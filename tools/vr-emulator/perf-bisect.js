/**
 * Pure helpers for `perf-round.js bisect` and `attribution`. No CDP, no fs: the
 * CLI feeds these the manifest, the page's save names and the evidence records.
 *
 * The bisect ladder is PerfLayerGate's l0..l5 (see src/vr/PerfLayerGate.ts).
 * Running one saved scene at each rung and reading the frame time off each one
 * says which layer first pushed it over budget; the CPU/GPU split at that rung
 * says which stage of the frame did it.
 */

// R4: the 72 Hz target. summaryLine (perf-round.js) and attribution agree on it.
// This is the rate the p90/p99 targets below are written for; it is the DEFAULT
// for `--refresh-hz` (R20), not something the page reports.
const TARGET_HZ = 72;
const TARGET_P90_MS = 13.9;
const TARGET_P99_MS = 20;

// R20: the headset's refresh rate. `VRSpike.perf.targetHz` is NOT it (that is
// the 50 Hz acceptance floor). The page only knows the real rate through
// `perf.runtimeRates.runtimeReportedHz`, which the IWER emulator fills in but
// Chrome + Virtual Desktop leaves null (as it is before Enter VR). So the rate
// is the runtime's when it reports one, else the one the lead declared with
// `--refresh-hz` after confirming it in Virtual Desktop.
const positiveHz = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** Parses `--refresh-hz`: a finite number > 0, or an Error naming the flag. */
function parseRefreshHz(text) {
  const hz = typeof text === 'number' ? text : Number(String(text).trim());
  if (String(text).trim() === '' || positiveHz(hz) === null) throw new Error(`--refresh-hz must be a number > 0, got "${text}"`);
  return hz;
}

/**
 * `state` is perf-round's STATE echo (`runtimeReportedHz`, or the raw
 * `runtimeRates`). Returns `{refreshHz, refreshHzSource: 'runtime' | 'declared'}`.
 */
function resolveRefreshHz(state, declaredHz) {
  const rates = state && state.runtimeRates;
  const runtime = positiveHz(state && state.runtimeReportedHz) ?? positiveHz(rates && rates.runtimeReportedHz);
  if (runtime !== null) return { refreshHz: runtime, refreshHzSource: 'runtime' };
  return { refreshHz: parseRefreshHz(declaredHz), refreshHzSource: 'declared' };
}

/**
 * The refresh rate an evidence record was measured at, or null when it cannot
 * be told. Records written before R20 have no `refreshHz`; they fall back to
 * the runtime's rate in their `before` state.
 */
function recordRefreshHz(r) {
  if (!r) return null;
  const own = positiveHz(r.refreshHz);
  if (own !== null) return own;
  const before = r.before || {};
  return positiveHz(before.runtimeReportedHz) ?? positiveHz(before.runtimeRates && before.runtimeRates.runtimeReportedHz);
}

const WINDOW_SECONDS = { rest: 60, walk: 60, talk: 60 };

// R12: the whole round has to fit a ~30 min headset budget, so the ladder runs
// on one checkpoint per set (its `ladderCheckpoint`) and every other checkpoint
// runs only at the full game, rung 5. The set's walk/talk windows are likewise
// only taken at rung 5; every other rung is a stationary `rest` window (which
// also keeps L1/L2 valid, per the Task 2 review).
const FULL_RUNG = 5;
// Reload, boot gates, load, Enter VR and the 10 s settle, per stop.
const STOP_OVERHEAD_SECONDS = 75;

const nameOf = (c) => (typeof c === 'string' ? c : c.name);
const isPending = (c) => typeof c === 'object' && c !== null && c.pending === true;

/** Expands benchmark sets to `{set, checkpoint, rung, window[, pending]}` rows. */
function bisectPlan(benchmarks, setNames) {
  const names = setNames.includes('all') ? Object.keys(benchmarks).filter((k) => !k.startsWith('_')) : setNames;
  const plan = [];
  for (const set of names) {
    const def = benchmarks[set];
    if (!def || typeof def !== 'object' || set.startsWith('_')) throw new Error(`Unknown benchmark set: ${set}`);
    const ladder = def.ladderCheckpoint;
    if (ladder !== undefined && !def.checkpoints.some((c) => nameOf(c) === ladder)) {
      throw new Error(`Benchmark set ${set}: ladderCheckpoint "${ladder}" is not one of its checkpoints`);
    }
    for (const cp of def.checkpoints) {
      // Without a ladderCheckpoint every checkpoint runs the whole ladder.
      const rungs = ladder === undefined || nameOf(cp) === ladder ? def.rungs : [FULL_RUNG];
      for (const rung of rungs) {
        const windows = rung === FULL_RUNG ? def.windows : ['rest'];
        for (const window of windows) {
          const row = { set, checkpoint: nameOf(cp), rung, window };
          if (isPending(cp)) row.pending = true;
          plan.push(row);
        }
      }
    }
  }
  return plan;
}

