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
    } else if (summaryFile) {
      report.staleSummary = true;
    }
  }

  const previous = readJson(LATEST);
  report.delta = diffSummaries(previous && previous.sweepSummary, report.sweepSummary);

  finish(report, stamp);

  const failed = Object.values(report.stages).some((stage) => stage.exitCode !== 0);
  console.log('\n=== DELTA SINCE LAST NIGHT ===');
  console.log(renderDelta(report.delta));
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

module.exports = { parseArgs, diffSummaries, renderDelta, portInUse };
