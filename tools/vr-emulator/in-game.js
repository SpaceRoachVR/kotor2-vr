/**
 * In-game VR scenario: load a save, enter an immersive session under the
 * emulated Quest 3, and exercise controls that only exist once a module and a
 * player are live — recenter, the action wheel, and locomotion.
 *
 *   node tools/vr-emulator/in-game.js "<launch-url>"
 *
 * Loading a save takes roughly a minute; the waits below are sized for that.
 */
const fs = require('fs');
const path = require('path');
const { VrHarness } = require('./harness');

const outDir = path.join(__dirname, 'evidence');
const results = [];

function log(phase, data, verdict) {
  console.log(`\n=== ${phase}${verdict ? ` [${verdict}]` : ''} ===`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  results.push({ phase, verdict: verdict || 'info', data });
}

async function clickButtonByText(harness, text) {
  const box = await harness.evaluate(`(() => {
    const wanted = ${JSON.stringify(text)}.toLowerCase();
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const btn = Array.from(document.querySelectorAll('button')).filter(visible)
      .find(b => (b.textContent || '').trim().toLowerCase() === wanted);
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!box) throw new Error(`No visible button labelled "${text}"`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await harness.cdp.send('Input.dispatchMouseEvent', {
      type, x: box.x, y: box.y, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0,
    });
  }
}

/** Engine-facing world state, used to tell "in a module" from "at the menu". */
const WORLD_STATE = `(() => {
  const K = window.KotOR || {};
  const gs = K.GameState;
  const module = gs && gs.module;
  const player = K.PartyManager && K.PartyManager.Player;
  return {
    hasModule: !!module,
    moduleName: module && module.name ? module.name : null,
    hasPlayer: !!player,
    playerPosition: player && player.position
      ? { x: player.position.x, y: player.position.y, z: player.position.z } : null,
    facing: player && typeof player.rotation === 'object' ? null : null,
    engineMode: gs ? gs.Mode : null,
  };
})()`;

(async () => {
  const url = process.argv[2];
  if (!url) throw new Error('usage: in-game.js <launch-url>');
  fs.mkdirSync(outDir, { recursive: true });

  const harness = new VrHarness({ port: 9427 });
  await harness.launch(url);

  await harness.waitFor(
    `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`,
    90000
  );
  await clickButtonByText(harness, 'OK');
  await harness.waitFor(
    `document.querySelector('#vr-spike-button') && !document.querySelector('#vr-spike-button').disabled`,
    240000, 2000
  );
  log('1 engine booted', 'VR button enabled', 'PASS');

  // --- Load a save --------------------------------------------------------
  const saves = await harness.evaluate(`(async () => {
    const K = window.KotOR;
    await K.SaveGame.GetSaveGames();
    return K.SaveGame.saves.map(s => ({ name: s.getName ? s.getName() : String(s.name || ''), id: s.id }));
  })()`, { timeoutMs: 120000 });
  log('2 saves discovered', saves, saves.length ? 'PASS' : 'FAIL');
  if (!saves.length) throw new Error('no saves to load; cannot reach an in-game state');

  // Mirror MenuSaveLoad's LOADGAME path exactly: clear menus and dispose the
  // live module *before* loading. Calling `save.load()` with the menu's module
  // still standing leaves the engine in GUI mode and the load never lands.
  await harness.evaluate(`(async () => {
    const K = window.KotOR;
    const gs = K.GameState;
    window.__loadError = null;
    gs.MenuManager.ClearMenus();
    if (gs.module) {
      try { gs.module.dispose(); } catch (e) { window.__loadError = 'dispose: ' + e; }
      gs.module = undefined;
    }
    Promise.resolve(K.SaveGame.saves[0].load())
      .catch(e => { window.__loadError = String(e && e.stack || e); });
    return true;
  })()`);

  try {
    await harness.waitFor(
      // A module plus a placed player is the real signal. `GameState.Mode` stays
      // at GUI (0) through a save load even once the world is live, so gating on
      // INGAME here waits forever on a load that already succeeded.
      `(() => {
        const gs = window.KotOR.GameState;
        const party = window.KotOR.PartyManager;
        const player = party && party.Player;
        return !!(gs && gs.module && player && player.position &&
          Number.isFinite(player.position.x));
      })()`,
      300000, 3000
    );
    log('3 module loaded', await harness.evaluate(WORLD_STATE), 'PASS');
  } catch (error) {
    log('3 module load FAILED', {
      error: error.message,
      loadError: await harness.evaluate(`window.__loadError`),
      state: await harness.evaluate(WORLD_STATE),
    }, 'FAIL');
    throw error;
  }

  // --- Enter VR in-game ---------------------------------------------------
  await new Promise((r) => setTimeout(r, 5000));
  await clickButtonByText(harness, 'Enter VR (spike)');
  await new Promise((r) => setTimeout(r, 6000));
  const session = await harness.evaluate(`(() => {
    const d = window.__xrDevice;
    return {
      active: !!(d && d.activeSession),
      inputSources: d && d.activeSession ? d.activeSession.inputSources.length : 0,
    };
  })()`);
  log('4 in-game immersive session', session, session.active ? 'PASS' : 'FAIL');
  if (!session.active) throw new Error('session did not start in-game');

  // --- Recenter -----------------------------------------------------------
  // Turn the emulated head well off-axis, then press the dominant-hand
  // recenter button and confirm the engine's yaw offset absorbs it.
  const headTurn = await harness.evaluate(`(() => {
    const d = window.__xrDevice;
    // IWER's device quaternion is a gl-matrix-backed THREE-alike; build the
    // rotation with its own constructor rather than a plain object literal.
    const q = d.quaternion;
    const half = 0.45; // ~51 degrees of yaw about the XR up axis
    q.set(0, Math.sin(half), 0, Math.cos(half));
    return { x: q.x, y: q.y, z: q.z, w: q.w };
  })()`);
  log('5a emulated head yawed off-axis', headTurn);
  await new Promise((r) => setTimeout(r, 1500));

  const beforeRecenter = await harness.evaluate(`({
    yawOffset: window.KotOR.VRSpike ? window.KotOR.VRSpike.yawOffset : null,
  })`).catch(() => ({ yawOffset: null }));

  await harness.evaluate(`(() => {
    // Recenter is dominant-hand button index 3, which in the xr-standard
    // mapping is the THUMBSTICK CLICK — not a face button. Pressing 'b-button'
    // (index 5) hits Cancel/Pause instead and silently proves nothing.
    window.__xrDevice.controllers.right.updateButtonValue('thumbstick', 1);
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 1200));
  await harness.evaluate(`(() => {
    window.__xrDevice.controllers.right.updateButtonValue('thumbstick', 0);
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 1200));
  const afterRecenter = await harness.evaluate(`({
    yawOffset: window.KotOR.VRSpike ? window.KotOR.VRSpike.yawOffset : null,
  })`).catch(() => ({ yawOffset: null }));
  log('5 recenter', { beforeRecenter, afterRecenter });

  // --- Action wheel -------------------------------------------------------
  const beforeWheel = await harness.evaluate(`window.__xrHarness.log.length`);
  await harness.evaluate(`(() => {
    window.__xrDevice.controllers.left.updateButtonValue('x-button', 1);
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 2500));
  const wheelLog = await harness.evaluate(
    `window.__xrHarness.log.slice(${beforeWheel}).slice(0, 20)`
  );
  await harness.evaluate(`(() => {
    window.__xrDevice.controllers.left.updateButtonValue('x-button', 0);
    return true;
  })()`);
  log('6 action wheel gesture', wheelLog);

  // --- Locomotion ---------------------------------------------------------
  const posBefore = await harness.evaluate(WORLD_STATE);
  await harness.evaluate(`(() => {
    window.__xrDevice.controllers.left.updateAxes('thumbstick', 0, -1);
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 4000));
  await harness.evaluate(`(() => {
    window.__xrDevice.controllers.left.updateAxes('thumbstick', 0, 0);
    return true;
  })()`);
  const posAfter = await harness.evaluate(WORLD_STATE);
  const moved = posBefore.playerPosition && posAfter.playerPosition
    ? Math.hypot(
      posAfter.playerPosition.x - posBefore.playerPosition.x,
      posAfter.playerPosition.y - posBefore.playerPosition.y
    ) : null;
  log('7 locomotion', { posBefore: posBefore.playerPosition, posAfter: posAfter.playerPosition, metresMoved: moved },
    moved && moved > 0.25 ? 'PASS' : 'FAIL');

  // --- Console health -----------------------------------------------------
  const health = await harness.evaluate(`(() => {
    const log = window.__xrHarness.log;
    const errors = log.filter(e => e.level === 'error');
    const warns = log.filter(e => e.level === 'warn');
    return {
      total: log.length,
      errors: errors.slice(-15).map(e => e.text.slice(0, 240)),
      warnings: Array.from(new Set(warns.map(w => w.text.slice(0, 160)))).slice(0, 20),
    };
  })()`);
  log('8 console health', health);

  fs.writeFileSync(path.join(outDir, 'in-game-results.json'), JSON.stringify(results, null, 2));
  const dump = harness.consoleMessages.map((m) => `[${m.level}] ${m.text}`).join('\n');
  fs.writeFileSync(path.join(outDir, 'in-game-console.log'), dump);
  await harness.close();
})().catch((error) => {
  console.error('\nSCENARIO ERROR:', error.message);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'in-game-results.json'), JSON.stringify(results, null, 2));
  process.exitCode = 1;
});
