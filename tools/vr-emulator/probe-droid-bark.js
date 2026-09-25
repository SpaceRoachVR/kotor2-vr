/**
 * From the t3-rescued checkpoint, stand near 103PER's Maintenance Droid at
 * (-20.9,-3.1) and sample the conversation state every 400 ms for 24 s:
 * which dialog starts, how often, its entry/replies/scripts, and whether the
 * droid attacks. The stage F walker was interrupted by a 0-turn
 * "Maintenance Droid" conversation ~150 times.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

const SNAP = `(() => {
  const K = window.KotOR; const gs = K.GameState; const cm = gs.CutsceneManager; const p = K.PartyManager.party[0];
  const droid = (gs.module.area.creatures || []).find((c) => /Maintenance Droid/.test(String(c.getName())) && c.position.distanceTo(p.position) < 12);
  const e = cm.currentEntry;
  return { mode: gs.Mode, active: cm.active, dlg: cm.dialog ? String(cm.dialog.resref) : null, state: cm.state, owner: cm.owner ? String(cm.owner.getName ? cm.owner.getName() : cm.owner.tag) : null,
    entry: e ? { text: String(e.text || '').slice(0, 60), script: e.script ? String(e.script.name || e.script) : null, replies: (e.replies || []).length, delay: e.delay } : null,
    replies: (cm.currentReplies || []).map((r) => ({ t: String(r.text || '').slice(0, 30), cont: r.isContinueDialog(), end: r.isEndDialog ? r.isEndDialog() : null, script: r.script ? String(r.script.name || r.script) : null })),
    menus: (gs.MenuManager.activeMenus || []).map((m) => m.constructor.name + (m.bVisible ? '' : '(hidden)')),
    droid: droid ? { dist: +droid.position.distanceTo(p.position).toFixed(1), combat: droid.combatData ? droid.combatData.combatState : null, target: droid.combatData && droid.combatData.lastAttackTarget ? String(droid.combatData.lastAttackTarget.tag) : null, hp: droid.getHP(), queue: (droid.actionQueue || []).map((a) => a.constructor.name).slice(0, 4), locals: droid.localBooleans ? Object.entries(droid.localBooleans || {}).filter(([, v]) => v).map(([k]) => k).slice(0, 8) : null } : null,
    pcHp: p.getHP() };
})()`;

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, 't3-rescued');
    await steps.enterVrSession(harness);
    await steps.sleep(3000);
    const before = harness.consoleMessages.length;
    await harness.evaluate(`(() => { const p = window.KotOR.PartyManager.party[0]; p.position.set(-26, -3, 12.2); p.positionChanged = true; return true; })()`);
    let last = '';
    for (let i = 0; i < 60; i += 1) {
      await steps.sleep(400);
      const s = await harness.evaluate(SNAP).catch((e) => ({ error: String(e.message).slice(0, 100) }));
      const key = JSON.stringify(s);
      if (key !== last) { console.log(`t=${((i + 1) * 0.4).toFixed(1)}s`, key.slice(0, 700)); last = key; }
    }
    const starts = harness.consoleMessages.slice(before).filter((m) => /startConversation dlg=/.test(m.text)).length;
    const ends = harness.consoleMessages.slice(before).filter((m) => /endConversation/.test(m.text)).length;
    console.log(`STARTS ${starts} ENDS ${ends}`);
    const tail = harness.consoleMessages.slice(before).filter((m) => /startConversation|endConversation|ActionDialogObject|showEntry|No reply|k_def|k_ai|percept|Perception/i.test(m.text) && !/prompt candidacy|VR rooms|dialog rooms/.test(m.text)).slice(0, 30).map((m) => `${m.level}: ${m.text}`.slice(0, 220));
    console.log('CONSOLE'); for (const l of tail) console.log(l);
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
