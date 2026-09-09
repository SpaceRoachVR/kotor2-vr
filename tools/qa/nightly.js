#!/usr/bin/env node
/**
 * The unattended nightly regression pass.
 *
 *   node tools/qa/nightly.js
 *   node tools/qa/nightly.js --skip-build     # working tree already built
 *   node tools/qa/nightly.js --sweep-limit 5  # short pass, for wiring this up
 *
 * Builds, runs the VR regression gate, sweeps every campaign module, and writes
 * one report that says what changed since the previous run. Exits non-zero if
 * either stage failed, so a scheduler or CI can gate on it.
 *
 * THE PORT GUARD IS NOT OPTIONAL
 *
 * Both stages want asset-service port 8479, and two concurrent runs do not
 * queue — the second dies with EADDRINUSE partway through and its evidence is
 * indistinguishable from a real failure. A scheduled run can easily land while
 * a session is already driving the engine by hand, so this refuses to start
 * rather than corrupt both runs. Same reason it never resumes a checkpoint: a
 * bad unattended run must not be able to poison a save another run will pick up.
 *
 * WHAT A GREEN NIGHT MEANS
 *
 * Load, build and render correctness under the emulated runtime, and nothing
 * more. It is not device evidence: IWER renders through an ordinary page WebGL
 * context, so comfort, compositor cadence and reprojection are all outside what
 * this can see. Those need the headset.
 */
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'tools', 'vr-emulator', 'evidence');
const NIGHTLY_DIR = path.join(EVIDENCE_DIR, 'nightly');
const LATEST = path.join(NIGHTLY_DIR, 'latest.json');
const ASSET_PORT = 8479;

function parseArgs(argv) {
  const args = {
    skipBuild: false, skipCheck: false, skipSweep: false,
    sweepLimit: null, idleMs: 15 * 60_000, help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--skip-build') args.skipBuild = true;
    else if (argv[i] === '--skip-check') args.skipCheck = true;
    else if (argv[i] === '--skip-sweep') args.skipSweep = true;
    else if (argv[i] === '--sweep-limit') args.sweepLimit = Number(argv[++i]);
    else if (argv[i] === '--idle-minutes') args.idleMs = Number(argv[++i]) * 60_000;
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  return args;
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (answer) => { socket.destroy(); resolve(answer); };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1500, () => done(false));
  });
}

/** Kills a process and everything it spawned. `child.kill()` orphans grandchildren. */
function killTree(pid) {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch { /* already gone */ }
}

/**
 * Runs a command, tees its output to a log, resolves with the exit code.
 *
 * `idleMs` was written for a specific hang: `vr:sweep` would finish its work,
 * write every artifact, print its whole report — and then sit for up to 425
 * seconds because `CdpSession.evaluate` never cleared the timeout it raced
 * against, and a pending ref'd timer keeps Node alive. That is fixed (see
 * .claude/skills/kotor2-vr/references/vr-testing.md), so this should no longer
 * fire — but it stays as a safety net, because an unattended job must not stall
 * forever on a stage that genuinely wedges. A stage silent for `idleMs` gets its
 * process tree killed and is marked `idle: true`.
 *
 * A killed stage has no meaningful exit code, so the caller must decide pass or
 * fail from the artifacts the stage wrote — never from an invented code.
 */
