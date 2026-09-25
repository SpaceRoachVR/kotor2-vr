/**
 * Stands the Exile on 104PER's SionArrives trigger from the asteroid-exterior
 * checkpoint and reports the conversation state every second: entry text,
 * raw replies (with isContinueDialog), skippable flags, movie state.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

const SNAP = `(() => {
  const K = window.KotOR; const gs = K.GameState; const cm = gs.CutsceneManager; const vm = gs.VideoManager;
  const e = cm.currentEntry;
  return { mode: gs.Mode, active: cm.active, dlg: cm.dialog ? String(cm.dialog.resref) : null, state: cm.state,
    entry: e ? { text: String(e.text || '').slice(0, 60), skippable: e.skippable, delay: e.delay, camera: e.cameraID, anim: e.isAnimatedCamera, script: e.script ? String(e.script.name || e.script) : null, listener: e.listener ? String(e.listener.tag) : null, repliesOnEntry: (e.replies || []).length } : null,
    replies: (cm.currentReplies || []).map((r) => ({ text: String(r.text || '').slice(0, 40), cont: typeof r.isContinueDialog === 'function' ? r.isContinueDialog() : null, script: r.script ? String(r.script.name || '') : null, entries: (r.entries || []).length })),
    movie: vm && vm.isMoviePlaying ? vm.isMoviePlaying() : null, movieQueue: vm && vm.queue ? vm.queue.length : null,
    menus: (gs.MenuManager.activeMenus || []).map((m) => m.constructor.name + (m.bVisible ? '' : '(hidden)')),
    player: [+K.PartyManager.party[0].position.x.toFixed(1), +K.PartyManager.party[0].position.y.toFixed(1)] };
})()`;

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, 'asteroid-exterior');
    await steps.enterVrSession(harness);
    await steps.sleep(3000);
    const before = harness.consoleMessages.length;
    await harness.evaluate(`(() => { const p = window.KotOR.PartyManager.party[0]; p.position.set(0, -165, 266.2); p.positionChanged = true; return true; })()`);
    const peragus = require('./playthrough-peragus');
    await steps.sleep(2000);
    const chooser = peragus.createPriorityChooser([/^Got it|^Understood|^I'll do that/i], { label: 'Atton (exterior)', unseenFallback: true });
    const played = await peragus.playAnyPendingConversation(harness, { choose: chooser, label: 'Atton (exterior)' }).catch((e) => ({ error: String(e.message).slice(0, 300) }));
    console.log('PLAYED', JSON.stringify(played && played.error ? played : { turns: played && played.turns, finished: played && played.finished, picks: chooser.picks, transcript: (played && played.transcript || []).slice(-14) }).slice(0, 2500));
    console.log('AFTER', JSON.stringify(await harness.evaluate(SNAP)));
    const diag = await harness.evaluate(`(() => {
      const K = window.KotOR; const gs = K.GameState; const cm = gs.CutsceneManager; const d = cm.dialog;
      if (!d) return null;
      const e = cm.currentEntry;
      return JSON.stringify({
        paused: cm.paused, state: cm.state, cameraState: cm.cameraState ? { mode: cm.cameraState.mode, anim: cm.cameraState.currentCameraAnimation ? String(cm.cameraState.currentCameraAnimation.name || 'yes') : null, camera: cm.cameraState.currentCamera ? String(cm.cameraState.currentCamera.name || 'yes') : null, stuntCam: !!cm.cameraState.stuntCamera } : null,
        dlg: String(d.resref), animatedCamera: d.animatedCamera, cutsceneMode: cm.cutsceneMode, cameraMode: cm.cameraState && cm.cameraState.mode,
        currentCameraAnimation: cm.cameraState && cm.cameraState.currentCameraAnimation ? String(cm.cameraState.currentCameraAnimation.name || 'yes') : null,
        stunt: Array.from((d.stuntActors && d.stuntActors.values) ? d.stuntActors.values() : (d.stuntActors || [])).map((a) => String(a.participant || a.tag || '?') + ':' + !!a.moduleObject),
        entry: e ? { idx: (d.entryList || []).indexOf(e), text: String(e.text || '').slice(0, 30), cameraID: e.cameraID, cameraAngle: e.cameraAngle, cameraAnimation: e.cameraAnimation, delay: e.delay, elapsed: Math.round(e.elapsed), skippable: e.skippable, repliesShown: e.repliesShown,
          checkList: Object.fromEntries(Object.entries(e.checkList || {}).filter(([k, v]) => typeof v !== 'function')) } : null,
        entries: (d.entryList || []).slice(0, 40).map((n, i) => ({ i, text: String(n.text || '').slice(0, 24), angle: n.cameraAngle, cam: n.cameraID, anim: n.cameraAnimation, delay: n.delay, replies: (n.replies || []).map((r) => r.index) })),
        replies: (d.replyList || []).slice(0, 40).map((n, i) => ({ i, text: String(n.text || '').slice(0, 16), cont: n.isContinueDialog(), entries: (n.entries || []).map((x) => x.index), script: n.script ? String(n.script.name || n.script) : null })),
      });
    })()`).catch((e) => JSON.stringify({ error: String(e.message).slice(0, 200) }));
    console.log('DIAG', diag);
    // Is the cutscene manager ticking at all during the stall?
    const ticks = await harness.evaluate(`(async () => {
      const K = window.KotOR; const gs = K.GameState; const cm = gs.CutsceneManager;
      const counts = { update: 0, entryUpdate: 0, errors: [], camErrors: [] };
      const u = cm.update.bind(cm); cm.update = (d) => { counts.update += 1; try { return u(d); } catch (e) { counts.errors.push(String(e && e.stack || e).slice(0, 300)); throw e; } };
      const uc = cm.updateCamera.bind(cm); cm.updateCamera = (d) => { try { return uc(d); } catch (e) { counts.camErrors.push(String(e && e.stack || e).slice(0, 300)); throw e; } };
      const e = cm.currentEntry; const eu = e ? e.update.bind(e) : null; if (e) e.update = (d) => { counts.entryUpdate += 1; return eu(d); };
      const gsu = gs.Update ? gs.Update.bind(gs) : null; let gsUpdates = 0; if (gsu) gs.Update = (d) => { gsUpdates += 1; return gsu(d); };
      await new Promise((r) => setTimeout(r, 2000));
      cm.update = u; cm.updateCamera = uc; if (e) e.update = eu; if (gsu) gs.Update = gsu;
      return { ...counts, gsUpdates, mode: gs.Mode, state: gs.State, modals: (gs.MenuManager.activeModals || []).length, menus: (gs.MenuManager.activeMenus || []).map((m) => m.constructor.name), presenting: !!(K.VRSpike && K.VRSpike.isPresenting), elapsedNow: e ? Math.round(e.elapsed) : null, entryElapsedField: e ? e.elapsed : null };
    })()`, { timeoutMs: 20000 }).catch((err) => ({ error: String(err.message).slice(0, 300) }));
    console.log('TICKS', JSON.stringify(ticks));
    const video = await harness.evaluate(`(async () => {
      const K = window.KotOR; const gs = K.GameState; const vm = gs.VideoManager;
      const samples = [];
      for (let i = 0; i < 6; i += 1) {
        samples.push({ mode: gs.Mode, playing: vm.isMoviePlaying ? vm.isMoviePlaying() : null, isPlaying: vm.isPlaying, current: vm.currentMovie ? String(vm.currentMovie.name || vm.currentMovie) : null, queue: vm.movieQueue ? vm.movieQueue.length : null,
          owns: vm.ownsMovieMode ? vm.ownsMovieMode() : null, ownership: vm.modeOwnership ? JSON.stringify(vm.modeOwnership).slice(0, 160) : null,
          theater: K.VRSpike && K.VRSpike.movieTheater ? { active: K.VRSpike.movieTheater.active, visible: K.VRSpike.movieTheater.visible } : null });
        await new Promise((r) => setTimeout(r, 120));
      }
      return samples;
    })()`, { timeoutMs: 20000 }).catch((err) => ({ error: String(err.message).slice(0, 300) }));
    console.log('VIDEO', JSON.stringify(video));
    const dispatch = await harness.evaluate(`(async () => {
      const K = window.KotOR; const gs = K.GameState; const counts = {};
      const wrap = (obj, name, key) => { const o = obj[name]; if (typeof o !== 'function') { counts[key] = 'n/a'; return () => {}; } counts[key] = 0; obj[name] = function (...a) { counts[key] += 1; return o.apply(this, a); }; return () => { obj[name] = o; }; };
      const restores = [wrap(gs, 'UpdateDialog', 'dialog'), wrap(gs, 'UpdateIngame', 'ingame'), wrap(gs, 'UpdateMovie', 'movie'), wrap(gs, 'UpdateGUI', 'gui'), wrap(gs.MenuManager, 'Update', 'menus'), wrap(gs.module, 'tick', 'tick'), wrap(gs.CutsceneManager, 'update', 'cutscene')];
      let modeSeen = new Set();
      const iv = setInterval(() => modeSeen.add(gs.Mode), 50);
      await new Promise((r) => setTimeout(r, 2000));
      clearInterval(iv); restores.forEach((r) => r());
      return { ...counts, modes: [...modeSeen], sameClass: gs.CutsceneManager === K.CutsceneManager, hasK: !!K.CutsceneManager };
    })()`, { timeoutMs: 20000 }).catch((err) => ({ error: String(err.message).slice(0, 300) }));
    console.log('DISPATCH', JSON.stringify(dispatch));
    const entryTicks = await harness.evaluate(`(async () => {
      const K = window.KotOR; const gs = K.GameState; const cm = gs.CutsceneManager; const e = cm.currentEntry;
      const c = { entryUpdate: 0, camErrors: [], updateErrors: [], deltas: [] };
      const uc = cm.updateCamera; cm.updateCamera = function (d) { try { return uc.call(this, d); } catch (err) { c.camErrors.push(String(err && err.stack || err).slice(0, 400)); throw err; } };
      const u = cm.update; cm.update = function (d) { c.deltas.push(+d.toFixed(4)); try { return u.call(this, d); } catch (err) { c.updateErrors.push(String(err && err.stack || err).slice(0, 400)); throw err; } };
      const eu = e ? e.update : null; if (e) e.update = function (d) { c.entryUpdate += 1; return eu.call(this, d); };
      const before = e ? e.elapsed : null;
      await new Promise((r) => setTimeout(r, 2000));
      cm.updateCamera = uc; cm.update = u; if (e) e.update = eu;
      return { entryUpdate: c.entryUpdate, camErrors: c.camErrors.slice(0, 2), updateErrors: c.updateErrors.slice(0, 2), deltaSample: c.deltas.slice(0, 8), deltaCount: c.deltas.length, elapsedBefore: before, elapsedAfter: e ? e.elapsed : null, paused: cm.paused, sameEntry: cm.currentEntry === e };
    })()`, { timeoutMs: 20000 }).catch((err) => ({ error: String(err.message).slice(0, 300) }));
    console.log('ENTRYTICKS', JSON.stringify(entryTicks));
    const skips = await harness.evaluate(`(async () => {
      const K = window.KotOR; const gs = K.GameState; const cm = gs.CutsceneManager; const out = [];
      for (let i = 0; i < 8; i += 1) {
        const before = cm.currentEntry ? (cm.dialog.entryList || []).indexOf(cm.currentEntry) : -1;
        const e = cm.currentEntry;
        const flags = e ? { skippable: e.skippable, isSkipped: e.checkList.isSkipped, repliesShown: e.repliesShown, elapsed: Math.round(e.elapsed) } : null;
        let result = 'no entry';
        try { cm.playerSkipEntry(cm.currentEntry); result = 'called'; } catch (err) { result = String(err); }
        await new Promise((r) => setTimeout(r, 400));
        const after = cm.currentEntry ? (cm.dialog.entryList || []).indexOf(cm.currentEntry) : -1;
        out.push({ before, flags, result, after, state: cm.state, active: cm.active, mode: gs.Mode, dlg: cm.dialog ? String(cm.dialog.resref) : null });
        if (!cm.active) break;
      }
      return out;
    })()`, { timeoutMs: 30000 }).catch((err) => ({ error: String(err.message).slice(0, 300) }));
    console.log('SKIPS', JSON.stringify(skips));
    const dlgLines = harness.consoleMessages.filter((m) => /DLGNode|camera|Camera|stunt|Stunt|animat/i.test(m.text) && !/prompt candidacy|VR rooms|dialog rooms|culling/.test(m.text)).slice(-25).map((m) => `${m.level}: ${m.text}`.slice(0, 240));
    console.log('DLGLOG'); for (const l of dlgLines) console.log(l);
    const tail = harness.consoleMessages.slice(before).filter((m) => /Conversation|conversation|movie|Movie|Video|a_setsion|104atton|Sion|showEntry|reply|Reply/.test(m.text) && !/prompt candidacy|VR rooms|dialog rooms/.test(m.text)).slice(-40).map((m) => `${m.level}: ${m.text}`.slice(0, 180));
    console.log(tail.join('\n'));
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
