/**
 * Loads a 101PER checkpoint and inspects the mining-tunnel transition trigger
 * (newtransition -> 102per FROM_101PER at 36.2,-23.9): its box, faction,
 * triggered flag and what happens when the player is placed inside it.
 *   node tools/vr-emulator/probe-hatch-trigger.js [checkpoint]
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

const INSPECT = `(() => {
  const K = window.KotOR; const gs = K.GameState; const area = gs.module && gs.module.area;
  const p = K.PartyManager.party[0];
  const trigs = (area.triggers || []).map((t) => ({
    tag: String(t.tag), type: t.type, linkedToModule: t.linkedToModule, linkedTo: t.linkedTo,
    pos: [+t.position.x.toFixed(2), +t.position.y.toFixed(2), +t.position.z.toFixed(2)],
    box: t.box ? { min: t.box.min.toArray().map((v) => +v.toFixed(2)), max: t.box.max.toArray().map((v) => +v.toFixed(2)) } : null,
    verts: (t.vertices || t.geometry || []).slice(0, 8).map((v) => [+(v.x).toFixed(2), +(v.y).toFixed(2), +(v.z).toFixed(2)]),
    triggered: t.triggered, inside: (t.objectsInside || []).map((o) => String(o.tag)),
    factionId: t.factionId, faction: t.faction ? t.faction.id : null,
    hostileToPlayer: p ? t.isHostile(p) : null, rep: p ? K.FactionManager.GetReputation(t, p) : null,
    containsPlayer: p && t.box ? t.box.containsPoint(p.position) : null,
    hasMesh: !!t.mesh, meshVerts: t.mesh && t.mesh.geometry && t.mesh.geometry.attributes.position ? t.mesh.geometry.attributes.position.count : null,
  })).filter((t) => t.linkedToModule || /transition/i.test(t.tag));
  return { mode: gs.Mode, disableTransit: gs.disableTransit, module: area ? String(area.name) : null,
    player: p ? { tag: String(p.tag), pos: [+p.position.x.toFixed(2), +p.position.y.toFixed(2), +p.position.z.toFixed(2)], positionChanged: p.positionChanged } : null,
    hatchOpen: gs.GlobalVariableManager.GetGlobalNumber('101PER_Open_Hatch'), trigs };
})()`;

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, process.argv[2] || 'hatch-opened');
    await steps.sleep(4000);
    await steps.clearBlockingModal(harness);
    console.log('BEFORE', JSON.stringify(await harness.evaluate(INSPECT, { timeoutMs: 60000 }), null, 1));
    // Place the player on the trigger origin and let the engine tick.
    await harness.evaluate(`(() => { const p = window.KotOR.PartyManager.party[0]; p.position.set(36.2, -23.9, p.position.z); p.positionChanged = true; return true; })()`);
    await steps.sleep(3000);
    console.log('ON ORIGIN', JSON.stringify(await harness.evaluate(INSPECT, { timeoutMs: 60000 }), null, 1));
    const tail = harness.consoleMessages.filter((m) => /ModuleTrigger|LoadModule|transit|Transit/.test(m.text)).slice(-20).map((m) => `${m.level}: ${m.text}`.slice(0, 200));
    console.log(tail.join('\n'));
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
