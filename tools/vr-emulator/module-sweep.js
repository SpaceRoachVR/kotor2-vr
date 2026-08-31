/**
 * Breadth-first module sweep.
 *
 *   npm run vr:sweep                          # every module in the install
 *   npm run vr:sweep -- --modules 101PER      # one module
 *   npm run vr:sweep -- --limit 5             # first five, for a smoke run
 *   npm run vr:sweep -- --start 302NAR        # resume an interrupted sweep
 *   npm run vr:sweep -- --url "<launch>"      # reuse a running asset service
 *
 * WHY THIS EXISTS
 *
 * Defect discovery on this project has been depth-first: a 40-70 minute scripted
 * playthrough that must succeed at step N to reach step N+1. That has three
 * structural costs. One blocker shadows every defect behind it, so nothing in
 * the Telos Academy can be known until the engine can walk there. Reaching new
 * ground means replaying 45 minutes of ground that already passed. And defects
 * arrive in encounter order, so a fault breaking forty modules is fixed at the
 * same priority as one breaking a single door — because there is no way to tell
 * them apart from inside a single playthrough.
 *
 * The sweep inverts all three. It warps into each of the 82 campaign modules in
 * turn, runs a fixed battery, records everything that is wrong, and moves on
 * whether the module passed or not. One run yields a whole-game defect
 * inventory ranked by how many modules each root cause breaks.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not play the game. It cannot tell you a quest is unfinishable, that
 * combat maths are wrong, or that a conversation dead-ends — those need the
 * playthrough driver, which keeps its job. The sweep answers a narrower and
 * cheaper question: of everything the engine must load, build and render to make
 * a module playable at all, what is broken? On current evidence that is where
 * most of the remaining work is.
 *
 * Read the caveat block in harness.js: like every emulator tool here, this
 * settles logic, not comfort or cadence. A green sweep is not device evidence.
 */
const fs = require('fs');
const path = require('path');

const { VrHarness } = require('./harness');
const { startAssetService } = require('./asset-service');
const { listGameModules, selectModules } = require('./module-list');
const { buildModuleProbeSource } = require('./module-probe');
const { rankRootCauses, summarize, toDefectRecords, renderRanking } = require('./sweep-report');

const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const DEFAULT_GAME_ROOT = 'D:\\SteamLibrary\\steamapps\\common\\Knights of the Old Republic II';

const PHASE_TIMEOUTS = {
  eula: 90_000,
  boot: 240_000,
  saves: 120_000,
};

function parseArgs(argv) {
  const args = {
    url: null,
    port: 9440,
    assetPort: null,
    game: DEFAULT_GAME_ROOT,
    modules: null,
    skip: [],
    start: null,
    limit: null,
    frames: 30,
    settle: 5_000,
    timeout: 300_000,
    reloadEvery: 25,
    reloadHeapMb: 3000,
    out: EVIDENCE_DIR,
  };
  const list = (value) => value.split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => argv[++i];
    if (flag === '--url') args.url = next();
    else if (flag === '--port') args.port = Number(next());
    else if (flag === '--asset-port') args.assetPort = Number(next());
    else if (flag === '--game') args.game = next();
    else if (flag === '--modules') args.modules = list(next());
    else if (flag === '--skip') args.skip = list(next());
    else if (flag === '--start') args.start = next();
    else if (flag === '--limit') args.limit = Number(next());
    else if (flag === '--frames') args.frames = Number(next());
    else if (flag === '--settle') args.settle = Number(next());
    else if (flag === '--timeout') args.timeout = Number(next());
    else if (flag === '--reload-every') args.reloadEvery = Number(next());
    else if (flag === '--reload-heap-mb') args.reloadHeapMb = Number(next());
    else if (flag === '--out') args.out = next();
    else if (flag === '--help' || flag === '-h') args.help = true;
    else throw new Error(`Unknown flag: ${flag}`);
  }
  return args;
}

const USAGE = `
Breadth-first module sweep — loads every campaign module and reports what is broken.

  --modules A,B      sweep exactly these, in this order
  --skip A,B         exclude these
  --start NAME       begin at NAME in sorted order (resume an interrupted run)
  --limit N          stop after N modules
  --frames N         frames to render per module (default 30)
  --settle MS        wait after the engine reports ready (default 5000)
  --timeout MS       per-module load timeout (default 300000)
  --reload-every N   reload the page after at most N modules (default 25, 0 disables)
  --reload-heap-mb N reload once the JS heap passes N MB (default 3000, 0 disables)
  --game DIR         retail install to enumerate modules from
  --url URL          reuse a running asset service instead of starting one
  --asset-port N     start the asset service on a non-default port
  --port N           CDP port (default 9440)
  --out DIR          where to write evidence
`;