function run(command, commandArgs, logPath, idleMs = 15 * 60_000) {
  return new Promise((resolve) => {
    const log = fs.createWriteStream(logPath);
    const started = Date.now();
    const child = spawn(command, commandArgs, {
      cwd: REPO_ROOT,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let tail = '';
    let idleTimer = null;
    let idled = false;
    const settle = (result) => {
      if (idleTimer) clearTimeout(idleTimer);
      log.end();
      resolve(result);
    };
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idled = true;
        killTree(child.pid);
      }, idleMs);
    };

    const capture = (chunk) => {
      log.write(chunk);
      // Keep the last stretch so a failure can be explained without opening the log.
      tail = (tail + chunk.toString()).slice(-4000);
      armIdle();
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    armIdle();

    child.on('exit', (code) => settle({
      code: idled ? null : (code ?? 1),
      idle: idled,
      seconds: Math.round((Date.now() - started) / 1000),
      tail,
    }));
    child.on('error', (error) => settle({
      code: 1, idle: false, seconds: 0, tail: `failed to spawn: ${error.message}`,
    }));
  });
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * The point of the nightly is the delta, not the absolute number — a sweep that
 * has blocked 11 modules for a week is not news, and one that blocked 12 last
 * night and 19 tonight is.
 */
function diffSummaries(previous, current) {
  if (!previous || !current) return null;
  const field = (key) => ({
    was: previous[key], now: current[key], delta: (current[key] ?? 0) - (previous[key] ?? 0),
  });
  return {
    modulesLoaded: field('modulesLoaded'),
    modulesClean: field('modulesClean'),
    modulesBlocked: field('modulesBlocked'),
    findings: field('findings'),
  };
}

function renderDelta(delta) {
  if (!delta) return '  (no previous run to compare against)';
  return Object.entries(delta).map(([key, value]) => {
    const sign = value.delta > 0 ? `+${value.delta}` : `${value.delta}`;
    const arrow = value.delta === 0 ? 'unchanged' : `${value.was} -> ${value.now} (${sign})`;
    return `  ${key.padEnd(16)} ${arrow}`;
  }).join('\n');
}

/**
 * Reads the measured run-to-run noise floor, when one has been taken.
 *
 * Five identical sweeps on an unchanged tree varied by 8 clean modules and 18
 * findings, but almost all of that sat in three codes while fifteen others
 * reproduced exactly. So a single-number delta is not readable and a per-code
 * delta is — provided the two are kept apart, which is what this enables.
 */
function readNoiseFloor(file = path.join(EVIDENCE_DIR, 'noise-floor', 'noise-floor.json')) {
  const data = readJson(file);
  if (!data || !Array.isArray(data.codes)) return null;
  return {
    runs: data.runCount,
    measuredCodes: new Set(data.codes.map((c) => c.code)),
    flakyCodes: new Map(data.codes.filter((c) => !c.stable).map((c) => [c.code, c.spread])),
    modulesCleanSpread: data.modulesClean && data.modulesClean.spread,
    findingsSpread: data.findings && data.findings.spread,
  };
}

/** Module counts per code, keyed by code — the shape a per-code delta needs. */
function codeCounts(ranking) {
  const counts = {};
  for (const entry of ranking || []) counts[entry.code] = entry.moduleCount;
  return counts;
}

/**
 * Splits the per-code movement into what is worth acting on and what is not.
 *
 * A code the noise floor measured as unstable can move several modules between
 * identical runs, so its delta is not evidence of anything. A code it measured
 * as stable reproduced exactly every time, so any movement in it is real. A code
 * the floor never saw is reported as unmeasured rather than quietly assumed
 * stable — most often it is genuinely new, which is itself worth seeing.
 */
function diffCodes(previous, current, noise) {
  const codes = Array.from(new Set([...Object.keys(previous || {}), ...Object.keys(current || {})]));
  const rows = codes.map((code) => {
    const was = (previous && previous[code]) || 0;
    const now = (current && current[code]) || 0;
    return {
      code,
      was,
      now,
      delta: now - was,
      flaky: Boolean(noise && noise.flakyCodes.has(code)),
      spread: noise && noise.flakyCodes.get(code),
      unmeasured: Boolean(noise && !noise.measuredCodes.has(code)),
    };
  }).filter((row) => row.delta !== 0);

  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.code.localeCompare(b.code));
  return { stable: rows.filter((r) => !r.flaky), flaky: rows.filter((r) => r.flaky) };
}

