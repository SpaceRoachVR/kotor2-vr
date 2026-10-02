/**
 * ROADMAP 0.3 follow-up — are the textures that renderer.info keeps counting
 * really alive, and if so, what are they?
 *
 * After the model/listener/light/particle fixes, probe-memory-growth.js showed
 * geometry flat but renderer.info.memory.textures still +~54 a cycle. That
 * counter only falls on texture.dispose(); a texture collected without one
 * stays counted. So this alternates two modules and, after a forced GC, counts
 * the live THREE.Texture objects (by prototype) and groups them by name.
 *
 *   node tools/vr-emulator/probe-texture-leak.js [--checkpoint droids-cleared] [--other 102PER] [--cycles 2]
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : fallback; };
const CHECKPOINT = arg('--checkpoint', 'droids-cleared');
const OTHER = arg('--other', '102PER');
const CYCLES = Number(arg('--cycles', 2));

async function load(harness, name) {
  await harness.evaluate(`(() => { const gs = window.KotOR.GameState; Promise.resolve(gs.LoadModule(${JSON.stringify(name)})).catch(() => undefined); return true; })()`);
  await steps.sleep(2000);
  await harness.waitFor(`(() => { const gs = window.KotOR.GameState; return !!(gs.module && gs.loadingModule === false && gs.module.readyToProcessEvents === true && gs.module.area); })()`, 180000, 2000);
  await steps.sleep(4000);
}

// The base THREE.Texture prototype, found from a cached texture.
const PROTO = `(() => {
  const K = window.KotOR;
  let t = null;
  for (const v of K.TextureLoader.textures.values()) { if (v && v.isTexture) { t = v; break; } }
  if (!t) return null;
  let p = Object.getPrototypeOf(t);
  while (Object.getPrototypeOf(p) && Object.getPrototypeOf(p).isTexture !== undefined) p = Object.getPrototypeOf(p);
  // isTexture is an instance field in r149, so walk to the prototype whose
  // own methods include 'clone' and 'dispose' and whose parent lacks 'updateMatrix'.
  p = Object.getPrototypeOf(t);
  while (Object.getPrototypeOf(p) && Object.prototype.hasOwnProperty.call(Object.getPrototypeOf(p), 'updateMatrix')) p = Object.getPrototypeOf(p);
  window.__texProto = p;
  return true;
})()`;

async function census(harness, label) {
  for (let i = 0; i < 3; i++) await harness.cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  const proto = await harness.cdp.send('Runtime.evaluate', { expression: 'window.__texProto', returnByValue: false });
  const objects = await harness.cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId });
  const res = await harness.cdp.send('Runtime.callFunctionOn', {
    objectId: objects.objects.objectId, returnByValue: true,
    functionDeclaration: `function () {
      const props = window.KotOR.GameState.renderer.properties;
      let uploaded = 0; const names = {};
      for (const t of this) {
        const p = props.get(t); if (p && p.__webglTexture) uploaded++;
        const n = String(t.name || (t.image && (t.image.src || t.image.constructor && t.image.constructor.name)) || t.constructor.name).slice(0, 40);
        names[n] = (names[n] || 0) + 1;
      }
      return { live: this.length, uploaded, top: Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 8) };
    }`,
  });
  await harness.cdp.send('Runtime.releaseObject', { objectId: objects.objects.objectId }).catch(() => {});
  const counter = await harness.evaluate(`window.KotOR.GameState.renderer.info.memory.textures`);
  console.log(`CENSUS ${label}: counter ${counter}, live textures ${res.result.value.live}, uploaded ${res.result.value.uploaded} ${JSON.stringify(res.result.value.top)}`);
}

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9441, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, CHECKPOINT);
    await steps.sleep(4000);
    await harness.cdp.send('HeapProfiler.enable').catch(() => {});
    const home = await harness.evaluate(`window.KotOR.GameState.module.filename`);
    console.log('PROTO ' + await harness.evaluate(PROTO));
    await census(harness, 'start ' + home);
    for (let i = 0; i < CYCLES; i++) {
      await load(harness, OTHER);
      await load(harness, home);
      await census(harness, `after cycle ${i + 1}`);
    }
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
