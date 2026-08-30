/**
 * Scripted VR scenario against the browser build under an emulated Quest 3.
 *
 *   node tools/vr-emulator/scenario.js "<launch-url>"
 *
 * Phases are additive and each one reports before the next runs, so a failure
 * says which step broke rather than just "timed out".
 */
const fs = require('fs');
const path = require('path');
const { VrHarness } = require('./harness');

const outDir = path.join(__dirname, 'evidence');

function log(phase, data) {
  console.log(`\n=== ${phase} ===`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

async function clickButtonByText(harness, text) {
  const box = await harness.evaluate(`(() => {
    const wanted = ${JSON.stringify(text)}.toLowerCase();
    // position:fixed elements report offsetParent === null, so measure instead.
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const btn = Array.from(document.querySelectorAll('button'))
      .filter(visible)
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
  return box;
}

const PAGE_STATE = `(() => {
  const btn = document.querySelector('#vr-spike-button');
  return {
    vrButton: btn ? { text: btn.textContent, disabled: btn.disabled } : null,
    canvases: Array.from(document.querySelectorAll('canvas')).map(c => ({ w: c.width, h: c.height })),
    visibleButtons: Array.from(document.querySelectorAll('button'))
      .filter(b => b.offsetParent !== null).map(b => (b.textContent||'').trim()).slice(0, 25),
    bodyTextHead: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 200),
    globals: Object.keys(window).filter(k => /kotor|game|engine|vr|module/i.test(k)).slice(0, 30),
  };
})()`;

(async () => {
  const url = process.argv[2];
  if (!url) throw new Error('usage: scenario.js <launch-url>');
  fs.mkdirSync(outDir, { recursive: true });

  const harness = new VrHarness({ port: 9424 });
  await harness.launch(url);
  log('phase 0: device', await harness.evaluate(`({
    immersiveVR: window.__xrHarness.ready,
    device: window.__xrHarness.deviceName,
  })`));

  // --- Phase 1: EULA -------------------------------------------------------
  await harness.waitFor(
    `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`,
    60000
  );
  await clickButtonByText(harness, 'OK');
  log('phase 1: EULA accepted', 'clicked OK');

  // --- Phase 2: settle, then report what the menu looks like ---------------
  await new Promise((r) => setTimeout(r, 15000));
  log('phase 2: post-EULA state', await harness.evaluate(PAGE_STATE));

  // --- Phase 3: wait for the engine canvas and the VR button ---------------
  try {
    await harness.waitFor(`document.querySelector('#vr-spike-button')`, 180000, 2000);
    log('phase 3: VR button present', await harness.evaluate(`(() => {
      const b = document.querySelector('#vr-spike-button');
      return { text: b.textContent, disabled: b.disabled };
    })()`));
  } catch (error) {
    log('phase 3: VR button NOT present', error.message);
    log('phase 3: state', await harness.evaluate(PAGE_STATE));
  }

  const dump = harness.consoleMessages.map((m) => `[${m.level}] ${m.text}`).join('\n');
  fs.writeFileSync(path.join(outDir, 'scenario-console.log'), dump);
  log('console', `${harness.consoleMessages.length} lines -> evidence/scenario-console.log`);
  const errs = harness.consoleMessages.filter((m) => m.level === 'error').slice(0, 15);
  if (errs.length) log('console errors', errs.map((e) => e.text));
  if (harness.pageErrors.length) log('page errors', harness.pageErrors.slice(0, 10));

  await harness.close();
})().catch(async (error) => {
  console.error('\nSCENARIO ERROR:', error.message);
  process.exitCode = 1;
});
