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
 *   node tools/vr-emulator/perf-round.js bisect <set|all>
 *   node tools/vr-emulator/perf-round.js note <text...>
 *   node tools/vr-emulator/perf-round.js checkpoint <name>
 *   node tools/vr-emulator/perf-round.js attribution [--budget <ms>]
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
 * perf-benchmarks.json: per rung it reloads with the layer, loads the
 * checkpoint, enters VR, settles 10 s and measures 60 s windows. Every
 * checkpoint is resolved against the saves first, and a set with one missing is
 * dropped whole before anything runs. The `walk` windows rely on the wearer
 * walking, as in `stop`; nothing scripts movement. `attribution` (no CDP) reads
 * the round's records and prints which rung first went over budget and which
 * stage (sim, render, gpu, runtime) dominated there. `note` records what Allen
 * reads off the Virtual Desktop overlay; `checkpoint` saves the current game
 * under the VRPT prefix so a stop can be loaded later.
 */
const fs = require('fs');
const path = require('path');
const { CdpSession, findPageTarget } = require('./cdp');
const { captureTrace, analyzeTrace } = require('./perf-trace');
const {
  bisectPlan, resolvePlan, attributeRungs, formatAttribution,
  WINDOW_SECONDS, TARGET_HZ, TARGET_P90_MS, TARGET_P99_MS,
} = require('./perf-bisect');

