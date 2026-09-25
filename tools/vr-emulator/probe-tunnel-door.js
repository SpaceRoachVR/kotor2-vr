/**
 * The walker pins at 102PER's fourth ordinary door (PeragusDoor1 at
 * -7.8,-16.7) right after opening it. Load the mining-tunnels checkpoint,
 * stand the player south-east of that door, open it, then drive north-west
 * through it while sampling position, the door's state and its walkmesh.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

const DOOR = `(() => {
  const K = window.KotOR; const gs = K.GameState; const area = gs.module.area; const p = K.PartyManager.party[0];
  const d = (area.doors || []).find((d) => Math.abs(d.position.x + 7.8) < 1 && Math.abs(d.position.y + 16.7) < 1);
  if (!d) return { door: null };
  const wm = d.collisionManager && d.collisionManager.walkmesh;
  return { door: { tag: String(d.tag), open: d.isOpen(), openState: d.openState, locked: d.isLocked(), passable: d.isOpen() || d.openState === 4,
    walkmeshInScene: !!(wm && wm.mesh && wm.mesh.parent), wmParent: wm && wm.mesh && wm.mesh.parent ? wm.mesh.parent.name : null,
    inWalkmeshList: Array.isArray(gs.walkmeshList) ? gs.walkmeshList.includes(wm) : null,
    walkTypes: wm ? (wm.walkTypes || []).slice(0, 12) : null, faces: wm ? (wm.faces || []).length : null, walkable: wm ? (wm.walkableFaces || []).length : null,
    modelAnim: d.model && d.model.animationManager && d.model.animationManager.currentAnimation ? d.model.animationManager.currentAnimation.name : null,
    rot: +d.rotation.z.toFixed(2) },
    player: { x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(2), room: p.room ? String(p.room.name) : null, blocked: p.blockingObject ? String(p.blockingObject.tag || p.blockingObject.constructor.name) : null } };
})()`;

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, 'mining-tunnels');
    await steps.enterVrSession(harness);
    await steps.sleep(3000);
    await harness.evaluate(`(() => { const p = window.KotOR.PartyManager.party[0]; p.position.set(-2, -22, 3.4); p.positionChanged = true; return true; })()`);
    await steps.sleep(1500);
    console.log('START', JSON.stringify(await harness.evaluate(DOOR)));
    const toDoor = await steps.moveTo(harness, { x: -7.3, y: -17.6, z: 3.4, range: 1.0, label: 'door approach', timeoutMs: 30000 }).catch((e) => ({ error: String(e.message) }));
    console.log('APPROACH', JSON.stringify(toDoor).slice(0, 300));
    console.log('AT DOOR', JSON.stringify(await harness.evaluate(DOOR)));
    const listed = await steps.listDoors(harness); const doors = Array.isArray(listed) ? listed : (listed.doors || []);
    const target = doors.find((d) => Math.abs(d.position.x + 7.8) < 1.5 && Math.abs(d.position.y + 16.7) < 1.5);
    console.log('LISTDOORS', JSON.stringify(target));
    if (target && !target.open) {
      const listedPrompts = await steps.listWorldPrompts(harness); const prompts = Array.isArray(listedPrompts) ? listedPrompts : (listedPrompts.prompts || []);
      console.log('PROMPTS', JSON.stringify(prompts).slice(0, 400));
      const open = prompts.find((pr) => /Door/i.test(pr.name || '') && Array.isArray(pr.actions) && pr.actions.some((a) => /^(Use|Open)/i.test(a)));
      console.log('OPEN VIA', JSON.stringify(open));
      if (open) await steps.activateWorldAction(harness, { objectId: open.id, actionLabel: open.actions.find((a) => /^(Use|Open)/i.test(a)) });
      await steps.sleep(3000);
    }
    console.log('OPENED', JSON.stringify(await harness.evaluate(DOOR)));
    for (let i = 0; i < 3; i += 1) {
      const through = await steps.moveTo(harness, { x: -12, y: -10, z: 3.4, range: 1.2, label: 'through', timeoutMs: 20000, usePath: i % 2 === 0 }).catch((e) => ({ error: String(e.message) }));
      console.log(`THROUGH ${i} usePath=${i % 2 === 0}`, JSON.stringify(through).slice(0, 200));
      console.log('STATE', JSON.stringify(await harness.evaluate(DOOR)));
    }
    const tail = harness.consoleMessages.filter((m) => /door|Door|collision|Collision|blocked|TypeError/.test(m.text) && !/prompt candidacy|VR rooms|dialog rooms/.test(m.text)).slice(-30).map((m) => `${m.level}: ${m.text}`.slice(0, 200));
    console.log(tail.join('\n'));
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
