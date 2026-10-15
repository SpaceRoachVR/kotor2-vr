/**
 * Pure helpers for `perf-round.js wave`: the Phase 2 wave headset round. No CDP,
 * no fs: the CLI feeds these the manifest, the flag list and the records.
 *
 * A wave round has two parts (spec, "Wave headset round"):
 *   1. suite: every set's checkpoints at the full game (perflayer l5) with every
 *      new flag on; a `rest` window, plus the set's own other windows (`walk`,
 *      `talk`), so a conversation set is measured while talking.
 *   2. A/B/A: on the worst set's ladderCheckpoint, per flag, three standing
 *      (`rest`) windows: A1 all flags on, B `perf.<flag>=off`, A2 all on again.
 *      Each window is its own boot, because flags are read at boot
 *      (readPerfFlag in src/utility/RendererOptions.ts).
 *
 * Records written by the wave carry `flags: {id: 'on'|'off'}`, `phase:
 * 'suite'|'A1'|'B'|'A2'`, and on the A/B/A windows `flag` (the flag under test).
 * `confirmFlag` reads them back and classifies a flag against its prediction.
 */
const { WINDOW_SECONDS, STOP_OVERHEAD_SECONDS, FULL_RUNG, recordRefreshHz } = require('./perf-bisect');

const nameOf = (c) => (typeof c === 'string' ? c : c.name);
const isPending = (c) => typeof c === 'object' && c !== null && c.pending === true;
const FLAG_ID = /^[a-z0-9][a-z0-9_-]*$/i;

// The wave's tolerances (spec: "within ±30% of the prediction and nothing
// regresses"; positions must match for A/B/A to compare like with like).
const PREDICTION_TOLERANCE = 0.3;
const REGRESSION_MS = 1;
const MAX_DRIFT_M = 0.5;

/**
 * `perf.x,perf.y` or `['x', 'perf.y']` -> `['x', 'y']`, lowercased, deduped, in
 * order. Lowercase because readLaunchOption looks keys up case-sensitively and
 * flags are lowercase by convention: `perf.Batching=off` would silently miss.
 */
function normalizeFlags(flags) {
  const list = (Array.isArray(flags) ? flags : String(flags || '').split(','))
    .map((f) => String(f).trim().toLowerCase())
    .filter(Boolean)
    .map((f) => (f.startsWith('perf.') ? f.slice(5) : f));
  if (!list.length) throw new Error('wave needs at least one flag, e.g. `wave perf.batching,perf.static-matrices`');
  for (const f of list) {
    if (!FLAG_ID.test(f)) throw new Error(`"${f}" is not a flag id (letters, digits, - and _; the URL param is perf.<id>=on|off)`);
  }
  return [...new Set(list)];
}

const flagState = (ids, off) => Object.fromEntries(ids.map((id) => [id, id === off ? 'off' : 'on']));

function setNamesOf(benchmarks) {
  return Object.keys(benchmarks).filter((k) => !k.startsWith('_'));
}

function setDef(benchmarks, set) {
  const def = benchmarks[set];
  if (!def || typeof def !== 'object' || String(set).startsWith('_')) throw new Error(`Unknown benchmark set: ${set}`);
  return def;
}

/**
 * The wave's windows, in run order: the whole suite with every flag on, then an
 * A/B/A per flag on `worstSet`'s ladderCheckpoint. Rows are
 * `{phase, set, checkpoint, window, flags[, flag][, pending]}`.
 */
function wavePlan(benchmarks, flags, worstSet) {
  const ids = normalizeFlags(flags);
  const worst = setDef(benchmarks, worstSet);
  const allOn = flagState(ids, null);
  const plan = [];
  for (const set of setNamesOf(benchmarks)) {
    const def = setDef(benchmarks, set);
    // The set's own windows: a stationary `rest` first, then whatever else the
    // manifest lists (walk, talk), so a talk-only set gets rest + talk.
    const windows = ['rest', ...def.windows.filter((w) => w !== 'rest')];
    for (const cp of def.checkpoints) {
      for (const window of windows) {
        const row = { phase: 'suite', set, checkpoint: nameOf(cp), window, flags: { ...allOn } };
        if (isPending(cp)) row.pending = true;
        plan.push(row);
      }
    }
  }
  const ladder = worst.ladderCheckpoint !== undefined ? worst.ladderCheckpoint : nameOf(worst.checkpoints[0]);
  const ladderCp = worst.checkpoints.find((c) => nameOf(c) === ladder);
  if (!ladderCp) throw new Error(`Benchmark set ${worstSet}: ladderCheckpoint "${ladder}" is not one of its checkpoints`);
  for (const flag of ids) {
    for (const phase of ['A1', 'B', 'A2']) {
      const row = { phase, set: worstSet, checkpoint: ladder, window: 'rest', flag, flags: flagState(ids, phase === 'B' ? flag : null) };
      if (isPending(ladderCp)) row.pending = true;
      plan.push(row);
    }
  }
  return plan;
}

