/**
 * Round 15 blocker: arriving in 103PER from the mining-tunnel turbolift plays
 * hk50.dlg, whose first entry runs a_102exitrun: the PC runs from From_102PER
 * to WP_PC_ENTER2 while the turbolift door TO102PER is closed (0.8 s) and
 * locked (plot) behind them. If the PC is still on the lift side when it shuts,
 * they are stuck in the lift for good.
 *
 * Loads the "containment fields down" checkpoint (102PER), optionally enters
 * the emulated XR session (--no-vr skips it), loads 103PER at From_102PER the
 * way the door does, and samples the PC, its action queue and the door every
 * 150 ms through the opening of the conversation, then plays it out and
 * reports where the PC ends up.
 *
 *   node tools/vr-emulator/probe-fuel-depot-lift.js [--no-vr] [--checkpoint name]
 *
 * Never saves (the harness guard stops autosaves).
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

const args = process.argv.slice(2);
const VR = !args.includes('--no-vr');
const CHECKPOINT = args.includes('--checkpoint') ? args[args.indexOf('--checkpoint') + 1] : 'containment-fields-down';
const ASSET_PORT = 8491;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SAMPLE = `(() => {
  const K = window.KotOR; const gs = K.GameState; const p = gs.getCurrentPlayer && gs.getCurrentPlayer();
  const area = gs.module && gs.module.area;
  if (!area || !p || !p.position) return { loading: true };
  const door = (area.doors || []).find((d) => String(d.tag) === 'TO102PER');
  const cm = gs.CutsceneManager;
  const q = p.actionQueue ? Array.from(p.actionQueue).map((a) => (a && a.constructor && a.constructor.name) || String(a && a.type)) : [];
  const vrs = K.VRSpike;
  return {
    t: +(performance.now() / 1000).toFixed(2), mode: gs.Mode, cs: !!(cm && cm.active),
    entry: cm && cm.currentEntry ? String(cm.currentEntry.comment || '').slice(0, 50) : null,
    p: [+p.position.x.toFixed(2), +p.position.y.toFixed(2)], room: p.room ? String(p.room.name) : null,
    q, door: door ? { open: door.isOpen(), os: door.openState, locked: door.isLocked(), anim: door.model && door.model.animationManager && door.model.animationManager.currentAnimation ? door.model.animationManager.currentAnimation.name : null } : null,
    blocked: p.blockingObject ? String(p.blockingObject.tag || p.blockingObject.constructor.name) : null,
    xr: vrs ? !!vrs.isPresenting : null,
  };
})()`;

(async () => {
  const service = await startAssetService({ port: ASSET_PORT });
  await waitForPort(ASSET_PORT).catch(() => undefined);
  const harness = new VrHarness({ port: 9453, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, CHECKPOINT);
    if (VR) await steps.enterVrSession(harness);
    await sleep(3000);
    await steps.clearProgressBlockingDialogue(harness, 'pending 102PER conversation').catch((e) => console.log('clear', e.message));
    await steps.returnToGameplay(harness).catch(() => undefined);
    console.log('GUARD', JSON.stringify(await harness.evaluate(`!!window.__xrHarness`)));
    if (args.includes('--patch-door')) {
      // Experiment for the proposed fix: a closing door stays passable until
      // its closing animation has finished (page-side only; src untouched).
      console.log('PATCH', JSON.stringify(await harness.evaluate(`(() => {
        const tick = () => {
          const gs = window.KotOR.GameState; const area = gs.module && gs.module.area;
          for (const d of (area && area.doors) || []) {
            const s = d.animStateInfo && d.animStateInfo.currentAnimState;
            const closing = d.model && /^closing/.test(String(d.model.getAnimationName && d.model.getAnimationName() || ''));
            if (closing) {
              d.collisionDelay = 1;
              const wm = d.collisionManager && d.collisionManager.walkmesh;
              if (wm && wm.mesh) { gs.group && gs.group.room_walkmeshes && gs.group.room_walkmeshes.remove(wm.mesh);
                if (Array.isArray(gs.walkmeshList)) { const i = gs.walkmeshList.indexOf(wm.mesh); if (i >= 0) gs.walkmeshList.splice(i, 1); }
                if (Array.isArray(area.doorWalkmeshes)) { const j = area.doorWalkmeshes.indexOf(wm); if (j >= 0) area.doorWalkmeshes.splice(j, 1); }
                d.__probeReopenCollision = true; }
            } else if (d.__probeReopenCollision) { d.__probeReopenCollision = false; d.updateCollisionState(); }
          }
        };
        setInterval(tick, 16);
        return true;
      })()`)));
    }
    await harness.evaluate(`(() => { window.KotOR.GameState.LoadModule('103per', 'from_102per'); return true; })()`);
    await harness.waitFor(`(() => { const gs = window.KotOR.GameState; return !!(gs.module && gs.module.area && String(gs.module.area.name).toLowerCase() === '103per' && !gs.loadingModule && gs.CutsceneManager && gs.CutsceneManager.active); })()`, 240000, 100);
    let last = '';
    const until = Date.now() + 14000;
    while (Date.now() < until) {
      const s = await harness.evaluate(SAMPLE).catch((e) => ({ err: String(e.message) }));
      const key = JSON.stringify({ ...s, t: 0 });
      if (key !== last) { console.log('S', JSON.stringify(s)); last = key; }
      await sleep(150);
    }
    const played = await steps.playDialogue(harness, {
      label: 'hk50',
      choose: (replies) => {
        const texts = replies.map((r) => String(r.text || r));
        const leave = texts.findIndex((t) => /heard enough|Never mind/i.test(t));
        return leave >= 0 ? leave : 0;
      },
    }).catch((e) => ({ error: String(e.message) }));
    console.log('PLAYED', JSON.stringify(played && (played.error || played.turns)));
    await sleep(2000);
    console.log('END', JSON.stringify(await harness.evaluate(SAMPLE)));
    const tail = harness.consoleMessages.filter((m) => /ActionJump|cutscene move|a_102exitrun|ActionCloseDoor|SetLocked|Resume|blocked|TypeError|ApplyEffect/.test(m.text)).slice(-30).map((m) => `${m.level}: ${m.text}`.slice(0, 200));
    console.log(tail.join('\n'));
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
