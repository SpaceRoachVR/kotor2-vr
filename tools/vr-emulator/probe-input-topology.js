/**
 * Focused probe for the "XR controller topology is missing required semantic
 * actions" warning seen on session entry under the emulated Quest 3.
 *
 *   node tools/vr-emulator/probe-input-topology.js "<launch-url>"
 */
const fs = require('fs');
const path = require('path');
const { VrHarness } = require('./harness');

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

(async () => {
  const url = process.argv[2];
  const harness = new VrHarness({ port: 9426 });
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

  const mark = await harness.evaluate(`window.__xrHarness.log.length`);
  await clickButtonByText(harness, 'Enter VR (spike)');
  await new Promise((r) => setTimeout(r, 8000));

  const topologyWarnings = await harness.evaluate(
    `window.__xrHarness.log.slice(${mark}).filter(e => /topology/i.test(e.text))`
  );
  console.log('=== topology warnings ===');
  console.log(JSON.stringify(topologyWarnings, null, 2));

  const liveState = await harness.evaluate(`(() => {
    const s = window.__xrDevice.activeSession;
    return {
      inputSourceCount: s ? s.inputSources.length : null,
      sources: s ? Array.from(s.inputSources).map(x => ({
        handedness: x.handedness, profiles: x.profiles,
        targetRayMode: x.targetRayMode,
        mapping: x.gamepad && x.gamepad.mapping,
        buttons: x.gamepad ? x.gamepad.buttons.length : null,
        axes: x.gamepad ? x.gamepad.axes.length : null,
        hasGrip: !!x.gripSpace,
        haptics: x.gamepad && x.gamepad.hapticActuators ? x.gamepad.hapticActuators.length : 0,
      })) : null,
    };
  })()`);
  console.log('\n=== live input sources (after settle) ===');
  console.log(JSON.stringify(liveState, null, 2));

  // Per-frame log noise check.
  const before = await harness.evaluate(`window.__xrHarness.log.length`);
  await new Promise((r) => setTimeout(r, 5000));
  const after = await harness.evaluate(`window.__xrHarness.log.length`);
  const sample = await harness.evaluate(
    `window.__xrHarness.log.slice(${before}).slice(0, 6)`
  );
  console.log('\n=== console volume over 5s while in session ===');
  console.log(JSON.stringify({ linesIn5s: after - before, sample }, null, 2));

  fs.mkdirSync(path.join(__dirname, 'evidence'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, 'evidence', 'input-topology-probe.json'),
    JSON.stringify({ topologyWarnings, liveState, linesIn5s: after - before, sample }, null, 2)
  );
  await harness.close();
})().catch((e) => { console.error('PROBE ERROR', e.message); process.exitCode = 1; });
