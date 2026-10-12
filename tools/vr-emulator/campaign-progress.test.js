const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { parseArgs } = require('./playthrough');
const { CAMPAIGN_PROGRESS, assertCampaignMilestone, selectObjectAtPlacement, evaluateCampaignAcceptance, getEbonSecurityDoorApproach, getMedbayCombatCornerRecovery } = require('./campaign-progress');
const { ROUTES, equipT3IonStriker } = require('./playthrough-peragus');

test('progression reads saved BYTE availability as well as live boolean availability', () => {
  for (const available of [true, false, 1, 0]) {
    const player = {id:208, tag:'T3M4', npcId:8, position:{x:0,y:0,z:0}};
    const snapshot = vm.runInNewContext(CAMPAIGN_PROGRESS, {window:{KotOR:{
      GameState:{module:{area:{name:'103per',creatures:[]},readyToProcessEvents:true},
        GlobalVariableManager:{Globals:{Number:new Map()}},Mode:1},
      PartyManager:{party:[player],NPCS:{8:{available,spawned:available}}},
      JournalManager:{Entries:[]},VRSpike:{isPresenting:true},
    }}});
    assert.equal(snapshot.roster[0].available, available === true || available === 1);
    assert.equal(snapshot.roster[0].spawned, available === true || available === 1);
    if (available) assert.doesNotThrow(() => assertCampaignMilestone('t3-fuel-depot',snapshot));
    else assert.throws(() => assertCampaignMilestone('t3-fuel-depot',snapshot), /not registered/);
  }
});

test('T3 ion equipment uses menu controls, verifies the slot, and returns to gameplay', async () => {
  const answers = [{located:true,tag:'T3M4'}, {ok:true}, {ok:true},
    {ok:true,item:'Droid Ion Striker'}, {closed:['MenuEquipment'],mode:1}];
  const waits = [];
  const harness = { evaluate: async () => {
    assert.ok(answers.length, 'unexpected engine operation');
    return answers.shift();
  }, waitFor: async (expression) => { waits.push(expression); } };
  assert.deepEqual(await equipT3IonStriker(harness), {ok:true,item:'Droid Ion Striker'});
  assert.equal(answers.length, 0);
  assert.equal(waits.length, 2);
  assert.match(waits[1], /LEFTARMBAND/);
});

test('missing ion equipment blocks before claiming a successful equip', async () => {
  const answers = [{located:true,tag:'T3M4'}, {ok:true}, {ok:true},
    {ok:false,reason:'item not offered'}];
  let waits = 0;
  const harness = {evaluate: async () => answers.shift(), waitFor: async () => { waits += 1; }};
  await assert.rejects(equipT3IonStriker(harness), /ion equipment: item not offered/);
  assert.equal(waits, 1);
});

test('the hangar ramp route crosses the landing without cutting the void between ramps', () => {
  const route = ROUTES.ROUTE_STORAGE_TO_SUBLEVEL;
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1];
    const to = route[index];
    const samples = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) * 2);
    for (let step = 0; step <= samples; step += 1) {
      const fraction = step / samples;
      const x = from.x + (to.x - from.x) * fraction;
      const y = from.y + (to.y - from.y) * fraction;
      // Interior of the nonwalkable space separating 106PER18 and 106PER20.
      assert.equal(x > -26.8 && x < -18.5 && y > 84 && y < 105, false,
        `route leg ${index} crosses the ramp void at ${x},${y}`);
    }
  }
  assert.deepEqual(ROUTES.ROUTE_SUBLEVEL_TO_STORAGE, [...route].reverse());
});

function progress(overrides = {}) {
  return { found: true, module: '101per', presenting: true, ready: true, mode: 1,
    player: { found: true, tag: 'Exile', npcId: -1 },
    companions: [{ tag: 'Kreia' }, { tag: 'Atton' }],
    globals: { '101PER_Kreia_Spawn': { found: true, value: 2 },
      '101PER_Talk_Kreia': { found: true, value: 1 },
      '101PER_Know_Adm_Code': { found: true, value: 1 } },
    journal: [{ tag: 'RecoverEbonHawk', state: 10 }], roster: [], ...overrides };
}

test('the fuel depot route leaves the north end of the central ramp before turning west', () => {
  const route = ROUTES.ROUTE_STORAGE_TO_FUEL_DEPOT_DOOR;
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1], to = route[index];
    const samples = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) * 4);
    for (let step = 0; step <= samples; step += 1) {
      const t = step / samples;
      const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t;
      assert.equal(x < -2.84 && x > -3.65 && y < 56.3 && y > 41.66, false,
        `leg ${index} crosses the central ramp wall at ${x},${y}`);
    }
  }
});

