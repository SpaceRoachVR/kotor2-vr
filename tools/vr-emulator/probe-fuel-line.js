/**
 * From the t3-rescued checkpoint, stand in 103PER's second fuel line and
 * watch for 25 s: which conversations start (dlg, owner), what the
 * Maintenance Droid nearby is (tag, scripts, faction), and the menu stack.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, 't3-rescued');
    await steps.enterVrSession(harness);
    await steps.sleep(3000);
    const droids = await harness.evaluate(`(() => { const K = window.KotOR; const area = K.GameState.module.area; const p = K.PartyManager.party[0];
      return (area.creatures || []).filter((c) => /droid/i.test(String(c.getName()))).map((c) => ({ tag: String(c.tag), name: String(c.getName()), dist: +c.position.distanceTo(p.position).toFixed(1), dead: c.isDead(), hostile: c.isHostile(p), faction: c.factionId, conv: c.conversation ? String(c.conversation.resref || c.conversation) : null,
        scripts: Object.fromEntries(Object.entries(c.scripts || {}).filter(([, v]) => v).map(([k, v]) => [k, String(v.name || v)])), pos: [+c.position.x.toFixed(1), +c.position.y.toFixed(1), +c.position.z.toFixed(1)] })); })()`);
    console.log('DROIDS', JSON.stringify(droids));
    const before = harness.consoleMessages.length;
    await harness.evaluate(`(() => { const p = window.KotOR.PartyManager.party[0]; p.position.set(-30, 4, 12.2); p.positionChanged = true; return true; })()`);
    for (let i = 0; i < 5; i += 1) {
      await steps.sleep(4000);
      const s = await harness.evaluate(`(() => { const gs = window.KotOR.GameState; const cm = gs.CutsceneManager;
        return { mode: gs.Mode, active: cm.active, dlg: cm.dialog ? String(cm.dialog.resref) : null, owner: cm.owner ? String(cm.owner.tag || cm.owner.constructor.name) : null, menus: (gs.MenuManager.activeMenus || []).map((m) => m.constructor.name + (m.bVisible ? '' : '(hidden)')), bark: gs.MenuManager.InGameBark ? gs.MenuManager.InGameBark.bVisible : null }; })()`);
      console.log(`t=${(i + 1) * 4}s`, JSON.stringify(s));
    }
    const tail = harness.consoleMessages.slice(before).filter((m) => /startConversation|endConversation|BarkString|bark|Maintenance|Perception|onNotice|dialogue|Dialogue/i.test(m.text) && !/prompt candidacy|VR rooms|dialog rooms/.test(m.text)).slice(0, 40).map((m) => `${m.level}: ${m.text}`.slice(0, 200));
    console.log('CONSOLE'); for (const l of tail) console.log(l);
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
