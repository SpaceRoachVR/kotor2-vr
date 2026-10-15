const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const path = require('path');
const { spawnSync } = require('child_process');
const { REOPEN_OVERLAY } = require('./perf-round');

// A stand-in for the engine pieces REOPEN_OVERLAY touches: InGameOverlay.show()
// forces INGAME (1), as src/game/tsl/menu/InGameOverlay.ts does, and
// RestoreEnginePlayMode picks MINIGAME (2) for a minigame area, DIALOG (3) under
// a live cutscene, else INGAME, as GameState.RestoreEnginePlayMode does.
function fakeEngine({ miniGame = false, cutscene = false, mode = 2 } = {}) {
  const gs = {
    Mode: mode,
    module: { area: { miniGame: miniGame ? { type: 2 } : null } },
    CutsceneManager: { active: cutscene },
    MenuManager: { InGameOverlay: { open() { gs.Mode = 1; } } },
    RestoreEnginePlayMode() {
      if (gs.CutsceneManager.active) gs.Mode = 3;
      else gs.Mode = gs.module.area.miniGame ? 2 : 1;
    },
  };
  return { window: { KotOR: { GameState: gs } } };
}

test('reopening the overlay keeps a minigame module in MINIGAME (107PER turret)', () => {
  assert.strictEqual(vm.runInNewContext(REOPEN_OVERLAY, fakeEngine({ miniGame: true })), 2);
});

test('reopening the overlay leaves an ordinary module in INGAME', () => {
  assert.strictEqual(vm.runInNewContext(REOPEN_OVERLAY, fakeEngine({ miniGame: false })), 1);
});

test('reopening the overlay under a live cutscene keeps DIALOG', () => {
  assert.strictEqual(vm.runInNewContext(REOPEN_OVERLAY, fakeEngine({ cutscene: true })), 3);
});

test('an engine without RestoreEnginePlayMode still gets the overlay opened', () => {
  const ctx = fakeEngine({ miniGame: true });
  delete ctx.window.KotOR.GameState.RestoreEnginePlayMode;
  assert.strictEqual(vm.runInNewContext(REOPEN_OVERLAY, ctx), 1);
});

test('summaryLine prints the refresh rate the record was measured at, and where it came from', () => {
  const { summaryLine } = require('./perf-round');
  const base = { label: 'w', report: { frametimeMs: { p90: 10, p99: 12 } }, before: { module: '101per', perflayer: 5, presenting: true } };
  assert.match(summaryLine({ ...base, refreshHz: 72, refreshHzSource: 'declared' }), /target p90<=13\.9 p99<=20 @ 72 Hz \(declared\)/);
  assert.match(summaryLine({ ...base, refreshHz: 90, refreshHzSource: 'runtime' }), /@ 90 Hz \(runtime\)/);
});

// The CLI's argument handling, run as a child process. Every command here is
// --dry or fails before any CDP connection, so no browser or game is needed.
const cli = (...args) => {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'perf-round.js'), ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

test('CLI: --budget is accepted by bisect (it used to read as a set name), and a bad one is refused', () => {
  const ok = cli('bisect', 'peragus', '--budget', '12', '--dry');
  assert.strictEqual(ok.code, 0, ok.err);
  assert.match(ok.out, /peragus\/medbay-swept l0: rest/);
  const bad = cli('bisect', 'peragus', '--budget', 'abc', '--dry');
  assert.notStrictEqual(bad.code, 0);
  assert.match(bad.err, /--budget must be a finite number > 0, got "abc"/);
});

test('CLI: the conversation wave plan has rest and talk windows', () => {
  const r = cli('wave', 'perf.x', '--worst', 'conversation', '--dry');
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /conversation\/kreia-awakened suite: rest, talk/);
  assert.match(r.out, /peragus\/medbay-swept suite: rest, walk/);
});

test('CLI: wave --predicted and --baseline are checked before any CDP', () => {
  assert.strictEqual(cli('wave', 'x', '--worst', 'peragus', '--predicted', '4', '--dry').code, 0);
  const noPrediction = cli('wave', 'x', '--worst', 'peragus', '--baseline', 'r0', '--dry');
  assert.notStrictEqual(noPrediction.code, 0);
  assert.match(noPrediction.err, /--baseline needs --predicted/);
  const badPrediction = cli('wave', 'x', '--worst', 'peragus', '--predicted', 'soon', '--dry');
  assert.match(badPrediction.err, /--predicted must be a number > 0/);
  const noFile = cli('wave', 'x', '--worst', 'peragus', '--predicted', '4', '--baseline', 'no-such-round-xyz', '--dry');
  assert.match(noFile.err, /no evidence file/);
  const wrongCount = cli('wave', 'x,y', '--worst', 'peragus', '--predicted', '4,3,2', '--dry');
  assert.match(wrongCount.err, /3 values for 2 flags/);
});

test('CLI source: instrumentation is switched on in measureWindow and traceWindow, and the stop loops honour SIGINT', () => {
  const src = require('fs').readFileSync(path.join(__dirname, 'perf-round.js'), 'utf8');
  const slice = (from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
  assert.match(slice('async function measureWindow', 'async function traceWindow'), /perf\.instrument = true;\s+perf\.start\(/);
  assert.match(slice('async function traceWindow', 'function summaryLine'), /cdp\.evaluate\(INSTRUMENT_ON\)/);
  assert.match(slice('async function bisect', 'async function wave'), /planStops\(runnable\)\) \{\s+if \(interrupted\(\)\) break;/);
  assert.match(slice('async function wave', 'function waveConfirmInputs'), /waveStops\(runnable\)\) \{\s+if \(interrupted\(\)\) break;/);
});