test('T3 reaches fuel control on the upper deck without dropping onto overlapping lower corridors', () => {
  const route = ROUTES.ROUTE_T3_TO_FUEL_CONTROL;
  assert.ok(Array.isArray(route) && route.length > 2, 'fuel control needs an upper-deck approach');
  for (const point of route) assert.ok(Math.abs(point.z - 22.4) < 0.1, 'route left the upper deck');
  // The corridor bends west at its southern end before turning back east
  // toward the console; cutting directly south from the arrival hits a wall.
  assert.ok(route.some(point => point.x < -37 && point.y > 12 && point.y < 18), 'route skipped the corridor bend');
  assert.ok(Math.hypot(route.at(-1).x + 28.4, route.at(-1).y - 1.4) < 0.5);
});

test('acceptance requires the fresh authored prologue and validates its target', () => {
  const args = parseArgs(['--acceptance', '--until', 't3-fuel-depot']);
  assert.equal(args.acceptance, true);
  assert.equal(args.until, 't3-fuel-depot');
  assert.equal(args.resume, null);
  assert.throws(() => parseArgs(['--acceptance', '--resume', 'levelled']), /fresh game/);
  assert.throws(() => parseArgs(['--acceptance', '--prologue-route', 'skip']), /authored prologue/);
  assert.throws(() => parseArgs(['--until']), /checkpoint/);
  assert.throws(() => parseArgs(['--until', 'invented']), /checkpoint/);
  assert.throws(() => parseArgs(['--acceptance']), /explicit --until/);
});

test('acceptance fails closed on partial, resumed, retried, or exception-bearing evidence', () => {
  const report = { acceptance: true, bootstrap: { freshGame: true, loadedFromSave: false, prologueRoute: 'continue', servingBundleSha256: 'a'.repeat(64) },
    target: 't3-fuel-depot', targetReached: true, blocked: null,
    passes: [{ resume: null }], steps: [{ ok: true }], pageErrors: [], vrLoopFailures: [], finalXrFrames: 10 };
  assert.deepEqual(evaluateCampaignAcceptance(report), { passed: true, failures: [] });
  for (const change of [{ targetReached: false }, { passes: [{ resume: 'levelled' }] },
    { passes: [{ resume: null }, { resume: 'levelled' }] }, { steps: [{ ok: true, retriedAfterDeath: true }] },
    { pageErrors: ['exception'] }, { pageErrors: undefined }, { vrLoopFailures: ['XR failure'] },
    { finalXrFrames: 0 }, { blocked: { step: 'Kreia' } },
    { bootstrap: { freshGame: true, loadedFromSave: false, prologueRoute: 'skip' } }]) {
    assert.equal(evaluateCampaignAcceptance({ ...report, ...change }).passed, false, JSON.stringify(change));
  }
  assert.equal(evaluateCampaignAcceptance(null).passed, false);
});

test('Kreia awakening requires the live creature, both globals, and the authored quest update', () => {
  assert.doesNotThrow(() => assertCampaignMilestone('kreia-awakened', progress()));
  assert.throws(() => assertCampaignMilestone('kreia-awakened', progress({ companions: [] })), /Kreia not found/);
  assert.throws(() => assertCampaignMilestone('kreia-awakened', progress({ journal: [] })), /journal state 10/);
  assert.throws(() => assertCampaignMilestone('kreia-awakened', progress({ globals: {} })), /declared/);
  assert.throws(() => assertCampaignMilestone('kreia-awakened', progress({ globals: {
    '101PER_Kreia_Spawn': { found: true, value: 1 },
  } })), /Kreia_Spawn=2/);
});

test('Atton must actually grant the administration code rather than merely expose a reply', () => {
  assert.doesNotThrow(() => assertCampaignMilestone('atton-freed', progress()));
  assert.throws(() => assertCampaignMilestone('atton-freed', progress({ globals: {
    '101PER_Switch': { found: true, value: 1 },
    '101PER_Know_Adm_Code': { found: true, value: 0 },
  } })), /Know_Adm_Code=1/);
  assert.throws(() => assertCampaignMilestone('atton-freed', progress({ companions: [{ tag: 'Kreia' }] })), /Atton not found/);
});

test('fuel depot arrival requires the correct module and registered, controlled T3-M4', () => {
  const arrived = progress({ module: '103per', player: { found: true, tag: 't3m4', npcId: 8 },
    roster: [{ id: 8, available: true }] });
  assert.doesNotThrow(() => assertCampaignMilestone('t3-fuel-depot', arrived));
  assert.throws(() => assertCampaignMilestone('t3-fuel-depot', { ...arrived, module: '106per' }), /expected 103per/);
  assert.throws(() => assertCampaignMilestone('t3-fuel-depot', { ...arrived, player: { found: true, tag: 't3m4', npcId: 0 } }), /controlled/);
  assert.throws(() => assertCampaignMilestone('t3-fuel-depot', { ...arrived, roster: [] }), /registered/);
});

test('a missing subject, inactive XR session, or loading module cannot pass progression', () => {
  assert.throws(() => assertCampaignMilestone('atton-freed', null), /not located/);
  for (const override of [{ found: false }, { presenting: false }, { ready: false }, { mode: 3 }]) {
    assert.throws(() => assertCampaignMilestone('atton-freed', progress(override)));
  }
  assert.throws(() => assertCampaignMilestone('invented', progress()), /unsupported/);
});

