const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  normalizeFlags, wavePlan, waveStops, stopOptions, estimateWave, formatWavePlan, abaDelta, confirmFlag,
  parsePredicted, confirmWave, formatConfirm, windowPrompt,
} = require('./perf-wave');
const { STOP_OVERHEAD_SECONDS } = require('./perf-bisect');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'perf-benchmarks.json'), 'utf8'));

// A wave record as `perf-round.js wave` writes it: the bisect fields plus
// `flags` and `phase`, and `flag` on the A/B/A windows.
const rec = (phase, { flag = 'x', p90, set = 'peragus', checkpoint = 'medbay-swept', window = 'rest', pos = { x: 0, y: 0, z: 0 }, afterPos, trustworthy = true, hz = 72, runtimeHz } = {}) => ({
  label: `w-${phase}-${set}-${checkpoint}-${window}${flag ? `-${flag}` : ''}`,
  phase, set, checkpoint, window,
  ...(phase === 'suite' ? {} : { flag }),
  flags: { [flag || 'x']: phase === 'B' ? 'off' : 'on' },
  targetHz: 50, // the acceptance floor: constant, never what separates windows
  ...(hz === null ? {} : { refreshHz: hz, refreshHzSource: 'declared' }),
  before: { player: pos, perflayer: 5, ...(runtimeHz === undefined ? {} : { runtimeReportedHz: runtimeHz }) },
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

test('confirmFlag inconclusive when refreshHz differs across A1/B/A2', () => {
  const out = confirmFlag(aba({ hzB: 90 }), 'x', 4);
  assert.strictEqual(out.verdict, 'inconclusive');
  assert.match(out.reason, /refreshHz differs/);
});

test('targetHz (the 50 Hz floor) never decides the A/B/A refresh check', () => {
  const recs = aba();
  recs[1].targetHz = 72; // would have looked like a mismatch under the old check
  assert.strictEqual(confirmFlag(recs, 'x', 4).verdict, 'confirmed');
});

test('older A/B/A records fall back to before.runtimeReportedHz', () => {
  const old = (hzs) => ['A1', 'B', 'A2'].map((phase, i) => rec(phase, { p90: phase === 'B' ? 20 : 16, hz: null, runtimeHz: hzs[i] }));
  const same = confirmFlag(old([90, 90, 90]), 'x', 4);
  assert.strictEqual(same.verdict, 'confirmed');
  const diff = confirmFlag(old([90, 72, 90]), 'x', 4);
  assert.strictEqual(diff.verdict, 'inconclusive');
  assert.match(diff.reason, /refreshHz differs/);
});

test('A/B/A refresh check is skipped, with a note, when no window has a known refreshHz', () => {
  const recs = ['A1', 'B', 'A2'].map((phase) => rec(phase, { p90: phase === 'B' ? 20 : 16, hz: null }));
  const out = confirmFlag(recs, 'x', 4);
  assert.strictEqual(out.verdict, 'confirmed');
  assert.match(out.note, /refresh-rate check skipped/);
});

test('A/B/A refresh check is partial, with a note, when only some windows know their refreshHz', () => {
  const recs = aba();
  delete recs[0].refreshHz;
  const out = confirmFlag(recs, 'x', 4);
  assert.strictEqual(out.verdict, 'confirmed');
  assert.match(out.note, /unknown on A1.*partial/);
});

test('a known A/B/A refreshHz leaves no refresh note', () => {
  assert.doesNotMatch(String(confirmFlag(aba(), 'x', 4).note), /refresh/);
});

const hold = { set: 'ebon-hawk', checkpoint: 'ebon-main-hold-open' };

test('confirmFlag: a baseline measured at another refreshHz is not compared, and says so', () => {
  const suite = [rec('suite', { flag: null, ...hold, p90: 20, hz: 72 })];
  const baseline = [rec('suite', { flag: null, ...hold, p90: 12, hz: 90 })];
  const out = confirmFlag([...aba(), ...suite], 'x', 4, baseline);
  assert.strictEqual(out.regressionChecked, false);
  assert.deepStrictEqual(out.regressions, []);
  assert.strictEqual(out.verdict, 'confirmed');
  assert.match(out.note, /different refreshHz/);
  assert.match(out.note, /every matching baseline window differs in refreshHz/);
});

test('confirmFlag: only the same-refreshHz baseline windows are compared', () => {
  const suite = [
    rec('suite', { flag: null, ...hold, p90: 20, hz: 72 }),
    rec('suite', { flag: null, set: 'telos', checkpoint: 'perf-telos-a', p90: 25, hz: 72 }),
  ];
  const baseline = [
    rec('suite', { flag: null, ...hold, p90: 12, hz: 90 }),
    rec('suite', { flag: null, set: 'telos', checkpoint: 'perf-telos-a', p90: 20, hz: 72 }),
  ];
  const out = confirmFlag([...aba(), ...suite], 'x', 4, baseline);
  assert.strictEqual(out.regressionChecked, true);
  assert.strictEqual(out.regressionMatched, 1);
  assert.deepStrictEqual(out.regressions.map((r) => r.set), ['telos']);
  assert.match(out.note, /1 baseline window\(s\)/);
});

test('confirmFlag: a baseline without refreshHz is still compared, with a note', () => {
  const suite = [rec('suite', { flag: null, ...hold, p90: 20 })];
  const baseline = [bisectRec('ebon-hawk', 'ebon-main-hold-open', 5, 'rest', 12)];
  const out = confirmFlag([...aba(), ...suite], 'x', 4, baseline);
  assert.strictEqual(out.regressionChecked, true);
  assert.match(out.note, /no known refreshHz on one side/);
  // The fallback is the runtime rate in `before`: 90 now vs 72 then is a mismatch.
  const old72 = bisectRec('ebon-hawk', 'ebon-main-hold-open', 5, 'rest', 12);
  old72.before = { runtimeReportedHz: 72 };
  const now90 = [rec('suite', { flag: null, ...hold, p90: 20, hz: null, runtimeHz: 90 })];
  const out2 = confirmFlag([...aba(), ...now90], 'x', 4, [old72]);
  assert.strictEqual(out2.regressionChecked, false);
  assert.match(out2.note, /different refreshHz/);
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

test("wavePlan suite: every set and checkpoint, all flags on, rest plus each set's walk and talk windows", () => {
  const suite = wavePlan(manifest, ['x'], 'telos').filter((r) => r.phase === 'suite');
  assert.ok(suite.every((r) => r.flags.x === 'on' && r.flag === undefined));
  const sets = [...new Set(suite.map((r) => r.set))];
  assert.deepStrictEqual(sets, ['peragus', 'ebon-hawk', 'conversation', 'combat', 'telos']);
  for (const set of sets) {
    const cps = manifest[set].checkpoints.map((c) => c.name);
    assert.deepStrictEqual([...new Set(suite.filter((r) => r.set === set).map((r) => r.checkpoint))], cps);
    const want = ['rest', ...manifest[set].windows.filter((w) => w !== 'rest')];
    for (const cp of cps) assert.deepStrictEqual(suite.filter((r) => r.checkpoint === cp).map((r) => r.window), want);
  }
  // Pending checkpoints stay marked so the save check can skip them.
  assert.ok(suite.find((r) => r.checkpoint === 'perf-telos-a').pending);
  // The worst set's ladder checkpoint is pending here, and so are its A/B/A rows.
  assert.ok(wavePlan(manifest, ['x'], 'telos').filter((r) => r.phase !== 'suite').every((r) => r.pending));
});

test('wavePlan suite: a talk-only set gets rest + talk, a walk set keeps walk, a rest-only set only rest', () => {
  const m = {
    c: { checkpoints: ['a', 'b'], ladderCheckpoint: 'a', rungs: [3, 5], windows: ['talk'] },
    w: { checkpoints: ['a'], ladderCheckpoint: 'a', rungs: [3, 5], windows: ['rest', 'walk'] },
    r: { checkpoints: ['a'], ladderCheckpoint: 'a', rungs: [5], windows: ['rest'] },
  };
  const suite = wavePlan(m, ['x'], 'w').filter((r) => r.phase === 'suite');
  const windowsOf = (set, cp) => suite.filter((r) => r.set === set && r.checkpoint === cp).map((r) => r.window);
  assert.deepStrictEqual(windowsOf('c', 'a'), ['rest', 'talk']);
  assert.deepStrictEqual(windowsOf('c', 'b'), ['rest', 'talk']);
  assert.deepStrictEqual(windowsOf('w', 'a'), ['rest', 'walk']);
  assert.deepStrictEqual(windowsOf('r', 'a'), ['rest']);
  // The real manifest's conversation set is talk-only.
  const real = wavePlan(manifest, ['x'], 'peragus').filter((r) => r.phase === 'suite' && r.set === 'conversation');
  assert.ok(real.some((r) => r.window === 'talk'));
  assert.ok(real.some((r) => r.window === 'rest'));
});

test('a conversation talk window from a bisect baseline matches the wave suite talk window', () => {
  const now = [{ ...rec('suite', { p90: 12, set: 'conversation', checkpoint: 'kreia-awakened', window: 'talk' }), phase: 'suite' }];
  const baseline = [bisectRec('conversation', 'kreia-awakened', 5, 'talk', 11)];
  const result = confirmFlag([...aba(), ...now], 'x', 4, baseline);
  assert.strictEqual(result.regressionChecked, true);
  assert.strictEqual(result.regressionMatched, 1);
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

test('parsePredicted: one number applies to every flag, a list gives one per flag, junk is refused', () => {
  assert.deepStrictEqual(parsePredicted('4', ['x', 'perf.y']), { x: 4, y: 4 });
  assert.deepStrictEqual(parsePredicted('4, 2.5', 'x,y'), { x: 4, y: 2.5 });
  assert.throws(() => parsePredicted('4,3,2', ['x', 'y']), /3 values for 2 flags/);
  for (const bad of ['0', '-1', 'abc', '', '4,', 'NaN']) assert.throws(() => parsePredicted(bad, ['x']), /--predicted must be a number > 0/, bad);
});

test('confirmWave and formatConfirm print the verdict, gain, drift and notes for each flag', () => {
  const records = [...aba(), ...aba().map((r) => ({ ...r, flag: 'y' }))];
  const results = confirmWave(records, ['x', 'y'], { x: 4, y: 4 });
  assert.deepStrictEqual(results.map((r) => r.flag), ['x', 'y']);
  assert.strictEqual(results[0].verdict, 'confirmed');
  const text = formatConfirm(results);
  assert.match(text, /^x: CONFIRMED {2}gain 4\.00 ms \(predicted 4 ms\) {2}drift 0\.00 m/m);
  assert.match(text, /^y: CONFIRMED/m);
  assert.match(text, /note: no baseline suite records given: regression check skipped/);
});

test('formatConfirm shows an inconclusive flag with its reason and a regression with its numbers', () => {
  const records = [
    ...aba(),
    { ...rec('suite', { p90: 20, set: 'peragus', checkpoint: 'medbay-swept', window: 'rest' }), phase: 'suite' },
  ];
  const baseline = [bisectRec('peragus', 'medbay-swept', 5, 'rest', 12)];
  const text = formatConfirm(confirmWave(records, ['x'], { x: 4 }, baseline));
  assert.match(text, /x: INCONCLUSIVE/);
  assert.match(text, /regression: peragus\/medbay-swept rest 12\.00 -> 20\.00 ms p90/);
  const drifted = formatConfirm(confirmWave(aba({ posB: { x: 3, y: 0, z: 0 } }), ['x'], { x: 4 }));
  assert.match(drifted, /x: INCONCLUSIVE.*drift 3\.00 m/);
  assert.match(drifted, /reason: position drift 3\.00 m > 0\.5 m/);
});

test('windowPrompt: WALK, TALK before those windows, STAND for A/B/A, nothing for a suite rest', () => {
  assert.match(windowPrompt('walk'), /^WALK now/);
  assert.strictEqual(windowPrompt('talk'), 'TALK now: start the conversation in front of you');
  assert.strictEqual(windowPrompt('talk', 'suite'), 'TALK now: start the conversation in front of you');
  assert.match(windowPrompt('rest', 'B'), /^STAND still/);
  assert.strictEqual(windowPrompt('rest', 'suite'), null);
  assert.strictEqual(windowPrompt('rest'), null);
});
