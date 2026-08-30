/**
 * Full VR scenario: boot the browser build under an emulated Quest 3, enter an
 * immersive session, and drive emulated controller input at the engine.
 *
 *   node tools/vr-emulator/vr-session.js "<launch-url>"
 *
 * Read the caveat block in harness.js before treating any result here as
 * device evidence.
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

async function click(harness, x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await harness.cdp.send('Input.dispatchMouseEvent', {
      type, x, y, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0,
    });
  }
}

/**
 * `offsetParent` is null for `position: fixed` elements, so it cannot be used
 * as the visibility test here — the Enter VR button is fixed-positioned and was
 * silently invisible to an offsetParent filter. Measure the rect instead.
 */
async function clickButtonByText(harness, text) {
  const box = await harness.evaluate(`(() => {
    const wanted = ${JSON.stringify(text)}.toLowerCase();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const btn = Array.from(document.querySelectorAll('button'))
      .filter(visible)
      .find(b => (b.textContent || '').trim().toLowerCase() === wanted);
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!box) throw new Error(`No visible button labelled "${text}"`);
  await click(harness, box.x, box.y);
  return box;
}

(async () => {
  const url = process.argv[2];
  if (!url) throw new Error('usage: vr-session.js <launch-url>');
  fs.mkdirSync(outDir, { recursive: true });

  const harness = new VrHarness({ port: 9425 });
  await harness.launch(url);
  log('0 device installed', await harness.evaluate(`({
    ready: window.__xrHarness.ready, device: window.__xrHarness.deviceName,
    immersiveVR: null,
  })`), 'PASS');

  // --- EULA ---------------------------------------------------------------
  await harness.waitFor(
    `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`,
    90000
  );
  await clickButtonByText(harness, 'OK');
  log('1 EULA accepted', 'clicked OK', 'PASS');

  // --- Wait for the engine to install the VR button ------------------------
  await harness.waitFor(
    `document.querySelector('#vr-spike-button') && !document.querySelector('#vr-spike-button').disabled`,
    240000, 2000
  );
  log('2 VR available', await harness.evaluate(`(() => {
    const b = document.querySelector('#vr-spike-button');
    return { text: b.textContent, disabled: b.disabled };
  })()`), 'PASS');

  // --- What does the engine expose for introspection? ----------------------
  log('3 engine surface', await harness.evaluate(`(() => {
    const K = window.KotOR || {};
    const gs = K.GameState;
    return {
      kotorVrExports: Object.keys(K).filter(k => /^(VR|XR)/.test(k)).slice(0, 40),
      hasGameState: !!gs,
      gameStateVrMembers: gs ? Object.getOwnPropertyNames(gs).filter(k => /vr|xr|comfort/i.test(k)).slice(0, 40) : [],
    };
  })()`));

  // --- Enter the immersive session ----------------------------------------
  const before = harness.consoleMessages.length;
  await clickButtonByText(harness, 'Enter VR (spike)');
  await new Promise((r) => setTimeout(r, 6000));

  const sessionState = await harness.evaluate(`(() => {
    const d = window.__xrDevice;
    return {
      deviceHasActiveSession: !!(d && d.activeSession),
      visibilityState: d && d.activeSession ? d.activeSession.visibilityState : null,
      inputSourceCount: d && d.activeSession ? d.activeSession.inputSources.length : 0,
      inputHandedness: d && d.activeSession
        ? Array.from(d.activeSession.inputSources).map(s => s.handedness) : [],
      buttonText: (document.querySelector('#vr-spike-button')||{}).textContent,
    };
  })()`);
  log('4 immersive session', sessionState,
    sessionState.deviceHasActiveSession ? 'PASS' : 'FAIL');
  log('4b console during entry',
    harness.consoleSince(before).map((m) => `[${m.level}] ${m.text}`).slice(0, 25));

  if (!sessionState.deviceHasActiveSession) {
    throw new Error('immersive session did not start; later phases would be meaningless');
  }

  // --- Frames actually delivered ------------------------------------------
  const frames = await harness.evaluate(`(async () => {
    const session = window.__xrDevice.activeSession;
    let count = 0;
    await new Promise((resolve) => {
      const tick = () => { count++; if (count < 90) session.requestAnimationFrame(tick); else resolve(); };
      session.requestAnimationFrame(tick);
      setTimeout(resolve, 5000);
    });
    return { xrFramesObserved: count };
  })()`, { timeoutMs: 20000 });
  log('5 XR frame delivery', frames, frames.xrFramesObserved > 30 ? 'PASS' : 'FAIL');

  // --- Drive controller input ---------------------------------------------
  const inputProbe = await harness.evaluate(`(() => {
    const d = window.__xrDevice;
    const out = {};
    for (const hand of ['left', 'right']) {
      const c = d.controllers[hand];
      out[hand] = c ? { connected: c.connected, buttons: Object.keys(c.gamepadConfig ? c.gamepadConfig.buttons || {} : {}) } : null;
    }
    const src = Array.from(d.activeSession.inputSources).map(s => ({
      handedness: s.handedness,
      profiles: s.profiles.slice(0, 3),
      buttonCount: s.gamepad ? s.gamepad.buttons.length : 0,
      axesCount: s.gamepad ? s.gamepad.axes.length : 0,
    }));
    return { controllers: out, inputSources: src };
  })()`);
  log('6 controller surface', inputProbe);

  // Hold the left X button — the all-purpose action wheel's open gesture.
  const beforeWheel = harness.consoleMessages.length;
  await harness.evaluate(`(() => {
    window.__xrDevice.controllers.left.updateButtonValue('x-button', 1);
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 2500));
  const wheelHeld = await harness.evaluate(`(() => {
    const src = Array.from(window.__xrDevice.activeSession.inputSources).find(s => s.handedness === 'left');
    return {
      leftButtonValues: src && src.gamepad ? src.gamepad.buttons.map(b => b.value) : null,
    };
  })()`);
  log('7 left X held', wheelHeld);
  await harness.evaluate(`(() => {
    window.__xrDevice.controllers.left.updateButtonValue('x-button', 0);
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 1500));
  log('7b console during wheel gesture',
    harness.consoleSince(beforeWheel).map((m) => `[${m.level}] ${m.text}`).slice(0, 25));

  // --- Thumbstick locomotion ----------------------------------------------
  const beforeMove = harness.consoleMessages.length;
  await harness.evaluate(`(() => {
    const c = window.__xrDevice.controllers.left;
    c.updateAxes && c.updateAxes('thumbstick', 0, -1);
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 3000));
  await harness.evaluate(`(() => {
    const c = window.__xrDevice.controllers.left;
    c.updateAxes && c.updateAxes('thumbstick', 0, 0);
    return true;
  })()`);
  log('8 locomotion stick', await harness.evaluate(`(() => {
    const d = window.__xrDevice;
    return { headsetPosition: d.position ? { x: d.position.x, y: d.position.y, z: d.position.z } : null };
  })()`));
  log('8b console during locomotion',
    harness.consoleSince(beforeMove).map((m) => `[${m.level}] ${m.text}`).slice(0, 20));

  // --- Exit ---------------------------------------------------------------
  await harness.evaluate(`window.__xrDevice.activeSession.end()`);
  await new Promise((r) => setTimeout(r, 2000));
  log('9 session exit', await harness.evaluate(`({
    activeSession: !!window.__xrDevice.activeSession,
    buttonText: (document.querySelector('#vr-spike-button')||{}).textContent,
  })`));

  const dump = harness.consoleMessages.map((m) => `[${m.level}] ${m.text}`).join('\n');
  fs.writeFileSync(path.join(outDir, 'vr-session-console.log'), dump);
  fs.writeFileSync(path.join(outDir, 'vr-session-results.json'), JSON.stringify(results, null, 2));
  const errors = harness.consoleMessages.filter((m) => m.level === 'error');
  log('console errors', errors.slice(0, 20).map((e) => e.text.slice(0, 300)));
  log('page errors', harness.pageErrors.slice(0, 10));

  await harness.close();
})().catch((error) => {
  console.error('\nSCENARIO ERROR:', error.message);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'vr-session-results.json'), JSON.stringify(results, null, 2));
  process.exitCode = 1;
});
