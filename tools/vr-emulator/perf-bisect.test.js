const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  bisectPlan, attributeRungs, formatAttribution, resolvePlan, estimatePlan, formatPlan, WINDOW_SECONDS,
  parseRefreshHz, resolveRefreshHz, recordRefreshHz,
} = require('./perf-bisect');

// perf-benchmarks.json: each set is {checkpoints, rungs, windows}. A checkpoint is
// {name} or {name, pending:true} (Task 6 creates the perf-* saves); a plain string
// is accepted too.
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'perf-benchmarks.json'), 'utf8'));

const rec = (set, checkpoint, rung, { ft, sim = 2, render = 3, gpu = null, trustworthy, label } = {}) => ({
  label: label || `${set}-${checkpoint}-l${rung}`,
  set, checkpoint, rung,
  report: {
    frametimeMs: { p50: ft - 1, p90: ft, p99: ft + 2 },
    cpuMs: { simulation: { p90: sim }, render: { p90: render } },
    gpuMs: gpu === null ? null : { p50: gpu - 1, p90: gpu, p99: gpu + 1, samples: 100, disjoint: false },
    xrCadence: trustworthy === undefined ? null : { integrity: { trustworthy } },
  },
});

test('bisectPlan rejects unknown sets', () => {
  assert.throws(() => bisectPlan(manifest, ['nonesuch']), /Unknown benchmark set: nonesuch/);
});

test('manifest names a ladderCheckpoint that is one of each set\'s checkpoints (R12)', () => {
  const expected = { peragus: 'medbay-swept', 'ebon-hawk': 'ebon-main-hold-open', conversation: 'kreia-awakened', combat: 'perf-combat', telos: 'perf-telos-a' };
  for (const [set, ladder] of Object.entries(expected)) {
    assert.strictEqual(manifest[set].ladderCheckpoint, ladder);
    assert.ok(manifest[set].checkpoints.some((c) => c.name === ladder));
  }
});

test('bisectPlan runs the peragus ladder on medbay-swept only; the other checkpoints get rung 5 alone', () => {
  const plan = bisectPlan(manifest, ['peragus']);
  assert.ok(plan.every((r) => r.set === 'peragus'));
  assert.deepStrictEqual([...new Set(plan.map((r) => r.checkpoint))], ['medbay-swept', 't3-hangar', 'droids-cleared']);
  const ladder = plan.filter((r) => r.checkpoint === 'medbay-swept');
  assert.deepStrictEqual([...new Set(ladder.map((r) => r.rung))], [0, 1, 2, 3, 4, 5]);
  for (const cp of ['t3-hangar', 'droids-cleared']) {
    assert.deepStrictEqual(plan.filter((r) => r.checkpoint === cp).map((r) => `${r.rung}:${r.window}`), ['5:rest', '5:walk']);
  }
  assert.strictEqual(plan.length, 11); // 5 rest rungs + (rest, walk) at l5, then 2 x (rest, walk)
  assert.strictEqual(new Set(plan.map((r) => `${r.checkpoint}@${r.rung}`)).size, 8);
});

test('bisectPlan: non-ladder checkpoints get only rung 5, and walk/talk appear only at rung 5, in every set', () => {
  const plan = bisectPlan(manifest, ['all']);
  for (const r of plan) {
    if (r.checkpoint !== manifest[r.set].ladderCheckpoint) assert.strictEqual(r.rung, 5, `${r.set}/${r.checkpoint}`);
    if (r.window !== 'rest') assert.strictEqual(r.rung, 5, `${r.set}/${r.checkpoint} ${r.window}`);
  }
  assert.ok(plan.some((r) => r.window === 'walk'));
  assert.ok(plan.some((r) => r.window === 'talk'));
});

