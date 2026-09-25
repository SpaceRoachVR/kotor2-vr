/**
 * Reproduces the 153HAR -> 103PER arrival without replaying the Harbinger:
 * from the fuel-line checkpoint it reloads 103PER through the engine's own
 * LoadModule with the authored waypoint (From_153HAR, inside the fuel pipe
 * at -36.81,-18.24,12.25) and samples where the Exile is, in which room, for
 * the next seconds, with every setPosition/attachToRoom call stack. The
 * stage E run ended that arrival at (-36.77,-5.5) on the deck outside the
 * pipe, 12.7 m north of the waypoint, so T3 was sealed off.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

const SNAP = `(() => {
  const K = window.KotOR; const p = K.PartyManager.party[0]; if (!p) return null;
  return { t: Math.round(performance.now()), pos: [+p.position.x.toFixed(2), +p.position.y.toFixed(2), +p.position.z.toFixed(2)], room: p.room && p.area ? p.area.rooms.indexOf(p.room) : null,
    force: [+p.forceVector.x.toFixed(2), +p.forceVector.y.toFixed(2)], mode: K.GameState.Mode, loading: !!K.GameState.loadingModule, module: K.GameState.module && K.GameState.module.area ? K.GameState.module.area.name : null };
})()`;

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, 'fuel-line');
    await steps.enterVrSession(harness);
    await steps.sleep(3000);
    console.log('BEFORE', JSON.stringify(await harness.evaluate(SNAP)));
    await harness.evaluate(`(() => {
      const K = window.KotOR; const p = K.PartyManager.party[0]; window.__moves = [];
      const stack = () => String(new Error().stack).split(String.fromCharCode(10)).slice(2, 9).map((s) => s.trim().slice(0, 100));
      const origSet = p.setPosition.bind(p);
      p.setPosition = (...a) => { window.__moves.push({ t: Math.round(performance.now()), kind: 'setPosition', to: a[0] && a[0].x !== undefined ? [+a[0].x.toFixed(2), +a[0].y.toFixed(2)] : String(a[0]), stack: stack() }); return origSet(...a); };
      const origAttach = p.attachToRoom.bind(p);
      p.attachToRoom = (room) => { const from = p.room && p.area ? p.area.rooms.indexOf(p.room) : null; const to = room && p.area ? p.area.rooms.indexOf(room) : null; if (from !== to) window.__moves.push({ t: Math.round(performance.now()), kind: 'attachToRoom', from, to, pos: [+p.position.x.toFixed(2), +p.position.y.toFixed(2), +p.position.z.toFixed(2)], stack: stack() }); return origAttach(room); };
      const origCopy = p.position.copy.bind(p.position);
      p.position.copy = (v) => { window.__moves.push({ t: Math.round(performance.now()), kind: 'position.copy', to: [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)], stack: stack() }); return origCopy(v); };
      // Hold the stick forward through the load, as the walker's push into
      // the transition trigger did on the stage E run.
      const controller = window.__xrDevice && window.__xrDevice.controllers && window.__xrDevice.controllers.left;
      if (controller && typeof controller.updateAxes === 'function') controller.updateAxes('thumbstick', 0, -1);
      K.GameState.LoadModule('103per', 'From_153HAR');
      return true;
    })()`);
    setTimeout(() => harness.evaluate(`(() => { const c = window.__xrDevice.controllers.left; c.updateAxes('thumbstick', 0, 0); return true; })()`).catch(() => undefined), 8000);
    const samples = [];
    for (let i = 0; i < 80; i += 1) {
      await steps.sleep(250);
      const s = await harness.evaluate(SNAP).catch((e) => ({ error: String(e.message).slice(0, 60) }));
      samples.push(s);
    }
    for (const s of samples) console.log('SAMPLE', JSON.stringify(s));
    const moves = await harness.evaluate(`window.__moves`).catch(() => []);
    console.log('MOVES', moves.length);
    for (const m of moves) console.log(JSON.stringify(m));
    console.log('END', JSON.stringify(await harness.evaluate(SNAP)));
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
