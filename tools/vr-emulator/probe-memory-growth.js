/**
 * ROADMAP 0.3 — characterise the memory growth across successive module loads.
 *
 * Historical sweeps crossed 3 GB of JS heap in roughly 20-25 module loads.
 * A headset session needs resource lifetimes that support continuous play.
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
const { bootstrapFreshNewGame } = require('../parity/engine-snapshot');
const { enterVrSession } = require('./playthrough-steps');

const EVIDENCE_DIR = path.join(__dirname, 'evidence');

function runtimeFailures(consoleMessages, pageErrors) {
  return [...pageErrors, ...consoleMessages
    .filter(message => message.level === 'error' && /\[VRSpike\].*(frame|rejected|failed|threw)/i.test(message.text))
    .map(message => message.text)];
}

function parseArgs(argv) {
  const args = { url: null, cycles: 3, modules: ['101PER', '102PER'], out: EVIDENCE_DIR, census: false, hold: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const option = argv[i];
    if (option === '--census') { args.census = true; continue; }
    if (!['--url', '--cycles', '--modules', '--out', '--hold'].includes(option)) {
      throw new Error(`Unknown memory probe option: ${option}`);
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
    if (option === '--url') args.url = value;
    else if (option === '--cycles') args.cycles = Number(value);
    else if (option === '--modules') args.modules = value.split(',').map(s => s.trim().toUpperCase());
    else if (option === '--out') args.out = value;
    else if (option === '--hold') args.hold = Number(value);
  }
  if (!Number.isSafeInteger(args.cycles) || args.cycles < 1) throw new Error('Cycles must be a positive integer');
  if (!Number.isSafeInteger(args.hold) || args.hold < 0) throw new Error('Hold must be a non-negative integer');
  if (!args.modules.length || args.modules.some(name => !/^[A-Z0-9_]{1,16}$/.test(name))) {
    throw new Error('Modules must be comma-separated resource names');
  }
  return args;
}

/** Every candidate retainer, counted in one pass. */
const SAMPLE = [
  '(() => {',
  '  const out = {};',
  '  const K = window.KotOR;',
  '  const gs = K.GameState;',
  '  out.moduleFound = !!gs.module;',
  '  out.module = gs.module ? gs.module.filename : null;',
  '  out.xrPresenting = !!gs.renderer.xr.isPresenting;',
  '  out.renderFrame = gs.renderer.info.render.frame;',
  '  const player = gs.PartyManager.Player;',
  '  out.player = player ? { found: true, resRef: player.getTemplateResRef(), tag: player.getTag(), id: player.id, type: player.objectType, effects: {}, inventory: player.inventory.length } : { found: false };',
  '  if (player) for (const effect of player.effects) { const type = effect.constructor.name; out.player.effects[type] = (out.player.effects[type] || 0) + 1; }',
  '  out.scriptInstances = K.NWScript?.NWScriptInstanceMap?.size ?? null;',
  '  out.uncachedScriptSituations = K.NWScript ? [...K.NWScript.NWScriptInstanceMap.values()].filter(instance => instance.isStoreState && K.NWScript.scripts.get(instance.nwscript?.name) !== instance.nwscript).length : null;',
  '  out.waypointHelpers = gs.group?.waypoints?.children.length ?? null;',
  '  out.staleWaypointHelpers = gs.group?.waypoints?.children.filter(helper => helper.userData.area && !gs.module?.area?.rooms.some(room => room.model === helper.userData.area)).length ?? null;',
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
  '    out.sceneMeshes = meshes;',
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
  '  if (gs.loadingModule) throw new Error("Engine is already loading a module");',
  '  const observation = { module: ' + JSON.stringify(name) + ', error: null };',
  '  window.__memoryProbeLoad = observation;',
  '  Promise.resolve(gs.LoadModule(observation.module)).catch(error => { observation.error = String(error); });',
  '  return true;',
  '})()',
].join('\n');

