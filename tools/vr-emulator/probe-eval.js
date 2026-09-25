/**
 * Resumes a checkpoint in the emulated headset and evaluates one expression
 * in the page, printing the JSON result. `node probe-eval.js <checkpoint>
 * "<expression>"`; the expression may use K (window.KotOR), gs (GameState),
 * p (party[0]) and area.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

const [, , checkpoint, expression] = process.argv;
if (!checkpoint || !expression) { console.error('usage: node probe-eval.js <checkpoint> "<expression>"'); process.exit(2); }

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, checkpoint);
    await steps.enterVrSession(harness);
    await steps.sleep(3000);
    const result = await harness.evaluate(`(() => { const K = window.KotOR; const gs = K.GameState; const p = K.PartyManager.party[0]; const area = gs.module && gs.module.area; try { return (${expression}); } catch (e) { return { probeError: String(e && e.stack || e) }; } })()`, { timeoutMs: 60000 });
    console.log('RESULT ' + JSON.stringify(result));
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