test('the hatch and mining tunnels require the authored ambush, hatch unlock, and Exile control', () => {
  for (const [name, module] of [['hatch-opened', '101per'], ['mining-tunnels', '102per']]) {
    const snapshot = progress({ module,
      // The generated protagonist has an empty retail Tag; identity comes
      // from ModulePlayer and the non-companion roster slot, not the name.
      player: { found: true, tag: '', npcId: -1, isPlayer: true },
      party: [{ found: true, id: 2147483647, npcId: -1, isPlayer: true }],
      globals: { '103PER_T3_Ambush': { found: true, value: 2 },
        '101PER_Open_Hatch': { found: true, value: 1 } } });
    assert.doesNotThrow(() => assertCampaignMilestone(name, snapshot));
    for (const party of [undefined, [], [...snapshot.party, { found: true, tag: 'T3M4', npcId: 8 }]]) {
      assert.throws(() => assertCampaignMilestone(name, { ...snapshot, party }), /solo Exile/);
    }
    assert.throws(() => assertCampaignMilestone(name, { ...snapshot, globals: {
      ...snapshot.globals, '103PER_T3_Ambush': { found: true, value: 1 },
    } }), /103PER_T3_Ambush=2/);
    for (const key of ['103PER_T3_Ambush', '101PER_Open_Hatch']) {
      for (const global of [undefined, { found: false, value: 1 }, { found: true, value: 0 }]) {
        assert.throws(() => assertCampaignMilestone(name, { ...snapshot,
          globals: { ...snapshot.globals, [key]: global } }), /expected declared/);
      }
    }
    for (const player of [null, { ...snapshot.player, found: false },
      { ...snapshot.player, isPlayer: false }, { ...snapshot.player, npcId: 8 },
      { ...snapshot.player, tag: 'T3M4' }]) {
      assert.throws(() => assertCampaignMilestone(name, { ...snapshot, player }), /Exile/);
    }
    for (const override of [{ module: '103per' }, { presenting: false }, { ready: false }, { mode: 3 }]) {
      assert.throws(() => assertCampaignMilestone(name, { ...snapshot, ...override }));
    }
  }
});

test('repeated corpse tags are resolved by their unique authored placement', () => {
  const point = { x: -28.08, y: 13, z: 9.57445 };
  const torch = { id: 7, position: { ...point } };
  const other = { id: 8, position: { x: -27.73, y: -13.9, z: 9.05 } };
  assert.equal(selectObjectAtPlacement([other, torch], point, 'torch'), torch);
  assert.throws(() => selectObjectAtPlacement([other], point, 'torch'), /found=false/);
  assert.throws(() => selectObjectAtPlacement([torch, { ...torch, id: 9 }], point, 'torch'), /exactly one/);
  assert.throws(() => selectObjectAtPlacement([], { ...point, x: NaN }, 'torch'), /finite/);
  assert.throws(() => selectObjectAtPlacement([], point, 'torch', 0), /positive/);
});

test('the second security-door approach crosses the open first doorway rather than its wall', () => {
  const first = { id: 199, open: true, position: { x: 49.7567, y: 39.7578, z: 1.805 } };
  const second = { id: 200, position: { x: 47.3369, y: 36.1489, z: 1.805 } };
  const route = getEbonSecurityDoorApproach(second, [first, second]);
  assert.deepEqual(route, [{ x: 49.7567, y: 41.0078, z: 1.805 },
    first.position, { x: 49.7567, y: 38.5078, z: 1.805 }]);
  assert.deepEqual(getEbonSecurityDoorApproach(first, [first, second]), []);
  assert.throws(() => getEbonSecurityDoorApproach(second, [{ ...first, open: false }]), /not open/);
  assert.throws(() => getEbonSecurityDoorApproach(second, []), /found=false/);
  assert.throws(() => getEbonSecurityDoorApproach(null, []), /placed target/);
});

test('medical combat recovery turns through the room interior only at the observed corner', () => {
  assert.deepEqual(getMedbayCombatCornerRecovery({ x: -20.58, y: -14.9, z: 9.06 }),
    [{ x: -25, y: -15, z: 9.06 }, { x: -24.3, y: -18.6, z: 9.06 }]);
  for (const position of [{ x: -27, y: 13, z: 9.06 }, { x: -20.58, y: -14.9, z: 0.8 },
    { x: -24, y: -15, z: 9.06 }, { x: -20, y: -22, z: 9.06 }]) {
    assert.deepEqual(getMedbayCombatCornerRecovery(position), []);
  }
  assert.throws(() => getMedbayCombatCornerRecovery({ x: NaN, y: 0, z: 0 }), /finite/);
  assert.throws(() => getMedbayCombatCornerRecovery(null), /finite/);
});
