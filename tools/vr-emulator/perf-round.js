/**
 * Drives a headset performance round from outside the headset, over CDP.
 *
 *   node tools/vr-emulator/perf-round.js stop <checkpoint> [tag]
 *   node tools/vr-emulator/perf-round.js load <checkpoint>
 *   node tools/vr-emulator/perf-round.js enter-vr
 *   node tools/vr-emulator/perf-round.js window <label> <seconds>
 *   node tools/vr-emulator/perf-round.js trace <label> <seconds>
 *   node tools/vr-emulator/perf-round.js state
 *   node tools/vr-emulator/perf-round.js reload [xrscale=0.8] [depth=linear]
 *   node tools/vr-emulator/perf-round.js summary
 *   node tools/vr-emulator/perf-round.js bisect <set|all> [--dry]
 *   node tools/vr-emulator/perf-round.js note <text...>
 *   node tools/vr-emulator/perf-round.js checkpoint <name>
 *   node tools/vr-emulator/perf-round.js attribution [--budget <ms>]
 *   node tools/vr-emulator/perf-round.js wave <flag,...> --worst <set> [--dry]
 *
 * Options: --port <cdp port> (default 9422, the `vr:play` browser; the
 * emulator harness uses its own), --round <name> (default r1), which names the
 * evidence file `evidence/perf/<round>.jsonl`.
 *
 * Why this exists. The Phase 0 procedure has the person in the headset type
 * `VRSpike.perf.start(...)` into DevTools, which cannot be done from inside the
 * headset, and it measured one fixed window in 101PER. The open risk (H3) is
 * the busier rooms, so this loads the playthrough checkpoints the Peragus run
 * left behind and times each window from here while the wearer stands or walks.
 *
 * `load` reboots the page first (see freshPage), then uses MenuSaveLoad's
 * exact LOADGAME sequence, the same one
 * `resumeFromCheckpoint` uses, then reopens InGameOverlay: a scripted load
 * leaves it closed, and with it closed the engine stays in GUI mode and
 * nothing the wearer does moves them.
 *
 * `reload` exists because `/launch` redirects to a fixed game URL and drops any
 * query string, so the H7 depth and H13 resolution arms cannot be set at
 * launch. The page is re-navigated with the options instead; the session
 * cookie is already set, and both options are read when the renderer and the
 * XR session are built. Every `load` reloads the page, keeping its options,
 * so the wearer presses Enter VR again after each one.
 *
 * `bisect` runs the PerfLayerGate ladder (`?perflayer=l0..l5`) over the sets in
 * perf-benchmarks.json: per rung it boots the page once at that layer, loads the
 * checkpoint, enters VR, settles 10 s and measures 60 s windows. The ladder runs
 * on each set's ladderCheckpoint only; the others run rung 5 (R12). `--dry`
 * prints the plan and a wall-time estimate without touching CDP. A stripped
 * layer must not leak into later play, so bisect navigates back to
 * `perflayer=l5` when it ends or is interrupted, and `load`, `window` and the
 * summary lines shout when the page is not at l5. Every
 * checkpoint is resolved against the saves first, and a set with one missing is
 * dropped whole before anything runs. The `walk` windows rely on the wearer
 * walking, as in `stop`; nothing scripts movement. `attribution` (no CDP) reads
 * the round's records and prints which rung first went over budget and which
 * stage (sim, render, gpu, runtime) dominated there. `note` records what Allen
 * reads off the Virtual Desktop overlay; `checkpoint` saves the current game
 * under the VRPT prefix so a stop can be loaded later.
 *
 * `wave` is the Phase 2 wave headset round (perf-wave.js): the whole suite at
 * l5 with every listed flag on, then on the worst set's ladderCheckpoint an
 * A/B/A of standing windows per flag (all on, `perf.<flag>=off`, all on). It
 * reuses bisect's machinery: one boot per stop with the stop's URL options,
 * the save check before anything runs, and the return to plain l5 (which drops
 * the perf.* overrides) however it ends. Its records add `flags` and `phase`
 * (and `flag` on the A/B/A windows) for `confirmFlag`. Flags are given as
 * `perf.x,perf.y` or `x,y`.
 */
