/**
 * A Chrome performance trace of a headset window, and a summary of where the
 * frame time went.
 *
 * Perf round P1 found real play sitting on a ~31 ms plateau: frames land at
 * ~15 ms or ~31 ms, the ones that miss the 13.9 ms (72 Hz) deadline waiting
 * for the next vsync. Resolution scaling changed nothing, so the renderer is
 * not fill-bound. What the frame numbers cannot say is which main-thread work
 * pushes a frame over the deadline. A trace can: it records every task on the
 * renderer main thread, the GPU process's work, garbage collection, and a
 * sampled JavaScript profile.
 *
 * `captureTrace` records over an open page CDP session and returns the raw
 * events (also written to disk, loadable in https://ui.perfetto.dev or the
 * DevTools Performance panel). `analyzeTrace` reduces them to the numbers
 * that decide the next fix: how long main-thread tasks run, how many overrun
 * the frame budget, GC time, GPU time, and the JavaScript functions with the
 * most self time.
 */
const fs = require('fs');

const CATEGORIES = [
  'toplevel',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'v8',
  'v8.execute',
  'disabled-by-default-v8.cpu_profiler',
  'blink',
  'gpu',
  'viz',
  // The kotor2vr.xrframe measure (one per XR frame callback) is a user-timing entry.
  'blink.user_timing',
];

/** 72 Hz, the headset refresh P1 ran at. The default; callers pass `budgetMs` for other refresh rates. */
const FRAME_BUDGET_MS = 1000 / 72;

async function captureTrace(cdp, seconds, outFile) {
  const events = [];
  cdp.on('Tracing.dataCollected', (params) => { for (const e of params.value || []) events.push(e); });
  const complete = new Promise((resolve) => cdp.on('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.start', {
    traceConfig: { includedCategories: CATEGORIES, recordMode: 'recordContinuously' },
    transferMode: 'ReportEvents',
  });
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await cdp.send('Tracing.end');
  await complete;
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ traceEvents: events }));
  return events;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return +sorted[i].toFixed(2);
}

function durationsMs(events) {
  return events.map((e) => e.dur / 1000).sort((a, b) => a - b);
}

function threadIds(events, name) {
  const ids = [];
  for (const e of events) {
    if (e.ph === 'M' && e.name === 'thread_name' && e.args && e.args.name === name) ids.push(`${e.pid}:${e.tid}`);
  }
  return ids;
}

/**
 * Self time per JavaScript function from the sampled CPU profile
 * (`ProfileChunk` events): each sample's time goes to the node it landed in.
 * Each row also names the call chains that led there, since a native
 * function like WebGL `getParameter` says nothing without its caller.
 */
function jsSelfTime(events, callerDepth = 4) {
  const nodes = new Map();
  const self = new Map();
  for (const e of events) {
    if (e.name !== 'ProfileChunk' || !e.args || !e.args.data) continue;
    const profile = e.args.data.cpuProfile || {};
    for (const node of profile.nodes || []) nodes.set(node.id, { frame: node.callFrame || {}, parent: node.parent });
    const samples = profile.samples || [];
    const deltas = e.args.data.timeDeltas || [];
    for (let i = 0; i < samples.length; i++) {
      // A sample's delta is the time since the previous one; attribute it here.
      const ms = (deltas[i] || 0) / 1000;
      self.set(samples[i], (self.get(samples[i]) || 0) + ms);
    }
  }
  const label = (frame) => {
    const name = frame.functionName || '(anonymous)';
    const file = String(frame.url || '').split(/[\/]/).pop();
    return `${name} ${file}:${frame.lineNumber >= 0 ? frame.lineNumber + 1 : '?'}`;
  };
  const byFunction = new Map();
  for (const [id, ms] of self) {
    const node = nodes.get(id);
    const frame = node ? node.frame : {};
    const name = frame.functionName || '(anonymous)';
    if (name === '(idle)' || name === '(program)' || name === '(root)' || name === '(garbage collector)') continue;
    const key = label(frame);
    const chain = [];
    for (let parent = node && node.parent, n = 0; parent !== undefined && n < callerDepth; n++) {
      const up = nodes.get(parent);
      if (!up) break;
      chain.push(label(up.frame));
      parent = up.parent;
    }
    const row = byFunction.get(key) || { ms: 0, callers: new Map() };
    row.ms += ms;
    const via = chain.join(' <- ') || '(top)';
    row.callers.set(via, (row.callers.get(via) || 0) + ms);
    byFunction.set(key, row);
  }
  return [...byFunction.entries()]
    .map(([fn, row]) => [fn, row.ms, [...row.callers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)])
    .sort((a, b) => b[1] - a[1]);
}