test('bisectPlan emits only rest below rung 5, whatever the set asks for', () => {
  const m = { s: { checkpoints: ['a'], ladderCheckpoint: 'a', rungs: [0, 1, 2, 3, 4, 5], windows: ['walk', 'talk', 'rest'] } };
  const plan = bisectPlan(m, ['s']);
  assert.deepStrictEqual(plan.filter((x) => x.rung < 5).map((x) => x.window), ['rest', 'rest', 'rest', 'rest', 'rest']);
  // at rung 5 the set's own windows are kept, in order
  assert.deepStrictEqual(plan.filter((x) => x.rung === 5).map((x) => x.window), ['walk', 'talk', 'rest']);
  // a set with no 'rest' still gets one below rung 5
  const talkOnly = bisectPlan({ s: { checkpoints: ['a'], ladderCheckpoint: 'a', rungs: [1, 3, 5], windows: ['talk'] } }, ['s']);
  assert.deepStrictEqual(talkOnly.map((x) => `${x.rung}:${x.window}`), ['1:rest', '3:rest', '5:talk']);
});

test('bisectPlan rejects a ladderCheckpoint that is not a checkpoint of the set', () => {
  const m = { s: { checkpoints: ['a'], ladderCheckpoint: 'zzz', rungs: [5], windows: ['rest'] } };
  assert.throws(() => bisectPlan(m, ['s']), /ladderCheckpoint "zzz"/);
});

test('estimatePlan adds ~75 s per stop to the window time; formatPlan prints rows and the estimate', () => {
  const m = { s: { checkpoints: ['a', 'b'], ladderCheckpoint: 'a', rungs: [4, 5], windows: ['rest', 'walk'] } };
  const plan = bisectPlan(m, ['s']); // a l4 rest | a l5 rest, walk | b l5 rest, walk
  const e = estimatePlan(plan);
  assert.strictEqual(e.stops, 3);
  assert.strictEqual(e.windows, 5);
  assert.strictEqual(e.totalSeconds, 5 * 60 + 3 * 75);
  const text = formatPlan(plan);
  assert.match(text, /s\/a l4: rest/);
  assert.match(text, /s\/b l5: rest, walk/);
  assert.match(text, /3 stops, 5 windows: about 8\.8 min/);
});

test('R12 shrinks the round well below the full cross-product', () => {
  const full = { };
  for (const [set, def] of Object.entries(manifest)) {
    if (set.startsWith('_')) continue;
    full[set] = { ...def, ladderCheckpoint: undefined };
  }
  const before = estimatePlan(bisectPlan(full, ['all'])).totalMinutes;
  const after = estimatePlan(bisectPlan(manifest, ['all'])).totalMinutes;
  assert.ok(after < before * 0.6, `${after} vs ${before} min`);
});

test('bisectPlan flags pending checkpoints and accepts "all"', () => {
  const plan = bisectPlan(manifest, ['all']);
  assert.ok(plan.some((r) => r.set === 'telos'));
  assert.ok(plan.filter((r) => r.checkpoint === 'perf-swoop').every((r) => r.pending === true));
  assert.ok(plan.filter((r) => r.checkpoint === 'medbay-swept').every((r) => !r.pending));
});

test('every window kind has a duration', () => {
  for (const k of ['rest', 'walk', 'talk']) assert.strictEqual(WINDOW_SECONDS[k], 60);
});

test('resolvePlan aborts a set with a missing checkpoint, lets other sets run, skips pending', () => {
  const plan = bisectPlan(manifest, ['peragus', 'ebon-hawk', 'conversation']);
  const available = ['VRPT-20260824-E2E medbay-swept', 'VRPT-20260824-E2E t3-hangar', 'vrpt-20260824-e2e DROIDS-CLEARED ',
    'VRPT-20260824-E2E ebon-main-hold-open', 'VRPT-20260824-E2E kreia-awakened'];
  const r = resolvePlan(plan, available, 'VRPT-20260824-E2E');
  assert.deepStrictEqual(r.aborted.map((a) => a.set), ['ebon-hawk']);
  assert.deepStrictEqual(r.aborted[0].missing, ['ebon-engine-room-open']);
  assert.ok(r.aborted[0].available.includes('kreia-awakened'));
  assert.ok(r.runnable.every((x) => x.set !== 'ebon-hawk' && !x.pending));
  assert.ok(r.runnable.some((x) => x.set === 'peragus'));
  assert.ok(r.runnable.some((x) => x.set === 'conversation' && x.checkpoint === 'kreia-awakened'));
  assert.deepStrictEqual(r.pendingSkipped, ['perf-theater']);
});

