/**
 * Makes T3-M4 the party leader at the hangar-bay checkpoint the way the
 * wheel does, walks him to Hangar Control with the driver, uses the console
 * through the VR prompt route, and reports the party order and the
 * conversation's PC speaker at each step. Run 13 switched the lead to T3 and
 * still saw the Exile's skills gate the console.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

const ORDER = `(() => { const K = window.KotOR; const PM = K.PartyManager; const cm = K.GameState.CutsceneManager; return { party: PM.party.map((m) => String(m.tag || m.getName())), player: PM.Player ? String(PM.Player.tag || PM.Player.getName()) : null, current: K.GameState.getCurrentPlayer ? String(K.GameState.getCurrentPlayer().tag || K.GameState.getCurrentPlayer().getName()) : null, mode: K.GameState.Mode, cmActive: cm.active, listener: cm.listener ? String(cm.listener.tag || (cm.listener.getName && cm.listener.getName())) : null, owner: cm.owner ? String(cm.owner.tag) : null }; })()`;

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, 'hangar-bay');
    await steps.enterVrSession(harness);
    await steps.sleep(3000);
    console.log('START', JSON.stringify(await harness.evaluate(ORDER)));
    const wheel = await steps.activateWheelAction(harness, { targetId: null, submenuId: 'submenu:party', actionLabel: 'T3-M4' }).catch((e) => ({ ok: false, reason: String(e.message) }));
    await steps.sleep(1500);
    console.log('WHEEL', JSON.stringify(wheel), JSON.stringify(await harness.evaluate(ORDER)));
    await steps.returnToGameplay(harness);
    console.log('AFTER RETURN', JSON.stringify(await harness.evaluate(ORDER)));
    // Teleport the party next to the console rather than walking 100 m.
    await harness.evaluate(`(() => { const K = window.KotOR; for (const m of K.PartyManager.party) { m.position.set(0.9, 37.6, 12.8); m.positionChanged = true; if (m.collisionManager) { m.collisionManager.groundFace = undefined; m.collisionManager.findWalkableFace(); } } return true; })()`);
    await steps.sleep(2000);
    console.log('TELEPORTED', JSON.stringify(await harness.evaluate(ORDER)));
    const target = (await steps.findObjectByTag(harness, 'HangarTer'))[0];
    const used = await steps.useTaggedWorldObject(harness, { tag: 'HangarTer', targetId: target.id, actionPattern: /^Use:/i, range: 2.6, maxAttempts: 3 }).catch((e) => ({ error: String(e.message).slice(0, 200) }));
    console.log('USED', JSON.stringify(used).slice(0, 300));
    await steps.sleep(2500);
    console.log('IN CONVERSATION', JSON.stringify(await harness.evaluate(ORDER)));
    const rows = await harness.evaluate(`(() => { const cm = window.KotOR.GameState.CutsceneManager; return (cm.currentReplies || []).map((r) => String(r.text || '').slice(0, 50)); })()`);
    console.log('ROWS', JSON.stringify(rows));
    const idx = rows.findIndex((r) => /Access emergency/i.test(r));
    if (idx >= 0) {
      await harness.evaluate(`(() => { window.KotOR.GameState.CutsceneManager.selectReplyAtIndex(${idx}); return true; })()`);
      await steps.sleep(2500);
      console.log('AFTER EMERGENCY', JSON.stringify(await harness.evaluate(ORDER)));
      const rows2 = await harness.evaluate(`(() => { const cm = window.KotOR.GameState.CutsceneManager; return { entry: cm.currentEntry ? String(cm.currentEntry.text || '').slice(0, 40) : null, rows: (cm.currentReplies || []).map((r) => String(r.text || '').slice(0, 50)) }; })()`);
      console.log('ROWS2', JSON.stringify(rows2));
    }
    const t = await harness.evaluate(`(() => { const K = window.KotOR; const area = K.GameState.module.area; const t = (area.placeables || []).find((o) => o && String(o.tag) === 'HangarTer'); return { c_skilcom: K.NWScript.Load('c_skilcom').run(t, 0), c_skilrep: K.NWScript.Load('c_skilrep').run(t, 0) }; })()`);
    console.log('CONDITIONALS', JSON.stringify(t));
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