const fs = require('fs');
const path = require('path');
const { CdpSession, findPageTarget } = require('./cdp');
const { captureTrace, analyzeTrace } = require('./perf-trace');
const {
  bisectPlan, planStops, formatPlan, resolvePlan, attributeRungs, formatAttribution,
  WINDOW_SECONDS, TARGET_HZ, TARGET_P90_MS, TARGET_P99_MS,
} = require('./perf-bisect');
const { wavePlan, waveStops, stopOptions, formatWavePlan, formatAba, normalizeFlags } = require('./perf-wave');

const CHECKPOINT_PREFIX = 'VRPT-20260824-E2E';
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value;
};
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
};
const PORT = Number(opt('--port', process.env.KOTOR2VR_CDP_PORT || 9422));
const ROUND = opt('--round', 'r1');
const DRY = flag('--dry');
const WORST = opt('--worst', undefined);
const [command, ...rest] = argv;
const EVIDENCE = path.join(__dirname, 'evidence', 'perf', `${ROUND}.jsonl`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const target = await findPageTarget(PORT, (u) => /\/game\//.test(u));
  return CdpSession.connect(target.webSocketDebuggerUrl);
}

// Everything a window's numbers depend on besides the room itself. A figure
// without its configuration beside it cannot be compared with the next one.
const STATE = `(() => {
  const K = window.KotOR;
  const gs = K && K.GameState;
  const vr = K && K.VRSpike;
  const p = K && K.PartyManager && K.PartyManager.party && K.PartyManager.party[0];
  let world = null;
  try { world = vr && vr.perf && vr.perf.worldContext ? vr.perf.worldContext() : null; } catch (e) { world = { error: String(e) }; }
  return {
    module: world && world.module,
    room: world && world.room,
    engineMode: gs ? gs.Mode : null,
    presenting: !!(vr && vr.isPresenting),
    search: location.search,
    perflayer: (() => {
      // PerfLayerGate is not exported on window.KotOR, so echo what the launch URL asked for.
      const m = /^l([0-5])$/.exec(String(new URLSearchParams(location.search).get('perflayer') || '').trim().toLowerCase());
      return m ? Number(m[1]) : 5;
    })(),
    depthMode: gs ? gs.rendererDepthMode : null,
    runtimeRates: vr && vr.perf ? vr.perf.runtimeRates : null,
    targetHz: vr && vr.perf ? vr.perf.targetHz : null,
    player: p && p.position ? { x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(2) } : null,
    roomsVisible: world && world.roomsVisible,
    roomsTotal: world && world.roomsTotal,
    moviePlaying: !!(gs && gs.VideoManager && gs.VideoManager.isMoviePlaying && gs.VideoManager.isMoviePlaying()),
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  };
})()`;

// A scripted load leaves InGameOverlay closed, so it is reopened; but its
// show() forces EngineMode.INGAME, which drops a minigame module (107PER, the
// turret; the swoop tracks) out of MINIGAME and leaves the wearer standing on
// the hangar floor instead of in the turret. The engine's own load opens the
// overlay and then sets the play mode; RestoreEnginePlayMode does the same
// (MINIGAME for a minigame area, DIALOG under a live cutscene, else INGAME).
const REOPEN_OVERLAY = `(() => {
  const gs = window.KotOR.GameState;
  gs.MenuManager.InGameOverlay.open();
  if (typeof gs.RestoreEnginePlayMode === 'function') gs.RestoreEnginePlayMode();
  return gs.Mode;
})()`;

async function waitUntil(cdp, expression, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await cdp.evaluate(expression).catch(() => false);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(1000);
  }
}

