const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { parseArgs, loadModule, landed, SAMPLE, runtimeFailures } = require('./probe-memory-growth');

test('a broken XR update cannot be mistaken for stable memory', () => {
  const failures = runtimeFailures([
    { level: 'error', text: "HTTP 404 for swkotor2.ini" },
    { level: 'error', text: "TypeError: a saved NPC action could not be restored" },
    { level: 'error', text: '[VRSpike] frame failed' },
  ], ['uncaught exception']);
  assert.deepEqual(failures, ['uncaught exception', '[VRSpike] frame failed']);
});

test('validates memory probe arguments and normalizes module names', () => {
  assert.deepEqual(parseArgs(['--modules', '101per,102per', '--cycles', '2']).modules, ['101PER', '102PER']);
  for (const argv of [['--cycles', '0'], ['--cycles', 'NaN'], ['--cycles', '1.5'],
    ['--modules', ''], ['--modules', '../101PER'], ['--hold', '-1'], ['--out'], ['--unknown']]) {
    assert.throws(() => parseArgs(argv));
  }
});

test('a load is rejected while another module transition is active', async () => {
  const GameState = { loadingModule: true, LoadModule: () => assert.fail('must not overlap a load') };
  await assert.rejects(vm.runInNewContext(loadModule('101PER'), { window: { KotOR: { GameState } } }), /already loading/i);
});

test('completion requires the requested module and surfaces load failure', () => {
  const context = { window: { KotOR: { GameState: {
    module: { filename: '102PER', readyToProcessEvents: true, area: {} }, loadingModule: false,
  } }, __memoryProbeLoad: { module: '101PER', error: null } } };
  assert.equal(vm.runInNewContext(landed, context), false);
  context.window.KotOR.GameState.module.filename = '101PER';
  assert.equal(vm.runInNewContext(landed, context), true);
  context.window.__memoryProbeLoad.error = 'load failed';
  assert.throws(() => vm.runInNewContext(landed, context), /load failed/);
});

test('sample reports mesh count and the identity of the located module', () => {
  const mesh = { isMesh: true };
  const points = { isPoints: true, geometry: {} };
  const context = { performance: { memory: { usedJSHeapSize: 1048576 } }, window: { KotOR: {
    GameState: { module: { filename: '101PER' }, PartyManager: {}, renderer: { xr: { isPresenting: true }, info: { render: { frame: 42 }, memory: { geometries: 2, textures: 1 } } },
      scene: { traverse: fn => { fn(mesh); fn(points); } } }, TextureLoader: { textures: new Map() },
    ResourceLoader: { CacheScopes: {} }, PartyManager: { party: [] },
  } } };
  const result = vm.runInNewContext(SAMPLE, context);
  assert.equal(result.sceneMeshes, 1);
  assert.equal(result.moduleFound, true);
  assert.equal(result.module, '101PER');
  assert.equal(result.xrPresenting, true);
  assert.equal(result.renderFrame, 42);
  assert.equal(result.player.found, false);
});

test('sample reports player identity and effect counts without retaining the player', () => {
  class VisualEffect {}
  const player = { getTemplateResRef: () => 'p_t3m4', getTag: () => 'T3M4', id: 208, objectType: 9,
    effects: [new VisualEffect(), new VisualEffect()], inventory: [{}] };
  const context = { window: { KotOR: { GameState: { renderer: { xr: {}, info: { render: {} } },
    PartyManager: { Player: player } } } } };
  const result = vm.runInNewContext(SAMPLE, context);
  assert.equal(result.player.found, true);
  assert.equal(result.player.resRef, 'p_t3m4');
  assert.equal(result.player.effects.VisualEffect, 2);
  assert.equal(result.player.inventory, 1);
  assert.equal(result.moduleFound, false);
});

test('sample tracks uncached continuations and helper ownership without retaining VM objects', () => {
  const cached = { name: 'cached' };
  const oldRoom = {};
  const currentRoom = {};
  const context = { window: { KotOR: {
    NWScript: { scripts: new Map([['cached', cached]]), NWScriptInstanceMap: new Map([
      ['live', { isStoreState: false, nwscript: cached }],
      ['cached-state', { isStoreState: true, nwscript: cached }],
      ['uncached-state', { isStoreState: true, nwscript: { name: 'continuation' } }],
    ]) },
    GameState: { module: { area: { rooms: [{ model: currentRoom }] } },
      renderer: { xr: {}, info: { render: {} } }, PartyManager: {},
      group: { waypoints: { children: [{ userData: { area: oldRoom } }, { userData: { area: currentRoom } }] } },
    },
  } } };
  const result = vm.runInNewContext(SAMPLE, context);
  assert.equal(result.scriptInstances, 3);
  assert.equal(result.uncachedScriptSituations, 1);
  assert.equal(result.waypointHelpers, 2);
  assert.equal(result.staleWaypointHelpers, 1);
});
