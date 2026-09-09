/**
 * ROADMAP 0.3 — characterise the memory growth across successive module loads.
 *
 * The sweep survives only because it can throw the page away: every full run
 * today crossed 3 GB of JS heap in roughly 20-25 module loads and reloaded,
 * three or four times per run, and every one of those was heap-triggered rather
 * than the module-count backstop. A headset session has no reload.
 *
 * WHY THIS MEASURES RATHER THAN SNAPSHOTS FIRST
 *
 * A full heap snapshot of this page is hundreds of MB and answers "what is on
 * the heap", not "what grew". Growth is the question, so this loads the same
 * short module cycle repeatedly and reports deltas per load for each candidate
 * retainer. `HeapProfiler.collectGarbage` runs before every reading, so what is
 * left is retained rather than merely uncollected - without that, every number
 * here would be garbage that a GC would have taken anyway.
 *
 * Counting GPU-side resources separately from the JS heap is what splits the
 * suspects: three's renderer.info counts geometries and textures the renderer
 * still holds, so if those climb while the caches do not, the leak is undisposed
 * render resources rather than engine bookkeeping.
 *
 *   node tools/vr-emulator/probe-memory-growth.js
 *   node tools/vr-emulator/probe-memory-growth.js --cycles 4 --modules 101PER,102PER
 */
const fs = require('fs');
const path = require('path');
const { VrHarness } = require('./harness');
const { startAssetService } = require('./asset-service');

const EVIDENCE_DIR = path.join(__dirname, 'evidence');

function parseArgs(argv) {
  const args = { url: null, cycles: 3, modules: ['101PER', '102PER'], out: EVIDENCE_DIR, census: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--url') args.url = argv[++i];
    else if (argv[i] === '--cycles') args.cycles = Number(argv[++i]);
    else if (argv[i] === '--modules') args.modules = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--census') args.census = true;
  }
  return args;
}

async function clickButtonByText(harness, text) {
  const box = await harness.evaluate('(() => {\n' +
    '  const wanted = ' + JSON.stringify(text) + '.toLowerCase();\n' +
    '  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };\n' +
    '  const btn = Array.from(document.querySelectorAll("button")).filter(visible)\n' +
    '    .find(b => (b.textContent || "").trim().toLowerCase() === wanted);\n' +
    '  if (!btn) return null;\n' +
    '  const r = btn.getBoundingClientRect();\n' +
    '  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };\n' +
    '})()');
  if (!box) throw new Error('No visible button labelled "' + text + '"');
  for (const type of ['mousePressed', 'mouseReleased']) {
    await harness.cdp.send('Input.dispatchMouseEvent', {
      type, x: box.x, y: box.y, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0,
    });
  }
}

/** Every candidate retainer, counted in one pass. */
const SAMPLE = [
  '(() => {',
  '  const out = {};',
  '  const K = window.KotOR;',
  '  const gs = K.GameState;',
  '  try { out.heapMb = +(performance.memory.usedJSHeapSize / 1048576).toFixed(1); } catch (e) { out.heapMb = null; }',
  '  try {',
  '    const info = gs.renderer.info;',
  '    out.geometries = info.memory.geometries;',
  '    out.textures = info.memory.textures;',
  '    out.programs = info.programs ? info.programs.length : null;',
  '  } catch (e) {}',
  '  // Engine-side bookkeeping.',
  '  try { out.textureLoaderCache = K.TextureLoader.textures.size; } catch (e) {}',
  '  try {',
  '    let n = 0;',
  '    const scopes = K.ResourceLoader.CacheScopes;',
  '    for (const key of Object.keys(scopes)) {',
  '      const scope = scopes[key];',
  '      if (!scope || typeof scope.forEach !== "function") continue;',
  '      scope.forEach((byType) => { n += (byType && byType.size) ? byType.size : 0; });',
  '    }',
  '    out.resourceCacheEntries = n;',
  '  } catch (e) {}',
  '  // Scene graph size: an area that was disposed should not still be parented.',
  '  try {',
  '    let nodes = 0, meshes = 0;',
  '    gs.scene.traverse((o) => { nodes++; if (o.isMesh) meshes++; });',
  '    out.sceneNodes = nodes;',
  '  } catch (e) {}',
  '  // Points are the specific suspect: OdysseyModel3D.dispose guards its',
  '  // geometry/material release behind an instanceof THREE.Mesh check, and',
  '  // extends Object3D rather than Mesh, so every emitter passes the outer type',
  '  // check and disposes nothing.',
  '  try {',
  '    let points = 0, pointsWithGeometry = 0;',
  '    gs.scene.traverse((o) => { if (o.isPoints) { points++; if (o.geometry) pointsWithGeometry++; } });',
  '    out.scenePoints = points;',
  '    out.scenePointsWithGeometry = pointsWithGeometry;',
  '    out.sceneMeshes = meshes;',
  '  } catch (e) {}',
  '  try { out.moduleObjects = gs.ModuleObjectManager.GetObjectCount ? gs.ModuleObjectManager.GetObjectCount() : null; } catch (e) {}',
  '  try { out.partySize = K.PartyManager.party.length; } catch (e) {}',
  '  try { out.audioBuffers = gs.audioEngine && gs.audioEngine.buffers ? gs.audioEngine.buffers.size : null; } catch (e) {}',
  '  return out;',
  '})()',
].join('\n');

