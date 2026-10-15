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
const TARGET_HZ = 72;
const TARGET_P90_MS = 13.9;
const TARGET_P99_MS = 20;

const WINDOW_SECONDS = { rest: 60, walk: 60, talk: 60 };

// Per the Task 2 review, L1 and L2 (world submission without characters) are
// only valid for a stationary wearer, so below this rung only `rest` runs.
const FIRST_MOVING_RUNG = 3;

const nameOf = (c) => (typeof c === 'string' ? c : c.name);
const isPending = (c) => typeof c === 'object' && c !== null && c.pending === true;

/** Expands benchmark sets to `{set, checkpoint, rung, window[, pending]}` rows. */
function bisectPlan(benchmarks, setNames) {
  const names = setNames.includes('all') ? Object.keys(benchmarks).filter((k) => !k.startsWith('_')) : setNames;
  const plan = [];
  for (const set of names) {
    const def = benchmarks[set];
    if (!def || typeof def !== 'object' || set.startsWith('_')) throw new Error(`Unknown benchmark set: ${set}`);
    for (const cp of def.checkpoints) {
      for (const rung of def.rungs) {
        const windows = rung < FIRST_MOVING_RUNG ? ['rest'] : def.windows;
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

/**
 * Checks every checkpoint in the plan against the page's save names before any
 * window runs. A set with a missing (non-pending) checkpoint is aborted whole,
 * with the checkpoint names that do exist; other sets are unaffected. Pending
 * checkpoints are skipped with a note, not treated as missing.
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
    if (row.pending) {
      if (!pendingSkipped.includes(row.checkpoint)) pendingSkipped.push(row.checkpoint);
      continue;
    }
    if (!have.has(norm(`${prefix} ${row.checkpoint}`))) {
      const list = missingBySet.get(row.set) || [];
      if (!list.includes(row.checkpoint)) list.push(row.checkpoint);
      missingBySet.set(row.set, list);
    }
  }
  const aborted = [...missingBySet].map(([set, missing]) => ({ set, missing, available }));
  const runnable = plan.filter((r) => !r.pending && !missingBySet.has(r.set));
  return { runnable, aborted, pendingSkipped };
}

const num = (v) => (Number.isFinite(v) ? v : 0);

function components(report) {
  const ft = num(report.frametimeMs && report.frametimeMs.p90);
  const sim = num(report.cpuMs && report.cpuMs.simulation && report.cpuMs.simulation.p90);
  const render = num(report.cpuMs && report.cpuMs.render && report.cpuMs.render.p90);
  const hasGpu = !!(report.gpuMs && Number.isFinite(report.gpuMs.p90));
  const gpu = hasGpu ? report.gpuMs.p90 : null;
  const runtime = Math.max(0, ft - Math.max(sim + render, hasGpu ? gpu : 0));
  return { p90: ft, p99: report.frametimeMs && report.frametimeMs.p99, sim, render, gpu, runtime };
}

// Order is the tie-break: the first of equals wins.
function dominantStage(c) {
  const candidates = [['sim', c.sim], ['render', c.render]];
  if (c.gpu !== null) candidates.push(['gpu', c.gpu]);
  candidates.push(['runtime', c.runtime]);
  return candidates.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
}

/**
 * Groups bisect records by set + checkpoint and finds, per group, the lowest
 * rung whose worst frame-time p90 exceeds `budgetMs`, and the stage that
 * dominates at that rung. Records without `set` and `rung` (plain windows,
 * notes) are ignored. A window whose xrCadence integrity is untrustworthy is
 * left out of the numbers and listed under the rung's `excluded`.
 */
function attributeRungs(records, budgetMs) {
  const groups = new Map();
  for (const r of records) {
    if (!r || !r.set || !Number.isFinite(r.rung) || !r.report) continue;
    const key = `${r.set}\u0000${r.checkpoint}`;
    if (!groups.has(key)) groups.set(key, { set: r.set, checkpoint: r.checkpoint, byRung: new Map() });
    const byRung = groups.get(key).byRung;
    if (!byRung.has(r.rung)) byRung.set(r.rung, []);
    byRung.get(r.rung).push(r);
  }

  const table = [];
  for (const g of groups.values()) {
    const rows = [...g.byRung.keys()].sort((a, b) => a - b).map((rung) => {
      const all = g.byRung.get(rung);
      const trusted = all.filter((r) => {
        const cad = r.report.xrCadence;
        return !(cad && cad.integrity && cad.integrity.trustworthy === false);
      });
      const excluded = all.filter((r) => !trusted.includes(r)).map((r) => r.label);
      if (!trusted.length) {
        return { rung, windows: 0, p90: null, p99: null, sim: null, render: null, gpu: null, runtime: null, stage: null, excluded };
      }
      const worst = trusted.map((r) => components(r.report)).reduce((a, b) => (b.p90 > a.p90 ? b : a));
      return { rung, windows: trusted.length, ...worst, stage: dominantStage(worst), excluded };
    });
    const over = rows.find((r) => r.p90 !== null && r.p90 > budgetMs);
    table.push({
      set: g.set,
      checkpoint: g.checkpoint,
      firstOverRung: over ? over.rung : null,
      stage: over ? over.stage : 'none',
      rows,
    });
  }
  return table;
}

const cell = (v) => (v === null || v === undefined ? '-' : (Number.isInteger(v) ? String(v) : (+v).toFixed(2)));

function formatAttribution(table, budgetMs = TARGET_P90_MS) {
  if (!table.length) return 'No bisect records: run `perf-round.js bisect <set|all>` first.';
  const out = [];
  for (const t of table) {
    const verdict = t.firstOverRung === null
      ? `no rung over the ${budgetMs} ms p90 budget`
      : `first over budget at l${t.firstOverRung}, stage: ${t.stage}`;
    out.push(`### ${t.set} / ${t.checkpoint}: ${verdict}`, '');
    out.push('| rung | windows | p90 ms | sim | render | gpu | runtime | stage | excluded |');
    out.push('|---|---|---|---|---|---|---|---|---|');
    for (const r of t.rows) {
      out.push(`| l${r.rung} | ${r.windows} | ${cell(r.p90)} | ${cell(r.sim)} | ${cell(r.render)} | ${cell(r.gpu)} | ${cell(r.runtime)} | ${r.stage || '-'} | ${r.excluded.length ? r.excluded.join(', ') : '-'} |`);
    }
    out.push('');
  }
  return out.join('\n').trimEnd();
}

module.exports = {
  TARGET_HZ, TARGET_P90_MS, TARGET_P99_MS, WINDOW_SECONDS,
  bisectPlan, resolvePlan, attributeRungs, formatAttribution,
};
