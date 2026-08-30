/**
 * Tests for the sweep's pure logic — enumeration, selection, ranking, coverage
 * and ledger emission. Everything here runs without a browser, an engine or a
 * retail install, so the parts that decide what a run MEANS stay checkable
 * independently of the hour-long run that produces the data.
 *
 *   node --test tools/vr-emulator/module-sweep.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { listGameModules, selectModules } = require('./module-list');
const { buildModuleProbeSource } = require('./module-probe');
const {
  rankRootCauses, summarize, toDefectRecords, renderRanking, severityRank,
} = require('./sweep-report');
const { parseArgs, harvestConsole } = require('./module-sweep');

// --- enumeration ------------------------------------------------------------

function fixtureInstall(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kotor-sweep-'));
  fs.mkdirSync(path.join(root, 'modules'));
  for (const file of files) fs.writeFileSync(path.join(root, 'modules', file), '');
  return root;
}

test('module enumeration counts modules, not files', () => {
  // The shape a retail install actually has: three files per module.
  const root = fixtureInstall([
    '001EBO.rim', '001EBO_s.rim', '001EBO_dlg.erf',
    '101PER.rim', '101PER_s.rim', '101PER_dlg.erf',
  ]);
  assert.deepEqual(listGameModules(root), ['001EBO', '101PER']);
});

test('a .mod overriding a .rim is still one module', () => {
  const root = fixtureInstall(['001EBO.rim', '001EBO_s.rim', '001EBO.mod']);
  assert.deepEqual(listGameModules(root), ['001EBO']);
});

test('module names are uppercased and sorted', () => {
  const root = fixtureInstall(['302nar.rim', '101PER.rim', '001ebo.rim']);
  assert.deepEqual(listGameModules(root), ['001EBO', '101PER', '302NAR']);
});

test('a missing modules directory names the path and the fix', () => {
  assert.throws(
    () => listGameModules(path.join(os.tmpdir(), 'definitely-not-an-install')),
    /Could not read .*modules.*--game/s
  );
});

// --- selection --------------------------------------------------------------

const ALL = ['001EBO', '101PER', '102PER', '302NAR', '950COR'];

test('--modules wins outright and keeps the caller order', () => {
  assert.deepEqual(selectModules(ALL, { only: ['302NAR', '001EBO'] }), ['302NAR', '001EBO']);
});

test('--modules rejects an unknown module rather than silently sweeping nothing', () => {
  assert.throws(() => selectModules(ALL, { only: ['NOPE'] }), /Unknown module\(s\): NOPE/);
});

test('--start resumes in sorted order', () => {
  assert.deepEqual(selectModules(ALL, { start: '102PER' }), ['102PER', '302NAR', '950COR']);
});

test('--skip and --limit compose with --start', () => {
  assert.deepEqual(
    selectModules(ALL, { start: '101PER', skip: ['302NAR'], limit: 2 }),
    ['101PER', '102PER']
  );
});

test('--limit rejects a non-positive value', () => {
  assert.throws(() => selectModules(ALL, { limit: 0 }), /--limit must be a positive integer/);
});

// --- probe source -----------------------------------------------------------

test('the probe source is valid JavaScript and carries its parameters', () => {
  const source = buildModuleProbeSource('101PER', { loadTimeoutMs: 1234, frames: 7, perCodeCap: 3 });
  assert.doesNotThrow(() => new Function('return ' + source));
  assert.match(source, /const NAME = "101PER"/);
  assert.match(source, /const LOAD_TIMEOUT = 1234/);
  assert.match(source, /const FRAMES = 7/);
  assert.match(source, /const CAP = 3/);
});

test('the probe never stringifies an engine object', () => {
  // Rule 3 in module-probe.js. A single JSON.stringify of a texture-bearing
  // engine object once produced ~30k console warnings inside the measured loop.
  const source = buildModuleProbeSource('101PER');
  assert.equal(/JSON\.stringify/.test(source), false);
});

test('the probe clears the loadingModule latch before every load', () => {
  // Without this, one failed load turns every later module into a silent no-op
  // that reports the previous module's contents.
  assert.match(buildModuleProbeSource('101PER'), /GS\.loadingModule = false/);
});

// --- ranking ----------------------------------------------------------------

const REPORTS = [
  {
    module: '001EBO', phase: 'complete', ms: 1000, findings: [
      { code: 'creature-model-missing', severity: 'major', detail: 'no model', subject: 'Atton' },
      { code: 'dialogue-missing', severity: 'major', detail: 'gone', subject: 'atton01' },
    ], skipped: [], truncated: {},
  },
  {
    module: '101PER', phase: 'complete', ms: 2000, findings: [
      { code: 'creature-model-missing', severity: 'major', detail: 'no model', subject: 'Kreia' },
      { code: 'creature-model-missing', severity: 'major', detail: 'no model', subject: 'Droid' },
    ], skipped: [{ probe: 'items', error: 'gone' }], truncated: {},
  },
  {
    module: '102PER', phase: 'load', ms: 500, findings: [
      { code: 'module-load-timeout', severity: 'blocker', detail: 'timed out', subject: '102PER' },
    ], skipped: [], truncated: {},
  },
];

test('ranking puts the widest blast radius first, not the loudest module', () => {
  const ranked = rankRootCauses(REPORTS);
  assert.equal(ranked[0].code, 'creature-model-missing');
  assert.equal(ranked[0].moduleCount, 2);
  assert.equal(ranked[0].occurrences, 3);
  assert.deepEqual(ranked[0].modules, ['001EBO', '101PER']);
});

test('a blocker in one module still ranks below a major in two', () => {
  // Deliberate: the sweep exists to find systemic faults. A single blocked
  // module is worth one session; a fault in two is worth understanding first.
  const ranked = rankRootCauses(REPORTS);
  const blocker = ranked.findIndex((r) => r.code === 'module-load-timeout');
  const systemic = ranked.findIndex((r) => r.code === 'creature-model-missing');
  assert.ok(systemic < blocker);
});

test('a code raised at two severities keeps the most severe', () => {
  const ranked = rankRootCauses([
    { module: 'A', findings: [{ code: 'x', severity: 'minor', detail: 'd', subject: null }] },
    { module: 'B', findings: [{ code: 'x', severity: 'blocker', detail: 'd', subject: null }] },
  ]);
  assert.equal(ranked[0].severity, 'blocker');
});

test('findings suppressed by the per-code cap still count toward blast radius', () => {
  const ranked = rankRootCauses([{
    module: 'A',
    findings: [{ code: 'x', severity: 'major', detail: 'd', subject: null }],
    truncated: { x: 900 },
  }]);
  assert.equal(ranked[0].occurrences, 900);
});

test('examples are capped so one systemic fault cannot fill the report', () => {
  const findings = Array.from({ length: 50 }, (_, i) => ({
    code: 'x', severity: 'major', detail: 'd', subject: 's' + i,
  }));
  const ranked = rankRootCauses([{ module: 'A', findings, truncated: {} }]);
  assert.equal(ranked[0].examples.length, 5);
  assert.equal(ranked[0].occurrences, 50);
});

test('severity order is most-severe-first', () => {
  assert.ok(severityRank('blocker') < severityRank('major'));
  assert.ok(severityRank('major') < severityRank('cosmetic'));
  assert.ok(severityRank('nonsense') > severityRank('cosmetic'));
});

// --- coverage ---------------------------------------------------------------

test('coverage separates loaded from clean', () => {
  const summary = summarize(REPORTS);
  assert.equal(summary.modulesSwept, 3);
  assert.equal(summary.modulesLoaded, 2);   // 102PER never got past load
  assert.equal(summary.modulesClean, 0);    // the other two have findings
  assert.equal(summary.modulesBlocked, 1);
  assert.equal(summary.findings, 5);
  assert.equal(summary.bySeverity.blocker, 1);
  assert.equal(summary.bySeverity.major, 4);
});

test('skipped probes are counted so a dead battery cannot read as clean', () => {
  assert.equal(summarize(REPORTS).skippedProbes, 1);
});

test('a module that loads and finds nothing counts as clean', () => {
  const summary = summarize([{ module: 'A', phase: 'complete', ms: 1, findings: [], skipped: [] }]);
  assert.equal(summary.modulesClean, 1);
  assert.equal(summary.modulesBlocked, 0);
});

// --- ledger emission --------------------------------------------------------

test('emitted records satisfy the DefectLedger contract', () => {
  const records = toDefectRecords(REPORTS, 'evidence/module-sweep.jsonl');
  assert.ok(records.length > 0);
  for (const record of records) {
    for (const field of ['id', 'title', 'module', 'room', 'expected', 'observed']) {
      assert.equal(typeof record[field], 'string');
      assert.ok(record[field].trim().length > 0, `${field} must be non-empty`);
    }
    assert.ok(['blocker', 'critical', 'major', 'minor', 'cosmetic'].includes(record.severity));
    assert.ok(['open', 'verified', 'resolved', 'not-reproducible'].includes(record.status));
    assert.ok(record.reproductionSteps.length >= 1);
    assert.ok(record.evidenceRefs.length >= 1);
  }
});

test('one record per code per module, with the occurrence count in the title', () => {
  const records = toDefectRecords(REPORTS, 'e.jsonl');
  const peragus = records.find((r) => r.id === 'sweep-101per-creature-model-missing');
  assert.ok(peragus);
  assert.match(peragus.title, /2×/);
  assert.match(peragus.observed, /Kreia/);
  assert.match(peragus.reproductionSteps[0], /--modules 101PER/);
});

test('room is declared module-wide rather than invented', () => {
  // The battery works at module scope. Fabricating a room to satisfy a required
  // field would put a made-up location into evidence.
  for (const record of toDefectRecords(REPORTS, 'e.jsonl')) {
    assert.equal(record.room, '(module-wide)');
  }
});

// --- console harvesting -----------------------------------------------------

test('console harvesting deduplicates and attributes only new messages', () => {
  const harness = {
    consoleMessages: [
      { level: 'log', text: 'before' },
      { level: 'error', text: 'texture missing: foo' },
      { level: 'error', text: 'texture missing: foo' },
      { level: 'warning', text: 'probe 404' },
    ],
  };
  const harvested = harvestConsole(harness, 1);
  assert.equal(harvested.total, 3);
  assert.equal(harvested.errors, 2);
  assert.equal(harvested.warnings, 1);
  assert.deepEqual(harvested.samples, ['texture missing: foo']);
});

// --- argument parsing -------------------------------------------------------

test('argument parsing handles lists and numbers', () => {
  const args = parseArgs(['--modules', '101PER, 102PER', '--limit', '3', '--frames', '10']);
  assert.deepEqual(args.modules, ['101PER', '102PER']);
  assert.equal(args.limit, 3);
  assert.equal(args.frames, 10);
});

test('an unknown flag fails loudly instead of being ignored', () => {
  assert.throws(() => parseArgs(['--modlues', '101PER']), /Unknown flag: --modlues/);
});

test('defaults keep a bare run safe and complete', () => {
  const args = parseArgs([]);
  assert.equal(args.modules, null);       // sweep everything
  assert.equal(args.reloadEvery, 25);     // backstop; the heap trigger leads
  assert.equal(args.frames, 30);
});

// --- rendering --------------------------------------------------------------

test('the ranking table renders and truncates', () => {
  const rendered = renderRanking(rankRootCauses(REPORTS), 1);
  assert.match(rendered, /creature-model-missing/);
  assert.match(rendered, /and 2 more codes/);
});

test('an empty ranking says so rather than rendering an empty table', () => {
  assert.match(renderRanking([]), /no findings/);
});

// --- readiness guard --------------------------------------------------------
// These pin the fix for the first smoke run's failure, where the probe passed
// its readiness check in 1.7s against the OUTGOING module and reported an area
// with zero rooms, zero creatures and zero of everything else as a blocker.

test('readiness requires a different module object, not merely an area', () => {
  const source = buildModuleProbeSource('101PER');
  assert.match(source, /const previousModule = GS\.module/);
  assert.match(source, /GS\.module !== previousModule/);
});

test('readiness requires the engine to have finished building the area', () => {
  assert.match(buildModuleProbeSource('101PER'), /readyToProcessEvents === true/);
});

test('the probe verifies it landed in the module it asked for', () => {
  const source = buildModuleProbeSource('101PER');
  assert.match(source, /module-identity-mismatch/);
  assert.match(source, /GS\.module\.filename/);
});

test('settle time is configurable and defaults to a non-zero wait', () => {
  assert.match(buildModuleProbeSource('X', { settleMs: 1500 }), /const SETTLE_MS = 1500/);
  assert.match(buildModuleProbeSource('X'), /const SETTLE_MS = 5000/);
});

test('the dialogue probe reads what the engine resolved, not DLGObject', () => {
  // DLGObject is not exported from the bundle, and FromResRef is synchronous
  // rather than async — the first version of this probe assumed both wrongly and
  // skipped itself on every module.
  const source = buildModuleProbeSource('101PER');
  assert.equal(/K\.DLGObject/.test(source), false);
  assert.match(source, /dialogue-unresolved/);
  assert.match(source, /creature\.conversation/);
});

test('--settle is accepted and reaches the probe', () => {
  assert.equal(parseArgs(['--settle', '2500']).settle, 2500);
  assert.equal(parseArgs([]).settle, 5000);
});

// --- reload policy ----------------------------------------------------------

test('reload defaults are heap-driven with a count backstop', () => {
  const args = parseArgs([]);
  assert.equal(args.reloadHeapMb, 3000);
  assert.equal(args.reloadEvery, 25);
});

test('an unavailable heap reading is null, not zero', () => {
  // performance.memory is Chrome-only and can be absent. Reporting 0 would read
  // as "heap is fine" and suppress every reload for the rest of the sweep.
  const { readHeapMb } = require('./module-sweep');
  const absent = { evaluate: async () => null };
  const broken = { evaluate: async () => { throw new Error('detached'); } };
  return Promise.all([
    readHeapMb(absent).then((v) => assert.equal(v, null)),
    readHeapMb(broken).then((v) => assert.equal(v, null)),
    readHeapMb({ evaluate: async () => 1024 * 1024 * 512 })
      .then((v) => assert.equal(Math.round(v), 512)),
  ]);
});

// --- benign console filtering -----------------------------------------------

test('the .mod 404 probe is recognised as benign, not a fault', () => {
  // ROADMAP 1.11. A retail install has no module-level .mod files, so this 404
  // fires for all 82 modules. Unfiltered it would top the blast-radius ranking
  // and bury every real systemic fault beneath it.
  const { isBenignConsoleError } = require('./module-sweep');
  assert.equal(isBenignConsoleError(
    "Error: GameFileSystem.read: failed reading 'modules/001EBO.mod' at offset 0 " +
    'for 160 bytes: expected HTTP 206, received 404'
  ), true);
});

test('a real read failure is not filtered as benign', () => {
  const { isBenignConsoleError } = require('./module-sweep');
  assert.equal(isBenignConsoleError(
    "Error: GameFileSystem.read: failed reading 'data/models.bif' at offset 0 " +
    'for 160 bytes: expected HTTP 206, received 500'
  ), false);
  assert.equal(isBenignConsoleError('Error: Resource not found: ResRef: t_door01'), false);
});

test('benign errors are counted separately rather than discarded', () => {
  const harness = {
    consoleMessages: [
      { level: 'error', text: "GameFileSystem.read: failed reading 'modules/X.mod' at offset 0 for 1 bytes: expected HTTP 206, received 404" },
      { level: 'error', text: 'Resource not found: ResRef: t_door01' },
    ],
  };
  const harvested = harvestConsole(harness, 0);
  assert.equal(harvested.errors, 1);
  assert.equal(harvested.benignErrors, 1);
  assert.deepEqual(harvested.samples, ['Resource not found: ResRef: t_door01']);
});
