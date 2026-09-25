/**
 * Replays the Fuel Control Station step from the t3-fuel-depot checkpoint and
 * records the engine's state every two seconds through the ambush and the
 * return to 101PER, then dumps the conversation-related console lines.
 * Diagnostic for the stuck 101atton conversation after the player switch.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');
const peragus = require('./playthrough-peragus');

const SNAP = `(() => {
  const K = window.KotOR; const gs = K.GameState; const cm = gs.CutsceneManager; const p = K.PartyManager.party[0];
  return {
    t: Math.round(performance.now() / 100) / 10, mode: gs.Mode,
    module: gs.module && gs.module.area ? String(gs.module.area.name) : null,
    player: p ? { tag: String(p.tag || ''), ctor: p.constructor.name, lvl: p.getTotalClassLevel ? p.getTotalClassLevel() : null, hp: p.getHP ? p.getHP() + '/' + p.getMaxHP() : null, gender: p.getGender ? p.getGender() : null, isPlayer: p.isPlayer } : null,
    partyTags: K.PartyManager.party.map((m) => String(m.tag || '')),
    dialog: cm && cm.dialog ? String(cm.dialog.resref) : null, active: cm ? cm.active : null, state: cm ? cm.state : null,
    entry: cm && cm.currentEntry ? String(cm.currentEntry.text || '').slice(0, 60) : null,
    menuVisible: !!(gs.MenuManager.InGameDialog && gs.MenuManager.InGameDialog.bVisible),
    t3end: gs.GlobalVariableManager.GetGlobalNumber('105PER_T3_End'), attonHatch: gs.GlobalVariableManager.GetGlobalNumber('101PER_Atton_Hatch'),
  };
})()`;

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, 't3-fuel-depot');
    await steps.enterVrSession(harness);
    await steps.sleep(2000);
    const consoleStart = harness.consoleMessages.length;
    await peragus.travelTo(harness, { x: -28.4, y: 1.4, z: 22.4, label: 'Fuel Control Station', range: 2.4, sweepRadius: 16, rounds: 4 });
    const chooser = peragus.createPriorityChooser([/Call up emergency system schematics/i, /Open emergency hatch on Peragus Administration Level/i, /^Log out/i], { label: 'fuelcon' });
    await peragus.useAndConverse(harness, { tag: 'ComputerPanel', near: { x: -28.4, y: 1.4, z: 22.4 }, choose: chooser, label: 'fuelcon' });
    const snaps = [];
    for (let i = 0; i < 100; i += 1) {
      const s = await harness.evaluate(SNAP).catch((e) => ({ error: String(e) }));
      const last = snaps[snaps.length - 1];
      if (!last || JSON.stringify({ ...s, t: 0 }) !== JSON.stringify({ ...last, t: 0 })) { snaps.push(s); console.log(JSON.stringify(s)); }
      if (s.module === '101per' && s.mode === 1 && i > 10) break;
      await steps.sleep(2000);
    }
    const lines = harness.consoleMessages.slice(consoleStart).map((m) => `${m.level}: ${m.text}`)
      .filter((l) => /Conversation|conversation|Switch|transform|Atton|atton|hatch|Hatch|LoadModule|StartNewModule|error|Error|101atton|delhk50|showEntry|Unhandled|preload|superseded|spawned|Loading Player|template/i.test(l) && !/rolling sound|PerfSampler|prompt candidacy|VR rooms|dialog rooms|VR targetUI/.test(l))
      .slice(-120).map((l) => l.slice(0, 220));
    console.log('---- console ----');
    console.log(lines.join('\n'));
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
