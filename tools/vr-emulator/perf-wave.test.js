const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  normalizeFlags, wavePlan, waveStops, stopOptions, estimateWave, formatWavePlan, abaDelta, confirmFlag,
} = require('./perf-wave');
const { STOP_OVERHEAD_SECONDS } = require('./perf-bisect');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'perf-benchmarks.json'), 'utf8'));

// A wave record as `perf-round.js wave` writes it: the bisect fields plus
// `flags` and `phase`, and `flag` on the A/B/A windows.
const rec = (phase, { flag = 'x', p90, set = 'peragus', checkpoint = 'medbay-swept', window = 'rest', pos = { x: 0, y: 0, z: 0 }, afterPos, trustworthy = true, hz = 72 } = {}) => ({
  label: `w-${phase}-${set}-${checkpoint}-${window}${flag ? `-${flag}` : ''}`,
  phase, set, checkpoint, window,
  ...(phase === 'suite' ? {} : { flag }),
  flags: { [flag || 'x']: phase === 'B' ? 'off' : 'on' },
  targetHz: hz,
  before: { player: pos, perflayer: 5 },
  after: { player: afterPos || pos, perflayer: 5 },
  report: {
    frametimeMs: { p50: p90 - 2, p90, p99: p90 + 3, max: p90 + 10 },
    xrCadence: { integrity: { trustworthy } },
  },
});

// Flag x predicted to save 4 ms: off it runs 20 ms, on it runs 16 ms.
const aba = ({ a1 = 16, b = 20, a2 = 16, posB = { x: 0, y: 0, z: 0 }, afterB, trustB = true, hzB = 72 } = {}) => [
  rec('A1', { p90: a1 }),
  rec('B', { p90: b, pos: posB, afterPos: afterB || posB, trustworthy: trustB, hz: hzB }),
  rec('A2', { p90: a2 }),
];

// A Phase 0 bisect record: `rung`, no `phase`.
const bisectRec = (set, checkpoint, rung, window, p90) => ({
  label: `bisect-${set}-${checkpoint}-l${rung}-${window}`, set, checkpoint, rung, window,
  report: { frametimeMs: { p50: p90 - 2, p90, p99: p90 + 3 }, xrCadence: { integrity: { trustworthy: true } } },
});

test('confirmFlag confirmed within ±30%', () => {
  const out = confirmFlag(aba({ a1: 16, b: 20, a2: 16.4 }), 'x', 4);
  assert.strictEqual(out.verdict, 'confirmed');
  // B.p90 - mean(A1.p90, A2.p90): positive means the flag saves time.
  assert.ok(Math.abs(out.deltaMs - 3.8) < 1e-9, `deltaMs ${out.deltaMs}`);
  assert.strictEqual(out.positionDriftM, 0);
  assert.strictEqual(out.withinPrediction, true);
});

test('confirmFlag rejected when no gain', () => {
  const none = confirmFlag(aba({ a1: 20, b: 20, a2: 20 }), 'x', 4);
  assert.strictEqual(none.verdict, 'rejected');
  assert.strictEqual(none.deltaMs, 0);
  // A gain of exactly 30% of the prediction is still "no meaningful gain".
  const tiny = confirmFlag(aba({ a1: 18.8, b: 20, a2: 18.8 }), 'x', 4);
  assert.strictEqual(tiny.verdict, 'rejected');
  // Worse with the flag on is no gain either.
  assert.strictEqual(confirmFlag(aba({ a1: 21, b: 20, a2: 21 }), 'x', 4).verdict, 'rejected');
});

test('confirmFlag inconclusive on drift', () => {
  // 0.6 m horizontal between B and the A windows; height (z) is ignored.
  const out = confirmFlag(aba({ posB: { x: 0.36, y: 0.48, z: 3 } }), 'x', 4);
  assert.strictEqual(out.verdict, 'inconclusive');
  assert.ok(Math.abs(out.positionDriftM - 0.6) < 1e-9, `drift ${out.positionDriftM}`);
  assert.match(out.reason, /drift/);
  // Exactly 0.5 m is still conclusive.
  assert.strictEqual(confirmFlag(aba({ posB: { x: 0.3, y: 0.4, z: 0 } }), 'x', 4).verdict, 'confirmed');
});