// A fresh page for every checkpoint. Loading a second save into a page that
// already has a module leaves party[0] as a blank creature still standing in
// the previous module's room, with no rooms drawn: the dry run measured an
// empty Ebon Hawk at 54 fps that way. The playthrough harness only ever loads
// into a freshly booted page, and so does this.
async function freshPage(cdp, targetUrl) {
  // bisect passes the rung's URL so the page boots once, at the right layer.
  const url = targetUrl || await cdp.evaluate('location.origin + location.pathname + location.search');
  await cdp.send('Page.navigate', { url });
  await sleep(3000);
  // Two gates stand between a reload and the main menu: the audio-unlock
  // "Click to Begin" modal and the EULA. Both want a trusted click, so each is
  // pressed with a dispatched mouse event, as many times as they appear.
  const GATE = `(() => { const b = Array.from(document.querySelectorAll('button')).find((x) =>
    ['BEGIN', 'OK'].includes((x.textContent || '').trim()) && x.getBoundingClientRect().width > 0);
    if (!b) return null; const r = b.getBoundingClientRect();
    return { label: b.textContent.trim(), x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`;
  const MAIN = `(() => { const m = window.KotOR && window.KotOR.GameState && window.KotOR.GameState.MenuManager;
    return !!(m && m.MainMenu && m.MainMenu.bVisible); })()`;
  const deadline = Date.now() + 240000;
  while (!(await cdp.evaluate(MAIN).catch(() => false))) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the main menu');
    const gate = await cdp.evaluate(GATE).catch(() => null);
    if (gate) {
      await click(cdp, gate);
      console.log(`pressed ${gate.label}`);
      await sleep(1500);
    } else {
      await sleep(1000);
    }
  }
  // Loading before the main menu lands gets the load stomped: the boot movie
  // queue ends by opening MainMenu and dropping the engine back to GUI mode.
  await sleep(2000);
}

// A stripped perflayer (anything but l5) makes every figure a partial-scene
// figure. It is only expected inside bisect, which passes `expectLayer`.
function warnIfStripped(state, what) {
  if (state && state.perflayer !== undefined && state.perflayer !== 5) {
    console.log(`WARNING: ${what}: page is at perflayer=l${state.perflayer}, not the full game. These numbers are for a stripped scene; reload without ?perflayer (or run \`reload perflayer=l5\`) before judging or playing.`);
  }
}

// `url` boots the page at a specific address; `expectLayer` says the caller put
// the page at a stripped layer on purpose. Returns the state read after loading.
async function load(cdp, name, { url, expectLayer } = {}) {
  await freshPage(cdp, url);
  const wanted = `${CHECKPOINT_PREFIX} ${name}`.toLowerCase();
  const loaded = await cdp.evaluate(`(async () => {
    const K = window.KotOR;
    const gs = K.GameState;
    await K.SaveGame.GetSaveGames();
    const all = K.SaveGame.saves.map((s) => String((s.getSaveName && s.getSaveName()) || s.SAVEGAMENAME || ''));
    const matches = all.reduce((f, n, i) => (n.trim().toLowerCase() === ${JSON.stringify(wanted)} ? f.concat(i) : f), []);
    if (!matches.length) {
      return { ok: false, available: all.filter((n) => n.startsWith(${JSON.stringify(CHECKPOINT_PREFIX)})) };
    }
    const index = matches[matches.length - 1];
    gs.MenuManager.ClearMenus();
    if (gs.module) { try { gs.module.dispose(); } catch (e) {} gs.module = undefined; }
    Promise.resolve(K.SaveGame.saves[index].load()).catch(() => undefined);
    return { ok: true, directory: String(K.SaveGame.saves[index].directory || '') };
  })()`, { timeoutMs: 120000 });
  if (!loaded.ok) {
    const names = loaded.available.map((n) => n.slice(CHECKPOINT_PREFIX.length + 1));
    throw new Error(`no checkpoint "${name}"; available: ${names.join(', ')}`);
  }

  const deadline = Date.now() + 180000;
  for (;;) {
    const ready = await cdp.evaluate(`(() => {
      const K = window.KotOR; const gs = K.GameState;
      const p = K.PartyManager.party && K.PartyManager.party[0];
      const playing = gs.VideoManager && gs.VideoManager.isMoviePlaying ? gs.VideoManager.isMoviePlaying() : false;
      let world = null;
      try { world = K.VRSpike.perf.worldContext ? K.VRSpike.perf.worldContext() : null; } catch (e) {}
      // A placed player in one of this module's rooms, with rooms drawn, is
      // the real signal; a module object alone appears long before that.
      return !!(gs.module && p && p.position && Number.isFinite(p.position.x)) && !playing && gs.Mode !== 5
        && !!(world && world.room && world.roomsVisible > 0);
    })()`).catch(() => false);
    if (ready) break;
    if (Date.now() > deadline) throw new Error(`checkpoint "${name}" did not finish loading in 3 minutes`);
    await sleep(1000);
  }
  await cdp.evaluate(REOPEN_OVERLAY);
  await sleep(1500);
  const state = await cdp.evaluate(STATE);
  console.log(`loaded "${name}" from ${loaded.directory}`);
  console.log(JSON.stringify(state));
  const prefix = String(state.module || '').slice(0, 3).toLowerCase();
  if (!String(state.room || '').toLowerCase().startsWith(prefix)) {
    console.log(`WARNING: player room ${state.room} does not look like part of ${state.module}`);
  }
  if (state.engineMode !== 1 && state.engineMode !== 2) {
    console.log(`WARNING: engineMode=${state.engineMode}, want 1 (INGAME) or 2 (MINIGAME); input may be suppressed`);
  }
  if (expectLayer === undefined) warnIfStripped(state, `load "${name}"`);
  return state;
}

