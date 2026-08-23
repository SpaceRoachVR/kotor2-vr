/**
 * VR regression check.
 *
 *   npm run vr:check                       # starts its own asset service
 *   npm run vr:check -- --url "<launch>"   # reuse a running one
 *
 * Boots the browser build against an emulated Quest 3, drives a real save, and
 * asserts the behaviour previous sessions had to verify by hand. Exits non-zero
 * on any failure so it can gate a commit.
 *
 * Read the caveat block in harness.js: this settles logic, not comfort or
 * cadence. A green run is not device evidence.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const { collectVrMetrics } = require('./collect');
const { runChecks } = require('./checks');

const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const ASSET_SERVER = path.join(__dirname, '..', 'asset-http', 'asset-server.js');

function parseArgs(argv) {
  const args = { url: null, port: 9430, keepEvidence: true };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--url') args.url = argv[++i];
    else if (argv[i] === '--port') args.port = Number(argv[++i]);
  }
  return args;
}

function waitForPort(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() > deadline) reject(new Error(`asset service never came up on ${port}`));
          else setTimeout(attempt, 250);
        });
    };
    attempt();
  });
}

/**
 * Starts the asset service and reads the launch URL it prints. The URL carries
 * a per-launch token, so it cannot be constructed — it has to be captured.
 */
function startAssetService() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ASSET_SERVER], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buffered = '';
    const onData = (chunk) => {
      buffered += chunk.toString();
      const match = buffered.match(/Open (http:\/\/\S+)/);
      if (match) {
        child.stdout.off('data', onData);
        resolve({ url: match[1], stop: () => child.kill() });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => { buffered += chunk.toString(); });
    child.on('exit', (code) => {
      if (/EADDRINUSE/.test(buffered)) {
        reject(new Error(
          'An asset service is already running on that port. Either stop it, or pass ' +
          'its launch URL with --url "<url>" (the token cannot be guessed).'
        ));
        return;
      }
      reject(new Error(`asset service exited with code ${code}: ${buffered.slice(-400)}`));
    });
    setTimeout(() => reject(new Error('asset service printed no launch URL')), 20_000);
  });
}

function render(results) {
  const width = Math.max(...results.map((r) => r.id.length));
  console.log('');
  for (const result of results) {
    const mark = result.ok ? 'PASS' : 'FAIL';
    console.log(`  ${mark}  ${result.id.padEnd(width)}  ${result.detail}`);
    if (!result.ok) console.log(`        ${result.describe}`);
  }
  console.log('');
}

/**
 * Warn — loudly — when the bundle predates the sources it was built from.
 *
 * This tool checks `dist/`, and nothing here builds it. On 2026-08-23 a run
 * passed 22/22 against a six-hour-old bundle and read as confirmation of a
 * change that was not in it; the same trap has cost this project hours before.
 * A warning rather than an automatic rebuild keeps the run fast and keeps this
 * tool doing one thing, but makes a stale bundle impossible to miss.
 */
function warnIfBundleIsStale() {
  const repoRoot = path.join(__dirname, '..', '..');
  const bundle = path.join(repoRoot, 'dist', 'KotOR.js');
  const stamp = path.join(repoRoot, 'dist', '.build-stamp');
  const sourceRoot = path.join(repoRoot, 'src');

  let bundleMtime;
  try {
    bundleMtime = fs.statSync(bundle).mtimeMs;
  } catch {
    console.warn('\n  !! dist/KotOR.js is missing — run `npm run webpack:dev` first.\n');
    return;
  }

  // Prefer the stamp: webpack's `compareBeforeEmit` defaults to true, so a
  // rebuild producing byte-identical output leaves the bundle's mtime behind
  // its sources while being entirely current. `tools/build-stamp.js` is written
  // on every completed build, so it dates the BUILD rather than the artefact.
  // Fall back to the bundle when no stamp exists — an older checkout, or a
  // build run through webpack directly rather than the npm script.
  let buildMtime = bundleMtime;
  try {
    buildMtime = Math.max(bundleMtime, fs.statSync(stamp).mtimeMs);
  } catch {
    // No stamp; bundle mtime it is.
  }

  let newest = { mtimeMs: 0, file: null };
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
      let mtimeMs;
      try { mtimeMs = fs.statSync(full).mtimeMs; } catch { continue; }
      if (mtimeMs > newest.mtimeMs) newest = { mtimeMs, file: full };
    }
  };
  walk(sourceRoot);

  // A source file cannot be located means the check cannot speak, and should
  // say so rather than implying the bundle is fresh.
  if (!newest.file) {
    console.warn('\n  !! could not read any source file under src/ — bundle freshness unverified.\n');
    return;
  }

  if (newest.mtimeMs <= buildMtime) return;

  const ageMinutes = Math.round((newest.mtimeMs - buildMtime) / 60_000);
  const relative = path.relative(path.join(__dirname, '..', '..'), newest.file);
  console.warn(
    `\n  ${'!'.repeat(72)}\n` +
    `  !! STALE BUNDLE — dist/KotOR.js is ${ageMinutes} minute(s) older than source.\n` +
    `  !! newest source: ${relative}\n` +
    `  !! These results describe the LAST BUILD, not your working tree.\n` +
    `  !! Run \`npm run webpack:dev\` and check again.\n` +
    `  ${'!'.repeat(72)}\n`
  );
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  warnIfBundleIsStale();

  let service = null;
  let url = args.url;
  if (!url) {
    console.log('starting asset service…');
    service = await startAssetService();
    url = service.url;
    await waitForPort(8479).catch(() => undefined);
  }
  console.log(`running VR checks against ${url.replace(/token=[^&]+/, 'token=…')}`);
  console.log('this drives a real save through a browser; expect a few minutes.\n');

  try {
    const metrics = await collectVrMetrics({
      url,
      port: args.port,
      onProgress: (step) => console.log(`  · ${step}`),
    });
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'vr-check-metrics.json'),
      JSON.stringify(metrics, null, 2)
    );

    const results = runChecks(metrics);
    render(results);
    const failed = results.filter((r) => !r.ok);
    console.log(
      failed.length
        ? `FAILED ${failed.length}/${results.length}: ${failed.map((r) => r.id).join(', ')}`
        : `PASSED ${results.length}/${results.length}`
    );
    console.log('metrics -> tools/vr-emulator/evidence/vr-check-metrics.json');
    console.log('\nNote: this settles logic, not comfort or cadence. Not device evidence.');
    process.exitCode = failed.length ? 1 : 0;
  } catch (error) {
    console.error('\nVR CHECK ERROR:', error.message);
    process.exitCode = 1;
  } finally {
    if (service) service.stop();
  }
})();
