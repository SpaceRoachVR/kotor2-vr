/**
 * Ad-hoc probe: where a module wedges the renderer main thread.
 *
 * 202TEL blocks on every sweep run, and the block is not an unresolved promise:
 * `evaluate` itself stops returning and the page cannot service `Page.reload`,
 * so only killing the browser recovers. That is the signature of a synchronous
 * loop, and no amount of evaluating JS will find it - the thread that would run
 * that JS is the thread that is stuck.
 *
 * The V8 inspector can interrupt a spinning script. Enable Debugger, start the
 * load, then send `Debugger.pause`: the `Debugger.paused` event comes back with
 * the call frames of whatever is looping. That is the measurement.
 *
 *   node tools/vr-emulator/probe-wedge.js --url "<launch url>" --module 202TEL
 */
const { VrHarness } = require('./harness');

async function clickButtonByText(harness, text) {
  const box = await harness.evaluate(`(() => {
    const wanted = ${JSON.stringify(text)}.toLowerCase();
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const btn = Array.from(document.querySelectorAll('button')).filter(visible)
      .find(b => (b.textContent || '').trim().toLowerCase() === wanted);
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!box) throw new Error(`No visible button labelled "${text}"`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await harness.cdp.send('Input.dispatchMouseEvent', {
      type, x: box.x, y: box.y, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0,
    });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const url = argv[argv.indexOf('--url') + 1];
  if (!url || url.startsWith('--')) throw new Error('--url <launch url> is required');
  const moduleArg = argv.indexOf('--module');
  const MODULE = moduleArg > -1 ? String(argv[moduleArg + 1]).toUpperCase() : '202TEL';
  const waitArg = argv.indexOf('--wait');
  const WAIT_MS = waitArg > -1 ? Number(argv[waitArg + 1]) : 90000;

  const harness = new VrHarness({ port: 9449 });
  try {
    await harness.launch(url);
    try {
      await harness.waitFor(
        `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`, 60_000);
      await clickButtonByText(harness, 'OK');
    } catch { /* already accepted */ }
    await harness.waitFor(`!!(window.KotOR && window.KotOR.GameState && window.KotOR.GameState.MenuManager)`, 240_000);
    await harness.waitFor(`!!window.KotOR.GameState.MenuManager.MainMenu`, 240_000);

    // The sweep reaches this module immediately after a soft Page.reload (the
    // heap-shedding path), not from a fresh browser. 202TEL loads perfectly in a
    // fresh browser, so the reload itself is the untested variable - and the one
    // condition a full relaunch never reproduces.
    if (argv.includes('--reload-first')) {
      console.log('soft-reloading the page, then re-booting as the sweep does…');
      await harness.cdp.send('Page.reload', { ignoreCache: false });
      await harness.waitFor('window.__xrHarness && window.__xrHarness.ready === true', 60_000);
      try {
        await harness.waitFor(
          `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`, 5_000);
        await clickButtonByText(harness, 'OK');
      } catch { /* acceptance persists across a reload */ }
      await harness.waitFor(`document.querySelector('#vr-spike-button') !== null`, 240_000, 2000);
      console.log('re-booted after soft reload');
    }

    // The sweep always establishes a party from a save before loading any
    // module. 202TEL loads fine from a cold main menu but blocks as the only
    // module in a sweep, so the save-established state is the live variable.
    if (argv.includes('--via-save')) {
      console.log('establishing party from save, as the sweep does…');
      await harness.evaluate(`(async () => {
        await window.KotOR.SaveGame.GetSaveGames();
        const gs = window.KotOR.GameState;
        gs.MenuManager.ClearMenus();
        if (gs.module) { try { gs.module.dispose(); } catch (e) {} gs.module = undefined; }
        Promise.resolve(window.KotOR.SaveGame.saves[0].load()).catch(() => undefined);
        return true;
      })()`, { timeoutMs: 300000 });
      await harness.waitFor(`(() => {
        const gs = window.KotOR.GameState;
        const p = window.KotOR.PartyManager && window.KotOR.PartyManager.Player;
        return !!(gs && gs.module && p && p.position && Number.isFinite(p.position.x));
      })()`, 300_000, 3000);
      console.log('party established');
    }

    // Capture the pause event before anything can fire it.
    let paused = null;
    harness.cdp.on('Debugger.paused', (params) => { if (!paused) paused = params; });
    await harness.cdp.send('Debugger.enable');

    // Fire and forget: if this wedges, the evaluate never returns, which is the
    // whole point. Do not await it.
    harness.cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const gs = window.KotOR.GameState;
        gs.loadingModule = false;
        gs.MenuManager.ClearMenus();
        gs.LoadModule('${MODULE}');
        return true;
      })()`,
      awaitPromise: false,
    }).catch(() => undefined);

    console.log(`load dispatched for ${MODULE}; waiting ${WAIT_MS}ms before interrupting…`);
    await new Promise((r) => setTimeout(r, WAIT_MS));

    // Is the thread actually stuck? A short evaluate that does not come back is
    // the confirmation; if it returns, the module is merely slow, not wedged.
    let responsive = false;
    try {
      await harness.cdp.send('Runtime.evaluate', { expression: '1+1', awaitPromise: false });
      responsive = true;
    } catch { /* timed out or errored: consistent with a wedge */ }

    console.log(`main thread responsive to a trivial evaluate: ${responsive}`);

    // If the thread is responsive, the sweep's block is not a wedge: its probe
    // polls for readyToProcessEvents and simply never gets it. Read the exact
    // state the probe is waiting on.
    if (responsive) {
      const state = await harness.evaluate(`(() => {
        const gs = window.KotOR.GameState;
        const m = gs.module;
        return {
          filename: String((m || {}).filename || ''),
          loadingModule: !!gs.loadingModule,
          readyToProcessEvents: m ? m.readyToProcessEvents : null,
          hasArea: !!(m && m.area),
          engineMode: String(gs.Mode),
          rooms: m && m.area && m.area.rooms ? m.area.rooms.length : null,
          creatures: m && m.area && m.area.creatures ? m.area.creatures.length : null,
        };
      })()`);
      console.log('STATE:', JSON.stringify(state, null, 1));

      // The sweep's frames phase awaits requestAnimationFrame 30 times with no
      // timeout. If rAF stops firing, that wait never returns - which looks
      // exactly like a crash from outside. Is the engine still painting?
      const raf = await harness.evaluate(`(async () => {
        let ticks = 0;
        const stop = Date.now() + 3000;
        await new Promise((resolve) => {
          const step = () => {
            ticks += 1;
            if (Date.now() >= stop) return resolve();
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
          setTimeout(resolve, 3500);
        });
        return { ticksIn3s: ticks, hidden: document.hidden,
                 visibility: document.visibilityState };
      })()`, { timeoutMs: 20000 });
      console.log('RAF:', JSON.stringify(raf));
    }

    await harness.cdp.send('Debugger.pause').catch(() => undefined);
    await new Promise((r) => setTimeout(r, 4000));

    if (!paused) {
      console.log('Debugger.paused never arrived — the thread did not yield even to the inspector.');
    } else {
      console.log('=== PAUSED — call frames (innermost first) ===');
      for (const frame of (paused.callFrames || []).slice(0, 20)) {
        const loc = frame.location || {};
        console.log(`  ${frame.functionName || '(anonymous)'}  @ script ${loc.scriptId}:${loc.lineNumber}:${loc.columnNumber}`);
      }
      console.log('reason:', paused.reason);
    }

    await harness.cdp.send('Debugger.resume').catch(() => undefined);
  } finally {
    await harness.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
