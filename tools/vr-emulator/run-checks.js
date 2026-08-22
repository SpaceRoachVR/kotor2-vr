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

(async () => {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

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
