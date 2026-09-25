/**
 * From the hangar-bay checkpoint: switch control to T3-M4 through the
 * wheel's Party submenu, walk T3 across the corridor, and check that the
 * Exile stays in the world and follows; then switch back through the wheel
 * and check the Exile is the same instance, in control, with the party
 * intact. Retail keeps the PC as a follower during a leader switch; the
 * engine used to destroy her.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

const SNAP = `(() => { const K = window.KotOR; const PM = K.PartyManager; const lead = PM.party[0];
  return { party: PM.party.map((m) => ({ name: String(m.getName()), id: m.id, isPlayer: !!m.isPlayer, isPC: m.isPC, pos: [+m.position.x.toFixed(1), +m.position.y.toFixed(1)], inScene: !!(m.container && m.container.parent), dist: +lead.position.distanceTo(m.position).toFixed(1) })),
    player: PM.Player ? { name: String(PM.Player.getName()), id: PM.Player.id } : null, actualName: PM.ActualPlayerName }; })()`;

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, 'hangar-bay');
    await steps.enterVrSession(harness);
    await steps.sleep(3000);
    const start = await harness.evaluate(SNAP);
    console.log('START', JSON.stringify(start));
    const exileId = start.player.id;
    const toT3 = await steps.activateWheelAction(harness, { targetId: null, submenuId: 'submenu:party', actionLabel: 'T3-M4' }).catch((e) => ({ ok: false, reason: String(e.message) }));
    await steps.sleep(3000);
    await steps.returnToGameplay(harness);
    console.log('POSSESSED T3', JSON.stringify(toT3), JSON.stringify(await harness.evaluate(SNAP)));
    // Walk T3 east along the turbolift corridor and see whether the Exile keeps up.
    const walk = await steps.moveTo(harness, { x: -43.5, y: 13.4, z: 9.3, range: 1.5, label: 'T3 walks off', timeoutMs: 40000, usePath: false }).catch((e) => ({ error: String(e.message).slice(0, 160) }));
    await steps.sleep(6000);
    console.log('AFTER WALK', JSON.stringify(walk).slice(0, 120), JSON.stringify(await harness.evaluate(SNAP)));
    const wheel = await steps.describeActionWheel(harness, null);
    console.log('PARTY SUBMENU', JSON.stringify(wheel.submenus && wheel.submenus['submenu:party']));
    const back = await steps.activateWheelAction(harness, { targetId: null, submenuId: 'submenu:party', actionLabel: start.player.name }).catch((e) => ({ ok: false, reason: String(e.message) }));
    await steps.sleep(3000);
    await steps.returnToGameplay(harness);
    const end = await harness.evaluate(SNAP);
    console.log('BACK', JSON.stringify(back), JSON.stringify(end));
    console.log('SAME EXILE INSTANCE', end.player && end.player.id === exileId);
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
