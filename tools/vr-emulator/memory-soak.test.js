const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { parseArgs, summarizeReadings, validateSample, compareParty, configureParty, saveReload } = require('./memory-soak');

test('fresh T3 possession is returned to the Exile before removing companions', async () => {
  const exile = { getTag: () => 'exile', getTemplateResRef: () => 'player', model: {}, isPlayer: true, npcId: -1 };
  const t3 = { npcId: 8, isPlayer: false };
  const pm = { Player: t3, party: [t3], MakePlayerLeader() {},
    SwitchPlayerCharacter(id) { assert.equal(id, -1); this.Player = exile; this.party = [exile]; },
    GetPartyMemberByNPCId(id) { return this.party.find(p => p.npcId === id); },
    RemoveNPCById() { assert.fail('must not remove the controlled player'); } };
  const context = { window: { KotOR: { PartyManager: pm, GameState: { PartyManager: pm, getCurrentPlayer: () => pm.party[0] } } } };
  const harness = { evaluate: script => vm.runInNewContext(script, context),
    waitFor: script => { assert.equal(vm.runInNewContext(script, context), true); } };
  const result = await configureParty(harness, false);
  assert.equal(result.party.length, 1);
  assert.equal(result.player.tag, 'exile');
});

test('soak arguments reject incomplete or unsafe configurations', () => {
  assert.equal(parseArgs([]).cycles, 10);
  assert.equal(parseArgs(['--profile']).profile, true);
  assert.deepEqual(parseArgs(['--modules', '101per,106per']).modules, ['101PER', '106PER']);
  for (const args of [['--cycles', '0'], ['--cycles', '1.2'], ['--modules', '../bad'],
    ['--modules', '101per,101per'], ['--port', '65536'], ['--unknown'], ['--out']]) {
    assert.throws(() => parseArgs(args));
  }
});

const member = (tag, npcId = -1) => ({ found: true, tag, npcId, resRef: tag, id: 10, type: 9, modelFound: true });
const sample = (cycle, module = '101PER', partyMode = 'solo', operation = 'transition') => ({
  cycle, module, partyMode, operation, moduleFound: true, ready: true, loading: false,
  xrPresenting: true, advancedFrames: 11, party: [member('exile')], player: member('exile'),
  heapMb: 100 + cycle, geometries: 10, textures: 20, loadMs: 1000, staleWaypointHelpers: 0, staleEncounterMeshes: 0,
});

test('samples fail closed on absent modules, stalled XR, missing party models and wrong module', () => {
  validateSample(sample(1), '101PER');
  for (const patch of [{ moduleFound: false }, { ready: false }, { loading: true },
    { xrPresenting: false }, { advancedFrames: 0 }, { party: [] }, { heapMb: NaN }, { staleEncounterMeshes: 1 },
    { party: [member('exile'), { ...member('t3', 8), modelFound: false }] }]) {
    assert.throws(() => validateSample({ ...sample(1), ...patch }, '101PER'));
  }
  assert.throws(() => validateSample(sample(1), '102PER'));
});

test('save reload identity compares roster and controlled character, not regenerated object IDs', () => {
  const a = { party: [member('exile'), member('t3', 8)], player: member('exile') };
  const b = JSON.parse(JSON.stringify(a));
  b.party[0].id = 55;
  compareParty(a, b);
  assert.throws(() => compareParty(a, { ...b, party: [member('exile')] }));
  assert.throws(() => compareParty(a, { ...b, player: member('t3', 8) }));
  assert.throws(() => compareParty(a, { ...b, controlled: member('t3', 8) }));
});

test('warm growth compares matching module, operation and actual party identity', () => {
  const rows = [sample(1), sample(2), sample(3), sample(4), sample(5),
    { ...sample(6), party: [member('exile'), member('t3', 8)] },
    sample(1, '102PER'), sample(1, '101PER', 'solo', 'reload')];
  const groups = summarizeReadings(rows);
  const stable = groups.find(g => g.samples === 5);
  assert.equal(stable.warmIntervals, 3);
  assert.equal(stable.heapDeltaMb, 3);
  assert.equal(stable.heapMbPerVisit, 1);
  assert.equal(stable.geometryDelta, 0);
  assert.equal(groups.length, 4);
  assert.equal(groups.find(g => g.samples === 1).heapMbPerVisit, null);
});

test('save reload uses only the exact overwritten slot and awaits requested module readiness', async () => {
  const player = { getTag: () => 'exile', getTemplateResRef: () => 'player', model: {}, npcId: -1 };
  const pm = { party: [player], Player: player };
  const gs = { PartyManager: pm, getCurrentPlayer: () => pm.party[0], loadingModule: false,
    module: { filename: '106PER', readyToProcessEvents: true, area: {} } };
  let loadCount = 0, readyChecks = 0;
  const save = { getSaveNumber: () => 2, getLastModule: () => '106per',
    async load() { loadCount++; gs.loadingModule = true; gs.module.readyToProcessEvents = false; } };
  const saves = { saves: [save], async SaveCurrentGame(name, id) { assert.equal(id, 2); } };
  const context = { window: { KotOR: { SaveGame: saves, GameState: gs } } };
  const harness = { evaluate: script => vm.runInNewContext(script, context),
    waitFor(script) {
      assert.equal(vm.runInNewContext(script, context), false);
      gs.loadingModule = false; gs.module.readyToProcessEvents = true;
      assert.equal(vm.runInNewContext(script, context), true);
      readyChecks++;
    } };
  await saveReload(harness, '106PER');
  assert.equal(loadCount, 1);
  assert.equal(readyChecks, 1);
  saves.saves = [];
  await assert.rejects(saveReload(harness, '106PER'), /not uniquely located/);
  saves.saves = [save, save];
  await assert.rejects(saveReload(harness, '106PER'), /not uniquely located/);
  saves.saves = [save];
  await assert.rejects(saveReload(harness, '101PER'), /module mismatch/);
  assert.equal(loadCount, 1);
});
