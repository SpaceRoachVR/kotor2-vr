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
