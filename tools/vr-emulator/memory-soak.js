/** Diagnostic lifecycle stress, not authored campaign acceptance. */
const fs = require('node:fs');
const path = require('node:path');
const { VrHarness } = require('./harness');
const { startAssetService } = require('./asset-service');
const { bootstrapFreshNewGame } = require('../parity/engine-snapshot');
const { enterVrSession } = require('./playthrough-steps');
const { SAMPLE, loadModule, landed, runtimeFailures } = require('./probe-memory-growth');

function parseArgs(argv) {
  const args = { cycles: 10, modules: ['101PER', '102PER', '106PER'],
    port: 8487, cdpPort: 9447, out: path.join(__dirname, 'evidence', `memory-soak-${Date.now()}`) };
  const keys = { '--cycles': 'cycles', '--modules': 'modules', '--port': 'port', '--cdp-port': 'cdpPort', '--out': 'out' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--profile') { args.profile = true; continue; }
    const key = keys[argv[i]];
    if (!key) throw new Error(`Unknown option: ${argv[i]}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    args[key] = key === 'modules' ? value.split(',').map(v => v.trim().toUpperCase())
      : key === 'out' ? path.resolve(value) : Number(value);
  }
  if (!Number.isSafeInteger(args.cycles) || args.cycles < 1) throw new Error('cycles must be a positive integer');
  for (const key of ['port', 'cdpPort']) {
    if (!Number.isSafeInteger(args[key]) || args[key] < 1 || args[key] > 65535) throw new Error(`Invalid ${key}`);
  }
  if (args.port === args.cdpPort) throw new Error('Service and CDP ports must differ');
  if (!args.modules.length || args.modules.some(m => !/^[A-Z0-9_]{1,16}$/.test(m))
    || new Set(args.modules).size !== args.modules.length) throw new Error('modules must be unique resource names');
  return args;
}

function partyKey(sample) {
  const identity = member => `${String(member.tag).toLowerCase()}:${member.npcId}`;
  return `${identity(sample.controlled || sample.player)}|${sample.party.map(identity).sort().join(',')}`;
}

function compareParty(before, after) {
  if (partyKey(before) !== partyKey(after)) {
    throw new Error(`Party changed across save/reload: ${JSON.stringify({ before, after })}`);
  }
}

function validateSample(sample, expectedModule) {
  if (!sample.moduleFound || String(sample.module).toUpperCase() !== expectedModule || !sample.ready || sample.loading) {
    throw new Error(`Module not ready: ${JSON.stringify(sample)}`);
  }
  if (!sample.xrPresenting || sample.advancedFrames < 10 || !Number.isFinite(sample.advancedFrames)) throw new Error('XR frames did not advance');
  if (!sample.player.found || !sample.party.length || sample.party.some(p => !p.found || !p.modelFound)) throw new Error(`Party missing or models not loaded: ${JSON.stringify(sample.party)}`);
  if (sample.staleEncounterMeshes !== 0) throw new Error(`Encounter meshes retain unloaded areas: ${sample.staleEncounterMeshes}`);
  for (const key of ['heapMb', 'geometries', 'textures', 'loadMs']) {
    if (!Number.isFinite(sample[key]) || sample[key] < 0) throw new Error(`Missing or invalid measurement: ${key}`);
  }
}

function summarizeReadings(readings) {
  const groups = new Map();
  for (const row of readings) {
    if (row.operation === 'baseline') continue;
    const key = `${row.module}|${row.operation}|${partyKey(row)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].map(([key, series]) => {
    // Discard the first occurrence of each exact state as cache warm-up.
    const warm = series.slice(1);
    const first = warm[0], last = warm.at(-1);
    const intervals = Math.max(0, warm.length - 1);
    const delta = field => intervals ? +(last[field] - first[field]).toFixed(3) : null;
    return { key, samples: series.length, warmIntervals: intervals,
      heapDeltaMb: delta('heapMb'), heapMbPerVisit: intervals ? +(delta('heapMb') / intervals).toFixed(3) : null,
      geometryDelta: delta('geometries'), textureDelta: delta('textures'),
      loadMsFirstWarm: first?.loadMs ?? null, loadMsLast: last?.loadMs ?? null };
  });
}

const PARTY_SAMPLE = `(() => {
  const gs = window.KotOR.GameState;
  const identity = p => p ? { found: true, tag: p.getTag(), resRef: p.getTemplateResRef(),
    id: p.id, type: p.objectType, npcId: p.npcId, modelFound: !!p.model } : { found: false };
  let encounterMeshes = 0, staleEncounterMeshes = 0;
  for (const mesh of gs.group?.triggers?.children || []) {
    const encounter = mesh.userData?.moduleObject;
    if (encounter instanceof window.KotOR.ModuleEncounter) {
      encounterMeshes++;
      if (encounter.area !== gs.module?.area) staleEncounterMeshes++;
    }
  }
  return { party: gs.PartyManager.party.map(identity), player: identity(gs.PartyManager.Player),
    controlled: identity(gs.getCurrentPlayer()),
    encounterMeshes, staleEncounterMeshes,
    ready: gs.module?.readyToProcessEvents === true, loading: gs.loadingModule,
    mode: gs.Mode, state: gs.State };
})()`;

async function configureParty(harness, full) {
  await harness.evaluate(`(() => {
    const pm = window.KotOR.PartyManager;
    if (!pm.Player) throw new Error('No controlled player for party fixture');
    if (!pm.Player.isPlayer) pm.SwitchPlayerCharacter(-1);
    return true;
  })()`);
  await harness.waitFor('!!(window.KotOR.PartyManager.Player?.isPlayer && window.KotOR.PartyManager.Player?.model)', 120000, 500);
  await harness.evaluate(`(async () => {
    const K = window.KotOR, pm = K.PartyManager;
    pm.MakePlayerLeader();
    for (const id of [0, 8]) {
      const member = pm.GetPartyMemberByNPCId(id);
      if (member === pm.Player) throw new Error('Refusing to remove controlled player');
      if (member) pm.RemoveNPCById(id);
    }
    if (${full}) {
      for (const [id, resref] of [[0, 'p_atton'], [8, 'p_t3m4']]) {
        if (!pm.NPCS[id]?.template) {
          const bytes = await K.ResourceLoader.loadResource(2027, resref);
          if (!bytes?.length || !pm.AddAvailableNPCByTemplate(id, new K.GFFObject(bytes))) throw new Error('Missing companion template: ' + resref);
        }
        await pm.AddNPCById(id);
      }
    }
    return true;
  })()`, { timeoutMs: 120000 });
  const state = await harness.evaluate(PARTY_SAMPLE);
  if (state.party.length !== (full ? 3 : 1)) throw new Error(`Party fixture failed: ${JSON.stringify(state)}`);
  if (full) {
    // Exercise the actual leader routing with the already loaded companions.
    await harness.evaluate(`(() => { const p = window.KotOR.PartyManager;
      const t3 = p.party.findIndex(c => c.npcId === 8);
      if (t3 < 1) throw new Error('T3 companion not found');
      p.SwitchLeaderAtIndex(t3);
      if (p.party[0].npcId !== 8) throw new Error('T3 leader switch failed');
      p.MakePlayerLeader(); return true; })()`);
  }
  return state;
}

async function saveReload(harness, expectedModule) {
  const before = await harness.evaluate(PARTY_SAMPLE);
  await harness.evaluate(`(async () => {
    const K = window.KotOR;
    await K.SaveGame.SaveCurrentGame('Memory soak checkpoint', 2);
    const matches = K.SaveGame.saves.filter(s => s.getSaveNumber() === 2);
    if (matches.length !== 1) throw new Error('Soak save was not uniquely located');
    const save = matches[0];
    if (String(save.getLastModule()).toUpperCase() !== ${JSON.stringify(expectedModule)}) throw new Error('Save module mismatch');
    window.__memoryProbeLoad = { module: ${JSON.stringify(expectedModule)}, error: null };
    await save.load();
    return true;
  })()`, { timeoutMs: 180000 });
  await harness.waitFor(landed, 300000, 1000);
  const after = await harness.evaluate(PARTY_SAMPLE);
  compareParty(before, after);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  fs.mkdirSync(args.out, { recursive: true });
  // Each invocation gets a new root, even when reusing an output directory.
  const userRoot = fs.mkdtempSync(path.join(args.out, 'user-'));
  const report = { schema: 'kotor2-vr/memory-soak@1', startedAt: new Date().toISOString(),
    scenario: 'direct module lifecycle stress; synthetic companion recruitment; one overwritten save slot',
    args, userRoot, completed: false, error: null, readings: [], summary: [] };
  const reportPath = path.join(args.out, 'memory-soak.json');
  const persist = () => {
    report.summary = summarizeReadings(report.readings);
    fs.writeFileSync(reportPath + '.tmp', JSON.stringify(report, null, 2));
    fs.renameSync(reportPath + '.tmp', reportPath);
  };
  const harness = new VrHarness({ port: args.cdpPort, observeServingBundle: true });
  let service;
  try {
    persist();
    service = await startAssetService({ port: args.port, userRoot });
    await harness.launch(service.url);
    await harness.evaluate(`window.__memoryProbeMovieSkip = setInterval(() => {
      const video = window.KotOR?.GameState?.VideoManager;
      if (video?.currentMovie?.skippable) video.skipMovie();
    }, 250); true`);
    try {
      report.bootstrap = await bootstrapFreshNewGame(harness, console.log);
      report.bundle = await harness.getTrustedServingBundle();
    } finally {
      await harness.evaluate('clearInterval(window.__memoryProbeMovieSkip); delete window.__memoryProbeMovieSkip; true');
    }
    await harness.evaluate(`(() => {
      const gs = window.KotOR.GameState, cm = gs.CutsceneManager;
      if (String(cm.dialog?.resref || '').toLowerCase() === 'intro' && cm.active) cm.endConversation(true);
      gs.MenuManager.InGameOverlay.open(); return true;
    })()`);
    await enterVrSession(harness);
    if (args.profile) await harness.cdp.send('HeapProfiler.startSampling', { samplingInterval: 32768 });
    const measure = async (cycle, module, operation, start) => {
      const loadMs = Date.now() - start;
      const frame = await harness.evaluate('window.KotOR.GameState.renderer.info.render.frame');
      await harness.waitFor(`window.KotOR.GameState.renderer.xr.isPresenting && window.KotOR.GameState.renderer.info.render.frame >= ${frame + 10}`, 30000, 500);
      // CDP console handles otherwise retain objects independently of the game.
      await harness.cdp.send('Runtime.discardConsoleEntries');
      await harness.cdp.send('HeapProfiler.collectGarbage');
      const resources = await harness.evaluate(SAMPLE), party = await harness.evaluate(PARTY_SAMPLE);
      const sample = { ...resources, ...party, player: { ...resources.player, ...party.player },
        cycle, operation, partyMode: cycle % 2 === 0 ? 'full' : 'solo', loadMs,
        measurementMs: Date.now() - start - loadMs };
      sample.advancedFrames = sample.renderFrame - frame;
      sample.heapMb = +((await harness.cdp.send('Runtime.getHeapUsage')).usedSize / 1048576).toFixed(3);
      validateSample(sample, module);
      report.readings.push(sample);
      report.runtimeFailures = runtimeFailures(harness.consoleSince(), harness.pageErrors);
      persist();
      console.log(`${cycle} ${module} ${operation} party=${sample.party.length} heap=${sample.heapMb}MB geom=${sample.geometries} tex=${sample.textures} load=${sample.loadMs}ms`);
      if (report.runtimeFailures.length) throw new Error(report.runtimeFailures.slice(0, 3).join('\n'));
    };
    for (let cycle = 1; cycle <= args.cycles; cycle++) {
      await configureParty(harness, cycle % 2 === 0);
      for (const module of args.modules) {
        const start = Date.now();
        await harness.evaluate(loadModule(module));
        await harness.waitFor(landed, 300000, 1000);
        await harness.waitFor('window.KotOR.GameState.Mode === 1', 30000, 500);
        await measure(cycle, module, 'transition', start);
      }
      const start = Date.now(), module = args.modules.at(-1);
      await saveReload(harness, module);
      await measure(cycle, module, 'reload', start);
      if (args.profile) {
        const profile = await harness.cdp.send('HeapProfiler.getSamplingProfile');
        fs.writeFileSync(path.join(args.out, `allocations-${cycle}.json`), JSON.stringify(profile));
      }
    }
    report.completed = true;
  } catch (error) {
    report.error = String(error.stack || error);
    if (harness.cdp) {
      try {
        report.failureState = { ...await harness.evaluate(SAMPLE), ...await harness.evaluate(PARTY_SAMPLE) };
      } catch (diagnosticError) { report.diagnosticError = String(diagnosticError); }
    }
    throw error;
  } finally {
    report.endedAt = new Date().toISOString();
    report.pageErrors = harness.pageErrors;
    report.consoleErrors = harness.consoleSince().filter(m => m.level === 'error');
    report.runtimeFailures = runtimeFailures(harness.consoleSince(), harness.pageErrors);
    try { persist(); } finally {
      try { await harness.close(); } finally { if (service) service.stop(); }
    }
    console.log(`Report: ${reportPath}`);
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { parseArgs, summarizeReadings, validateSample, compareParty, configureParty, saveReload };