test('confirmFlag inconclusive on a missing or untrustworthy A/B window', () => {
  const missing = confirmFlag(aba().filter((r) => r.phase !== 'A2'), 'x', 4);
  assert.strictEqual(missing.verdict, 'inconclusive');
  assert.match(missing.reason, /A2/);
  const untrusted = confirmFlag(aba({ trustB: false }), 'x', 4);
  assert.strictEqual(untrusted.verdict, 'inconclusive');
  assert.match(untrusted.reason, /B.*untrustworthy/);
  // Another flag's windows do not stand in for this one's.
  assert.strictEqual(confirmFlag(aba(), 'y', 4).verdict, 'inconclusive');
  // No player position means the drift cannot be checked.
  const noPos = aba();
  noPos[1].before.player = null;
  const out = confirmFlag(noPos, 'x', 4);
  assert.strictEqual(out.verdict, 'inconclusive');
  assert.strictEqual(out.positionDriftM, null);
});

test('confirmFlag ambiguous: a real gain more than 30% off the prediction is confirmed only from 0.7× up', () => {
  // 6 ms against a 4 ms prediction: 50% over, but more than 0.7× -> confirmed.
  const over = confirmFlag(aba({ a1: 14, b: 20, a2: 14 }), 'x', 4);
  assert.strictEqual(over.verdict, 'confirmed');
  assert.strictEqual(over.withinPrediction, false);
  // 2 ms against 4 ms: a real gain (> 0.3×) but under 0.7× -> rejected.
  const under = confirmFlag(aba({ a1: 18, b: 20, a2: 18 }), 'x', 4);
  assert.strictEqual(under.verdict, 'rejected');
  assert.strictEqual(under.withinPrediction, false);
  // Exactly 0.7× (2.8 of 4) is the lowest confirmed gain.
  assert.strictEqual(confirmFlag(aba({ a1: 17.2, b: 20, a2: 17.2 }), 'x', 4).verdict, 'confirmed');
});

test('confirmFlag skips the regression check without a baseline and says so', () => {
  const out = confirmFlag(aba(), 'x', 4);
  assert.strictEqual(out.regressionChecked, false);
  assert.match(out.note, /no baseline/i);
});

test('confirmFlag: a suite regression over 1 ms p90 against the baseline blocks confirmation', () => {
  const suite = [
    rec('suite', { flag: null, set: 'ebon-hawk', checkpoint: 'ebon-main-hold-open', p90: 15.2 }),
    rec('suite', { flag: null, set: 'telos', checkpoint: 'perf-telos-a', p90: 25 }),
  ];
  const baseline = [
    rec('suite', { flag: null, set: 'ebon-hawk', checkpoint: 'ebon-main-hold-open', p90: 14 }),
    rec('suite', { flag: null, set: 'telos', checkpoint: 'perf-telos-a', p90: 25 }),
  ];
  const out = confirmFlag([...aba(), ...suite], 'x', 4, baseline);
  assert.strictEqual(out.verdict, 'inconclusive');
  assert.strictEqual(out.regressionChecked, true);
  assert.deepStrictEqual(out.regressions.map((r) => r.set), ['ebon-hawk']);
  assert.ok(Math.abs(out.regressions[0].deltaMs - 1.2) < 1e-9);
  // Exactly 1 ms is not a regression.
  suite[0].report.frametimeMs.p90 = 15;
  const ok = confirmFlag([...aba(), ...suite], 'x', 4, baseline);
  assert.strictEqual(ok.verdict, 'confirmed');
  assert.deepStrictEqual(ok.regressions, []);
});