/**
 * One boot per stop. Suite rows of one checkpoint share a boot (same flags);
 * every A/B/A window is its own boot, since the flag state changes or, for A2,
 * the point is a fresh repeat of A1.
 */
function waveStops(plan) {
  const stops = [];
  for (const row of plan) {
    const last = stops[stops.length - 1];
    if (row.phase === 'suite' && last && last.phase === 'suite' && last.set === row.set && last.checkpoint === row.checkpoint) {
      last.windows.push(row.window);
    } else {
      const stop = { phase: row.phase, set: row.set, checkpoint: row.checkpoint, windows: [row.window], flags: row.flags, pending: !!row.pending };
      if (row.flag !== undefined) stop.flag = row.flag;
      stops.push(stop);
    }
  }
  return stops;
}

/** The `reload`-style URL options for a stop: the full game plus every flag. */
function stopOptions(stop) {
  return [`perflayer=l${FULL_RUNG}`, ...Object.entries(stop.flags).map(([id, state]) => `perf.${id}=${state}`)];
}

function estimateWave(plan, overheadSeconds = STOP_OVERHEAD_SECONDS) {
  const stops = waveStops(plan).length;
  const windowSeconds = plan.reduce((sum, r) => sum + WINDOW_SECONDS[r.window], 0);
  const totalSeconds = windowSeconds + stops * overheadSeconds;
  return { stops, windows: plan.length, windowSeconds, overheadSeconds: stops * overheadSeconds, totalSeconds, totalMinutes: +(totalSeconds / 60).toFixed(1) };
}

/** The `wave --dry` text: one line per stop with its URL options, then the estimate. */
function formatWavePlan(plan) {
  const lines = waveStops(plan).map((s) => {
    const what = s.phase === 'suite' ? 'suite' : `${s.phase} (${s.flag} ${s.flags[s.flag]})`;
    return `${s.set}/${s.checkpoint} ${what}: ${s.windows.join(', ')}  [${stopOptions(s).join(' ')}]${s.pending ? '  (pending: runs only if the save exists)' : ''}`;
  });
  const all = estimateWave(plan);
  const now = estimateWave(plan.filter((r) => !r.pending));
  lines.push('', `${all.stops} stops, ${all.windows} windows: about ${all.totalMinutes} min with every pending save present`);
  lines.push(`${now.stops} stops, ${now.windows} windows: about ${now.totalMinutes} min without the pending ones`);
  lines.push(`(windows plus ~${STOP_OVERHEAD_SECONDS} s overhead per stop)`);
  return lines.join('\n');
}

const p90Of = (r) => {
  const v = r && r.report && r.report.frametimeMs && r.report.frametimeMs.p90;
  return Number.isFinite(v) ? v : null;
};
// Same convention as attributeRungs: only an explicit `trustworthy: false` excludes.
const trusted = (r) => {
  const cad = r && r.report && r.report.xrCadence;
  return !(cad && cad.integrity && cad.integrity.trustworthy === false);
};
const mean = (a, b) => (a + b) / 2;

// KotOR world space is Z-up: x/y is the floor plane, z is height. Both the
// before and after position of every window count, so a wearer who walked off
// during a window (and came back for the next) shows up as drift too.
function horizontalDrift(records) {
  const pos = records.flatMap((r) => [r && r.before && r.before.player, r && r.after && r.after.player]);
  if (pos.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  let max = 0;
  for (let i = 0; i < pos.length; i++) {
    for (let j = i + 1; j < pos.length; j++) max = Math.max(max, Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y));
  }
  return max;
}