function renderCodeDelta(split, noise) {
  if (!split) return '  (no previous run to compare against)';
  const lines = [];
  const width = Math.max(
    4, ...[...split.stable, ...split.flaky].map((r) => r.code.length), 0);
  const row = (r) => {
    const sign = r.delta > 0 ? `+${r.delta}` : `${r.delta}`;
    const note = r.unmeasured ? '  (unmeasured by the noise floor)'
      : r.spread ? `  (measured spread ${r.spread})` : '';
    return `  ${r.code.padEnd(width)}  ${r.was} -> ${r.now} (${sign})${note}`;
  };

  lines.push('  REAL — codes that reproduced exactly across the noise-floor runs');
  lines.push(split.stable.length ? split.stable.map(row).join('\n') : '    (no movement)');
  lines.push('');
  lines.push('  NOISE — codes measured as varying between identical runs');
  lines.push(split.flaky.length ? split.flaky.map(row).join('\n') : '    (no movement)');

  if (!noise) {
    lines.unshift('  !! no noise floor measured — run tools/qa/noise-floor.js; ' +
      'every code below is being treated as real', '');
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node tools/qa/nightly.js [--skip-build] [--skip-check] [--skip-sweep] ' +
      '[--sweep-limit <n>] [--idle-minutes <n>]');
    return;
  }

  fs.mkdirSync(NIGHTLY_DIR, { recursive: true });

  if (await portInUse(ASSET_PORT)) {
    console.error(
      `ABORTED: something is already listening on ${ASSET_PORT}. An asset service is running, ` +
      `so a session is mid-flight. Two runs cannot share the port and the second one\'s ` +
      `evidence would be garbage. Nothing was started.`
    );
    process.exitCode = 2;
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = { startedAt: new Date().toISOString(), stages: {} };

  if (!args.skipBuild) {
    // webpack:dev, never `dev` — the `serve` path sets publicPath '/launcher/'
    // and the build then 404s anywhere it is loaded from disk.
    console.log('building (webpack:dev)...');
    const build = await run('npm', ['run', 'webpack:dev'], path.join(NIGHTLY_DIR, `${stamp}-build.log`));
    report.stages.build = { exitCode: build.code, seconds: build.seconds };
    console.log(`  build exit ${build.code} in ${build.seconds}s`);
    if (build.code !== 0) {
      report.abortedAfter = 'build';
      report.buildTail = build.tail;
      finish(report, stamp);
      process.exitCode = 1;
      return;
    }
  }

  if (!args.skipCheck) {
  console.log('running vr:check...');
  const check = await run('npm', ['run', 'vr:check'], path.join(NIGHTLY_DIR, `${stamp}-vr-check.log`), args.idleMs);
  // vr:check exits cleanly today; if it ever goes idle that is itself a defect,
  // so it is recorded as a failure rather than rescued from an artifact.
  report.stages.check = { exitCode: check.idle ? 1 : check.code, seconds: check.seconds };
  if (check.idle) report.stages.check.idle = true;
  if (report.stages.check.exitCode !== 0) report.stages.check.tail = check.tail;
  console.log(`  vr:check exit ${report.stages.check.exitCode} in ${check.seconds}s` +
    (check.idle ? ' (killed after going idle)' : ''));
  }

  if (!args.skipSweep) {
    console.log('running vr:sweep...');
    const sweepArgs = ['run', 'vr:sweep'];
    if (args.sweepLimit) sweepArgs.push('--', '--limit', String(args.sweepLimit));
    const summaryPath = path.join(EVIDENCE_DIR, 'module-sweep-summary.json');
    const sweepStartedAt = Date.now();
    const sweep = await run('npm', sweepArgs, path.join(NIGHTLY_DIR, `${stamp}-vr-sweep.log`), args.idleMs);

    const summaryFile = readJson(summaryPath);
    // The sweep's authoritative result is the summary it wrote, not its exit
    // code — it may have been killed for going idle after finishing. Only trust
    // a summary this run actually produced.
    const summaryIsFresh = (() => {
      try { return fs.statSync(summaryPath).mtimeMs >= sweepStartedAt; } catch { return false; }
    })();

    report.stages.sweep = { exitCode: sweep.code, seconds: sweep.seconds };
    if (sweep.idle) {
      report.stages.sweep.idle = true;
      report.stages.sweep.note = summaryIsFresh
        ? 'went idle after writing its report and was killed; verdict taken from the summary file'
        : 'went idle without writing a report — treated as a failure';
      // Known hang, see run(). A fresh summary means the work completed.
      report.stages.sweep.exitCode = summaryIsFresh
        ? (summaryFile && summaryFile.summary && summaryFile.summary.modulesBlocked ? 1 : 0)
        : 1;
    }
    if (report.stages.sweep.exitCode !== 0 || sweep.idle) report.stages.sweep.tail = sweep.tail;
    console.log(`  vr:sweep exit ${report.stages.sweep.exitCode} in ${sweep.seconds}s` +
      (sweep.idle ? ' (killed after going idle; verdict from summary file)' : ''));

    if (summaryFile && summaryIsFresh) {
      report.sweepSummary = summaryFile.summary;
      report.topRootCauses = (summaryFile.ranking || []).slice(0, 5);
      // Stored in full, not just the top five: tomorrow's per-code delta can
      // only see a code that yesterday recorded a count for.
      report.codeCounts = codeCounts(summaryFile.ranking);
    } else if (summaryFile) {
      report.staleSummary = true;
    }
  }

  const previous = readJson(LATEST);
  const noise = readNoiseFloor();
  report.delta = diffSummaries(previous && previous.sweepSummary, report.sweepSummary);
  report.noiseFloor = noise && {
    runs: noise.runs,
    modulesCleanSpread: noise.modulesCleanSpread,
    findingsSpread: noise.findingsSpread,
    flakyCodes: Object.fromEntries(noise.flakyCodes),
  };
  report.codeDelta = previous && previous.codeCounts && report.codeCounts
    ? diffCodes(previous.codeCounts, report.codeCounts, noise)
    : null;

  finish(report, stamp);

  const failed = Object.values(report.stages).some((stage) => stage.exitCode !== 0);
  console.log('\n=== DELTA SINCE LAST NIGHT ===');
  console.log(renderDelta(report.delta));
  if (noise) {
    console.log(`\n  measured noise floor over ${noise.runs} identical runs: ` +
      `${noise.modulesCleanSpread} clean modules, ${noise.findingsSpread} findings — ` +
      `treat the totals above as unchanged unless they exceed that`);
  }
  console.log('\n=== PER-CODE DELTA ===\n');
  console.log(renderCodeDelta(report.codeDelta, noise));
  console.log(`\nreport -> ${path.relative(REPO_ROOT, path.join(NIGHTLY_DIR, `${stamp}.json`))}`);
  console.log('\nEmulated-runtime evidence only — says nothing about comfort or cadence.');
  process.exitCode = failed ? 1 : 0;
}

function finish(report, stamp) {
  report.finishedAt = new Date().toISOString();
  const file = path.join(NIGHTLY_DIR, `${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  fs.writeFileSync(LATEST, JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error('NIGHTLY ERROR:', error && error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs, diffSummaries, renderDelta, portInUse,
  readNoiseFloor, codeCounts, diffCodes, renderCodeDelta,
};
