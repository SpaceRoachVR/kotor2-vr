/**
 * Validates the Central Controller step without the 236 m walk: resume
 * mining-tunnels, stand the Exile beside Shftcom, and run the same scripted
 * console conversation the stage uses; then report the four containment
 * fields.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');
const peragus = require('./playthrough-peragus');

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, 'mining-tunnels');
    await steps.enterVrSession(harness);
    await steps.sleep(3000);
    await harness.evaluate(`(() => { const p = window.KotOR.PartyManager.party[0]; p.position.set(-15, 26, 3.36); p.positionChanged = true; return true; })()`);
    await steps.sleep(1500);
    const chooser = peragus.createScriptedChooser([/^Access fuel containment functions/i, /^Shut down containment fields/i, /^Log out/i], { label: 'Central Controller' });
    const result = await peragus.useAndConverse(harness, { tag: 'Shftcom', choose: chooser, label: 'Central Controller' });
    console.log('PICKS', JSON.stringify(chooser.picks));
    console.log('TRANSCRIPT', JSON.stringify(result.played.transcript.slice(-8)));
    await steps.sleep(5000);
    const fields = await harness.evaluate(`(() => (window.KotOR.GameState.module.area.doors || []).filter((d) => /^FFDoor/.test(String(d.tag))).map((d) => ({ tag: String(d.tag), open: d.isOpen(), locked: d.isLocked(), openState: d.openState })))()`);
    console.log('FIELDS', JSON.stringify(fields));
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