test('confirmFlag: a bisect L5 baseline counts, so a suite window that went 12 -> 20 ms does not confirm', () => {
  const suite = [rec('suite', { flag: null, set: 'ebon-hawk', checkpoint: 'ebon-main-hold-open', p90: 20 })];
  const baseline = [
    bisectRec('ebon-hawk', 'ebon-main-hold-open', 3, 'rest', 9),
    bisectRec('ebon-hawk', 'ebon-main-hold-open', 5, 'rest', 12),
  ];
  const out = confirmFlag([...aba(), ...suite], 'x', 4, baseline);
  assert.notStrictEqual(out.verdict, 'confirmed');
  assert.strictEqual(out.regressionChecked, true);
  assert.strictEqual(out.regressionMatched, 1);
  assert.deepStrictEqual(out.regressions.map((r) => [r.set, r.baselineP90, r.p90]), [['ebon-hawk', 12, 20]]);
});

test('confirmFlag: a baseline that matches no suite window is not a regression check', () => {
  const suite = [rec('suite', { flag: null, set: 'ebon-hawk', checkpoint: 'ebon-main-hold-open', p90: 20 })];
  // Only a stripped rung here, and l5 for a checkpoint the wave did not run: nothing comparable.
  const baseline = [
    bisectRec('ebon-hawk', 'ebon-main-hold-open', 3, 'rest', 9),
    bisectRec('telos', 'perf-telos-a', 5, 'rest', 25),
  ];
  const out = confirmFlag([...aba(), ...suite], 'x', 4, baseline);
  assert.strictEqual(out.regressionChecked, false);
  assert.strictEqual(out.regressionMatched, 0);
  assert.match(out.note, /matched no suite window/);
});

test('confirmFlag inconclusive when the player moved within a window (after positions count)', () => {
  const out = confirmFlag(aba({ afterB: { x: 7, y: 0, z: 0 } }), 'x', 4);
  assert.strictEqual(out.verdict, 'inconclusive');
  assert.ok(Math.abs(out.positionDriftM - 7) < 1e-9, `drift ${out.positionDriftM}`);
  const noAfter = aba();
  noAfter[2].after.player = null;
  assert.strictEqual(confirmFlag(noAfter, 'x', 4).verdict, 'inconclusive');
});

test('confirmFlag inconclusive when targetHz differs across A1/B/A2', () => {
  const out = confirmFlag(aba({ hzB: 90 }), 'x', 4);
  assert.strictEqual(out.verdict, 'inconclusive');
  assert.match(out.reason, /targetHz/);
});

test('confirmFlag rejects a prediction that is not a positive number', () => {
  assert.throws(() => confirmFlag(aba(), 'x', 0), /predictedMs/);
  assert.throws(() => confirmFlag(aba(), 'x', NaN), /predictedMs/);
});

test('abaDelta reads the latest A1/B/A2 windows of one flag', () => {
  const recs = [...aba({ a1: 30, b: 30, a2: 30 }), ...aba({ a1: 16, b: 20, a2: 16 })];
  const d = abaDelta(recs, 'perf.x');
  assert.strictEqual(d.deltaMs, 4);
  assert.deepStrictEqual([d.a1, d.b, d.a2], [16, 20, 16]);
});

test('normalizeFlags strips the perf. prefix, dedupes and rejects junk', () => {
  assert.deepStrictEqual(normalizeFlags('perf.x,perf.y,x'), ['x', 'y']);
  // readLaunchOption is case-sensitive and flags are lowercase by convention.
  assert.deepStrictEqual(normalizeFlags('Perf.Batching,BATCHING,perf.X'), ['batching', 'x']);
  assert.deepStrictEqual(normalizeFlags(['batching', 'perf.static-matrices']), ['batching', 'static-matrices']);
  assert.throws(() => normalizeFlags(''), /at least one flag/);
  assert.throws(() => normalizeFlags('perf.a=on'), /flag id/);
});