test('attributeRungs picks first rung whose frametime p90 > budget', () => {
  const t = attributeRungs([rec('peragus', 'a', 0, { ft: 8 }), rec('peragus', 'a', 1, { ft: 12 }), rec('peragus', 'a', 2, { ft: 20 })], 13.9);
  assert.strictEqual(t.length, 1);
  assert.strictEqual(t[0].firstOverRung, 2);
  assert.deepStrictEqual(t[0].rows.map((r) => r.rung), [0, 1, 2]);
});

test('attributeRungs names gpu stage when gpuMs.p90 dominates', () => {
  const t = attributeRungs([rec('s', 'c', 4, { ft: 16, sim: 3, render: 4, gpu: 15 })], 13.9);
  assert.strictEqual(t[0].firstOverRung, 4);
  assert.strictEqual(t[0].stage, 'gpu');
});

test('attributeRungs names sim, render and runtime stages', () => {
  const stage = (o) => attributeRungs([rec('s', 'c', 3, { ft: 20, ...o })], 13.9)[0].stage;
  assert.strictEqual(stage({ sim: 12, render: 2, gpu: 5 }), 'sim');
  assert.strictEqual(stage({ sim: 2, render: 12, gpu: 5 }), 'render');
  // runtime = 20 - max(2+3, 6) = 14 beats sim 2, render 3, gpu 6
  assert.strictEqual(stage({ sim: 2, render: 3, gpu: 6 }), 'runtime');
  // no gpu timer: gpu is ignored, runtime = 20 - 5 = 15
  assert.strictEqual(stage({ sim: 2, render: 3, gpu: null }), 'runtime');
});

test('attributeRungs floors runtime at zero', () => {
  const t = attributeRungs([rec('s', 'c', 3, { ft: 14, sim: 1, render: 1, gpu: 30 })], 13.9);
  assert.strictEqual(t[0].stage, 'gpu');
  assert.strictEqual(t[0].rows[0].runtime, 0);
});

test('attributeRungs skips untrustworthy windows and lists them in excluded', () => {
  const t = attributeRungs([
    rec('s', 'c', 3, { ft: 8, trustworthy: true }),
    rec('s', 'c', 4, { ft: 30, trustworthy: false, label: 'bad-window' }),
    rec('s', 'c', 5, { ft: 9, trustworthy: true }),
  ], 13.9);
  assert.strictEqual(t[0].firstOverRung, null);
  assert.strictEqual(t[0].stage, 'none');
  const row4 = t[0].rows.find((r) => r.rung === 4);
  assert.deepStrictEqual(row4.excluded, ['bad-window']);
  assert.strictEqual(row4.p90, null);
});

test('attributeRungs reports none when all rungs pass', () => {
  const t = attributeRungs([rec('s', 'c', 3, { ft: 9 }), rec('s', 'c', 4, { ft: 11 })], 13.9);
  assert.strictEqual(t[0].firstOverRung, null);
  assert.strictEqual(t[0].stage, 'none');
});

test('attributeRungs uses the worst p90 when a rung has several windows, and groups by set + checkpoint', () => {
  const t = attributeRungs([
    rec('s', 'c', 3, { ft: 10, label: 'rest' }),
    rec('s', 'c', 3, { ft: 18, sim: 11, render: 1, gpu: 2, label: 'walk' }),
    rec('s', 'd', 3, { ft: 9 }),
    { label: 'note', text: 'hello' },
    { label: 'plain-window', report: { frametimeMs: { p90: 50 } } },
  ], 13.9);
  assert.strictEqual(t.length, 2);
  const c = t.find((x) => x.checkpoint === 'c');
  assert.strictEqual(c.rows[0].p90, 18);
  assert.strictEqual(c.rows[0].windows, 2);
  assert.strictEqual(c.stage, 'sim');
  assert.strictEqual(t.find((x) => x.checkpoint === 'd').stage, 'none');
});

