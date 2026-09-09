#!/usr/bin/env node
/**
 * Runs the browser build inside the Quest's own browser, on the headset, with
 * CDP still reachable from this machine.
 *
 *   npm run quest:perf              # start the loop
 *   npm run quest:perf -- --check   # verify the wiring, launch nothing
 *   npm run quest:perf -- --serial <serial>
 *   npm run quest:perf -- --url "<launch url>"   # reuse a running asset service
 *
 * WHY A REVERSE TUNNEL AND NOT THE LAN ADDRESS
 *
 * WebXR is gated on a secure context. `https://` qualifies and so does
 * `http://127.0.0.1` — Chromium treats loopback as potentially trustworthy —
 * but `http://192.168.x.x` does not. Serving the build to the headset over the
 * LAN therefore leaves `navigator.xr` undefined, which presents exactly like a
 * missing XR runtime and would have cost another day of the confound that
 * already cost two wrong readings in Phase 0.
 *
 * `adb reverse tcp:8479 tcp:8479` makes the headset's *own* 127.0.0.1:8479
 * tunnel back to this machine's loopback. So:
 *
 *   - the launch URL the asset service prints works verbatim on the headset,
 *     token and all, with no rewriting;
 *   - the page is a secure context, so WebXR is available;
 *   - the asset service keeps its deliberate `host: '127.0.0.1'` binding — the
 *     retail game data and the per-launch token are never exposed to the LAN.
 *
 * WHAT THIS SETTLES THAT THE EMULATOR CANNOT
 *
 * `tools/vr-emulator/` renders through an ordinary page WebGL context, so its
 * frametimes are not headset frametimes and it can say nothing about comfort,
 * compositor cadence or reprojection. This runs on the actual device against
 * the actual compositor, so `metavr perf capture --mode vr` sees real GPU
 * timings, real XR runtime metrics, and real reprojection.
 *
 * It is a different measurement from the PCVR-over-Virtual-Desktop path, not a
 * replacement for it: this is the Quest browser rendering locally, not VDXR
 * streaming a desktop Chrome session. Numbers from the two are not comparable.
 */
const { execFileSync, spawn } = require('child_process');

const { startAssetService } = require('../vr-emulator/asset-service');
const { resolveAdb, listDevices, selectQuest, describe } = require('./adb');

const ASSET_PORT = 8479;
const CDP_PORT = Number(process.env.KOTOR2VR_QUEST_CDP_PORT) || 9423;
const BROWSER_PACKAGE = 'com.oculus.browser';
const DEVTOOLS_SOCKET = 'localabstract:chrome_devtools_remote';

const USAGE = `
Usage: node tools/quest/quest-perf.js [options]

  --check            verify device, adb and ports, then exit without launching
  --serial <serial>  target a specific device (required if two are attached)
  --url <url>        reuse a running asset service instead of starting one
  --port <n>         asset service port (default ${ASSET_PORT})
  --cdp-port <n>     local port to forward CDP onto (default ${CDP_PORT})
  --package <name>   browser package (default ${BROWSER_PACKAGE})
  --no-launch        wire the tunnels up but do not open the browser
`.trim();

function parseArgs(argv) {
  const args = {
    check: false, serial: null, url: null,
    port: ASSET_PORT, cdpPort: CDP_PORT, pkg: BROWSER_PACKAGE, launch: true, help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--check') args.check = true;
    else if (flag === '--no-launch') args.launch = false;
    else if (flag === '--help' || flag === '-h') args.help = true;
    else if (flag === '--serial') args.serial = argv[++i];
    else if (flag === '--url') args.url = argv[++i];
    else if (flag === '--package') args.pkg = argv[++i];
    else if (flag === '--port') args.port = Number(argv[++i]);
    else if (flag === '--cdp-port') args.cdpPort = Number(argv[++i]);
    else throw new Error(`Unknown option: ${flag}`);
  }
  return args;
}