const loadModule = (name) => [
  '(async () => {',
  '  const gs = window.KotOR.GameState;',
  '  gs.loadingModule = false;',
  '  try { gs.MenuManager.ClearMenus(); } catch (e) {}',
  '  const previous = gs.module;',
  '  Promise.resolve(gs.LoadModule(' + JSON.stringify(name) + ')).catch(() => undefined);',
  '  return true;',
  '})()',
].join('\n');

const landed = [
  '(() => {',
  '  const gs = window.KotOR.GameState;',
  '  return !!(gs.module && gs.loadingModule === false && gs.module.readyToProcessEvents === true && gs.module.area);',
  '})()',
].join('\n');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let service = null;
  let url = args.url;
  if (!url) { service = await startAssetService(); url = service.url; }

  const harness = new VrHarness({ port: 9447 });
  const readings = [];
  try {
    await harness.launch(url);
    try {
      await harness.waitFor(
        'Array.from(document.querySelectorAll("button")).some(b => (b.textContent||"").trim() === "OK")', 60000);
      await clickButtonByText(harness, 'OK');
    } catch (e) { /* already accepted */ }
    await harness.waitFor('!!(window.KotOR && window.KotOR.GameState && window.KotOR.GameState.MenuManager)', 240000);
    await harness.waitFor('!!window.KotOR.GameState.MenuManager.MainMenu', 240000);

    await harness.evaluate('(async () => { await window.KotOR.SaveGame.GetSaveGames(); return window.KotOR.SaveGame.saves.length; })()',
      { timeoutMs: 180000 });
    await harness.evaluate([
      '(async () => {',
      '  const gs = window.KotOR.GameState;',
      '  gs.MenuManager.ClearMenus();',
      '  if (gs.module) { try { gs.module.dispose(); } catch (e) {} gs.module = undefined; }',
      '  Promise.resolve(window.KotOR.SaveGame.saves[0].load()).catch(() => undefined);',
      '  return true;',
      '})()',
    ].join('\n'));
    await harness.waitFor(landed, 300000, 3000);

  /**
   * Live BufferGeometry instances, grouped so a leak names itself.
   *
   * renderer.info says how many geometries are retained but not which. This
   * asks the heap directly: every object whose prototype is BufferGeometry,
   * grouped by name and vertex count. A group whose count rises once per load
   * is the leak, and the name usually says whose it is.
   */
  const census = async () => {
    try {
      const proto = await harness.cdp.send('Runtime.evaluate', {
        expression: '(() => { let g = null; window.KotOR.GameState.scene.traverse((o) => { if (!g && o.isMesh && o.geometry) g = o.geometry; }); if (!g) return null; let p = Object.getPrototypeOf(g); while (p && p.constructor && p.constructor.name !== "BufferGeometry" && Object.getPrototypeOf(p)) { p = Object.getPrototypeOf(p); } return p; })()',
        returnByValue: false,
      });
      const protoId = proto && proto.result && proto.result.objectId;
      if (!protoId) return null;
      const objects = await harness.cdp.send('Runtime.queryObjects', { prototypeObjectId: protoId });
      const arrayId = objects && objects.objects && objects.objects.objectId;
      if (!arrayId) return null;
      const summary = await harness.cdp.send('Runtime.callFunctionOn', {
        objectId: arrayId,
        returnByValue: true,
        functionDeclaration: `function () {
          const groups = {};
          let total = 0;
          for (const g of this) {
            if (!g || !g.attributes) continue;
            total++;
            const pos = g.attributes.position;
            const key = (g.name || "(unnamed)") + " |v=" + (pos ? pos.count : 0);
            groups[key] = (groups[key] || 0) + 1;
          }
          return { total: total, groups: groups };
        }`,
      });
      return summary && summary.result ? summary.result.value : null;
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
  };

    const measure = async (label) => {
      // Retained, not merely uncollected. Without this every delta below is
      // garbage a GC would have taken anyway.
      try { await harness.cdp.send('HeapProfiler.collectGarbage'); } catch (e) {}
      const sample = await harness.evaluate(SAMPLE, { timeoutMs: 60000 });
      sample.label = label;
      if (args.census) sample.census = await census();
      readings.push(sample);
      console.log(
        label.padEnd(22),
        'heap=' + String(sample.heapMb).padStart(7) + 'MB',
        'geom=' + String(sample.geometries).padStart(6),
        'tex=' + String(sample.textures).padStart(5),
        'prog=' + String(sample.programs).padStart(4),
        'texCache=' + String(sample.textureLoaderCache).padStart(5),
        'resCache=' + String(sample.resourceCacheEntries).padStart(6),
        'nodes=' + String(sample.sceneNodes).padStart(6),
      );
      return sample;
    };

    await measure('baseline');
    for (let cycle = 1; cycle <= args.cycles; cycle += 1) {
      for (const name of args.modules) {
        await harness.evaluate(loadModule(name));
        await harness.waitFor(landed, 300000, 2000);
        await measure(`cycle ${cycle} ${name}`);
      }
    }

    fs.mkdirSync(args.out, { recursive: true });
    const outFile = path.join(args.out, 'memory-growth.json');
    fs.writeFileSync(outFile, JSON.stringify({ modules: args.modules, cycles: args.cycles, readings }, null, 2));

    // Steady state, not the first load. The first load of a run is still
    // settling - the party spawns, the scene graph fills - so differencing
    // against it reports one-time build-up as if it were per-load growth.
    // Comparing the same module on successive cycles isolates what a revisit
    // costs, which is the number that matters for a long session.
    const sameModule = {};
    for (const r of readings) {
      const m = /cycle d+ (S+)/.exec(r.label || '');
      if (!m) continue;
      (sameModule[m[1]] = sameModule[m[1]] || []).push(r);
    }
    console.log(String.fromCharCode(10) + '=== cost of revisiting the same module (steady state) ===');
    for (const name of Object.keys(sameModule)) {
      const series = sameModule[name];
      if (series.length < 2) continue;
      const a = series[series.length - 2];
      const b = series[series.length - 1];
      console.log('  ' + name
        + '  geometries +' + String(b.geometries - a.geometries).padStart(5)
        + '  textures +' + String(b.textures - a.textures).padStart(4)
        + '  heap +' + String((b.heapMb - a.heapMb).toFixed(1)).padStart(7) + 'MB'
        + '  sceneNodes +' + String(b.sceneNodes - a.sceneNodes).padStart(5));
    }

    const first = readings[1] || readings[0];
    const last = readings[readings.length - 1];
    const delta = (key) => (last[key] != null && first[key] != null ? last[key] - first[key] : null);
    const loads = readings.length - 2;
    console.log('\n=== growth from first load to last (' + loads + ' further loads) ===');
    for (const key of ['heapMb', 'geometries', 'textures', 'programs', 'textureLoaderCache',
      'resourceCacheEntries', 'sceneNodes', 'sceneMeshes', 'moduleObjects']) {
      const d = delta(key);
      if (d == null) continue;
      const per = loads > 0 ? (d / loads) : d;
      console.log('  ' + key.padEnd(22) + String(d).padStart(9) + '   per load ' + per.toFixed(1));
    }
    if (args.census) {
      const firstGroups = (readings[1] && readings[1].census && readings[1].census.groups) || {};
      const lastGroups = (last.census && last.census.groups) || {};
      const rows = Object.keys(lastGroups)
        .map((k) => ({ k: k, grew: (lastGroups[k] || 0) - (firstGroups[k] || 0), now: lastGroups[k] }))
        .filter((r) => r.grew > 0)
        .sort((a, b) => b.grew - a.grew)
        .slice(0, 25);
      console.log(String.fromCharCode(10) + "=== live geometries that grew across the run ===");
      for (const r of rows) console.log("  +" + String(r.grew).padStart(5), "now", String(r.now).padStart(5), "  ", r.k);
      if (!rows.length) console.log("  (none grew)");
      if (last.census && last.census.total != null) console.log("  live BufferGeometry total:", last.census.total);
    }
    console.log('\nreport -> ' + path.relative(process.cwd(), outFile));
  } finally {
    await harness.close();
    if (service) service.stop();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
