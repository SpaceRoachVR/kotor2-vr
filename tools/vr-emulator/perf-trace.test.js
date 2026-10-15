const test = require('node:test');
const assert = require('node:assert');
const { analyzeTrace } = require('./perf-trace');

const meta = { ph: 'M', name: 'thread_name', pid: 1, tid: 2, args: { name: 'CrRendererMain' } };
const task = (ms) => ({ ph: 'X', name: 'RunTask', pid: 1, tid: 2, dur: ms * 1000 });
const otherThread = { ph: 'X', name: 'RunTask', pid: 9, tid: 9, dur: 99000 };

test('main-thread tasks are measured against the 72 Hz budget, other threads ignored', () => {
  const a = analyzeTrace([meta, task(5), task(20), task(31), otherThread]);
  assert.strictEqual(a.rendererMainThreadFound, true);
  assert.strictEqual(a.mainThreadTasks.count, 3);
  assert.strictEqual(a.mainThreadTasks.overBudget, 2);
});

test('JS self time is attributed to the sampled function and names its caller', () => {
  const chunk = {
    name: 'ProfileChunk', ph: 'P',
    args: { data: {
      cpuProfile: {
        nodes: [
          { id: 1, callFrame: { functionName: '(root)' } },
          { id: 2, parent: 1, callFrame: { functionName: 'Update', url: 'x/GameState.ts', lineNumber: 9 } },
          { id: 3, parent: 2, callFrame: { functionName: 'hot', url: 'x/A.ts', lineNumber: 0 } },
        ],
        samples: [3, 3, 2],
      },
      timeDeltas: [1000, 1000, 500],
    } },
  };
  const a = analyzeTrace([meta, chunk]);
  assert.strictEqual(a.topJsSelfTime[0].fn, 'hot A.ts:1');
  assert.strictEqual(a.topJsSelfTime[0].ms, 2);
  assert.match(a.topJsSelfTime[0].callers[0].via, /^Update GameState\.ts:10/);
});

test('budgetMs follows the refresh rate: 90 Hz counts 20 and 31 ms tasks over, not 5 ms', () => {
  const a = analyzeTrace([meta, task(5), task(20), task(31)], { budgetMs: 1000 / 90 });
  assert.strictEqual(a.mainThreadTasks.overBudget, 2);
  assert.strictEqual(a.frameBudgetMs, +(1000 / 90).toFixed(2));
  // A tight 90 Hz budget counts a 12 ms task that the default 72 Hz budget does not.
  const tight = analyzeTrace([meta, task(12)], { budgetMs: 1000 / 90 });
  const loose = analyzeTrace([meta, task(12)]);
  assert.strictEqual(tight.mainThreadTasks.overBudget, 1);
  assert.strictEqual(loose.mainThreadTasks.overBudget, 0);
  assert.strictEqual(loose.frameBudgetMs, +(1000 / 72).toFixed(2));
});

const NAME = 'kotor2vr.xrframe';
const asyncPair = (id, startMs, durMs, extra = {}) => [
  { ph: 'b', cat: 'blink.user_timing', name: NAME, pid: 1, tid: 2, id2: { local: id }, ts: startMs * 1000, ...extra },
  { ph: 'e', cat: 'blink.user_timing', name: NAME, pid: 1, tid: 2, id2: { local: id }, ts: (startMs + durMs) * 1000, ...extra },
];

test('kotor2vr.xrframe user-timing measures give the xrFrame stats block', () => {
  const events = [meta, ...asyncPair('0x1', 0, 10), ...asyncPair('0x2', 20, 12), ...asyncPair('0x3', 40, 40)];
  const a = analyzeTrace(events);
  assert.strictEqual(a.xrFrameSource, 'user_timing');
  assert.strictEqual(a.xrFrame.count, 3);
  assert.strictEqual(a.xrFrame.p50, 12);
  assert.strictEqual(a.xrFrame.max, 40);
  assert.strictEqual(a.xrFrame.overBudget, 1);
});

test('xrframe async pairs interleave by id and other names are ignored', () => {
  const [b1, e1] = asyncPair('0xa', 0, 8);
  const [b2, e2] = asyncPair('0xb', 2, 30);
  const other = { ...asyncPair('0xc', 0, 99)[0], name: 'something.else' };
  const otherEnd = { ...asyncPair('0xc', 0, 99)[1], name: 'something.else' };
  const a = analyzeTrace([meta, b1, b2, e1, other, otherEnd, e2]);
  assert.strictEqual(a.xrFrame.count, 2);
  assert.strictEqual(a.xrFrame.max, 30);
  assert.strictEqual(a.xrFrameSource, 'user_timing');
});

test('xrframe pairs also match on id2.global and plain id', () => {
  const g = [
    { ph: 'b', name: NAME, cat: 'blink.user_timing', pid: 1, tid: 2, id2: { global: 'g1' }, ts: 0 },
    { ph: 'e', name: NAME, cat: 'blink.user_timing', pid: 1, tid: 2, id2: { global: 'g1' }, ts: 5000 },
  ];
  const p = [
    { ph: 'b', name: NAME, cat: 'blink.user_timing', pid: 1, tid: 2, id: '7', ts: 10000 },
    { ph: 'e', name: NAME, cat: 'blink.user_timing', pid: 1, tid: 2, id: '7', ts: 17000 },
  ];
  const a = analyzeTrace([meta, ...g, ...p]);
  assert.strictEqual(a.xrFrame.count, 2);
  assert.strictEqual(a.xrFrame.max, 7);
});

test('xrframe complete (X) events are supported and an unmatched begin is dropped', () => {
  const x = { ph: 'X', name: NAME, cat: 'blink.user_timing', pid: 1, tid: 2, ts: 0, dur: 9000 };
  const dangling = { ph: 'b', name: NAME, cat: 'blink.user_timing', pid: 1, tid: 2, id2: { local: 'z' }, ts: 1 };
  const a = analyzeTrace([meta, x, dangling]);
  assert.strictEqual(a.xrFrame.count, 1);
  assert.strictEqual(a.xrFrame.max, 9);
  assert.strictEqual(a.xrFrameSource, 'user_timing');
});

test('without xrframe measures xrFrame is null and the generic selector is the labelled fallback', () => {
  const generic = { ph: 'X', name: 'FireAnimationFrame', pid: 1, tid: 2, dur: 16000 };
  const a = analyzeTrace([meta, task(5), generic]);
  assert.strictEqual(a.xrFrame, null);
  assert.strictEqual(a.xrFrameSource, 'generic');
  assert.strictEqual(a.animationFrameCallbacks.count, 1);
});

test('xrFrame overBudget honours budgetMs', () => {
  const events = [meta, ...asyncPair('0x1', 0, 10), ...asyncPair('0x2', 20, 12)];
  assert.strictEqual(analyzeTrace(events, { budgetMs: 1000 / 90 }).xrFrame.overBudget, 1);
  assert.strictEqual(analyzeTrace(events, { budgetMs: 1000 / 72 }).xrFrame.overBudget, 0);
});

test('Tracing.start categories include blink.user_timing', () => {
  assert.ok(require('./perf-trace').CATEGORIES.includes('blink.user_timing'));
});