/**
 * The latest A1, B and A2 windows of `flag` and the gain they show.
 * `deltaMs = B.p90 - mean(A1.p90, A2.p90)`: B has the flag off, so a positive
 * delta is time the flag saves. `problems` lists missing or untrustworthy
 * windows, and a refreshHz that differs between them (frame budgets differ, so
 * the p90s are not comparable). A window with no known refreshHz (older
 * evidence: no `refreshHz`, no runtime rate in `before`) makes the check
 * partial or skipped; `notes` says so.
 */
function abaDelta(records, flag) {
  const [id] = normalizeFlags([flag]);
  const pick = (phase) => {
    const hits = records.filter((r) => r && r.phase === phase && r.flag === id);
    return hits.length ? hits[hits.length - 1] : null;
  };
  const win = { A1: pick('A1'), B: pick('B'), A2: pick('A2') };
  const problems = [];
  for (const [phase, r] of Object.entries(win)) {
    if (!r || p90Of(r) === null) problems.push(`${phase} window missing`);
    else if (!trusted(r)) problems.push(`${phase} window untrustworthy (xrCadence integrity)`);
  }
  const present = Object.values(win).filter(Boolean);
  const notes = [];
  const known = present.filter((r) => recordRefreshHz(r) !== null);
  const rates = [...new Set(known.map(recordRefreshHz))];
  if (rates.length > 1) problems.push(`refreshHz differs across A1/B/A2 (${known.map((r) => `${r.phase} ${recordRefreshHz(r)}`).join(', ')})`);
  else if (known.length < present.length) {
    const unknown = present.filter((r) => recordRefreshHz(r) === null).map((r) => r.phase);
    notes.push(`refreshHz unknown on ${unknown.join('/')}: A/B/A refresh-rate check ${known.length === 0 ? 'skipped' : 'partial'}`);
  }
  const positionDriftM = present.length === 3 ? horizontalDrift(present) : null;
  const ok = problems.length === 0;
  return {
    flag: id,
    a1: p90Of(win.A1), b: p90Of(win.B), a2: p90Of(win.A2),
    deltaMs: ok ? p90Of(win.B) - mean(p90Of(win.A1), p90Of(win.A2)) : null,
    positionDriftM,
    problems,
    notes,
    set: win.A1 ? win.A1.set : null,
    checkpoint: win.A1 ? win.A1.checkpoint : null,
  };
}

// Suite windows of this wave against the same (set, checkpoint, window) in the
// baseline. Every suite window counts, including the worst set's: all flags are
// on in the suite, so a regression there cannot be pinned on one flag, but it
// still blocks confirmation (spec: "nothing regresses").
//
// A baseline row is a previous wave's suite window, or a Phase 0 bisect window
// at the full game (`rung === 5`, no `phase`); stripped rungs never compare.
// `matched` counts the keys found on both sides: zero means nothing was
// actually checked, which the caller must not report as "no regressions".
// A pair measured at different refresh rates is not compared (frame budgets
// differ): `refreshMismatched` counts those, `refreshUnknown` the compared pairs
// where either side has no known rate (older evidence).
const isFullGameBisect = (r) => r && r.phase === undefined && r.rung === 5;
function suiteRegressions(records, baseline) {
  const key = (r) => `${r.set}\u0000${r.checkpoint}\u0000${r.window}`;
  const latest = (rows, accept) => {
    const m = new Map();
    for (const r of rows) if (r && accept(r) && trusted(r) && p90Of(r) !== null) m.set(key(r), r);
    return m;
  };
  const now = latest(records, (r) => r.phase === 'suite');
  const before = latest(baseline, (r) => r.phase === 'suite' || isFullGameBisect(r));
  const regressions = [];
  let matched = 0;
  let refreshMismatched = 0;
  let refreshUnknown = 0;
  for (const [k, r] of now) {
    const base = before.get(k);
    if (!base) continue;
    const hzNow = recordRefreshHz(r);
    const hzBase = recordRefreshHz(base);
    if (hzNow !== null && hzBase !== null && hzNow !== hzBase) { refreshMismatched++; continue; }
    if (hzNow === null || hzBase === null) refreshUnknown++;
    matched++;
    const deltaMs = p90Of(r) - p90Of(base);
    if (deltaMs > REGRESSION_MS) regressions.push({ set: r.set, checkpoint: r.checkpoint, window: r.window, baselineP90: p90Of(base), p90: p90Of(r), deltaMs });
  }
  return { regressions, matched, refreshMismatched, refreshUnknown };
}

