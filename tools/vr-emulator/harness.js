/**
 * Automated VR test harness.
 *
 * Runs the browser build against an emulated Quest 3 so VR behaviour can be
 * exercised without a headset. This is the scriptable equivalent of the
 * Immersive Web Emulator Chrome extension: the extension is a DevTools-panel
 * GUI over Meta's IWER runtime, and a DevTools panel cannot be driven
 * programmatically, so we inject the same runtime (`iwer`) ourselves and drive
 * it over CDP.
 *
 * What this can and cannot prove:
 *   - CAN: session lifecycle, per-frame update/render ownership, input routing,
 *     the action wheel, world prompts, panels, locomotion maths, and anything
 *     else that is engine logic reacting to XR poses and button values.
 *   - CANNOT: comfort, real compositor cadence, reprojection, lens-level visual
 *     correctness. IWER renders through the ordinary page WebGL context, so
 *     frametimes here are not headset frametimes. Device evidence is still
 *     required for anything the roadmap gates on comfort or performance.
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { CdpSession, waitForEndpoint, findPageTarget } = require('./cdp');

const IWER_BUNDLE = path.join(__dirname, '..', '..', 'node_modules', 'iwer', 'build', 'iwer.js');
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
];

function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (listening) => {
      socket.destroy();
      resolve(listening);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

function resolveChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Could not find chrome.exe');
}

/**
 * Source injected before any page script runs. It installs the emulated device
 * so `navigator.xr` is already the IWER runtime by the time the engine probes
 * `isSessionSupported` — the engine only builds its Enter VR button once, at
 * startup, so a late install would leave the button disabled.
 */
function buildBootstrap(deviceName) {
  const runtime = fs.readFileSync(IWER_BUNDLE, 'utf8');
  return `${runtime}
;(function () {
  try {
    var config = IWER[${JSON.stringify(deviceName)}];
    if (!config) throw new Error('Unknown IWER device: ' + ${JSON.stringify(deviceName)});
    var device = new IWER.XRDevice(config);
    // Chrome exposes a native XRSystem on navigator.xr even with no headset and
    // no OpenXR runtime, and IWER refuses to clobber what looks like a real
    // runtime. Without forceInstall the device installs but navigator.xr stays
    // native, so isSessionSupported('immersive-vr') answers false and the
    // engine's Enter VR button comes up disabled.
    device.installRuntime({ forceInstall: true });
    // Stereo needs a canvas-backed context; IWER renders through the page's own
    // WebGL context, so nothing further is required here.
    window.__xrDevice = device;
    var log = [];
    window.__xrHarness = {
      ready: true,
      deviceName: ${JSON.stringify(deviceName)},
      log: log,
    };
    // CDP reports object arguments as "Object" unless each is fetched by id.
    // Serialising at the call site keeps warning payloads readable, which is
    // the whole point of the engine's diagnostics.
    //
    // This must NOT use JSON.stringify. stringify invokes toJSON() on every
    // nested value, and THREE's Texture.toJSON warns
    // 'THREE.Texture: Unable to serialize Texture.' for any texture whose image
    // it cannot encode. The engine logs objects that reach THREE materials all
    // the time, so stringifying them made the harness itself emit ~30k warnings
    // in a single run — 98% of all console output, in the middle of the exact
    // loop we are measuring. Walk plain containers by hand instead and render
    // anything else by constructor name, so nothing is ever asked to serialise.
    function describe(value, depth, seen) {
      if (value === null) return 'null';
      var type = typeof value;
      if (type === 'string') return depth === 0 ? value : JSON.stringify(value);
      if (type === 'number' || type === 'boolean' || type === 'undefined') return String(value);
      if (type === 'bigint') return value.toString() + 'n';
      if (type === 'function') return '[fn ' + (value.name || 'anonymous') + ']';
      if (type === 'symbol') return value.toString();
      if (value instanceof Error) return value.stack || String(value);
      if (seen.has(value)) return '[circular]';
      if (depth > 4) return '[deep]';
      seen.add(value);
      if (Array.isArray(value)) {
        var items = value.slice(0, 20).map(function (v) { return describe(v, depth + 1, seen); });
        if (value.length > 20) items.push('… +' + (value.length - 20));
        return '[' + items.join(', ') + ']';
      }
      var ctor = value.constructor && value.constructor.name;
      // Only walk plain objects. A class instance is named, not expanded —
      // expanding engine/THREE objects is what caused the flood.
      if (ctor && ctor !== 'Object') return '[' + ctor + ']';
      var keys = Object.keys(value).slice(0, 30);
      return '{' + keys.map(function (k) {
        return k + ': ' + describe(value[k], depth + 1, seen);
      }).join(', ') + (Object.keys(value).length > 30 ? ', …' : '') + '}';
    }

    ['log', 'info', 'warn', 'error'].forEach(function (level) {
      var original = console[level].bind(console);
      console[level] = function () {
        try {
          var parts = Array.prototype.map.call(arguments, function (arg) {
            return describe(arg, 0, new WeakSet());
          });
          log.push({ level: level, text: parts.join(' ') });
          if (log.length > 5000) log.shift();
        } catch (e) { /* never let logging break the run */ }
        return original.apply(null, arguments);
      };
    });
  } catch (error) {
    window.__xrHarness = { ready: false, error: String(error && error.stack || error) };
  }
})();`;
}