function makeAdb(adbPath, serial) {
  return (adbArgs, options = {}) => execFileSync(
    adbPath,
    ['-s', serial, ...adbArgs],
    { encoding: 'utf8', stdio: options.quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'] }
  );
}

/**
 * The Quest browser only publishes its devtools socket once it has been
 * running. Reporting that plainly beats a CDP connection refused three steps
 * later with no explanation.
 */
function devtoolsSocketPresent(adb) {
  try {
    const sockets = adb(['shell', 'cat', '/proc/net/unix'], { quiet: true });
    return /chrome_devtools_remote/.test(sockets);
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const adbPath = resolveAdb();
  const devices = listDevices(adbPath);
  console.log(`adb        ${adbPath}`);
  console.log(`attached   ${describe(devices)}`);

  const quest = selectQuest(devices, args.serial);
  console.log(`headset    ${quest.serial} (${quest.model || quest.device})`);

  const adb = makeAdb(adbPath, quest.serial);

  const installed = adb(['shell', 'pm', 'list', 'packages', args.pkg], { quiet: true });
  if (!installed.includes(args.pkg)) {
    throw new Error(`${args.pkg} is not installed on ${quest.serial}. Pass --package with the browser's package name.`);
  }
  console.log(`browser    ${args.pkg}`);

  if (args.check) {
    console.log('\ncheck only — no tunnels opened, nothing launched.');
    console.log(devtoolsSocketPresent(adb)
      ? 'devtools socket is already published (browser has run this boot).'
      : 'devtools socket not published yet — it appears once the browser opens.');
    return;
  }

  let service = null;
  let launchUrl = args.url;
  if (!launchUrl) {
    service = await startAssetService(args.port === ASSET_PORT ? {} : { port: args.port });
    launchUrl = service.url;
    console.log(`asset      ${launchUrl}`);
  } else {
    console.log(`asset      ${launchUrl} (reused)`);
  }

  // Order matters: remote first for reverse, local first for forward. Getting
  // these backwards produces a tunnel that exists and carries nothing.
  adb(['reverse', `tcp:${args.port}`, `tcp:${args.port}`]);
  console.log(`reverse    headset 127.0.0.1:${args.port} -> this machine :${args.port}`);

  adb(['forward', `tcp:${args.cdpPort}`, DEVTOOLS_SOCKET]);
  console.log(`forward    127.0.0.1:${args.cdpPort} -> headset ${DEVTOOLS_SOCKET}`);

  if (args.launch) {
    // Deliberately no package argument. Naming com.oculus.browser explicitly
    // starts the process but opens no window — the Store stays in front, no tab
    // exists, and because the devtools socket only appears once there is a tab,
    // CDP then refuses the connection for a reason that looks like remote
    // debugging being switched off. Letting the system resolve the VIEW intent
    // opens the browser properly; this is also what metavr's own open_url does.
    adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', launchUrl]);
    console.log(`launched   ${launchUrl} in the headset browser`);
  }

  console.log(`
Next, in the headset: accept the EULA, load a save, press "Enter VR (spike)".

Then capture the compositor side from this machine. Through the metavr MCP:

  metavr_run  subcommand="perf capture"
              args={ mode: "vr", app: "${args.pkg}", duration: 60000, output: "kotor2vr-<label>" }
  metavr_run  subcommand="perf analyze-trace"  args={ focus: "frames" }
  metavr_run  subcommand="perf compare"        args={ baseline_id: "<before>", comparison_id: "<after>" }

Runtime knobs worth sweeping between captures (reset with vrruntime_reset):

  metavr_device action="vrruntime_set" vrruntime={ cpu_level: 4, gpu_level: 4, foveation_level: 2 }

The web side is unchanged: CDP is on http://127.0.0.1:${args.cdpPort}, so every tool
built on tools/vr-emulator/cdp.js points at the headset browser as-is. Do not
reload the page when attaching.

Ctrl+C here removes both tunnels${service ? ' and stops the asset service' : ''}.
`);

  const shutdown = () => {
    try { adb(['reverse', '--remove', `tcp:${args.port}`], { quiet: true }); } catch { /* already gone */ }
    try { adb(['forward', '--remove', `tcp:${args.cdpPort}`], { quiet: true }); } catch { /* already gone */ }
    if (service) service.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nQUEST PERF ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, USAGE };
