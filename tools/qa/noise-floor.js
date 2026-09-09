#!/usr/bin/env node
/**
 * Measures how much the module sweep varies between identical runs.
 *
 *   node tools/qa/noise-floor.js --runs 3
 *   node tools/qa/noise-floor.js --runs 2 --limit 10   # quick wiring check
 *   node tools/qa/noise-floor.js --analyze <dir>       # re-read a finished set
 *
 * WHY THIS EXISTS
 *
 * The nightly reports a delta, and a delta is only readable against a known
 * noise floor. Two consecutive full runs on an unchanged tree moved seven
 * modules from finding-bearing to clean — no engine change between them. Until
 * that spread is quantified, a future "+5 blocked" cannot be told apart from
 * weather, which makes the delta worse than useless: it invites a hunt for a
 * regression that was never there, or hides one inside the noise.
 *
 * Runs the sweep N times back to back into separate evidence directories, then
 * reports which modules and which codes are stable and which are not.
 *
 * It never writes to the shared evidence directory, so a measurement run cannot
 * disturb the nightly's own baseline in `evidence/nightly/latest.json`.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { portInUse } = require('./nightly');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SWEEP = path.join(REPO_ROOT, 'tools', 'vr-emulator', 'module-sweep.js');
const DEFAULT_OUT = path.join(REPO_ROOT, 'tools', 'vr-emulator', 'evidence', 'noise-floor');
const ASSET_PORT = 8479;

const USAGE = `
Usage: node tools/qa/noise-floor.js [options]

  --runs <n>      how many identical sweeps to run (default 3)
  --limit <n>     modules per sweep, for a quick wiring check (default: all 82)
  --out <dir>     where run evidence goes (default tools/vr-emulator/evidence/noise-floor)
  --analyze <dir> skip running; re-analyse a directory of finished runs
`.trim();

function parseArgs(argv) {
  const args = { runs: 3, limit: null, out: DEFAULT_OUT, analyze: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--runs') args.runs = Number(argv[++i]);
    else if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (argv[i] === '--out') args.out = path.resolve(argv[++i]);
    else if (argv[i] === '--analyze') args.analyze = path.resolve(argv[++i]);
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  if (!Number.isInteger(args.runs) || args.runs < 2) {
    throw new Error('--runs must be an integer of at least 2; one run measures nothing');
  }
  return args;
}

/** A module's fingerprint for a run: its finding codes, sorted, with counts. */
function fingerprint(report) {
  const counts = new Map();
  for (const finding of report.findings || []) {
    counts.set(finding.code, (counts.get(finding.code) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, n]) => (n > 1 ? `${code}×${n}` : code))
    .join(', ') || '(clean)';
}

/**
 * Compares runs module by module and code by code.
 *
 * Deliberately reports *which* modules and codes are unstable, not just a
 * percentage: a noise floor concentrated in six known-flaky modules is a
 * different fact from the same number spread thinly across all 82, and only the
 * first can be excluded from a delta.
 *
 * @param {object[][]} runs one array of per-module reports per run
 */
function analyzeRuns(runs) {
  if (runs.length < 2) throw new Error('need at least two runs to compare');

  const moduleNames = Array.from(new Set(runs.flat().map((r) => r.module))).sort();

  const modules = moduleNames.map((name) => {
    const prints = runs.map((run) => {
      const report = run.find((r) => r.module === name);
      return report ? fingerprint(report) : '(absent)';
    });
    const distinct = Array.from(new Set(prints));
    return { module: name, prints, stable: distinct.length === 1, variants: distinct };
  });

  const codeNames = Array.from(new Set(
    runs.flat().flatMap((r) => (r.findings || []).map((f) => f.code))
  )).sort();

  const codes = codeNames.map((code) => {
    const perRun = runs.map((run) =>
      run.filter((r) => (r.findings || []).some((f) => f.code === code)).length);
    const min = Math.min(...perRun);
    const max = Math.max(...perRun);
    return { code, perRun, min, max, spread: max - min, stable: max === min };
  }).sort((a, b) => b.spread - a.spread || b.max - a.max || a.code.localeCompare(b.code));

  const cleanPerRun = runs.map((run) => run.filter((r) => (r.findings || []).length === 0).length);
  const findingsPerRun = runs.map((run) =>
    run.reduce((sum, r) => sum + (r.findings || []).length, 0));

  const range = (values) => ({
    perRun: values,
    min: Math.min(...values),
    max: Math.max(...values),
    spread: Math.max(...values) - Math.min(...values),
  });

  return {
    runCount: runs.length,
    moduleCount: moduleNames.length,
    stableModules: modules.filter((m) => m.stable).length,
    flakyModules: modules.filter((m) => !m.stable),
    modulesClean: range(cleanPerRun),
    findings: range(findingsPerRun),
    codes,
    unstableCodes: codes.filter((c) => !c.stable),
  };
}