async function clickButtonByText(harness, text) {
  const box = await harness.evaluate(`(() => {
    const wanted = ${JSON.stringify(text)}.toLowerCase();
    // position:fixed elements report offsetParent === null, so measure instead.
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const btn = Array.from(document.querySelectorAll('button')).filter(visible)
      .find(b => (b.textContent || '').trim().toLowerCase() === wanted);
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!box) throw new Error(`No visible button labelled "${text}"`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await harness.cdp.send('Input.dispatchMouseEvent', {
      type, x: box.x, y: box.y, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0,
    });
  }
}

/**
 * Boots the engine to the point where a module can be warped into.
 *
 * A save is loaded first, and not for its contents. `LoadModule` expects a party
 * to place, and warping with none puts the engine in a state where failures are
 * artefacts of the empty party rather than of the module — which would make the
 * whole sweep unreadable. This mirrors what `CheatConsoleManager.warp` assumes
 * during ordinary play.
 */
async function bootEngine(harness, onProgress, expectEula = true) {
  // The EULA appears on a cold boot but NOT after the mid-sweep heap reload —
  // acceptance persists, so the button never returns. Waiting for it
  // unconditionally aborted a whole 82-module run at module 20, immediately
  // after a "reloading page to shed accumulated state (heap 3100 MB)". Treat
  // its absence as already-accepted and press on; a genuinely dead page still
  // fails, just at the engine-boot wait below, which is the honest place.
  try {
    await harness.waitFor(
      `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`,
      // A reload is not expected to show it, so do not spend the cold-boot
      // budget proving that on every reload.
      expectEula ? PHASE_TIMEOUTS.eula : 5_000
    );
    await clickButtonByText(harness, 'OK');
    onProgress('EULA accepted');
  } catch (error) {
    onProgress('EULA already accepted');
  }

  await harness.waitFor(
    `document.querySelector('#vr-spike-button') !== null`,
    PHASE_TIMEOUTS.boot, 2000
  );
  onProgress('engine booted');

  const saveCount = await harness.evaluate(`(async () => {
    await window.KotOR.SaveGame.GetSaveGames();
    return window.KotOR.SaveGame.saves.length;
  })()`, { timeoutMs: PHASE_TIMEOUTS.saves });
  if (!saveCount) {
    throw new Error(
      'No saves found. The sweep needs one save to establish a party before it can warp ' +
      'between modules. Create one, or run tools/vr-emulator/playthrough.js once.'
    );
  }

  // Mirror MenuSaveLoad's LOADGAME path: clear menus and dispose the live module
  // before loading, or the engine stays in GUI mode and the load never lands.
  await harness.evaluate(`(async () => {
    const gs = window.KotOR.GameState;
    gs.MenuManager.ClearMenus();
    if (gs.module) { try { gs.module.dispose(); } catch (e) {} gs.module = undefined; }
    Promise.resolve(window.KotOR.SaveGame.saves[0].load()).catch(() => undefined);
    return true;
  })()`);
  await harness.waitFor(
    `(() => {
      const gs = window.KotOR.GameState;
      const p = window.KotOR.PartyManager && window.KotOR.PartyManager.Player;
      return !!(gs && gs.module && p && p.position && Number.isFinite(p.position.x));
    })()`,
    PHASE_TIMEOUTS.saves, 3000
  );
  onProgress(`party established from save (${saveCount} available)`);
  return { saveCount };
}

/**
 * Console errors that are the engine asking a question, not reporting a fault.
 *
 * ROADMAP 1.11 settled this class: the engine probes for a resource in its
 * preferred location first and falls back when it is absent, and the absence is
 * logged at error level. A retail TSL install has no module-level `.mod` files —
 * TSLRCM installs to Override here — so `modules/NAME.mod` 404s for every one of
 * the 82 modules before the `.rim` is read successfully.
 *
 * Left unfiltered this single benign probe would top the blast-radius ranking
 * with 82 modules affected, which is precisely the signal the ranking exists to
 * carry and precisely the wrong thing to point it at. They are counted and
 * reported separately rather than discarded, so the filter can never quietly
 * swallow a real regression in the same code path.
 */
const BENIGN_CONSOLE_PATTERNS = [
  /GameFileSystem\.read: failed reading 'modules\/[^']+\.mod'.*received 404/,
];

function isBenignConsoleError(text) {
  return BENIGN_CONSOLE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Console output the engine produced while one module was being probed.
 *
 * Much of this engine reports failure through `console.warn`/`console.error`
 * rather than by throwing, so a module can complete every probe cleanly and
 * still have told us it is broken. Diffing the capture around each module is
 * how those get attributed to the module that caused them.
 */
/**
 * The page's JS heap in MB, or null where the browser does not expose it.
 *
 * `performance.memory` is Chrome-only and can be absent, so the caller must treat
 * null as "unknown" and fall back rather than as "heap is fine".
 */
async function readHeapMb(harness) {
  try {
    const bytes = await harness.evaluate(
      '(performance && performance.memory) ? performance.memory.usedJSHeapSize : null'
    );
    return typeof bytes === 'number' ? bytes / (1024 * 1024) : null;
  } catch {
    return null;
  }
}

function harvestConsole(harness, fromIndex) {
  const messages = harness.consoleMessages.slice(fromIndex);
  const allErrors = messages.filter((m) => m.level === 'error');
  const benign = allErrors.filter((m) => isBenignConsoleError(m.text));
  const errors = allErrors.filter((m) => !isBenignConsoleError(m.text));
  const warnings = messages.filter((m) => m.level === 'warning' || m.level === 'warn');
  return {
    total: messages.length,
    errors: errors.length,
    benignErrors: benign.length,
    warnings: warnings.length,
    // A handful of examples, deduplicated — one broken asset can log thousands
    // of identical lines and they add nothing after the first.
    samples: Array.from(new Set(errors.map((m) => m.text.slice(0, 300)))).slice(0, 10),
    warningSamples: Array.from(new Set(warnings.map((m) => m.text.slice(0, 300)))).slice(0, 5),
  };
}

async function sweep(args, onProgress) {
  const all = listGameModules(args.game);
  const modules = selectModules(all, {
    only: args.modules,
    skip: args.skip,
    start: args.start,
    limit: args.limit,
  });
  onProgress(`${modules.length} module(s) selected of ${all.length} in the install`);

  fs.mkdirSync(args.out, { recursive: true });
  const jsonlPath = path.join(args.out, 'module-sweep.jsonl');
  // Incremental, one JSON object per line. A sweep is long and a crash 60
  // modules in must not cost the 60 modules of evidence already collected.
  const stream = fs.createWriteStream(jsonlPath, { flags: 'w' });

  let service = null;
  let url = args.url;
  if (!url) {
    onProgress('starting asset service…');
    service = await startAssetService(args.assetPort ? { port: args.assetPort } : {});
    url = service.url;
  }

  const harness = new VrHarness({ port: args.port });
  const reports = [];

  try {
    await harness.launch(url);
    await bootEngine(harness, onProgress);

    let sinceReload = 0;
    for (let index = 0; index < modules.length; index += 1) {
      const name = modules[index];
      const label = `[${index + 1}/${modules.length}] ${name}`;

      // The engine leaks across module loads — ~8.9 GB and load times climbing
      // 41s -> 47s -> 65s were measured across successive loads (ROADMAP 0.3).
      // Left alone, a long sweep degrades into measuring the leak rather than
      // the modules, and late modules would fail for reasons early ones did not.
      //
      // Reloading is not cheap here: the engine re-enumerates every save on boot,
      // and this machine has 600+, which costs minutes. So the trigger is the heap
      // itself rather than a module count — reload when there is a reason to,
      // instead of on a fixed cadence that pays that cost eight times a sweep.
      // The count remains as a backstop for when the heap reading is unavailable.
      const heapMb = await readHeapMb(harness);
      const heapExceeded = args.reloadHeapMb > 0 && heapMb != null && heapMb > args.reloadHeapMb;
      const countExceeded = args.reloadEvery > 0 && sinceReload >= args.reloadEvery;
      if (heapExceeded || countExceeded) {
        onProgress(`  · reloading page to shed accumulated state ` +
          `(${heapExceeded ? `heap ${Math.round(heapMb)} MB` : `${sinceReload} modules`})`);
        await harness.cdp.send('Page.reload', { ignoreCache: false });
        await harness.waitFor('window.__xrHarness && window.__xrHarness.ready === true', 30_000);
        await bootEngine(harness, () => {}, false);
        sinceReload = 0;
      }

      const consoleFrom = harness.consoleMessages.length;
      const errorsFrom = harness.pageErrors.length;
      const started = Date.now();
      let report;
      try {
        report = await harness.evaluate(
          buildModuleProbeSource(name, {
            loadTimeoutMs: args.timeout,
            frames: args.frames,
            settleMs: args.settle,
          }),
          { timeoutMs: args.timeout + args.settle + 120_000 }
        );
      } catch (error) {
        // The probe itself failed to return — a page crash, an OOM, a CDP
        // timeout. That is a finding about the module, not a reason to stop.
        report = {
          module: name,
          ok: false,
          phase: 'driver',
          ms: Date.now() - started,
          counts: {},
          findings: [{
            code: 'probe-did-not-return',
            severity: 'blocker',
            detail: String(error && error.message || error).slice(0, 400),
            subject: name,
          }],
          skipped: [],
          truncated: {},
        };
      }

      report.console = harvestConsole(harness, consoleFrom);
      const pageErrors = harness.pageErrors.slice(errorsFrom);
      for (const pageError of pageErrors.slice(0, 10)) {
        report.findings.push({
          code: 'page-exception',
          severity: 'critical',
          detail: String(pageError).slice(0, 400),
          subject: name,
        });
      }
      if (report.console.errors > 0) {
        report.findings.push({
          code: 'console-error',
          severity: 'major',
          detail: `${report.console.errors} console error(s) during load and render. ` +
            `First: ${report.console.samples[0] || '(none captured)'}`,
          subject: name,
        });
      }

      reports.push(report);
      stream.write(JSON.stringify(report) + '\n');
      sinceReload += 1;

      const blockers = report.findings.filter((f) => f.severity === 'blocker').length;
      const verdict = blockers ? `BLOCKED (${report.phase})`
        : report.findings.length ? `${report.findings.length} finding(s)`
        : 'clean';
      onProgress(`  ${label}  ${Math.round(report.ms / 1000)}s  ${verdict}`);
    }
  } finally {
    stream.end();
    await harness.close();
    if (service) service.stop();
  }

  return { reports, jsonlPath, modules, allCount: all.length };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const started = Date.now();
  try {
    const { reports, jsonlPath, allCount } = await sweep(args, (step) => console.log(step));

    const ranked = rankRootCauses(reports);
    const summary = summarize(reports);
    const records = toDefectRecords(reports, path.relative(process.cwd(), jsonlPath));

    const summaryPath = path.join(args.out, 'module-sweep-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify({
      generatedFrom: path.relative(process.cwd(), jsonlPath),
      installModuleCount: allCount,
      summary,
      ranking: ranked,
    }, null, 2));

    const ledgerPath = path.join(args.out, 'module-sweep-defects.json');
    fs.writeFileSync(ledgerPath, JSON.stringify(records, null, 2));

    console.log('\n=== ROOT CAUSES BY BLAST RADIUS ===\n');
    console.log(renderRanking(ranked));
    console.log('\n=== COVERAGE ===\n');
    console.log(`  modules swept    ${summary.modulesSwept} of ${allCount} in the install`);
    console.log(`  loaded           ${summary.modulesLoaded}`);
    console.log(`  clean            ${summary.modulesClean}`);
    console.log(`  blocked          ${summary.modulesBlocked}`);
    console.log(`  findings         ${summary.findings} ` +
      `(${summary.bySeverity.blocker} blocker, ${summary.bySeverity.critical} critical, ` +
      `${summary.bySeverity.major} major, ${summary.bySeverity.minor} minor)`);
    if (summary.skippedProbes) {
      // A probe that cannot run is not a probe that passed. Surfaced loudly so a
      // battery quietly dying against a moved API cannot read as a clean sweep.
      console.log(`  !! skipped probes ${summary.skippedProbes} — a battery could not run; ` +
        `check the "skipped" field in the JSONL`);
    }
    console.log(`\n  wall clock       ${Math.round((Date.now() - started) / 1000)}s`);
    console.log(`\n  reports  -> ${path.relative(process.cwd(), jsonlPath)}`);
    console.log(`  summary  -> ${path.relative(process.cwd(), summaryPath)}`);
    console.log(`  defects  -> ${path.relative(process.cwd(), ledgerPath)}`);
    console.log('\nNote: this settles load/build/render correctness, not playability, ' +
      'comfort or cadence. Not device evidence.');

    process.exitCode = summary.modulesBlocked ? 1 : 0;
  } catch (error) {
    console.error('\nSWEEP ERROR:', error && error.stack || error);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  parseArgs, sweep, harvestConsole, readHeapMb, bootEngine, isBenignConsoleError,
  BENIGN_CONSOLE_PATTERNS, USAGE, DEFAULT_GAME_ROOT,
};
