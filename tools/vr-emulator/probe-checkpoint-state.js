/**
 * Loads a campaign checkpoint and reports the live conversation and player
 * state, for diagnosing a step that blocked right after a resume.
 *   node tools/vr-emulator/probe-checkpoint-state.js hatch-opened
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
    await steps.resumeFromCheckpoint(harness, process.argv[2] || 'hatch-opened');
    await steps.sleep(4000);
    const state = await harness.evaluate(`(() => {
      const K = window.KotOR; const gs = K.GameState; const cm = gs.CutsceneManager; const menus = gs.MenuManager;
      const p = K.PartyManager.party[0];
      const nameOf = (v) => v ? String(v.name || v.resref || (v.constructor && v.constructor.name) || '?') : null;
      return {
        mode: gs.Mode,
        menus: (menus.activeMenus || []).map((m) => m.constructor.name + (m.bVisible ? '' : '(hidden)')),
        cm: cm ? { active: cm.active, dialog: cm.dialog ? String(cm.dialog.resref) : null, state: cm.state,
          entry: cm.currentEntry ? { text: String(cm.currentEntry.text || '').slice(0, 120), skippable: cm.currentEntry.skippable, camera: cm.currentEntry.cameraID, replies: (cm.currentReplies || []).length, delay: cm.currentEntry.delay, duration: cm.currentEntry.duration } : null,
          replies: (cm.currentReplies || []).map((r) => String(r.text || '').slice(0, 60)), lastSpoken: String(cm.lastSpokenString || '').slice(0, 120),
          owner: cm.dialog && cm.dialog.owner ? String(cm.dialog.owner.tag || '') : null, isAnimatedCamera: cm.currentEntry ? cm.currentEntry.isAnimatedCamera : null } : null,
        movie: gs.VideoManager && gs.VideoManager.isMoviePlaying ? gs.VideoManager.isMoviePlaying() : null,
        player: p ? { name: String(p.getName()), tag: String(p.tag), ctor: p.constructor.name, hp: p.getHP(), maxHp: p.getMaxHP(), level: p.getTotalClassLevel ? p.getTotalClassLevel() : null, xp: p.getXP ? p.getXP() : null,
          classes: (p.classes || []).map((c) => ({ id: c.id, level: c.level })), position: { x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2) }, isPlayer: p.isPlayer, npcId: p.npcId } : null,
        party: K.PartyManager.party.map((m) => String(m.tag)),
        globals: ['101PER_Open_Hatch','105PER_T3_End','103PER_T3_Ambush','101PER_Switch','PER_TURNINTO_T3M4'].map((g) => {
          try { return g + '=' + (g === 'PER_TURNINTO_T3M4' ? gs.GlobalVariableManager.GetGlobalBoolean(g) : gs.GlobalVariableManager.GetGlobalNumber(g)); } catch (e) { return g + '=?'; } }),
      };
    })()`, { timeoutMs: 60000 });
    console.log(JSON.stringify(state, null, 2));
    // What happens if the entry is skipped a few times?
    for (let i = 0; i < 5; i += 1) {
      await harness.evaluate(`(() => { const cm = window.KotOR.GameState.CutsceneManager; try { cm.playerSkipEntry(cm.currentEntry); } catch (e) { return String(e); } return true; })()`);
      await steps.sleep(1000);
      const s = await harness.evaluate(`(() => { const gs = window.KotOR.GameState; const cm = gs.CutsceneManager; return { mode: gs.Mode, state: cm.state, entry: cm.currentEntry ? String(cm.currentEntry.text || '').slice(0, 80) : null, visible: !!(gs.MenuManager.InGameDialog && gs.MenuManager.InGameDialog.bVisible), replies: (cm.currentReplies || []).length }; })()`);
      console.log('skip', i, JSON.stringify(s));
    }
    const tail = harness.consoleMessages.filter((m) => !/rolling sound|PerfSampler|prompt candidacy|VR rooms|dialog rooms/.test(m.text)).slice(-40).map((m) => `${m.level}: ${m.text}`.slice(0, 200));
    console.log(tail.join('\n'));
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