// `extra` ({rung, set, checkpoint, window}) comes from bisect and is written into
// the record beside targetHz, so attribution can group the lines by rung. The
// wave adds {flags, phase, flag} and leaves `rung` out: its windows are all at
// l5, so the stripped-layer warning stays armed and attribution ignores them.
async function measureWindow(cdp, label, seconds, extra = {}) {
  // Auto-reporting restarts the window every 60 s, which would split a long
  // window and leave report() describing only its tail. Hold it off for the
  // window and restore it after.
  const before = await cdp.evaluate(STATE);
  if (extra.rung === undefined) warnIfStripped(before, `window "${label}"`);
  await cdp.evaluate(`(() => {
    const perf = window.KotOR.VRSpike.perf;
    window.__perfRoundAutoReport = perf.autoReportSec;
    perf.autoReportSec = 0;
    perf.start(${JSON.stringify(label)});
    return true;
  })()`);
  console.log(`window "${label}" running for ${seconds} s in ${before.module} (presenting=${before.presenting})`);
  await sleep(seconds * 1000);
  const report = await cdp.evaluate(`(() => {
    const perf = window.KotOR.VRSpike.perf;
    const rpt = perf.report();
    perf.autoReportSec = window.__perfRoundAutoReport || 60;
    perf.start('between-windows');
    return rpt;
  })()`, { timeoutMs: 30000 });
  const after = await cdp.evaluate(STATE);
  const { rung, set, checkpoint, window, flags, phase, flag: flagUnderTest } = extra;
  const record = {
    at: new Date().toISOString(), round: ROUND, label, seconds,
    ...(rung !== undefined ? { rung } : {}),
    ...(set !== undefined ? { set } : {}),
    ...(checkpoint !== undefined ? { checkpoint } : {}),
    ...(window !== undefined ? { window } : {}),
    ...(flags !== undefined ? { flags } : {}),
    ...(phase !== undefined ? { phase } : {}),
    ...(flagUnderTest !== undefined ? { flag: flagUnderTest } : {}),
    targetHz: before.targetHz,
    before, after, report,
  };
  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  fs.appendFileSync(EVIDENCE, `${JSON.stringify(record)}\n`);
  console.log(summaryLine(record));
}

// A timed window with a Chrome trace recorded over the same seconds, for the
// 31 ms plateau (P1): the fps numbers say frames are late, the trace says what
// made them late. Keep it short (20-30 s); a trace with the CPU profiler on
// runs to hundreds of MB.
async function traceWindow(cdp, label, seconds) {
  const dir = path.dirname(EVIDENCE);
  fs.mkdirSync(dir, { recursive: true });
  const traceFile = path.join(dir, `${ROUND}-${label}.trace.json`);
  // The frame budget follows the headset's refresh rate; STATE carries targetHz.
  const state = await cdp.evaluate(STATE);
  const budgetMs = Number.isFinite(state.targetHz) && state.targetHz > 0 ? 1000 / state.targetHz : undefined;
  const [events] = await Promise.all([
    captureTrace(cdp, seconds, traceFile),
    measureWindow(cdp, label, seconds),
  ]);
  const analysis = analyzeTrace(events, { seconds, budgetMs });
  fs.writeFileSync(path.join(dir, `${ROUND}-${label}.trace-summary.json`), JSON.stringify(analysis, null, 1));
  const t = analysis.mainThreadTasks;
  const f = analysis.animationFrameCallbacks;
  console.log(`trace ${traceFile} (${events.length} events; open in ui.perfetto.dev)`);
  console.log(`main-thread tasks ${t.count}: p50 ${t.p50} p90 ${t.p90} p99 ${t.p99} ms, ${t.overBudget} over ${analysis.frameBudgetMs} ms`);
  console.log(`frame callbacks ${f.count}: p50 ${f.p50} p90 ${f.p90} p99 ${f.p99} ms, ${f.overBudget} over budget`);
  console.log(`GC ${analysis.gcMs} ms, GPU tasks ${analysis.gpuTaskMs} ms, JS sampled ${analysis.jsSampledMs} ms`);
  for (const row of analysis.topJsSelfTime.slice(0, 15)) {
    console.log(`  ${String(row.ms).padStart(8)} ms ${String(row.share).padStart(5)}%  ${row.fn}`);
    if (row.callers[0]) console.log(`             via ${row.callers[0].via}`);
  }
}

