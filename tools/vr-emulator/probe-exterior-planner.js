/**
 * From the asteroid-exterior checkpoint, ask the engine's own walkmesh
 * planner for a route to 104PER's dormitory airlock trigger and follow it,
 * reporting the planned points and where the walk ends. Ground truth for
 * whether the exterior is one connected walkmesh the planner handles.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');
const peragus = require('./playthrough-peragus');

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, 'asteroid-exterior');
    await steps.enterVrSession(harness);
    await steps.sleep(3000);
    const target = { x: -50.3, y: -139.5, z: 256.7 };
    const planned = await harness.evaluate(`(() => {
      const K = window.KotOR; const player = K.PartyManager.party[0]; const area = K.GameState.module.area;
      const path = area.path.traverseToPoint(player, player.position.clone(), player.position.clone().set(${target.x}, ${target.y}, ${target.z}), true);
      const pts = (path.points || []).map((p) => [+p.vector.x.toFixed(1), +p.vector.y.toFixed(1), +p.vector.z.toFixed(1)]);
      path.dispose();
      return { count: pts.length, first: pts.slice(0, 6), last: pts.slice(-6), rooms: (area.rooms || []).length };
    })()`);
    console.log('PLANNED', JSON.stringify(planned));
    const chooser = peragus.createPriorityChooser([/^Got it|^Understood|^I'll do that/i], { label: 'Atton (exterior)', unseenFallback: true });
    const started = Date.now();
    let result;
    try {
      result = await steps.navigateTo(harness, { ...target, range: 1.0, label: 'airlock trigger (planned)', maxAttempts: 4, usePath: true });
    } catch (e) { result = { error: String(e.message).slice(0, 200) }; }
    await peragus.playAnyPendingConversation(harness, { choose: chooser, label: 'Atton (exterior)' }).catch(() => undefined);
    const where = await harness.evaluate(`(() => { const K = window.KotOR; const p = K.PartyManager.party[0]; return { module: String(K.GameState.module.area.name), pos: [+p.position.x.toFixed(1), +p.position.y.toFixed(1), +p.position.z.toFixed(1)] }; })()`);
    console.log('RESULT', JSON.stringify({ seconds: Math.round((Date.now() - started) / 1000), result, where }).slice(0, 600));
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
