/**
 * Beside 105PER's Turbolift Console (from the dormitories checkpoint, by
 * teleport): run the "[Destroy the console...]" branch, then sample the
 * invisible console's HP, the PC's action queue and combat state every
 * second for 25 s, and report Door_To_101PER's lock.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');
const peragus = require('./playthrough-peragus');

const SNAP = `(() => {
  const K = window.KotOR; const gs = K.GameState; const area = gs.module.area; const p = K.PartyManager.party[0];
  const inv = (area.placeables || []).find((o) => /turboconinvis/i.test(String(o.tag)));
  const door = (area.doors || []).find((d) => String(d.tag) === 'Door_To_101PER');
  return { inv: inv ? { id: inv.id, hp: inv.getHP(), max: inv.getMaxHP ? inv.getMaxHP() : null, dead: inv.isDead(), min1: inv.min1HP, plot: inv.plot, faction: inv.factionId, hasModel: !!inv.model, pos: [+inv.position.x.toFixed(1), +inv.position.y.toFixed(1)] } : null,
    pc: { queue: (p.actionQueue || []).map((a) => a.constructor.name), combat: p.combatData ? { state: p.combatData.combatState, target: p.combatData.lastAttackTarget ? String(p.combatData.lastAttackTarget.tag) : null } : null, roundActions: p.combatRound && p.combatRound.actions ? p.combatRound.actions.length : null, pos: [+p.position.x.toFixed(1), +p.position.y.toFixed(1)] },
    door: door ? { locked: door.isLocked(), open: door.isOpen() } : null, mode: gs.Mode };
})()`;

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, 'dormitories');
    await steps.enterVrSession(harness);
    await steps.sleep(3000);
    await harness.evaluate(`(() => { const p = window.KotOR.PartyManager.party[0]; p.position.set(-52.5, -41.5, 10); p.positionChanged = true; return true; })()`);
    await steps.sleep(1500);
    console.log('BEFORE', JSON.stringify(await harness.evaluate(SNAP)));
    const chooser = peragus.createScriptedChooser([/\[Destroy the console to force open the door\.\]/i], { label: 'Turbolift Console' });
    const result = await peragus.useAndConverse(harness, { tag: 'TurboConsole', choose: chooser, label: 'Turbolift Console' });
    console.log('PICKS', JSON.stringify(chooser.picks));
    const before = harness.consoleMessages.length;
    for (let i = 0; i < 25; i += 1) {
      await steps.sleep(1000);
      const s = await harness.evaluate(SNAP);
      console.log(`t=${i + 1}s`, JSON.stringify(s));
      if (s.door && !s.door.locked) break;
    }
    const tail = harness.consoleMessages.slice(before).filter((m) => /Combat|combat|attack|Attack|Turbocon|death|Death|damage|Damage|onDamaged|ActionAttack/.test(m.text) && !/AreaMusic|prompt candidacy/.test(m.text)).slice(0, 40).map((m) => `${m.level}: ${m.text}`.slice(0, 200));
    console.log('CONSOLE'); for (const l of tail) console.log(l);
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