test('formatAttribution renders a markdown table and says so when there is nothing', () => {
  const t = attributeRungs([rec('peragus', 'a', 0, { ft: 8 }), rec('peragus', 'a', 2, { ft: 20, sim: 2, render: 14, gpu: 5 })], 13.9);
  const md = formatAttribution(t);
  assert.match(md, /peragus/);
  assert.match(md, /\| rung \|/);
  assert.match(md, /first over at l2/);
  assert.match(md, /render/);
  assert.match(formatAttribution([]), /no bisect records/i);
});

test('resolvePlan (R13): a pending checkpoint runs if its save exists, is skipped only if absent', () => {
  const plan = bisectPlan(manifest, ['conversation']);
  const withSave = resolvePlan(plan, ['VRPT-20260824-E2E kreia-awakened', 'VRPT-20260824-E2E perf-theater'], 'VRPT-20260824-E2E');
  assert.deepStrictEqual(withSave.pendingSkipped, []);
  assert.deepStrictEqual(withSave.aborted, []);
  assert.ok(withSave.runnable.some((x) => x.checkpoint === 'perf-theater' && x.pending === true));
  const without = resolvePlan(plan, ['VRPT-20260824-E2E kreia-awakened'], 'VRPT-20260824-E2E');
  assert.deepStrictEqual(without.pendingSkipped, ['perf-theater']);
  assert.ok(without.runnable.every((x) => x.checkpoint !== 'perf-theater'));
});

const plannedRows = (set, checkpoint, rungs) => rungs.map((rung) => ({ set, checkpoint, rung, window: 'rest' }));

test('attributeRungs: a planned rung with no record is a missing row and makes the crossing uncertain', () => {
  // l2 never ran; l1 passes, l3 is over budget. The crossing is somewhere in l2..l3.
  const t = attributeRungs(
    [rec('p', 'm', 0, { ft: 8 }), rec('p', 'm', 1, { ft: 9 }), rec('p', 'm', 3, { ft: 20 })],
    13.9, plannedRows('p', 'm', [0, 1, 2, 3]),
  )[0];
  assert.strictEqual(t.firstOverRung, 3);
  assert.strictEqual(t.uncertain, true);
  assert.deepStrictEqual(t.boundedBy, [2, 3]);
  assert.deepStrictEqual(t.missingRungs, [2]);
  const row2 = t.rows.find((r) => r.rung === 2);
  assert.strictEqual(row2.missing, true);
  assert.strictEqual(row2.p90, null);
  assert.match(formatAttribution([t]), /first over at l3 \(l2 unmeasured\)/);
});

test('attributeRungs: a rung whose every window is untrustworthy is missing too', () => {
  const t = attributeRungs(
    [rec('p', 'm', 1, { ft: 9, trustworthy: true }), rec('p', 'm', 2, { ft: 11, trustworthy: false, label: 'bad' }), rec('p', 'm', 3, { ft: 20, trustworthy: true })],
    13.9, plannedRows('p', 'm', [1, 2, 3]),
  )[0];
  assert.strictEqual(t.firstOverRung, 3);
  assert.strictEqual(t.uncertain, true);
  assert.deepStrictEqual(t.boundedBy, [2, 3]);
  const row2 = t.rows.find((r) => r.rung === 2);
  assert.strictEqual(row2.missing, true);
  assert.deepStrictEqual(row2.excluded, ['bad']);
  assert.match(formatAttribution([t]), /first over at l3 \(l2 unmeasured\)/);
});

