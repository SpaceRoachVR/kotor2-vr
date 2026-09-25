/**
 * Beside 153HAR's kreia_sion_door (from the harbinger-engine-deck checkpoint,
 * by teleport): report the door's fields and what the VR prompt system
 * offers for it, then try Use and report the door state.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

const DOOR = `(() => {
  const K = window.KotOR; const area = K.GameState.module.area;
  const d = (area.doors || []).find((d) => String(d.tag) === 'kreia_sion_door');
  if (!d) return null;
  return { id: d.id, tag: String(d.tag), name: String(d.getName()), open: d.isOpen(), openState: d.openState, locked: d.isLocked(), lockedField: d.locked, keyRequired: d.keyRequired, keyName: d.keyName, plot: d.plot, static: d.static, useable: typeof d.isUseable === 'function' ? d.isUseable() : null,
    scripts: Object.fromEntries(Object.entries(d.scripts || {}).filter(([, v]) => v).map(([k, v]) => [k, String(v.name || v)])), conversation: d.conversation ? String(d.conversation.resref) : null, transition: d.linkedToModule || null, hp: d.getHP(), pos: [+d.position.x.toFixed(1), +d.position.y.toFixed(1)] };
})()`;

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, 'harbinger-engine-deck');
    await steps.enterVrSession(harness);
    await steps.sleep(3000);
    await harness.evaluate(`(() => { const p = window.KotOR.PartyManager.party[0]; p.position.set(10.5, -1.9, 0.01); p.positionChanged = true; return true; })()`);
    await steps.sleep(1500);
    console.log('DOOR', JSON.stringify(await harness.evaluate(DOOR)));
    const prompts = await steps.listWorldPrompts(harness);
    console.log('PROMPTS', JSON.stringify((prompts.prompts || []).filter((p) => /door/i.test(p.name || ''))));
    const doors = await steps.listDoors(harness);
    console.log('LISTDOORS', JSON.stringify((doors.doors || []).filter((d) => d.tag === 'kreia_sion_door')));
    const tail = harness.consoleMessages.filter((m) => /VR prompt|prompt candidacy|lockGate|kreia_sion/i.test(m.text)).slice(-12).map((m) => `${m.level}: ${m.text}`.slice(0, 260));
    console.log('CONSOLE'); for (const l of tail) console.log(l);
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