/** Groups plan rows into stops: one load per (set, checkpoint, rung). */
function planStops(plan) {
  const stops = [];
  for (const row of plan) {
    const last = stops[stops.length - 1];
    if (last && last.set === row.set && last.checkpoint === row.checkpoint && last.rung === row.rung) last.windows.push(row.window);
    else stops.push({ set: row.set, checkpoint: row.checkpoint, rung: row.rung, windows: [row.window], pending: !!row.pending });
  }
  return stops;
}

/** Wall-time estimate: every window plus a fixed overhead per stop. */
function estimatePlan(plan, overheadSeconds = STOP_OVERHEAD_SECONDS) {
  const stops = planStops(plan);
  const windows = plan.length;
  const windowSeconds = plan.reduce((sum, r) => sum + WINDOW_SECONDS[r.window], 0);
  const totalSeconds = windowSeconds + stops.length * overheadSeconds;
  return { stops: stops.length, windows, windowSeconds, overheadSeconds: stops.length * overheadSeconds, totalSeconds, totalMinutes: +(totalSeconds / 60).toFixed(1) };
}

/** The `bisect --dry` text: one line per stop, then the estimate. */
function formatPlan(plan) {
  const lines = planStops(plan).map((s) => `${s.set}/${s.checkpoint} l${s.rung}: ${s.windows.join(', ')}${s.pending ? '  (pending: runs only if the save exists)' : ''}`);
  const all = estimatePlan(plan);
  const now = estimatePlan(plan.filter((r) => !r.pending));
  lines.push('', `${all.stops} stops, ${all.windows} windows: about ${all.totalMinutes} min with every pending save present`);
  lines.push(`${now.stops} stops, ${now.windows} windows: about ${now.totalMinutes} min without the pending ones`);
  lines.push(`(windows plus ~${STOP_OVERHEAD_SECONDS} s overhead per stop)`);
  return lines.join('\n');
}

/**
 * Checks every checkpoint in the plan against the page's save names before any
 * window runs. A set with a missing (non-pending) checkpoint is aborted whole,
 * with the checkpoint names that do exist; other sets are unaffected. A
 * pending checkpoint (R13) is skipped only if its save is absent; if the save
 * exists it runs like any other.
 */
function resolvePlan(plan, saveNames, prefix) {
  const norm = (s) => String(s).trim().toLowerCase();
  const head = `${prefix} `;
  const have = new Set(saveNames.map(norm));
  const available = saveNames
    .filter((n) => norm(n).startsWith(norm(head)))
    .map((n) => String(n).trim().slice(head.length));

  const pendingSkipped = [];
  const missingBySet = new Map();
  for (const row of plan) {
    if (have.has(norm(`${prefix} ${row.checkpoint}`))) continue;
    if (row.pending) {
      if (!pendingSkipped.includes(row.checkpoint)) pendingSkipped.push(row.checkpoint);
      continue;
    }
    const list = missingBySet.get(row.set) || [];
    if (!list.includes(row.checkpoint)) list.push(row.checkpoint);
    missingBySet.set(row.set, list);
  }
  const aborted = [...missingBySet].map(([set, missing]) => ({ set, missing, available }));
  const runnable = plan.filter((r) => !missingBySet.has(r.set) && !(r.pending && pendingSkipped.includes(r.checkpoint)));
  return { runnable, aborted, pendingSkipped };
}

const finite = (v) => (Number.isFinite(v) ? v : null);

function components(report) {
  const ft = finite(report.frametimeMs && report.frametimeMs.p90) ?? 0;
  const sim = finite(report.cpuMs && report.cpuMs.simulation && report.cpuMs.simulation.p90);
  const render = finite(report.cpuMs && report.cpuMs.render && report.cpuMs.render.p90);
  const gpu = finite(report.gpuMs && report.gpuMs.p90);
  const runtime = sim === null || render === null ? null : Math.max(0, ft - Math.max(sim + render, gpu ?? 0));
  return { p90: ft, p99: report.frametimeMs && report.frametimeMs.p99, sim, render, gpu, runtime };
}

// Order is the tie-break: the first of equals wins. Without the CPU split there
// is nothing to attribute to, and calling the remainder "runtime" would blame
// the runtime for a gap in the data.
function dominantStage(c) {
  if (c.sim === null || c.render === null) return null;
  const candidates = [['sim', c.sim], ['render', c.render]];
  if (c.gpu !== null) candidates.push(['gpu', c.gpu]);
  candidates.push(['runtime', c.runtime]);
  return candidates.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
}

const NO_CPU_NOTE = 'cpuMs.simulation/render absent from the report: no stage can be named';

/**
 * Groups bisect records by set + checkpoint and finds, per group, the lowest
 * measured rung whose worst frame-time p90 exceeds `budgetMs`, and the stage
 * that dominates at that rung. Records without `set` and `rung` (plain
 * windows, notes) are ignored. A window whose xrCadence integrity is
 * untrustworthy is left out of the numbers and listed under the rung's
 * `excluded`.
 *
 * `plan` (bisectPlan rows) names the rungs that were meant to be measured. A
 * planned rung with no usable window (no record, or every window untrustworthy)
 * becomes a `missing` row. If one sits below the first over-budget rung the
 * answer is uncertain: the true crossing is somewhere in `boundedBy`
 * ([lowest missing rung, firstOverRung]). With nothing over budget, any
 * missing rung also makes `none` uncertain.
 */