function renderReport(analysis) {
  const lines = [];
  const { modulesClean, findings } = analysis;

  lines.push('=== NOISE FLOOR ===', '');
  lines.push(`  runs                ${analysis.runCount} identical sweeps, unchanged tree`);
  lines.push(`  modules             ${analysis.moduleCount}`);
  lines.push(`  identical every run ${analysis.stableModules} of ${analysis.moduleCount}`);
  lines.push(`  varied              ${analysis.flakyModules.length}`);
  lines.push('');
  lines.push(`  modulesClean        ${modulesClean.perRun.join(' / ')}  ` +
    `→ spread ${modulesClean.spread}`);
  lines.push(`  findings            ${findings.perRun.join(' / ')}  → spread ${findings.spread}`);
  lines.push('');
  lines.push(`  READ A DELTA AS NOISE UNLESS IT EXCEEDS: ` +
    `${modulesClean.spread} clean modules, ${findings.spread} findings`);

  if (analysis.flakyModules.length) {
    lines.push('', '=== MODULES THAT VARIED ===', '');
    for (const m of analysis.flakyModules) {
      lines.push(`  ${m.module}`);
      for (const variant of m.variants) lines.push(`      ${variant}`);
    }
  }

  if (analysis.unstableCodes.length) {
    lines.push('', '=== CODES THAT VARIED (module count per run) ===', '');
    const width = Math.max(4, ...analysis.unstableCodes.map((c) => c.code.length));
    for (const c of analysis.unstableCodes) {
      lines.push(`  ${c.code.padEnd(width)}  ${c.perRun.join(' / ')}  spread ${c.spread}`);
    }
  } else {
    lines.push('', '  every code held the same module count across all runs');
  }

  return lines.join('\n');
}

function readRun(dir) {
  const file = path.join(dir, 'module-sweep.jsonl');
  return fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

function runSweep(outDir, limit) {
  return new Promise((resolve, reject) => {
    const argv = [SWEEP, '--out', outDir];
    if (limit) argv.push('--limit', String(limit));
    const logPath = path.join(outDir, 'sweep.log');
    fs.mkdirSync(outDir, { recursive: true });
    const log = fs.createWriteStream(logPath);
    const child = spawn(process.execPath, argv, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (c) => log.write(c));
    child.stderr.on('data', (c) => log.write(c));
    child.on('exit', (code) => {
      log.end();
      // A sweep exits non-zero when modules are blocked, which is a legitimate
      // measurement, not a failure of the measurement. Only a missing evidence
      // file means the run is unusable.
      if (fs.existsSync(path.join(outDir, 'module-sweep.jsonl'))) resolve(code);
      else reject(new Error(`run in ${outDir} wrote no evidence (exit ${code}); see ${logPath}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  let runDirs;
  if (args.analyze) {
    runDirs = fs.readdirSync(args.analyze)
      .filter((d) => d.startsWith('run-'))
      .sort()
      .map((d) => path.join(args.analyze, d));
    if (runDirs.length < 2) throw new Error(`need at least two run-* directories in ${args.analyze}`);
  } else {
    if (await portInUse(ASSET_PORT)) {
      console.error(
        `ABORTED: something is already listening on ${ASSET_PORT}. Nothing was started.`);
      process.exitCode = 2;
      return;
    }
    fs.mkdirSync(args.out, { recursive: true });
    runDirs = [];
    for (let i = 1; i <= args.runs; i += 1) {
      const dir = path.join(args.out, `run-${String(i).padStart(2, '0')}`);
      const started = Date.now();
      console.log(`run ${i}/${args.runs} …`);
      const code = await runSweep(dir, args.limit);
      console.log(`  done in ${Math.round((Date.now() - started) / 1000)}s (sweep exit ${code})`);
      runDirs.push(dir);
    }
  }

  const analysis = analyzeRuns(runDirs.map(readRun));
  const report = renderReport(analysis);
  console.log('\n' + report);

  const outDir = args.analyze || args.out;
  fs.writeFileSync(path.join(outDir, 'noise-floor.json'), JSON.stringify(analysis, null, 2));
  fs.writeFileSync(path.join(outDir, 'noise-floor.txt'), report + '\n');
  console.log(`\nreport -> ${path.relative(REPO_ROOT, path.join(outDir, 'noise-floor.json'))}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('\nNOISE FLOOR ERROR:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, fingerprint, analyzeRuns, renderReport };
