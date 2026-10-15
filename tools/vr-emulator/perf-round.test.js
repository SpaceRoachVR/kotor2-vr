const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
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