function summaryLine(r) {
  const rpt = r.report || {};
  const ft = rpt.frametimeMs || {};
  const cad = rpt.xrCadence || {};
  const world = rpt.world || {};
  // R4: the spec's 72 Hz target, not the old 50 fps floor.
  const verdict = ft.p90 <= TARGET_P90_MS && ft.p99 <= TARGET_P99_MS ? 'PASS' : 'FAIL';
  return [
    `${r.label.padEnd(28)} ${String(world.module || r.before.module).padEnd(7)}`,
    `${String(rpt.fps).padStart(6)} fps  p50 ${ft.p50} p90 ${ft.p90} p99 ${ft.p99}`,
    `calls ${rpt.render && rpt.render.calls}  tris ${rpt.render && rpt.render.triangles}`,
    `rooms ${world.roomsVisible}/${world.roomsTotal}  moved ${world.path ? world.path.distanceMetres : '?'} m`,
    `layer ${r.before.perflayer === undefined ? 'n/a' : `l${r.before.perflayer}${r.before.perflayer === 5 ? '' : ' STRIPPED'}`}`,
    `heap ${rpt.jsHeapMB}  trustworthy=${cad.integrity ? cad.integrity.trustworthy : "n/a"}  ${r.before.presenting ? 'stereo' : 'MONO'}  ${verdict} (target ${TARGET_HZ} Hz: p90<=${TARGET_P90_MS} p99<=${TARGET_P99_MS})`,
  ].join(' | ');
}

async function gameUrl(cdp, options) {
  const params = new URLSearchParams('key=tsl&assets=/assets');
  for (const option of options) {
    const [key, value] = option.split('=');
    if (!key || value === undefined) throw new Error(`reload options are key=value, got "${option}"`);
    params.set(key, value);
  }
  return `${await cdp.evaluate('location.origin')}/game/index.html?${params}`;
}

async function navigateWithOptions(cdp, options) {
  const url = await gameUrl(cdp, options);
  await cdp.send('Page.navigate', { url });
  console.log(`navigated to ${url}`);
}

async function reload(cdp, options) {
  await navigateWithOptions(cdp, options);
  console.log('Now run `load <checkpoint>`; it reloads the page again with these options kept.');
}

async function click(cdp, point) {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
  }
}

