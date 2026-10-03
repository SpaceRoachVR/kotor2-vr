/**
 * Real controller input, end to end (critic run 11: "vr:check:combat calls the
 * combat code directly and never moves a controller, so the B regression can't
 * fail it"). Loads "R15 PREPARED FIGHT", enters VR and drives the emulated Quest
 * controllers through WebXRActionDriver:
 *
 *  1. a tap of B pauses, a second tap resumes;
 *  2. holding B 0.9 s in combat stops combat and does not pause;
 *  3. the trigger press that opens the VR Menu from the wheel clicks nothing,
 *     and B closing the VR Menu does not pause;
 *  4. walking at the target with an open off hand does not cast a queued
 *     Force power (pose velocity is withheld, as on Virtual Desktop);
 *  5. a cast Force power spends Force points.
 *
 *   node tools/vr-emulator/check-real-input.js [--port 8512]
 *
 * Never saves. Exits 1 on a failed assertion. Logic only, not feel.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');
const { WebXRActionDriver } = require('./dsl/WebXRActionDriver');

const args = process.argv.slice(2);
const PORT = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 8512;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures.push(label);
};

const PAUSED = `!!window.KotOR.VRSpike.isPlayerPaused()`;
const log = (harness, re) => harness.evaluate(`(window.__xrHarness && window.__xrHarness.log || []).filter((e) => ${re}.test(e.text)).length`);

(async () => {
  const service = await startAssetService({ port: PORT });
  await waitForPort(PORT).catch(() => undefined);
  const harness = new VrHarness({ port: PORT + 950, headless: true });
  try {
    await steps.boot(harness, service.url);
    await harness.waitFor(`!!(window.KotOR.GameState.MenuManager.MainMenu && window.KotOR.GameState.MenuManager.MainMenu.bVisible)`, 120000, 1000);
    const found = await harness.evaluate(`(async () => { const K = window.KotOR; await K.SaveGame.GetSaveGames();
      const s = K.SaveGame.saves.find((x) => (x.getSaveName && x.getSaveName()) === 'R15 PREPARED FIGHT');
      if (!s) return false; K.GameState.MenuManager.ClearMenus(); Promise.resolve(s.load()).catch(() => undefined); return true; })()`);
    if (!found) { console.log('SKIP  no "R15 PREPARED FIGHT" save'); process.exitCode = 2; return; }
    await harness.waitFor(`(() => { const gs = window.KotOR.GameState; const p = window.KotOR.PartyManager.party[0];
      return !!(gs.module && p && p.position && gs.Mode === 1 && gs.module.readyToProcessEvents === true && !gs.loadingModule); })()`, 240000, 2000);
    await sleep(5000);
    await steps.enterVrSession(harness);
    await sleep(2000);
    // Virtual Desktop reports no pose velocity: withhold it, so every gesture
    // below goes through the position fallback the headset uses.
    await harness.evaluate(`(() => { const P = window.XRPose; if (!P) return false;
      Object.defineProperty(P.prototype, 'linearVelocity', { get() { return undefined; }, configurable: true });
      Object.defineProperty(P.prototype, 'angularVelocity', { get() { return undefined; }, configurable: true }); return true; })()`);
    const xr = new WebXRActionDriver(harness);

    // 1. Tap B: pause; tap again: resume.
    const before = await harness.evaluate(PAUSED);
    await xr.pressButton('right', 'b-button', 150);
    await sleep(400);
    const afterTap = await harness.evaluate(PAUSED);
    await xr.pressButton('right', 'b-button', 150);
    await sleep(400);
    const afterSecond = await harness.evaluate(PAUSED);
    check(before === false && afterTap === true && afterSecond === false, 'a tap of B pauses and a second tap resumes', `${before} -> ${afterTap} -> ${afterSecond}`);

    // Put the player 1.8 m from the nearest hostile and start a fight.
    const setup = await harness.evaluate(`(() => { const K = window.KotOR; const gs = K.GameState; const p = gs.getCurrentPlayer();
      let best = null, bd = 1e9; for (const c of gs.module.area.creatures) { if (!c || (c.isDead && c.isDead())) continue; let h = false; try { h = c.isHostile(p); } catch (e) {} if (!h) continue;
        const d = c.position.distanceTo(p.position); if (d < bd) { bd = d; best = c; } }
      if (!best) return null; try { best.addHP(400, true); } catch (e) {}
      const v = best.position.clone().sub(p.position); v.z = 0; v.normalize();
      p.position.copy(best.position.clone().sub(v.clone().multiplyScalar(1.8)));
      p.setFacing(Math.atan2(v.y, v.x) - Math.PI / 2, true); window.__t = best;
      return { id: best.id, tag: best.getTag() }; })()`);
    check(!!setup, 'a hostile to fight', setup ? setup.tag : '');
    if (!setup) return;
    await sleep(2500);
    await harness.evaluate(`(() => { const c = window.KotOR.VRSpike.hooks.getCombatContext(${setup.id}); if (c && c.onCombatSwing) c.onCombatSwing({ actorId: c.actorId, nominatedTargetId: c.nominatedTargetId, input: 'dominant-swing' }); return true; })()`);
    await sleep(1500);

    // 2. Hold B in combat: combat stops, the game is not paused.
    const cancelsBefore = await log(harness, /\[VR combat cancel\] edge=true/);
    await xr.pressButton('right', 'b-button', 900);
    await sleep(400);
    const cancelsAfter = await log(harness, /\[VR combat cancel\] edge=true/);
    const pausedAfterHold = await harness.evaluate(PAUSED);
    check(cancelsAfter > cancelsBefore, 'holding B 0.9 s cancels combat', `cancels ${cancelsBefore} -> ${cancelsAfter}`);
    check(pausedAfterHold === false, 'holding B does not pause the game');

    // 3. Open the VR Menu from the wheel with the trigger still down: no row changes.
    const opened = await harness.evaluate(`(() => { const vr = window.KotOR.VRSpike; window.__hand0 = vr.dominantHand;
      const wheel = vr.hooks.createActionWheel(null); const e = wheel.pages.flatMap((p) => p.entries).find((x) => x.label === 'VR Menu');
      if (!e) return false; return true; })()`);
    if (opened) {
      await xr.setButton('right', 'trigger', 1);
      await xr.setButton('left', 'trigger', 1);
      await harness.evaluate(`(() => { const vr = window.KotOR.VRSpike; const wheel = vr.hooks.createActionWheel(null);
        const e = wheel.pages.flatMap((p) => p.entries).find((x) => x.label === 'VR Menu'); (e.activate || e.item.activate)(); return true; })()`);
      await sleep(600);
      await xr.setButton('right', 'trigger', 0);
      await xr.setButton('left', 'trigger', 0);
      await sleep(300);
      const state = await harness.evaluate(`(() => { const vr = window.KotOR.VRSpike; return { open: !!vr.hooks.getComfortSettingsPanelContext(), same: vr.dominantHand === window.__hand0 }; })()`);
      check(state.open, 'the VR Menu opens from the wheel');
      check(state.same, 'the press that opened it clicked no row (dominant hand unchanged)');
      await xr.pressButton('right', 'b-button', 150);
      await sleep(500);
      const closed = await harness.evaluate(`(() => ({ open: !!window.KotOR.VRSpike.hooks.getComfortSettingsPanelContext(), paused: ${PAUSED} }))()`);
      check(!closed.open, 'B closes the VR Menu');
      check(closed.paused === false, 'B closing the VR Menu does not pause the game');
      if (closed.paused) { await xr.pressButton('right', 'b-button', 150); await sleep(300); }
    } else {
      check(false, 'the VR Menu is on the wheel');
    }

    // 4 and 5. Queue a Force power at the hostile.
    const queued = await harness.evaluate(`(() => { const vr = window.KotOR.VRSpike; const wheel = vr.hooks.createActionWheel(${setup.id}); const all = [];
      const walk = (m) => { for (const pg of m.pages) for (const e of pg.entries) { all.push(e); if (e.buildMenu) { try { walk(e.buildMenu()); } catch (x) {} } } }; walk(wheel);
      const p = all.find((x) => /stun|wound|affliction|slow|shock|lightning|choke|throw|push/i.test(String(x.label)) && typeof x.activate === 'function');
      if (!p) return { skipped: 'no targeted Force power on the wheel: ' + all.map((x) => x.label).join(', ') };
      p.activate(); const c = vr.hooks.getCombatContext(${setup.id});
      const pl = window.KotOR.GameState.getCurrentPlayer(); return { label: String(p.label), readout: c && c.stanceReadout, fp: pl.getFP(), max: pl.getMaxFP() }; })()`);
    if (queued.skipped) {
      console.log('  SKIP  Force: ' + queued.skipped);
    } else {
      check(!/^Force Power /.test(queued.label), 'the wheel names the power as the game does', queued.label);
      // 4. Walk toward the target with the off hand open and still: no cast.
      const released0 = await log(harness, /\[VR force cast\].*released/);
      await harness.evaluate(`(() => { const p = window.KotOR.GameState.getCurrentPlayer(); const t = window.__t;
        const v = t.position.clone().sub(p.position); v.z = 0; v.normalize(); p.position.copy(t.position.clone().sub(v.multiplyScalar(5))); return true; })()`);
      await sleep(800);
      await xr.moveThumbstick('left', 0, -1, 1500);
      await sleep(500);
      const released1 = await log(harness, /\[VR force cast\].*released/);
      const stillQueued = await harness.evaluate(`(() => { const c = window.KotOR.VRSpike.hooks.getCombatContext(${setup.id}); return c && c.stanceReadout; })()`);
      check(released1 === released0, 'walking at the target with an open hand casts nothing', `queue "${stillQueued}"`);
      // 5. Cast it: Force points are spent.
      const out = await harness.evaluate(`(() => { const c = window.KotOR.VRSpike.hooks.getCombatContext(${setup.id}); return c && c.onForceCastGesture ? c.onForceCastGesture() : 'no handler'; })()`);
      await sleep(4500);
      const fp = await harness.evaluate(`window.KotOR.GameState.getCurrentPlayer().getFP()`);
      check(out === true, 'the queued power casts on the gesture', String(out));
      check(fp < queued.fp, 'casting it spends Force points', `${queued.fp} -> ${fp} of ${queued.max}`);
    }
  } finally {
    await harness.close().catch(() => undefined);
    try { service.stop(); } catch (e) {}
  }
  console.log(failures.length ? `FAILED ${failures.length}` : 'PASSED');
  if (failures.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
