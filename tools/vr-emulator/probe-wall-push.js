/**
 * Critic runs 14-15: holding the stick into a 102PER wall shook the view, the
 * rig stepping 5-15 cm per update with the player standing still. Loads "R15
 * PREPARED FIGHT", enters VR, walks the player toward walls in eight headings
 * and samples the player and rig every XR frame for 2.5 s of full stick, then
 * reports, per heading, how far the player travelled (path) against how far it
 * got (net), and the largest single-frame rig step while blocked.
 *
 *   node tools/vr-emulator/probe-wall-push.js [--port 8514] [--user <saves folder>]
 *
 * Never saves.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');
const { WebXRActionDriver } = require('./dsl/WebXRActionDriver');

const args = process.argv.slice(2);
const PORT = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 8514;
const USER = args.includes('--user') ? args[args.indexOf('--user') + 1] : undefined;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const service = await startAssetService({ port: PORT, userRoot: USER });
  await waitForPort(PORT).catch(() => undefined);
  const harness = new VrHarness({ port: PORT + 950, headless: true });
  try {
    await steps.boot(harness, service.url);
    await harness.waitFor(`!!(window.KotOR.GameState.MenuManager.MainMenu && window.KotOR.GameState.MenuManager.MainMenu.bVisible)`, 120000, 1000);
    await harness.evaluate(`(async () => { const K = window.KotOR; await K.SaveGame.GetSaveGames();
      const s = K.SaveGame.saves.find((x) => (x.getSaveName && x.getSaveName()) === 'R15 PREPARED FIGHT');
      K.GameState.MenuManager.ClearMenus(); Promise.resolve(s.load()).catch(() => undefined); return true; })()`);
    await harness.waitFor(`(() => { const gs = window.KotOR.GameState; const p = window.KotOR.PartyManager.party[0];
      return !!(gs.module && p && p.position && gs.Mode === 1 && gs.module.readyToProcessEvents === true && !gs.loadingModule); })()`, 240000, 2000);
    await sleep(4000);
    await steps.enterVrSession(harness);
    await sleep(2000);
    // No enemies in the way: this is about walls.
    await harness.evaluate(`(() => { const gs = window.KotOR.GameState; for (const c of gs.module.area.creatures) { try { if (c.isHostile(gs.getCurrentPlayer())) c.position.z -= 500; } catch (e) {} } return true; })()`);
    const xr = new WebXRActionDriver(harness);
    const start = await harness.evaluate(`(() => { const p = window.KotOR.GameState.getCurrentPlayer(); return { x: p.position.x, y: p.position.y, z: p.position.z }; })()`);
    const results = [];
    const only = args.includes('--heading') ? Number(args[args.indexOf('--heading') + 1]) : null;
    for (let i = 0; i < 8; i++) {
      if (only !== null && i * 45 !== only) continue;
      const angle = i * Math.PI / 4;
      await harness.evaluate(`(() => { const p = window.KotOR.GameState.getCurrentPlayer(); p.position.set(${start.x}, ${start.y}, ${start.z}); return true; })()`);
      await sleep(600);
      // Sample every XR frame while the stick is held.
      await harness.evaluate(`(() => { const vr = window.KotOR.VRSpike; const token = {}; window.__wallToken = token; window.__wall = []; const s = vr.session;
        const tick = (ts) => { if (window.__wallToken !== token) return; const p = window.KotOR.GameState.getCurrentPlayer(); const r = vr.rig;
          const cm = p.collisionManager; window.__wall.push({ t: ts, px: p.position.x, py: p.position.y, rx: r.position.x, ry: r.position.y, wall: cm && Number.isFinite(cm.lastWallAt) ? Math.round(performance.now() - cm.lastWallAt) : -1, nx: cm && cm.lastWallNormal ? +cm.lastWallNormal.x.toFixed(2) : 0, ny: cm && cm.lastWallNormal ? +cm.lastWallNormal.y.toFixed(2) : 0, f: p.force, fx: +p.forceVector.x.toFixed(3), fy: +p.forceVector.y.toFixed(3), blk: (cm && cm.recentWallNormals ? cm.recentWallNormals.filter((n) => performance.now() - n.at < 250).map((n) => n.x.toFixed(2) + "," + n.y.toFixed(2)).join("|") : "-") });
          if (window.__wall.length < 600) s.requestAnimationFrame(tick); };
        s.requestAnimationFrame(tick); return true; })()`);
      await xr.setThumbstick('left', Math.sin(angle), -Math.cos(angle));
      await sleep(2500);
      await xr.setThumbstick('left', 0, 0);
      const r = await harness.evaluate(`(() => { const w = window.__wall.slice(5); if (w.length < 3) return null;
        let path = 0, rig = 0, maxRigStep = 0, backward = 0;
        const dx = Math.sin(${angle}), dy = Math.cos(${angle});
        for (let k = 1; k < w.length; k++) {
          const sx = w[k].px - w[k-1].px, sy = w[k].py - w[k-1].py;
          path += Math.hypot(sx, sy);
          // Movement against the previous step: an oscillation.
          if (k > 1) { const px = w[k-1].px - w[k-2].px, py = w[k-1].py - w[k-2].py; if (sx * px + sy * py < 0) backward += Math.hypot(sx, sy); }
          const step = Math.hypot(w[k].rx - w[k-1].rx, w[k].ry - w[k-1].ry); rig += step; if (step > maxRigStep) maxRigStep = step; }
        const net = Math.hypot(w[w.length-1].px - w[0].px, w[w.length-1].py - w[0].py);
        window.__wallToken = null; return { frames: w.length, path: +path.toFixed(2), net: +net.toFixed(2), backward: +backward.toFixed(2), rigPath: +rig.toFixed(2), maxRigStepCm: +(maxRigStep * 100).toFixed(1) }; })()`);
      if (only !== null) console.log(JSON.stringify(await harness.evaluate(`window.__wall.slice(5, 40).map((w) => [+(w.px).toFixed(2), +(w.py).toFixed(2), w.wall, w.nx, w.ny, w.fx, w.fy, w.blk])`)));
      results.push({ heading: i * 45, ...r });
      console.log(JSON.stringify(results[results.length - 1]));
    }
    const shaky = results.filter((r) => r && r.backward > 0.2);
    console.log(shaky.length ? `SHAKE in ${shaky.length} heading(s)` : 'no shake');
    if (shaky.length) process.exitCode = 1;
  } finally {
    await harness.close().catch(() => undefined);
    try { service.stop(); } catch (e) {}
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