/**
 * Classifies one flag from a wave's records.
 *
 * - inconclusive: an A1/B/A2 window is missing or untrustworthy, the player
 *   moved more than 0.5 m (horizontal) between them, or (with a baseline) a
 *   suite window regressed by more than 1 ms p90.
 * - rejected: `deltaMs <= 0.3 × predictedMs`, i.e. no meaningful gain.
 * - confirmed: `|deltaMs − predictedMs| <= 0.3 × predictedMs`.
 *
 * Ambiguous case (Ruling for Task 9): a real gain (> 0.3×) that is more than
 * 30% off the prediction, either way. It is `confirmed` when
 * `deltaMs >= 0.7 × predictedMs` (it delivers at least the low end of the
 * prediction, including a larger-than-predicted gain), otherwise `rejected`.
 * Taken together: confirmed iff deltaMs >= 0.7 × predictedMs. `withinPrediction`
 * says whether it landed inside the ±30% band, so the ledger can note a miss.
 *
 * `baseline` (optional) is the previous round's records: a wave's suite
 * windows or Phase 0 bisect windows at rung 5. Without it, or when it matches
 * none of this wave's suite windows, the regression check is skipped
 * (`regressionChecked: false`) and `note` says so; `regressionMatched` counts
 * the windows compared.
 */
function confirmFlag(records, flag, predictedMs, baseline) {
  if (!Number.isFinite(predictedMs) || predictedMs <= 0) throw new Error(`predictedMs must be a number > 0, got ${predictedMs}`);
  const d = abaDelta(records, flag);
  const check = Array.isArray(baseline) ? suiteRegressions(records, baseline) : { regressions: [], matched: 0, refreshMismatched: 0, refreshUnknown: 0 };
  const regressionChecked = check.matched > 0;
  const result = {
    flag: d.flag,
    verdict: 'inconclusive',
    deltaMs: d.deltaMs,
    predictedMs,
    positionDriftM: d.positionDriftM,
    a1: d.a1, b: d.b, a2: d.a2,
    withinPrediction: d.deltaMs === null ? null : Math.abs(d.deltaMs - predictedMs) <= PREDICTION_TOLERANCE * predictedMs,
    regressionChecked,
    regressionMatched: check.matched,
    regressions: check.regressions,
    reason: '',
  };
  const notes = [...d.notes];
  if (!Array.isArray(baseline)) notes.push('no baseline suite records given: regression check skipped');
  else {
    if (check.refreshMismatched > 0) notes.push(`${check.refreshMismatched} baseline window(s) were measured at a different refreshHz than this wave: not compared`);
    if (check.refreshUnknown > 0) notes.push(`${check.refreshUnknown} compared window(s) have no known refreshHz on one side (older evidence)`);
    if (!regressionChecked) {
      notes.push(check.refreshMismatched > 0
        ? 'every matching baseline window differs in refreshHz: regression check skipped'
        : 'baseline matched no suite window of this wave (want suite or bisect rung-5 windows of the same set/checkpoint/window): regression check skipped');
    }
  }
  if (notes.length) result.note = notes.join('; ');

  if (d.problems.length) {
    result.reason = d.problems.join('; ');
    return result;
  }
  if (d.positionDriftM === null) {
    result.reason = 'player position missing from an A/B/A window: drift cannot be checked';
    return result;
  }
  if (d.positionDriftM > MAX_DRIFT_M) {
    result.reason = `position drift ${d.positionDriftM.toFixed(2)} m > ${MAX_DRIFT_M} m between A1/B/A2`;
    return result;
  }
  if (d.deltaMs <= PREDICTION_TOLERANCE * predictedMs) {
    result.verdict = 'rejected';
    result.reason = `gain ${d.deltaMs.toFixed(2)} ms <= ${PREDICTION_TOLERANCE * 100}% of the predicted ${predictedMs} ms: no meaningful gain`;
    return result;
  }
  if (d.deltaMs < (1 - PREDICTION_TOLERANCE) * predictedMs) {
    result.verdict = 'rejected';
    result.reason = `gain ${d.deltaMs.toFixed(2)} ms is real but under 70% of the predicted ${predictedMs} ms`;
    return result;
  }
  if (result.regressions.length) {
    result.reason = `gain holds, but ${result.regressions.length} suite window(s) regressed > ${REGRESSION_MS} ms p90 (all flags on, so not attributable to one flag)`;
    return result;
  }
  result.verdict = 'confirmed';
  result.reason = result.withinPrediction
    ? `gain ${d.deltaMs.toFixed(2)} ms within ±30% of the predicted ${predictedMs} ms`
    : `gain ${d.deltaMs.toFixed(2)} ms is outside ±30% of the predicted ${predictedMs} ms but >= 70% of it`;
  return result;
}