const XR_FRAME_MEASURE = 'kotor2vr.xrframe';

/**
 * Durations (ms) of the `kotor2vr.xrframe` user-timing measures. Chrome writes a
 * measure as an async begin/end pair (`b`/`e`, paired by name plus id; the id is
 * `id2.local`, `id2.global` or `id`), and some versions write one complete (`X`)
 * event instead. An unmatched begin or end is dropped.
 */
function xrFrameDurationsMs(events) {
  const durs = [];
  const open = new Map();
  for (const e of events) {
    if (e.name !== XR_FRAME_MEASURE) continue;
    if (e.cat && !/user_timing/.test(e.cat)) continue;
    if (e.ph === 'X' && typeof e.dur === 'number') {
      durs.push(e.dur / 1000);
    } else if (e.ph === 'b' || e.ph === 'e') {
      const id2 = e.id2 || {};
      const key = id2.global !== undefined ? `g:${id2.global}`
        : `${e.pid}:${id2.local !== undefined ? id2.local : e.id}`;
      if (e.ph === 'b') {
        open.set(key, e.ts);
      } else if (open.has(key)) {
        durs.push((e.ts - open.get(key)) / 1000);
        open.delete(key);
      }
    }
  }
  return durs.sort((a, b) => a - b);
}

function analyzeTrace(events, { seconds = null, top = 25, budgetMs = FRAME_BUDGET_MS } = {}) {
  const main = new Set(threadIds(events, 'CrRendererMain'));
  const onMain = (e) => main.has(`${e.pid}:${e.tid}`);
  const complete = events.filter((e) => e.ph === 'X' && typeof e.dur === 'number');

  const tasks = complete.filter((e) => onMain(e) && (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask'));
  const taskMs = durationsMs(tasks);
  const animationFrames = complete.filter((e) => onMain(e) && /FireAnimationFrame|XRFrame|AnimationFrame/i.test(e.name));
  const frameMs = durationsMs(animationFrames);
  const xrMs = xrFrameDurationsMs(events);
  const gc = complete.filter((e) => /GC|Scavenge|MarkCompact/i.test(e.name) && onMain(e));
  const gpu = complete.filter((e) => e.name === 'GPUTask');
  const sum = (list) => +list.reduce((t, e) => t + e.dur / 1000, 0).toFixed(1);
  const functions = jsSelfTime(events);
  const jsTotal = functions.reduce((t, row) => t + row[1], 0);

  return {
    seconds,
    rendererMainThreadFound: main.size > 0,
    frameBudgetMs: +budgetMs.toFixed(2),
    mainThreadTasks: {
      count: taskMs.length,
      p50: percentile(taskMs, 50),
      p90: percentile(taskMs, 90),
      p99: percentile(taskMs, 99),
      overBudget: taskMs.filter((ms) => ms > budgetMs).length,
      totalMs: +taskMs.reduce((t, ms) => t + ms, 0).toFixed(1),
    },
    animationFrameCallbacks: {
      count: frameMs.length,
      p50: percentile(frameMs, 50),
      p90: percentile(frameMs, 90),
      p99: percentile(frameMs, 99),
      overBudget: frameMs.filter((ms) => ms > budgetMs).length,
    },
    // The exact per-XR-frame callback times, when the page emitted
    // `kotor2vr.xrframe` measures; the generic selector above is the fallback.
    xrFrameSource: xrMs.length ? 'user_timing' : 'generic',
    xrFrame: xrMs.length ? {
      count: xrMs.length,
      p50: percentile(xrMs, 50),
      p90: percentile(xrMs, 90),
      p99: percentile(xrMs, 99),
      max: percentile(xrMs, 100),
      overBudget: xrMs.filter((ms) => ms > budgetMs).length,
    } : null,
    gcMs: sum(gc),
    gpuTaskMs: sum(gpu),
    jsSampledMs: +jsTotal.toFixed(1),
    topJsSelfTime: functions.slice(0, top).map(([fn, ms, callers]) => ({
      fn,
      ms: +ms.toFixed(1),
      share: jsTotal > 0 ? +((ms / jsTotal) * 100).toFixed(1) : 0,
      callers: callers.map(([via, callerMs]) => ({ via, ms: +callerMs.toFixed(1) })),
    })),
  };
}

module.exports = { captureTrace, analyzeTrace, FRAME_BUDGET_MS, CATEGORIES };