function attributeRungs(records, budgetMs, plan = []) {
  const groups = new Map();
  for (const r of records) {
    if (!r || !r.set || !Number.isFinite(r.rung) || !r.report) continue;
    const key = `${r.set}\u0000${r.checkpoint}`;
    if (!groups.has(key)) groups.set(key, { set: r.set, checkpoint: r.checkpoint, byRung: new Map() });
    const byRung = groups.get(key).byRung;
    if (!byRung.has(r.rung)) byRung.set(r.rung, []);
    byRung.get(r.rung).push(r);
  }
  // A group exists only if something was measured for it; the plan then fills in the gaps.
  for (const row of plan) {
    const g = groups.get(`${row.set}\u0000${row.checkpoint}`);
    if (g && !g.byRung.has(row.rung)) g.byRung.set(row.rung, []);
  }

  const table = [];
  for (const g of groups.values()) {
    const wanted = new Set(plan.filter((p) => p.set === g.set && p.checkpoint === g.checkpoint).map((p) => p.rung));
    const rows = [...g.byRung.keys()].sort((a, b) => a - b).map((rung) => {
      const all = g.byRung.get(rung);
      const trusted = all.filter((r) => {
        const cad = r.report.xrCadence;
        return !(cad && cad.integrity && cad.integrity.trustworthy === false);
      });
      const excluded = all.filter((r) => !trusted.includes(r)).map((r) => r.label);
      if (!trusted.length) {
        return { rung, windows: 0, missing: true, p90: null, p99: null, sim: null, render: null, gpu: null, runtime: null, stage: null, excluded };
      }
      const worst = trusted.map((r) => components(r.report)).reduce((a, b) => (b.p90 > a.p90 ? b : a));
      return { rung, windows: trusted.length, missing: false, ...worst, stage: dominantStage(worst), excluded };
    });
    const over = rows.find((r) => !r.missing && r.p90 > budgetMs);
    // Only rungs the plan asked for count as unmeasured; a stray record from an
    // older manifest that was all-untrustworthy is just excluded, not "missing".
    const missingRungs = rows.filter((r) => r.missing && (wanted.size === 0 || wanted.has(r.rung))).map((r) => r.rung);
    const missingBelow = over ? missingRungs.filter((m) => m < over.rung) : missingRungs;
    const entry = {
      set: g.set,
      checkpoint: g.checkpoint,
      firstOverRung: over ? over.rung : null,
      stage: over ? over.stage : 'none',
      rows,
      missingRungs,
      uncertain: missingBelow.length > 0,
    };
    if (over && missingBelow.length) entry.boundedBy = [missingBelow[0], over.rung];
    if (over && over.stage === null) entry.note = NO_CPU_NOTE;
    table.push(entry);
  }
  return table;
}

const cell = (v) => (v === null || v === undefined ? '-' : (Number.isInteger(v) ? String(v) : (+v).toFixed(2)));

function formatAttribution(table, budgetMs = TARGET_P90_MS) {
  if (!table.length) return 'No bisect records: run `perf-round.js bisect <set|all>` first.';
  const out = [];
  for (const t of table) {
    const below = t.firstOverRung === null ? t.missingRungs : t.missingRungs.filter((m) => m < t.firstOverRung);
    const gap = below.length ? ` (${below.map((m) => `l${m}`).join(', ')} unmeasured)` : '';
    const verdict = t.firstOverRung === null
      ? `no measured rung over the ${budgetMs} ms p90 budget${gap}`
      : `first over at l${t.firstOverRung}${gap}, stage: ${t.stage === null ? 'unknown' : t.stage}`;
    out.push(`### ${t.set} / ${t.checkpoint}: ${verdict}`, '');
    if (t.note) out.push(`Note: ${t.note}.`, '');
    out.push('| rung | windows | p90 ms | sim | render | gpu | runtime | stage | excluded |');
    out.push('|---|---|---|---|---|---|---|---|---|');
    for (const r of t.rows) {
      const stage = r.missing ? 'unmeasured' : (r.stage || '-');
      out.push(`| l${r.rung} | ${r.windows} | ${cell(r.p90)} | ${cell(r.sim)} | ${cell(r.render)} | ${cell(r.gpu)} | ${cell(r.runtime)} | ${stage} | ${r.excluded.length ? r.excluded.join(', ') : '-'} |`);
    }
    out.push('');
  }
  return out.join('\n').trimEnd();
}

module.exports = {
  TARGET_HZ, TARGET_P90_MS, TARGET_P99_MS, WINDOW_SECONDS, STOP_OVERHEAD_SECONDS, FULL_RUNG,
  parseRefreshHz, resolveRefreshHz, recordRefreshHz,
  bisectPlan, planStops, estimatePlan, formatPlan, resolvePlan, attributeRungs, formatAttribution,
};
