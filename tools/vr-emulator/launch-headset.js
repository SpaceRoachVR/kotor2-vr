/**
 * One-command launch for a headset session.
 *
 *   npm run vr:play
 *
 * Starts the asset service, then opens Chrome on the launch URL with a **fresh**
 * user-data-dir. That last part is not a nicety: a Chromium process caches the
 * "no XR device" answer from browser startup, so a window opened in an
 * already-running Chrome reports `immersive-vr: false` no matter what the
 * runtime is doing. That confound produced two wrong readings during Phase 0,
 * and it looks exactly like a broken runtime.
 *
 * Bring the VR runtime up before running this — Virtual Desktop Streamer with
 * VDXR selected. SteamVR does not need to be running.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ASSET_SERVER = path.join(__dirname, '..', 'asset-http', 'asset-server.js');
const CDP_PORT = Number(process.env.KOTOR2VR_CDP_PORT) || 9422;
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
];
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function resolveBrowser(preferEdge) {
  const ordered = preferEdge
    ? [...EDGE_CANDIDATES, ...CHROME_CANDIDATES]
    : [...CHROME_CANDIDATES, ...EDGE_CANDIDATES];
  for (const candidate of ordered) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Could not find Chrome or Edge');
}

function startAssetService() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ASSET_SERVER], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buffered = '';
    const onData = (chunk) => {
      buffered += chunk.toString();
      process.stdout.write(chunk);
      const match = buffered.match(/Open (http:\/\/\S+)/);
      if (match) {
        child.stdout.off('data', onData);
        resolve({ url: match[1], child });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => {
      buffered += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('exit', (code) => {
      if (/EADDRINUSE/.test(buffered)) {
        reject(new Error(
          'An asset service is already running. Stop it first — this needs to print a ' +
          'fresh launch token.'
        ));
        return;
      }
      reject(new Error(`asset service exited with code ${code}`));
    });
    setTimeout(() => reject(new Error('asset service printed no launch URL')), 20_000);
  });
}

(async () => {
  const preferEdge = process.argv.includes('--edge');
  const keepProfile = process.argv.includes('--keep-profile');
  const browser = resolveBrowser(preferEdge);

  const { url, child } = await startAssetService();

  const profileDir = path.join(os.tmpdir(), `kotor2vr-headset-${Date.now()}`);
  if (!keepProfile) fs.mkdirSync(profileDir, { recursive: true });

  const args = [
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Opening DevTools before the session starts means the console is already
    // capturing if something needs reporting; several open roadmap items are
    // waiting on exactly that evidence.
    '--auto-open-devtools-for-tabs',
    // ...and make that evidence collectable rather than only readable. Without
    // a debugging port the only way to get a texture diagnostic or a console
    // warning out of a headset session is for the person wearing the headset
    // to read it aloud -- and DevTools refuses pasted snippets until someone
    // types "allow pasting" by hand, so even running a query is awkward.
    // Same port the emulator harness uses; the two never run together, because
    // they both want the asset service.
    `--remote-debugging-port=${CDP_PORT}`,
    url,
  ];

  console.log(`\nlaunching ${path.basename(browser)} with a fresh profile`);
  console.log(`  profile: ${profileDir}`);
  console.log('\nReminders:');
  console.log('  · VR runtime (VDXR via Virtual Desktop) must already be up.');
  console.log('  · Disable Synchronous Spacewarp and select 72 Hz.');
  console.log('  · Accept the EULA, load your save, then press "Enter VR (spike)".');
  console.log('  · Leave DevTools open — the console is the evidence for several open items.');
  console.log(`  · CDP is on http://127.0.0.1:${CDP_PORT} — diagnostics can be pulled from outside.`);
  console.log('\nCtrl+C here stops the asset service when you are done.\n');

  spawn(browser, args, { detached: true, stdio: 'ignore' }).unref();

  const shutdown = () => {
    child.kill();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})().catch((error) => {
  console.error('\nLAUNCH ERROR:', error.message);
  process.exitCode = 1;
});
