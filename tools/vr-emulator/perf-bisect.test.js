const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  bisectPlan, attributeRungs, formatAttribution, resolvePlan, WINDOW_SECONDS,
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

test('bisectPlan expands peragus to 3 checkpoints x 6 rungs', () => {
  const plan = bisectPlan(manifest, ['peragus']);
  const pairs = new Set(plan.map((r) => `${r.checkpoint}@${r.rung}`));
  assert.strictEqual(pairs.size, 18);
  assert.deepStrictEqual([...new Set(plan.map((r) => r.checkpoint))], ['medbay-swept', 't3-hangar', 'droids-cleared']);
  assert.ok(plan.every((r) => r.set === 'peragus'));
});

test('bisectPlan with one window per rung gives exactly checkpoints x rungs rows', () => {
  const m = { s: { checkpoints: ['a', 'b', 'c'], rungs: [0, 1, 2, 3, 4, 5], windows: ['rest'] } };
  assert.strictEqual(bisectPlan(m, ['s']).length, 18);
});

test('bisectPlan emits only rest below rung 3, whatever the set asks for', () => {
  const m = { s: { checkpoints: ['a'], rungs: [0, 1, 2, 3, 4], windows: ['walk', 'talk', 'rest'] } };
  const plan = bisectPlan(m, ['s']);
  assert.deepStrictEqual(plan.filter((x) => x.rung < 3).map((x) => x.window), ['rest', 'rest', 'rest']);
  // at rung >= 3 the set's own windows are kept, in order
  assert.deepStrictEqual(plan.filter((x) => x.rung === 3).map((x) => x.window), ['walk', 'talk', 'rest']);
  // a set with no 'rest' still gets one below rung 3
  const talkOnly = bisectPlan({ s: { checkpoints: ['a'], rungs: [1, 3], windows: ['talk'] } }, ['s']);
  assert.deepStrictEqual(talkOnly.map((x) => `${x.rung}:${x.window}`), ['1:rest', '3:talk']);
});

test('bisectPlan flags pending checkpoints and accepts "all"', () => {
  const plan = bisectPlan(manifest, ['all']);
  assert.ok(plan.some((r) => r.set === 'telos'));
  assert.ok(plan.filter((r) => r.checkpoint === 'perf-turret').every((r) => r.pending === true));
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
  assert.match(md, /first over budget at l2/);
  assert.match(md, /render/);
  assert.match(formatAttribution([]), /no bisect records/i);
});