const CHECKPOINT_PREFIX = 'VRPT-20260824-E2E';
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value;
};
const PORT = Number(opt('--port', process.env.KOTOR2VR_CDP_PORT || 9422));
const ROUND = opt('--round', 'r1');
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
async function freshPage(cdp) {
  const url = await cdp.evaluate('location.origin + location.pathname + location.search');
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

async function load(cdp, name) {
  await freshPage(cdp);
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
  await cdp.evaluate(`(() => { window.KotOR.GameState.MenuManager.InGameOverlay.open(); return true; })()`);
  await sleep(1500);
  const state = await cdp.evaluate(STATE);
  console.log(`loaded "${name}" from ${loaded.directory}`);
  console.log(JSON.stringify(state));
  const prefix = String(state.module || '').slice(0, 3).toLowerCase();
  if (!String(state.room || '').toLowerCase().startsWith(prefix)) {
    console.log(`WARNING: player room ${state.room} does not look like part of ${state.module}`);
  }
  if (state.engineMode !== 1) {
    console.log(`WARNING: engineMode=${state.engineMode}, want 1 (INGAME); input may be suppressed`);
  }
}

// `extra` ({rung, set, checkpoint, window}) comes from bisect and is written into
// the record beside targetHz, so attribution can group the lines by rung.
async function measureWindow(cdp, label, seconds, extra = {}) {
  // Auto-reporting restarts the window every 60 s, which would split a long
  // window and leave report() describing only its tail. Hold it off for the
  // window and restore it after.
  const before = await cdp.evaluate(STATE);
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
  const { rung, set, checkpoint, window } = extra;
  const record = {
    at: new Date().toISOString(), round: ROUND, label, seconds,
    ...(rung !== undefined ? { rung } : {}),
    ...(set !== undefined ? { set } : {}),
    ...(checkpoint !== undefined ? { checkpoint } : {}),
    ...(window !== undefined ? { window } : {}),
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
    `heap ${rpt.jsHeapMB}  trustworthy=${cad.integrity ? cad.integrity.trustworthy : "n/a"}  ${r.before.presenting ? 'stereo' : 'MONO'}  ${verdict} (target ${TARGET_HZ} Hz: p90<=${TARGET_P90_MS} p99<=${TARGET_P99_MS})`,
  ].join(' | ');
}

async function navigateWithOptions(cdp, options) {
  const params = new URLSearchParams('key=tsl&assets=/assets');
  for (const option of options) {
    const [key, value] = option.split('=');
    if (!key || value === undefined) throw new Error(`reload options are key=value, got "${option}"`);
    params.set(key, value);
  }
  const url = `${await cdp.evaluate('location.origin')}/game/index.html?${params}`;
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
  await cdp.evaluate(`(() => { window.KotOR.GameState.MenuManager.InGameOverlay.open(); return true; })()`);
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
    await cdp.evaluate(`(() => { window.KotOR.GameState.MenuManager.InGameOverlay.open(); return true; })()`);
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
  if (!saved) throw new Error(`saving "${name}" did not complete (a save may already be in progress)`);
  console.log(`saved "${CHECKPOINT_PREFIX} ${name}"`);
}

function attribution() {
  const budgetMs = Number(opt('--budget', TARGET_P90_MS));
  const records = readRecords();
  if (!records.length) return console.log(`no records at ${EVIDENCE}; run bisect <set|all> for round "${ROUND}" first`);
  console.log(formatAttribution(attributeRungs(records, budgetMs), budgetMs));
}

async function listSaveNames(cdp) {
  return cdp.evaluate(`(async () => {
    const K = window.KotOR;
    await K.SaveGame.GetSaveGames();
    return K.SaveGame.saves.map((s) => String((s.getSaveName && s.getSaveName()) || s.SAVEGAMENAME || ''));
  })()`, { timeoutMs: 120000 });
}

// The ladder. Each rung needs its own page (the layer is read at boot), and
// `load` reboots the page anyway, so the windows of one (checkpoint, rung) share
// one load. A failed stop is reported and the run goes on to the next.
async function bisect(cdp, setNames) {
  const benchmarks = JSON.parse(fs.readFileSync(path.join(__dirname, 'perf-benchmarks.json'), 'utf8'));
  const plan = bisectPlan(benchmarks, setNames);

  // Resolve every checkpoint before any window, so a typo fails in seconds and
  // not after an hour of rungs.
  await freshPage(cdp);
  const { runnable, aborted, pendingSkipped } = resolvePlan(plan, await listSaveNames(cdp), CHECKPOINT_PREFIX);
  for (const name of pendingSkipped) console.log(`skipping pending checkpoint "${name}" (not created yet)`);
  for (const a of aborted) {
    console.log(`ABORTING set "${a.set}": no checkpoint ${a.missing.map((m) => `"${m}"`).join(', ')}; available: ${a.available.join(', ') || '(none)'}`);
  }
  if (!runnable.length) throw new Error('nothing to run');

  const stops = [];
  for (const row of runnable) {
    const last = stops[stops.length - 1];
    if (last && last.set === row.set && last.checkpoint === row.checkpoint && last.rung === row.rung) last.windows.push(row.window);
    else stops.push({ set: row.set, checkpoint: row.checkpoint, rung: row.rung, windows: [row.window] });
  }

  const failures = [];
  for (const s of stops) {
    const tag = `${s.set}/${s.checkpoint} l${s.rung}`;
    try {
      console.log(`[${new Date().toLocaleTimeString()}] ${tag}: reload, load, enter VR`);
      await navigateWithOptions(cdp, [`perflayer=l${s.rung}`]);
      await sleep(3000);
      await load(cdp, s.checkpoint);
      await enterVrOrWait(cdp);
      const echoed = (await cdp.evaluate(STATE)).perflayer;
      if (echoed !== s.rung) throw new Error(`page reports perflayer l${echoed}, wanted l${s.rung}`);
      await sleep(10000);
      for (const window of s.windows) {
        if (window === 'walk') console.log('WALK now: nothing scripts movement, the wearer walks for this window');
        const label = `${ROUND}-bisect-${s.set}-${s.checkpoint}-l${s.rung}-${window}`;
        await measureWindow(cdp, label, WINDOW_SECONDS[window], { rung: s.rung, set: s.set, checkpoint: s.checkpoint, window });
      }
    } catch (error) {
      console.log(`FAILED ${tag}: ${error.message || error}`);
      failures.push(tag);
    }
  }
  if (failures.length) console.log(`failed stops: ${failures.join('; ')}`);
  console.log(formatAttribution(attributeRungs(readRecords(), TARGET_P90_MS), TARGET_P90_MS));
}

async function main() {
  if (command === 'summary') return summary();
  if (command === 'attribution') return attribution();
  if (command === 'note') return note(rest);
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
    if (command === 'checkpoint' && rest[0]) return await checkpoint(cdp, rest.join(' '));
    throw new Error('usage: perf-round.js stop <checkpoint> [tag] | load <checkpoint> | enter-vr | window <label> <seconds> | trace <label> <seconds> | state | reload [k=v ...] | summary | bisect <set|all> | note <text...> | checkpoint <name> | attribution [--budget <ms>]');
  } finally {
    cdp.close();
  }
}

main().catch((error) => { console.error(error.message || error); process.exit(1); });
