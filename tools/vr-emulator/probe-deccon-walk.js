/**
 * Stands the party north of 106PER's Decontamination Console (62.3,20.3) and
 * drives the real thumbstick approach the walker uses, sampling canMove,
 * engine mode, effects and the gas triggers while it pushes. Run 14 stalled
 * there at (62.43,23.06) with nothing queued, while a raw forceVector push
 * from the same spot reached the console.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

const SNAP = `(() => { const K = window.KotOR; const p = K.PartyManager.party[0]; const gs = K.GameState;
  return { pos: [+p.position.x.toFixed(2), +p.position.y.toFixed(2), +p.position.z.toFixed(2)], canMove: p.canMove ? p.canMove() : null, mode: gs.Mode, force: [+p.forceVector.x.toFixed(2), +p.forceVector.y.toFixed(2)], speed: +Number(p.speed || 0).toFixed(2),
    effects: (p.effects || []).map((e) => e.constructor && e.constructor.name).slice(0, 8), hp: p.getHP(), anim: p.animationState ? p.animationState.index : null, controlled: p.controlled, room: p.room && p.area ? p.area.rooms.indexOf(p.room) : null,
    followers: K.PartyManager.party.slice(1).map((m) => [String(m.tag), +m.position.x.toFixed(1), +m.position.y.toFixed(1)]), inGas: (gs.module.area.triggers || []).filter((t) => t && /gas/i.test(String(t.tag)) && t.box && t.box.containsPoint(p.position)).map((t) => String(t.tag)) }; })()`;

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, 'hangar-door-open');
    await steps.enterVrSession(harness);
    await steps.sleep(3000);
    // Leader north of the console with a follower standing between them in
    // the 2.5 m strip, as run 14 had Atton 1.9 m away when it stalled.
    await harness.evaluate(`(() => { const spots = [[62.9, 23.3], [62.4, 21.6], [63.0, 25.0]]; window.KotOR.PartyManager.party.forEach((m, i) => { const s = spots[i] || spots[2]; m.position.set(s[0], s[1], 0.9); m.positionChanged = true; if (m.collisionManager) { m.collisionManager.groundFace = undefined; m.collisionManager.findWalkableFace(); } }); return true; })()`);
    await steps.sleep(1500);
    console.log('PLACED', JSON.stringify(await harness.evaluate(SNAP)));
    const samples = [];
    const sampler = (async () => { for (let i = 0; i < 40; i += 1) { await steps.sleep(250); samples.push(await harness.evaluate(SNAP).catch((e) => ({ error: String(e.message).slice(0, 60) }))); } })();
    const walk = await steps.moveTo(harness, { x: 62.3, y: 20.3, z: 0.9, range: 1.2, label: 'to the console', timeoutMs: 10000, usePath: false }).catch((e) => ({ error: String(e.message).slice(0, 300) }));
    await sampler;
    console.log('WALK', JSON.stringify(walk).slice(0, 400));
    let prev = '';
    for (const s of samples) { const k = JSON.stringify(s); if (k !== prev) console.log('SAMPLE', k); prev = k; }
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