// requestSession needs user activation, which a DOM .click() from CDP does not
// carry; a dispatched mouse event does, as the emulator harness relies on.
async function enterVr(cdp) {
  const box = await waitUntil(cdp, `(() => { const b = document.querySelector('#vr-spike-button');
    if (!b || b.disabled) return false; const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, 60000, 'an enabled Enter VR button');
  await click(cdp, box);
  await waitUntil(cdp, '!!(window.KotOR.VRSpike && window.KotOR.VRSpike.isPresenting)', 30000, 'the XR session');
  await cdp.evaluate(REOPEN_OVERLAY);
  await sleep(1500);
  console.log(JSON.stringify(await cdp.evaluate(STATE)));
}

// One headset stop, unattended: the wearer only has to stand still for the
// first ~40 s after the level appears, then walk until the next load. The
// settle period keeps the load's own hitches out of the standing window, and
// the walking window's path distance shows afterwards whether they walked.
async function enterVrOrWait(cdp) {
  try {
    await enterVr(cdp);
  } catch (error) {
    console.log(`Enter VR did not start from here (${error.message}); press it in the headset now`);
    await waitUntil(cdp, '!!(window.KotOR.VRSpike && window.KotOR.VRSpike.isPresenting)', 300000, 'the XR session');
    await cdp.evaluate(REOPEN_OVERLAY);
  }
}

async function stop(cdp, name, tag) {
  const label = `${ROUND}-${name}${tag ? `-${tag}` : ''}`;
  console.log(`[${new Date().toLocaleTimeString()}] loading ${name}`);
  await load(cdp, name);
  await enterVrOrWait(cdp);
  console.log(`[${new Date().toLocaleTimeString()}] in VR — settling 10 s, then STAND 30 s, then WALK 60 s`);
  await sleep(10000);
  await measureWindow(cdp, `${label}-rest`, 30);
  await measureWindow(cdp, `${label}-walk`, 60);
  console.log(`[${new Date().toLocaleTimeString()}] stop ${name} done`);
}

function summary() {
  if (!fs.existsSync(EVIDENCE)) throw new Error(`no evidence yet at ${EVIDENCE}`);
  for (const record of readRecords()) {
    console.log(record.label === 'note' ? `NOTE ${record.at}: ${record.text}` : summaryLine(record));
  }
}

function readRecords() {
  if (!fs.existsSync(EVIDENCE)) return [];
  return fs.readFileSync(EVIDENCE, 'utf8').split(/\r?\n/).filter((t) => t.trim()).map((t) => JSON.parse(t));
}

function appendRecord(record) {
  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  fs.appendFileSync(EVIDENCE, `${JSON.stringify(record)}\n`);
}

// What the wearer reads off the Virtual Desktop overlay, kept with the round.
function note(words) {
  const text = words.join(' ').trim();
  if (!text) throw new Error('usage: perf-round.js note <text...>');
  appendRecord({ at: new Date().toISOString(), round: ROUND, label: 'note', text });
  console.log(`noted in ${EVIDENCE}`);
}

async function checkpoint(cdp, name) {
  const saved = await cdp.evaluate(`(async () => {
    const ok = await window.KotOR.SaveGame.SaveCurrentGame(${JSON.stringify(`${CHECKPOINT_PREFIX} ${name}`)});
    return ok !== false;
  })()`, { timeoutMs: 60000 });
  if (!saved) throw new Error(`saving "${name}" did not complete: no module loaded, or a save is already writing`);
  console.log(`saved "${CHECKPOINT_PREFIX} ${name}"`);
}

function loadBenchmarks() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'perf-benchmarks.json'), 'utf8'));
}

// The rungs the manifest asks of each set that has records, so a rung that never
// ran shows as unmeasured and not as a gap nobody can see.
function plannedRowsFor(records) {
  const benchmarks = loadBenchmarks();
  const sets = [...new Set(records.map((r) => r.set).filter((set) => set && benchmarks[set] && !set.startsWith('_')))];
  return sets.length ? bisectPlan(benchmarks, sets) : [];
}

function attribution() {
  const raw = opt('--budget', String(TARGET_P90_MS));
  const budgetMs = Number(raw);
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error(`--budget must be a finite number > 0, got "${raw}"`);
  const records = readRecords();
  if (!records.length) return console.log(`no records at ${EVIDENCE}; run bisect <set|all> for round "${ROUND}" first`);
  console.log(formatAttribution(attributeRungs(records, budgetMs, plannedRowsFor(records)), budgetMs));
}

async function listSaveNames(cdp) {
  return cdp.evaluate(`(async () => {
    const K = window.KotOR;
    await K.SaveGame.GetSaveGames();
    return K.SaveGame.saves.map((s) => String((s.getSaveName && s.getSaveName()) || s.SAVEGAMENAME || ''));
  })()`, { timeoutMs: 120000 });
}

// Runs `body`, then, however it ends (error or Ctrl+C), navigates the page back
// to plain perflayer=l5 with no other options, so neither a stripped layer nor
// a perf.<flag>=off can leak into play.
async function withPlainPageAfter(cdp, body) {
  const restore = async () => {
    try {
      await Promise.race([
        navigateWithOptions(cdp, ['perflayer=l5']),
        sleep(5000).then(() => { throw new Error('timed out'); }),
      ]);
    } catch (error) {
      console.log(`could not send the page back to perflayer=l5 (${error.message}); reload it without ?perflayer or perf.* options before playing`);
    }
  };
  let interrupted = false;
  const onSigint = () => {
    if (interrupted) return;
    interrupted = true;
    console.log('interrupted: restoring perflayer=l5');
    restore().finally(() => process.exit(130));
  };
  process.on('SIGINT', onSigint);
  try {
    return await body();
  } finally {
    process.removeListener('SIGINT', onSigint);
    await restore();
  }
}

// Resolve every checkpoint before any window, so a typo fails in seconds and
// not after an hour of stops. Returns the runnable plan rows.
async function resolveAgainstSaves(cdp, plan) {
  await freshPage(cdp, await gameUrl(cdp, ['perflayer=l5']));
  const { runnable, aborted, pendingSkipped } = resolvePlan(plan, await listSaveNames(cdp), CHECKPOINT_PREFIX);
  for (const name of pendingSkipped) console.log(`skipping pending checkpoint "${name}" (its save does not exist yet)`);
  for (const a of aborted) {
    console.log(`ABORTING set "${a.set}": no checkpoint ${a.missing.map((m) => `"${m}"`).join(', ')}; available: ${a.available.join(', ') || '(none)'}`);
  }
  if (!runnable.length) throw new Error('nothing to run');
  return runnable;
}

// The ladder. Each rung needs its own page (the layer is read at boot), and
// `load` reboots the page anyway, so one navigation to the rung's URL serves
// both, and the windows of one (checkpoint, rung) share one load. A failed stop
// is reported and the run goes on to the next. However it ends, the page is
// sent back to perflayer=l5 so the stripped layer cannot leak into play.
async function bisect(cdp, setNames) {
  const plan = bisectPlan(loadBenchmarks(), setNames);
  return withPlainPageAfter(cdp, async () => {
    const runnable = await resolveAgainstSaves(cdp, plan);
    const failures = [];
    for (const stopPlan of planStops(runnable)) {
      const tag = `${stopPlan.set}/${stopPlan.checkpoint} l${stopPlan.rung}`;
      try {
        console.log(`[${new Date().toLocaleTimeString()}] ${tag}: boot at the rung, load, enter VR`);
        const state = await load(cdp, stopPlan.checkpoint, {
          url: await gameUrl(cdp, [`perflayer=l${stopPlan.rung}`]),
          expectLayer: stopPlan.rung,
        });
        // Before Enter VR: a wrong layer wastes the whole stop, so find out now.
        if (state.perflayer !== stopPlan.rung) throw new Error(`page reports perflayer l${state.perflayer}, wanted l${stopPlan.rung}`);
        await enterVrOrWait(cdp);
        await sleep(10000);
        for (const window of stopPlan.windows) {
          if (window === 'walk') console.log('WALK now: nothing scripts movement, the wearer walks for this window');
          const label = `${ROUND}-bisect-${stopPlan.set}-${stopPlan.checkpoint}-l${stopPlan.rung}-${window}`;
          await measureWindow(cdp, label, WINDOW_SECONDS[window], { rung: stopPlan.rung, set: stopPlan.set, checkpoint: stopPlan.checkpoint, window });
        }
      } catch (error) {
        console.log(`FAILED ${tag}: ${error.message || error}`);
        failures.push(tag);
      }
    }
    if (failures.length) console.log(`failed stops: ${failures.join('; ')}`);
    console.log(formatAttribution(attributeRungs(readRecords(), TARGET_P90_MS, runnable), TARGET_P90_MS));
  });
}

// The wave round (perf-wave.js). Same shape as bisect: one boot per stop with
// that stop's URL options (perflayer=l5 plus perf.<id>=on|off for every flag),
// load, enter VR, settle 10 s, measure. A failed stop is reported and the run
// goes on to the next.
async function wave(cdp, flagList, worstSet) {
  const flags = normalizeFlags(flagList);
  const plan = wavePlan(loadBenchmarks(), flags, worstSet);
  return withPlainPageAfter(cdp, async () => {
    const runnable = await resolveAgainstSaves(cdp, plan);
    const failures = [];
    for (const stopPlan of waveStops(runnable)) {
      const what = stopPlan.phase === 'suite' ? 'suite' : `${stopPlan.phase} perf.${stopPlan.flag}=${stopPlan.flags[stopPlan.flag]}`;
      const tag = `${stopPlan.set}/${stopPlan.checkpoint} ${what}`;
      try {
        const options = stopOptions(stopPlan);
        console.log(`[${new Date().toLocaleTimeString()}] ${tag}: boot with ${options.join(' ')}, load, enter VR`);
        const state = await load(cdp, stopPlan.checkpoint, { url: await gameUrl(cdp, options) });
        // Before Enter VR: a page that lost its options wastes the whole stop.
        const search = new URLSearchParams(state.search || '');
        for (const option of options.slice(1)) {
          const [key, value] = option.split('=');
          if (search.get(key) !== value) throw new Error(`page URL has ${key}=${search.get(key)}, wanted ${value}`);
        }
        await enterVrOrWait(cdp);
        await sleep(10000);
        for (const window of stopPlan.windows) {
          if (window === 'walk') console.log('WALK now: nothing scripts movement, the wearer walks for this window');
          else if (stopPlan.phase !== 'suite') console.log('STAND still at the load spot, same view: A/B/A compares like with like only from one place');
          const suffix = stopPlan.phase === 'suite' ? 'suite' : `${stopPlan.flag}-${stopPlan.phase}`;
          const label = `${ROUND}-wave-${stopPlan.set}-${stopPlan.checkpoint}-${suffix}-${window}`;
          await measureWindow(cdp, label, WINDOW_SECONDS[window], {
            set: stopPlan.set, checkpoint: stopPlan.checkpoint, window, flags: stopPlan.flags, phase: stopPlan.phase,
            ...(stopPlan.flag !== undefined ? { flag: stopPlan.flag } : {}),
          });
        }
      } catch (error) {
        console.log(`FAILED ${tag}: ${error.message || error}`);
        failures.push(tag);
      }
    }
    if (failures.length) console.log(`failed stops: ${failures.join('; ')}`);
    console.log(formatAba(readRecords(), flags));
  });
}

async function main() {
  if (command === 'summary') return summary();
  if (command === 'attribution') return attribution();
  if (command === 'note') return note(rest);
  if (command === 'bisect' && DRY) {
    if (!rest[0]) throw new Error('usage: perf-round.js bisect <set|all> --dry');
    return console.log(formatPlan(bisectPlan(loadBenchmarks(), rest)));
  }
  if (command === 'wave') {
    if (!rest[0] || !WORST) throw new Error('usage: perf-round.js wave <flag,...> --worst <set> [--dry]');
    // Build the plan before any CDP, so a bad flag or set name fails here.
    const plan = wavePlan(loadBenchmarks(), rest[0], WORST);
    if (DRY) return console.log(formatWavePlan(plan));
  }
  const cdp = await connect();
  try {
    if (command === 'load' && rest[0]) return await load(cdp, rest[0]);
    if (command === 'window' && rest[0]) return await measureWindow(cdp, rest[0], Number(rest[1] || 60));
    if (command === 'trace' && rest[0]) return await traceWindow(cdp, rest[0], Number(rest[1] || 20));
    if (command === 'stop' && rest[0]) return await stop(cdp, rest[0], rest[1]);
    if (command === 'enter-vr') return await enterVr(cdp);
    if (command === 'state') return console.log(JSON.stringify(await cdp.evaluate(STATE), null, 1));
    if (command === 'reload') return await reload(cdp, rest);
    if (command === 'bisect' && rest[0]) return await bisect(cdp, rest);
    if (command === 'wave') return await wave(cdp, rest[0], WORST);
    if (command === 'checkpoint' && rest[0]) return await checkpoint(cdp, rest.join(' '));
    throw new Error('usage: perf-round.js stop <checkpoint> [tag] | load <checkpoint> | enter-vr | window <label> <seconds> | trace <label> <seconds> | state | reload [k=v ...] | summary | bisect <set|all> [--dry] | note <text...> | checkpoint <name> | attribution [--budget <ms>] | wave <flag,...> --worst <set> [--dry]');
  } finally {
    cdp.close();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message || error); process.exit(1); });
}

module.exports = { REOPEN_OVERLAY };
