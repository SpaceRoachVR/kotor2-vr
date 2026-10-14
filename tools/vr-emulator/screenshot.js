/**
 * Saves a PNG of the headset view from a running `npm run vr:play` session.
 *
 *   node tools/vr-emulator/screenshot.js [out.png] [--port 9422] [--count 1] [--interval 1000]
 *
 * Reads the desktop mirror (src/vr/runtime/VRDesktopMirror.ts) over CDP, so it
 * works while Allen is in the headset and never touches input or reloads the
 * page. Without a path, files go to Pictures\KOTOR2VR with a timestamped name.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CdpSession, findPageTarget } = require('./cdp');

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : fallback; };
const flagValues = new Set(['--port', '--count', '--interval'].flatMap((f) => [f, opt(f, null)]));
const outArg = argv.find((a) => !a.startsWith('--') && !flagValues.has(a));
const PORT = Number(opt('--port', process.env.KOTOR2VR_CDP_PORT || 9422));
const COUNT = Math.max(1, Number(opt('--count', 1)));
const INTERVAL = Math.max(0, Number(opt('--interval', 1000)));

function outputPath(index) {
  if (outArg && COUNT === 1) return path.resolve(outArg);
  const dir = outArg ? path.resolve(outArg) : path.join(os.homedir(), 'Pictures', 'KOTOR2VR');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return path.join(dir, `kotor2vr_${stamp}${COUNT > 1 ? `_${String(index + 1).padStart(3, '0')}` : ''}.png`);
}

async function main() {
  const target = await findPageTarget(PORT, (u) => /\/game\//.test(u));
  const cdp = await CdpSession.connect(target.webSocketDebuggerUrl);
  try {
    for (let i = 0; i < COUNT; i++) {
      const url = await cdp.evaluate(
        `(async () => {
          const mirror = window.VRSpike && window.VRSpike.desktopMirror;
          if (!mirror) throw new Error('VRSpike.desktopMirror is missing (old build?)');
          return await mirror.capture();
        })()`,
        { timeoutMs: 10000 },
      );
      if (typeof url !== 'string' || !url.startsWith('data:image/png;base64,')) {
        throw new Error(`capture returned ${typeof url === 'string' ? url.slice(0, 80) : typeof url}`);
      }
      const file = outputPath(i);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(url.slice('data:image/png;base64,'.length), 'base64'));
      console.log(file);
      if (i + 1 < COUNT) await new Promise((r) => setTimeout(r, INTERVAL));
    }
  } finally {
    cdp.close();
  }
}

main().catch((error) => { console.error(error.message || error); process.exit(1); });