test('wavePlan builds A/B/A per flag on worst set only', () => {
  const plan = wavePlan(manifest, ['perf.x', 'y'], 'peragus');
  const aba = plan.filter((r) => r.phase !== 'suite');
  assert.strictEqual(aba.length, 6);
  for (const r of aba) {
    assert.strictEqual(r.set, 'peragus');
    assert.strictEqual(r.checkpoint, 'medbay-swept');
    assert.strictEqual(r.window, 'rest');
  }
  assert.deepStrictEqual(aba.map((r) => `${r.flag}:${r.phase}`), ['x:A1', 'x:B', 'x:A2', 'y:A1', 'y:B', 'y:A2']);
  assert.deepStrictEqual(aba[0].flags, { x: 'on', y: 'on' });
  assert.deepStrictEqual(aba[1].flags, { x: 'off', y: 'on' });
  assert.deepStrictEqual(aba[2].flags, { x: 'on', y: 'on' });
  assert.deepStrictEqual(aba[4].flags, { x: 'on', y: 'off' });
  // The A/B/A windows come after the whole suite.
  const firstAba = plan.findIndex((r) => r.phase !== 'suite');
  assert.ok(plan.slice(firstAba).every((r) => r.phase !== 'suite'));
});

test('wavePlan suite: every set and checkpoint, all flags on, rest plus walk where the set walks', () => {
  const suite = wavePlan(manifest, ['x'], 'telos').filter((r) => r.phase === 'suite');
  assert.ok(suite.every((r) => r.flags.x === 'on' && r.flag === undefined));
  const sets = [...new Set(suite.map((r) => r.set))];
  assert.deepStrictEqual(sets, ['peragus', 'ebon-hawk', 'conversation', 'combat', 'telos']);
  for (const set of sets) {
    const cps = manifest[set].checkpoints.map((c) => c.name);
    assert.deepStrictEqual([...new Set(suite.filter((r) => r.set === set).map((r) => r.checkpoint))], cps);
    const want = manifest[set].windows.includes('walk') ? ['rest', 'walk'] : ['rest'];
    for (const cp of cps) assert.deepStrictEqual(suite.filter((r) => r.checkpoint === cp).map((r) => r.window), want);
  }
  // Pending checkpoints stay marked so the save check can skip them.
  assert.ok(suite.find((r) => r.checkpoint === 'perf-telos-a').pending);
  // The worst set's ladder checkpoint is pending here, and so are its A/B/A rows.
  assert.ok(wavePlan(manifest, ['x'], 'telos').filter((r) => r.phase !== 'suite').every((r) => r.pending));
});

test('wavePlan rejects an unknown worst set', () => {
  assert.throws(() => wavePlan(manifest, ['x'], 'nonesuch'), /Unknown benchmark set: nonesuch/);
  assert.throws(() => wavePlan(manifest, ['x'], '_comment'), /Unknown benchmark set/);
});

test('waveStops: one boot per checkpoint in the suite, one per A/B/A window', () => {
  const plan = wavePlan(manifest, ['x', 'y'], 'peragus');
  const stops = waveStops(plan);
  const suiteStops = stops.filter((s) => s.phase === 'suite');
  const cps = Object.keys(manifest).filter((k) => !k.startsWith('_')).reduce((n, k) => n + manifest[k].checkpoints.length, 0);
  assert.strictEqual(suiteStops.length, cps);
  assert.strictEqual(stops.length - suiteStops.length, 6);
  assert.deepStrictEqual(stopOptions(stops.find((s) => s.phase === 'B' && s.flag === 'y')), ['perflayer=l5', 'perf.x=on', 'perf.y=off']);
});

test('estimateWave and formatWavePlan describe the run without CDP', () => {
  const plan = wavePlan(manifest, ['x'], 'peragus');
  const est = estimateWave(plan);
  assert.strictEqual(est.stops, waveStops(plan).length);
  assert.strictEqual(est.totalSeconds, plan.length * 60 + est.stops * STOP_OVERHEAD_SECONDS);
  const text = formatWavePlan(plan);
  assert.match(text, /peragus\/medbay-swept B \(x off\): rest/);
  assert.match(text, /perf\.x=off/);
  assert.match(text, /min/);
});
