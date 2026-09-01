/**
 * Ad-hoc probe: which phase of the sweep probe hangs on a module.
 *
 * 202TEL blocks on every sweep run, including as the only module in a run, yet
 * every part of it measures healthy in isolation: it loads fully
 * (readyToProcessEvents, 13 rooms, 18 creatures), the main thread stays
 * responsive, and requestAnimationFrame ticks at ~57fps. So the module is fine
 * and something in the probe's own later phases does not return.
 *
 * The probe reports its phase into `report`, which never comes back when it
 * hangs - so the phase is unreadable exactly when it matters. It now also
 * publishes to `window.__sweepPhase`, and because the thread is responsive a
 * second evaluate can read that while the first is still stuck.
 *
 * Dispatch the real probe source without awaiting it, then poll.
 *
 *   node tools/vr-emulator/probe-phase.js --url "<launch url>" --module 202TEL
 */
const { VrHarness } = require('./harness');
const { buildModuleProbeSource } = require('./module-probe');

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
  const watchArg = argv.indexOf('--watch-ms');
  const WATCH_MS = watchArg > -1 ? Number(argv[watchArg + 1]) : 300000;

  const harness = new VrHarness({ port: 9452 });
  try {
    await harness.launch(url);
    try {
      await harness.waitFor(
        `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`, 60_000);
      await clickButtonByText(harness, 'OK');
    } catch { /* already accepted */ }
    await harness.waitFor(`document.querySelector('#vr-spike-button') !== null`, 240_000, 2000);

    // Mirror the sweep's boot exactly: a party established from a save.
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
    // Which module does the save sit in, and does the engine consider the
    // target module "saved"? LoadModule writes the OUTGOING module's .sav before
    // disposing it, so entering the module the save was already in reads a .sav
    // written seconds earlier - a completely different path from a pristine load.
    const saveContext = await harness.evaluate(`(async () => {
      const K = window.KotOR;
      const save = K.SaveGame.saves[0];
      const CG = K.GameState.CurrentGame || K.CurrentGame;
      const isSaved = async (n) => {
        try { return await CG.IsModuleSaved(n); } catch (e) { return 'threw:' + String(e && e.message || e); }
      };
      return {
        saveName: String(save && save.getName ? save.getName() : ''),
        saveLastModule: String(save && save.getLastModule ? save.getLastModule() : ''),
        currentModule: String((K.GameState.module || {}).filename || ''),
        isModuleSavedTarget: await isSaved('${MODULE}'),
        isLoadingSave: !!K.GameState.isLoadingSave,
        // IsModuleSaved matches any file named <module>.* in gameinprogress, so
        // list what is actually there rather than infer from the boolean.
        gameInProgress: await (async () => {
          try {
            return await K.GameFileSystem.readdir('gameinprogress');
          } catch (e) { return 'threw:' + String(e && e.message || e); }
        })(),
        // Does the .sav we wrote actually contain the field? This separates
        // "written without it" from "read without it" - opposite fixes.
        savHasTemplateResRef: await (async () => {
          try {
            const bytes = await K.GameFileSystem.readFile('gameinprogress/001ebo.sav');
            const text = new TextDecoder('latin1').decode(bytes);
            return { bytes: bytes.length,
                     hasLabel: text.indexOf('TemplateResRef') >= 0,
                     labelCount: text.split('TemplateResRef').length - 1 };
          } catch (e) { return 'threw:' + String(e && e.message || e); }
        })(),
      };
    })()`, { timeoutMs: 60000 });
    console.log('SAVE CONTEXT (before load):', JSON.stringify(saveContext));

    console.log('party established; dispatching the real sweep probe (not awaited)…');

    await harness.evaluate(`(() => { window.__sweepPhase = '(not started)';
      window.__sweepDone = false; return true; })()`);

    // A single BaseItem.From2DA is bounded work, so a stack caught inside it
    // means it is being called an enormous number of times. Count addItem so
    // the paused frame can say whether this is a big-but-finite inventory or a
    // runaway loop.
    await harness.evaluate(`(() => {
      const proto = window.KotOR.ModuleObject.prototype;
      if (proto.__addItemCounted) return 'already';
      const original = proto.addItem;
      window.__addItemCount = 0;
      proto.addItem = function () {
        window.__addItemCount += 1;
        return original.apply(this, arguments);
      };
      proto.__addItemCounted = true;
      return 'counting';
    })()`);

    const source = buildModuleProbeSource(MODULE, { loadTimeoutMs: 300000, frames: 30, settleMs: 5000 });
    harness.cdp.send('Runtime.evaluate', {
      expression: `Promise.resolve((${source})).then((r) => {
        window.__sweepDone = true; window.__sweepResult = r;
      }, (e) => { window.__sweepDone = true; window.__sweepError = String(e && e.stack || e); });`,
      awaitPromise: false,
    }).catch(() => undefined);

    // The page stops answering evaluate once it wedges, so the phase readout
    // goes dark exactly when the stack matters. The V8 inspector can still
    // interrupt a spinning script: pause it and read the frames.
    let paused = null;
    harness.cdp.on('Debugger.paused', (params) => { if (!paused) paused = params; });
    await harness.cdp.send('Debugger.enable').catch(() => undefined);
    let pauseSent = false;

    const started = Date.now();
    let last = null;
    while (Date.now() - started < WATCH_MS) {
      await new Promise((r) => setTimeout(r, 2000));
      let snap;
      try {
        snap = await harness.evaluate(`({
          phase: String(window.__sweepPhase),
          done: !!window.__sweepDone,
          error: window.__sweepError || null,
        })`, { timeoutMs: 15000 });
      } catch (e) {
        console.log(`[${Math.round((Date.now() - started) / 1000)}s] page stopped answering: ${String(e.message || e).slice(0, 90)}`);
        if (!pauseSent) {
          pauseSent = true;
          console.log('  interrupting the spinning script…');
          await harness.cdp.send('Debugger.pause').catch(() => undefined);
          await new Promise((r) => setTimeout(r, 5000));
          if (paused) {
            console.log('=== PAUSED — call frames (innermost first) ===');
            for (const frame of (paused.callFrames || []).slice(0, 25)) {
              const loc = frame.location || {};
              const u = (paused.__urls || {})[loc.scriptId];
              console.log(`  ${frame.functionName || '(anonymous)'} @ ${u || 'script ' + loc.scriptId}:${loc.lineNumber}:${loc.columnNumber}`);
            }
            // The page is paused, so Runtime.evaluate is unavailable - but the
            // paused frame can still be evaluated in.
            const top = (paused.callFrames || [])[0];
            if (top) {
              const read = async (expr) => {
                try {
                  const r = await harness.cdp.send('Debugger.evaluateOnCallFrame', {
                    callFrameId: top.callFrameId, expression: expr, returnByValue: true,
                  });
                  return r && r.result ? r.result.value : undefined;
                } catch (e) { return 'err:' + String(e.message || e).slice(0, 60); }
              };
              const first = await read('window.__addItemCount');
              console.log('addItem calls so far:', first);

              // Which script is looping? Walk the frames for an NWScriptInstance.
              for (let i = 0; i < Math.min(14, paused.callFrames.length); i += 1) {
                const f = paused.callFrames[i];
                try {
                  const r = await harness.cdp.send('Debugger.evaluateOnCallFrame', {
                    callFrameId: f.callFrameId,
                    expression: `(() => { try { return (this && (this.name || this.scriptName))
                      ? String(this.name || this.scriptName) : null; } catch (e) { return null; } })()`,
                    returnByValue: true,
                  });
                  const v = r && r.result ? r.result.value : null;
                  if (v) console.log(`  frame ${i} (${f.functionName || '(anon)'}) script name: ${v}`);
                } catch { /* frame not evaluable */ }
              }
              await harness.cdp.send('Debugger.resume').catch(() => undefined);
              await new Promise((r) => setTimeout(r, 8000));
              paused = null;
              await harness.cdp.send('Debugger.pause').catch(() => undefined);
              await new Promise((r) => setTimeout(r, 4000));
              if (paused && paused.callFrames && paused.callFrames[0]) {
                const t2 = paused.callFrames[0];
                const r2 = await harness.cdp.send('Debugger.evaluateOnCallFrame', {
                  callFrameId: t2.callFrameId, expression: 'window.__addItemCount',
                  returnByValue: true,
                }).catch(() => null);
                const second = r2 && r2.result ? r2.result.value : undefined;
                console.log('addItem calls 8s later:', second,
                  '=> growing:', typeof first === 'number' && typeof second === 'number'
                    ? (second - first) : 'unknown');
                console.log('  still inside:', (paused.callFrames || []).slice(0, 6)
                  .map((f) => f.functionName || '(anon)').join(' < '));
              }
            }
            return;
          }
          console.log('  no Debugger.paused event: the thread will not yield even to the inspector.');
        }
        continue;
      }
      if (snap.phase !== last) {
        console.log(`[${Math.round((Date.now() - started) / 1000)}s] phase -> ${snap.phase}`);
        last = snap.phase;
      }
      if (snap.done) {
        console.log('probe returned. error:', snap.error || '(none)');
        // The point of this run: compare what the sweep probe concluded against
        // a live re-read of the same objects, in the same page, moments later.
        // Two contradictory readings of templateResRef on one build is either a
        // timing effect or a difference in what is being counted.
        const compare = await harness.evaluate(`(() => {
          const r = window.__sweepResult || {};
          const codes = {};
          for (const f of (r.findings || [])) codes[f.code] = (codes[f.code] || 0) + 1;
          const area = window.KotOR.GameState.module.area;
          const all = [].concat(area.placeables || [], area.doors || [], area.creatures || []);
          const missingNow = all.filter((o) => !o.templateResRef);
          return {
            probeFindings: codes,
            probeCounts: r.counts,
            liveTotal: all.length,
            liveMissing: missingNow.length,
            liveSample: all.slice(0, 3).map((o) => ({
              name: (() => { try { return o.getName(); } catch (e) { return '?'; } })(),
              templateResRef: o.templateResRef || null,
              hasField: !!(o.template && o.template.RootNode
                && o.template.RootNode.hasField('TemplateResRef')),
            })),
            missingSample: missingNow.slice(0, 3).map((o) => ({
              name: (() => { try { return o.getName(); } catch (e) { return '?'; } })(),
              templateResRef: o.templateResRef || null,
              hasField: !!(o.template && o.template.RootNode
                && o.template.RootNode.hasField('TemplateResRef')),
            })),
          };
        })()`, { timeoutMs: 60000 });
        const after = await harness.evaluate(`(async () => {
          const K = window.KotOR;
          const CG = K.GameState.CurrentGame || K.CurrentGame;
          let saved = null;
          try { saved = await CG.IsModuleSaved('${MODULE}'); } catch (e) { saved = 'threw'; }
          let dir = null;
          try { dir = await K.GameFileSystem.readdir('gameinprogress'); } catch (e) { dir = 'threw'; }
          return { isModuleSavedTarget: saved, isLoadingSave: !!K.GameState.isLoadingSave,
                   gameInProgress: dir };
        })()`, { timeoutMs: 60000 });
        console.log('SAVE CONTEXT (after load):', JSON.stringify(after));
        console.log('COMPARE:', JSON.stringify(compare, null, 1));
        return;
      }
    }
    console.log(`probe never returned within ${WATCH_MS}ms; stuck in phase: ${last}`);
  } finally {
    await harness.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