const landed = [
  '(() => {',
  '  const gs = window.KotOR.GameState;',
  '  const observation = window.__memoryProbeLoad;',
  '  if (observation && observation.error) throw new Error(observation.error);',
  '  return !!(observation && gs.module && String(gs.module.filename).toUpperCase() === observation.module && gs.loadingModule === false && gs.module.readyToProcessEvents === true && gs.module.area);',
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
    // Use the normal skip route for skippable movies; decoding the entire
    // opening movie is unrelated to measuring module resource lifetimes.
    await harness.evaluate(`window.__memoryProbeMovieSkip = setInterval(() => {
      const video = window.KotOR?.GameState?.VideoManager;
      if (video?.currentMovie?.skippable) video.skipMovie();
    }, 250)`);
    try {
      await bootstrapFreshNewGame(harness, message => console.log(message));
    } finally {
      await harness.evaluate('clearInterval(window.__memoryProbeMovieSkip); delete window.__memoryProbeMovieSkip; true');
    }
    await harness.evaluate(`(() => {
      const gs = window.KotOR.GameState;
      const cm = gs.CutsceneManager;
      if (String(cm.dialog?.resref || '').toLowerCase() === 'intro' && cm.active) cm.endConversation(true);
      gs.MenuManager.InGameOverlay.open();
      return true;
    })()`);
    await enterVrSession(harness);

  /**
   * Live BufferGeometry instances, grouped so a leak names itself.
   *
   * renderer.info says how many geometries are retained but not which. This
   * asks the heap directly: every object whose prototype is BufferGeometry,
   * grouped by name and vertex count. A group whose count rises once per load
   * is the leak, and the name usually says whose it is.
   */
  const census = async () => {
    const objectGroup = 'memory-probe-census';
    try {
      const proto = await harness.cdp.send('Runtime.evaluate', {
        expression: '(() => { let g = null; window.KotOR.GameState.scene.traverse((o) => { if (!g && o.isMesh && o.geometry) g = o.geometry; }); if (!g) return null; let p = Object.getPrototypeOf(g); while (p && p.constructor && p.constructor.name !== "BufferGeometry" && Object.getPrototypeOf(p)) { p = Object.getPrototypeOf(p); } return p; })()',
        returnByValue: false,
        objectGroup,
      });
      const protoId = proto && proto.result && proto.result.objectId;
      if (!protoId) return null;
      const objects = await harness.cdp.send('Runtime.queryObjects', { prototypeObjectId: protoId, objectGroup });
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
    } finally {
      await harness.cdp.send('Runtime.releaseObjectGroup', { objectGroup });
    }
  };

    const measure = async (label) => {
      // Retained, not merely uncollected. Without this every delta below is
      // garbage a GC would have taken anyway.
      const frame = await harness.evaluate('window.KotOR.GameState.renderer.info.render.frame');
      await harness.waitFor(`window.KotOR.GameState.renderer.xr.isPresenting && window.KotOR.GameState.renderer.info.render.frame > ${frame + 10}`, 30000, 500);
      await harness.cdp.send('HeapProfiler.collectGarbage');
      const sample = await harness.evaluate(SAMPLE, { timeoutMs: 60000 });
      const failures = runtimeFailures(harness.consoleSince(), harness.pageErrors);
      if (failures.length) throw new Error(`Memory probe encountered runtime failures: ${failures.slice(0, 3).join('\n')}`);
      const heap = await harness.cdp.send('Runtime.getHeapUsage');
      sample.heapMb = +(heap.usedSize / 1048576).toFixed(1);
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
        'effects=' + JSON.stringify(sample.player.effects),
      );
      return sample;
    };

    await measure('baseline');
    for (let cycle = 1; cycle <= args.cycles; cycle += 1) {
      for (const name of args.modules) {
        await harness.evaluate(loadModule(name));
        await harness.waitFor(landed, 300000, 2000);
        await harness.waitFor(`window.KotOR.GameState.Mode === 1`, 30000, 500);
        await measure(`cycle ${cycle} ${name}`);
      }
    }

    fs.mkdirSync(args.out, { recursive: true });
    const outFile = path.join(args.out, 'memory-growth.json');
    fs.writeFileSync(outFile, JSON.stringify({ modules: args.modules, cycles: args.cycles,
      pageErrors: harness.pageErrors, runtimeFailures: runtimeFailures(harness.consoleSince(), harness.pageErrors),
      consoleErrors: harness.consoleSince().filter(message => message.level === 'error'), readings }, null, 2));

    // Steady state, not the first load. The first load of a run is still
    // settling - the party spawns, the scene graph fills - so differencing
    // against it reports one-time build-up as if it were per-load growth.
    // Comparing the same module on successive cycles isolates what a revisit
    // costs, which is the number that matters for a long session.
    const sameModule = {};
    for (const r of readings) {
      const m = /cycle \d+ (\S+)/.exec(r.label || '');
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
    if (args.hold) {
      // Experiments that attach from outside need a heap that is not moving under
      // them: a sweep still loading modules adds orphans between the before and
      // after readings, which is larger than the effect being measured.
      console.log(`
holding the page open for ${args.hold}s on CDP port 9447 — attach experiments now`);
      await new Promise((r) => setTimeout(r, args.hold * 1000));
    }
  } finally {
    await harness.close();
    if (service) service.stop();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { parseArgs, loadModule, landed, SAMPLE, runtimeFailures };
