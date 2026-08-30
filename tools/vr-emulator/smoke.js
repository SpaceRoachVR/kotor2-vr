/**
 * Harness self-test: proves the emulated device is installed and visible to the
 * page before any page script runs.
 *
 *   node tools/vr-emulator/smoke.js [url]
 */
const { VrHarness } = require('./harness');

(async () => {
  const url = process.argv[2] || 'about:blank';
  const harness = new VrHarness({ port: 9422 });
  try {
    await harness.launch(url);
    const report = await harness.evaluate(`(async () => ({
      harness: window.__xrHarness,
      hasNavigatorXR: typeof navigator.xr !== 'undefined',
      isSessionSupportedSource: String(navigator.xr.isSessionSupported).slice(0, 80),
      immersiveVR: await navigator.xr.isSessionSupported('immersive-vr'),
      inline: await navigator.xr.isSessionSupported('inline'),
      controllers: Object.keys(window.__xrDevice.controllers || {}),
      primaryInputMode: window.__xrDevice.primaryInputMode,
    }))()`);
    console.log(JSON.stringify(report, null, 2));
    const ok = report.immersiveVR === true && !/native code/.test(report.isSessionSupportedSource);
    console.log(ok ? '\nSMOKE: PASS' : '\nSMOKE: FAIL');
    process.exitCode = ok ? 0 : 1;
  } catch (error) {
    console.error('SMOKE: ERROR', error);
    process.exitCode = 1;
  } finally {
    await harness.close();
  }
})();