class VrHarness {
  constructor(options = {}) {
    this.port = options.port || 9422;
    this.deviceName = options.device || 'metaQuest3';
    this.userDataDir = options.userDataDir;
    this.headless = options.headless === true;
    this.consoleMessages = [];
    this.pageErrors = [];
    this.chrome = null;
    this.cdp = null;
  }

  async launch(url) {
    const chromePath = resolveChrome();
    // A previous run whose Chrome outlived it still holds this port. Chrome
    // would fail to bind, `waitForEndpoint` would happily answer from the *old*
    // browser, and the scenario would drive a stale page — which surfaces as a
    // baffling timeout waiting for a button that was clicked minutes ago.
    if (await isPortListening(this.port)) {
      throw new Error(
        `CDP port ${this.port} is already in use — a previous harness Chrome is still ` +
        `running. Close it (or pass a different port) before launching.`
      );
    }
    const userDataDir =
      this.userDataDir ||
      path.join(process.env.TEMP || '.', `kotor2vr-emul-${process.pid}-${this.port}`);
    fs.mkdirSync(userDataDir, { recursive: true });

    const args = [
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${this.port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      // Software rendering is far too slow for this engine; keep real GPU.
      '--enable-unsafe-webgpu',
      '--window-size=1600,1000',
    ];
    if (this.headless) args.push('--headless=new');
    args.push(url);

    this.chrome = spawn(chromePath, args, { detached: false, stdio: 'ignore' });
    await waitForEndpoint(this.port);

    const target = await findPageTarget(this.port, (u) => u.startsWith('http://'));
    this.cdp = await CdpSession.connect(target.webSocketDebuggerUrl);

    this.cdp.on('Runtime.consoleAPICalled', (params) => {
      const text = (params.args || [])
        .map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type))
        .join(' ');
      this.consoleMessages.push({ level: params.type, text });
    });
    this.cdp.on('Runtime.exceptionThrown', (params) => {
      const d = params.exceptionDetails || {};
      this.pageErrors.push(
        (d.exception && d.exception.description) || d.text || 'unknown page exception'
      );
    });

    await this.cdp.send('Runtime.enable');
    await this.cdp.send('Page.enable');
    await this.cdp.send('Log.enable');
    await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: buildBootstrap(this.deviceName),
    });
    // The bootstrap only takes effect on a fresh document, and the first
    // navigation already happened during launch.
    await this.cdp.send('Page.reload', { ignoreCache: false });
    await this.waitFor('window.__xrHarness && window.__xrHarness.ready === true', 30000);
    return this;
  }

  async waitFor(expression, timeoutMs = 60000, pollMs = 250) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      try {
        const value = await this.cdp.evaluate(`!!(${expression})`);
        if (value === true) return true;
        last = value;
      } catch (error) {
        last = error.message;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(`waitFor timed out after ${timeoutMs}ms: ${expression} (last: ${last})`);
  }

  evaluate(expression, options) {
    return this.cdp.evaluate(expression, options);
  }

  /**
   * Click through CDP input rather than `element.click()` so the press counts
   * as a user activation — `requestSession('immersive-vr')` is gated on one.
   */
  async clickSelector(selector) {
    const box = await this.cdp.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (!box) throw new Error(`No element matched ${selector}`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.cdp.send('Input.dispatchMouseEvent', {
        type,
        x: box.x,
        y: box.y,
        button: 'left',
        clickCount: 1,
        buttons: type === 'mousePressed' ? 1 : 0,
      });
    }
    return box;
  }

  consoleSince(index = 0) {
    return this.consoleMessages.slice(index);
  }

  async close() {
    if (this.cdp) this.cdp.close();
    if (this.chrome && !this.chrome.killed) {
      try {
        process.kill(this.chrome.pid);
      } catch {
        /* already exited */
      }
    }
  }
}

module.exports = { VrHarness, buildBootstrap };