/** One line per flag after a wave run: A1/B/A2 p90, the gain and the drift. */
function formatAba(records, flags) {
  return normalizeFlags(flags).map((f) => {
    const d = abaDelta(records, f);
    const n = (v) => (v === null ? '-' : v.toFixed(2));
    const tail = d.problems.length ? `  (${d.problems.join('; ')})` : '';
    return `${f}: A1 ${n(d.a1)}  B ${n(d.b)}  A2 ${n(d.a2)} ms p90  gain ${n(d.deltaMs)} ms  drift ${n(d.positionDriftM)} m${tail}`;
  }).join('\n');
}

/**
 * `--predicted` for the flags of a wave. `predictedMs` in the workflow's
 * `wave1[]` is a per-set object; the lead passes the WORST set's value. One
 * number applies to every flag; a comma list gives one per flag, in the order
 * the flags were listed.
 */
function parsePredicted(raw, flags) {
  const ids = normalizeFlags(flags);
  const parts = String(raw).split(',').map((t) => t.trim());
  const values = parts.map(Number);
  if (parts.some((t) => t === '') || values.some((v) => !Number.isFinite(v) || v <= 0)) {
    throw new Error(`--predicted must be a number > 0 in ms (or a comma list, one per flag), got "${raw}"`);
  }
  if (values.length === 1) return Object.fromEntries(ids.map((id) => [id, values[0]]));
  if (values.length !== ids.length) {
    throw new Error(`--predicted gave ${values.length} values for ${ids.length} flags (${ids.join(', ')}): pass one number for all, or one per flag`);
  }
  return Object.fromEntries(ids.map((id, i) => [id, values[i]]));
}

/** confirmFlag for every flag of a wave: `predicted` is {id: ms} from parsePredicted. */
function confirmWave(records, flags, predicted, baseline) {
  return normalizeFlags(flags).map((id) => confirmFlag(records, id, predicted[id], baseline));
}

/** The printed verdict: flag, verdict, gain vs prediction, drift, reason and notes. */
function formatConfirm(results) {
  const n = (v) => (v === null || v === undefined ? '-' : v.toFixed(2));
  return results.map((r) => {
    const lines = [`${r.flag}: ${r.verdict.toUpperCase()}  gain ${n(r.deltaMs)} ms (predicted ${r.predictedMs} ms)  drift ${n(r.positionDriftM)} m  regression check ${r.regressionChecked ? `${r.regressionMatched} window(s), ${r.regressions.length} regressed` : 'skipped'}`];
    if (r.reason) lines.push(`  reason: ${r.reason}`);
    for (const g of r.regressions) lines.push(`  regression: ${g.set}/${g.checkpoint} ${g.window} ${g.baselineP90.toFixed(2)} -> ${g.p90.toFixed(2)} ms p90`);
    if (r.note) lines.push(`  note: ${r.note}`);
    return lines.join('\n');
  }).join('\n');
}

/**
 * What the wearer is told before a window starts, or null when there is nothing
 * to do: nothing scripts movement or conversations, the wearer does them.
 */
function windowPrompt(window, phase) {
  if (window === 'walk') return 'WALK now: nothing scripts movement, the wearer walks for this window';
  if (window === 'talk') return 'TALK now: start the conversation in front of you';
  if (phase !== undefined && phase !== 'suite') return 'STAND still at the load spot, same view: A/B/A compares like with like only from one place';
  return null;
}

module.exports = {
  PREDICTION_TOLERANCE, REGRESSION_MS, MAX_DRIFT_M,
  normalizeFlags, wavePlan, waveStops, stopOptions, estimateWave, formatWavePlan, abaDelta, confirmFlag, formatAba,
  parsePredicted, confirmWave, formatConfirm, windowPrompt,
};