test('attributeRungs: nothing over budget with a rung unmeasured is not a clean pass', () => {
  const t = attributeRungs([rec('p', 'm', 3, { ft: 9 }), rec('p', 'm', 5, { ft: 10 })], 13.9, plannedRows('p', 'm', [3, 4, 5]))[0];
  assert.strictEqual(t.firstOverRung, null);
  assert.strictEqual(t.stage, 'none');
  assert.strictEqual(t.uncertain, true);
  assert.match(formatAttribution([t]), /\(l4 unmeasured\)/);
});

test('attributeRungs: a complete ladder is certain; a missing rung above the crossing does not blur it', () => {
  const full = attributeRungs([rec('p', 'm', 2, { ft: 9 }), rec('p', 'm', 3, { ft: 20 })], 13.9, plannedRows('p', 'm', [2, 3, 4]))[0];
  assert.strictEqual(full.firstOverRung, 3);
  assert.strictEqual(full.uncertain, false);
  assert.strictEqual(full.boundedBy, undefined);
  assert.doesNotMatch(formatAttribution([full]), /unmeasured\)/);
});

test('attributeRungs: without cpuMs the stage is null with a note, never runtime', () => {
  const r = rec('p', 'm', 3, { ft: 20 });
  delete r.report.cpuMs;
  const t = attributeRungs([r], 13.9)[0];
  assert.strictEqual(t.firstOverRung, 3);
  assert.strictEqual(t.stage, null);
  assert.match(t.note, /cpuMs/);
  assert.match(formatAttribution([t]), /stage: unknown/);
  const half = rec('p', 'm', 3, { ft: 20 });
  delete half.report.cpuMs.render;
  assert.strictEqual(attributeRungs([half], 13.9)[0].stage, null);
});

test('resolveRefreshHz: the runtime rate wins, else the declared one', () => {
  assert.deepStrictEqual(resolveRefreshHz({ runtimeReportedHz: 90 }, 72), { refreshHz: 90, refreshHzSource: 'runtime' });
  assert.deepStrictEqual(resolveRefreshHz({ runtimeRates: { runtimeReportedHz: 80 } }, 72), { refreshHz: 80, refreshHzSource: 'runtime' });
  for (const state of [{ runtimeReportedHz: null }, {}, null, { runtimeReportedHz: 0 }, { runtimeReportedHz: NaN }, { runtimeRates: { runtimeReportedHz: null } }]) {
    assert.deepStrictEqual(resolveRefreshHz(state, 72), { refreshHz: 72, refreshHzSource: 'declared' });
  }
  // targetHz is the 50 Hz acceptance floor and must never be read as the rate.
  assert.deepStrictEqual(resolveRefreshHz({ targetHz: 50, runtimeReportedHz: null }, 72), { refreshHz: 72, refreshHzSource: 'declared' });
});

test('parseRefreshHz accepts positive finite numbers and rejects the rest', () => {
  assert.strictEqual(parseRefreshHz('72'), 72);
  assert.strictEqual(parseRefreshHz('90.5'), 90.5);
  for (const bad of ['0', '-72', 'abc', '', 'Infinity', 'NaN', undefined]) assert.throws(() => parseRefreshHz(bad), /--refresh-hz/);
  assert.throws(() => resolveRefreshHz({}, 'x'), /--refresh-hz/);
});

test('recordRefreshHz: own refreshHz, else before.runtimeReportedHz, else null', () => {
  assert.strictEqual(recordRefreshHz({ refreshHz: 72, before: { runtimeReportedHz: 90 } }), 72);
  assert.strictEqual(recordRefreshHz({ before: { runtimeReportedHz: 90 } }), 90);
  assert.strictEqual(recordRefreshHz({ before: { runtimeRates: { runtimeReportedHz: 80 } } }), 80);
  assert.strictEqual(recordRefreshHz({ targetHz: 50, before: {} }), null);
  assert.strictEqual(recordRefreshHz(null), null);
});
