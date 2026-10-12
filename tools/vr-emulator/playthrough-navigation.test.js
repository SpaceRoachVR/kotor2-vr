const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { parseArgs, PROLOGUE_ROUTES } = require('./playthrough');
const {
  CHECKPOINT_ORDER,
  CHECKPOINT_PREFIX,
  MEDBAY_FIXTURE_TAGS,
  MEDBAY_MAX_NAVIGATION_ATTEMPTS,
  MEDICAL_COMPUTER_MAX_VISITS,
  GAMEPLAY_RETURN_MENU_NAMES,
  INTERMEDIATE_WAYPOINT_RANGE,
  EXTERIOR_RETURN_LIFT_ROUTE,
  EBON_GALAXY_MAP_APPROACH,
  EBON_COMMUNICATIONS_APPROACH,
  computeHeadRelativeMoveAxes,
  isWithinNavigationRange,
  navigationInputDurationMs,
  canRetryPlannedApproach,
  clearHostiles,
  chooseDroidCombatAbility,
  swingAt,
  handleNavigationAttacker,
  clearProgressBlockingDialogue,
  computeReferenceFacingFromQuaternion,
  isProgressBlockingForeground,
  dialogueTranscriptKey,
  chooseRequiredWorldAction,
  chooseExplicitWorldAction,
  inventoryQuantityByName,
  chooseRequiredDialogueScript,
  chooseRequiredDialogueText,
  createRequiredDialogueTextSequence,
  createRequiredDialogueScriptSequence,
  chooseMorgueUnlockReply,
  createMorgueUnlockChooser,
  getDisplayedReplyScriptNames,
  validateCheckpointSnapshot,
  waitForWorldPrompt,
  describeWalkmeshRoute,
  isModuleExitDoor,
} = require('./playthrough-steps');

test('droid combat prefers authored ion equipment and falls back to its unlimited shock arm', () => {
  const shock = { label: 'Droid Shock Arm' };
  const ion = { label: 'Droid Ion Blast Mark I' };
  assert.equal(chooseDroidCombatAbility([{ label: 'Attack' }, shock, ion]), ion);
  assert.equal(chooseDroidCombatAbility([shock]), shock);
  const charge = { label: 'Droid Charge Arm' };
  assert.equal(chooseDroidCombatAbility([charge]), charge);
  assert.equal(chooseDroidCombatAbility([{ label: 'Attack' }]), null);
  assert.throws(() => chooseDroidCombatAbility(null), /labelled actions/);
  assert.throws(() => chooseDroidCombatAbility([{}]), /labelled actions/);
});

test('combat bridge rejects an unsupported input before calling the engine', async () => {
  await assert.rejects(swingAt({ evaluate: () => { throw new Error('engine must not be called'); } }, 1, 'unknown'), /dominant swing or trigger/);
});

test('the combat bridge commits a queued droid ability with the trigger input', async () => {
  const inputs = [];
  const context = {actorId:'1',nominatedTargetId:'2',tempoReadiness:1,weaponMode:'blaster',
    onCombatSwing: event => inputs.push(event.input)};
  const sandbox = {performance:{now:()=>100}, window:{KotOR:{
    PartyManager:{party:[{actionQueue:[]}]},
    VRSpike:{hooks:{getCombatContext:()=>context}},
  }}};
  const harness = {evaluate: async source => vm.runInNewContext(source, sandbox)};
  assert.equal((await swingAt(harness, 2, 'dominant-trigger')).ok, true);
  assert.equal((await swingAt(harness, 2)).ok, true);
  assert.deepEqual(inputs, ['dominant-trigger','dominant-swing']);
  context.tempoReadiness = 0;
  assert.equal((await swingAt(harness, 2, 'dominant-trigger')).ok, false);
  assert.equal(inputs.length, 2, 'an unavailable tempo window must not commit an input');
});

test('navigation engages the live attacker and rejects an unresolved fight', async () => {
  const attacker={found:true,id:4,tag:'droid',name:'Mining Droid',distance:9};
  let fights=0;
  const harness={evaluate:async()=>attacker};
  const fight=async (_h,target)=>{assert.equal(target,attacker);fights+=1;return {killed:true};};
  assert.equal(await handleNavigationAttacker(harness,{hp:20,maxHp:30,dead:false},{fight}),true);
  assert.equal(fights,1);
  await assert.rejects(handleNavigationAttacker(harness,{hp:20,maxHp:30,dead:false},
    {fight:async()=>({killed:false,reason:'unreachable'})}), /not defeated: unreachable/);
  harness.navigationCombatActive=true;
  assert.equal(await handleNavigationAttacker(harness,{hp:20,maxHp:30,dead:false},{fight}),false);
  assert.equal(fights,1,'an ongoing fight must not recursively interrupt its own approach');
  harness.navigationCombatActive=false;
  assert.equal(await handleNavigationAttacker(harness,{hp:30,maxHp:30,dead:false},{fight}),false);
  harness.evaluate=async()=>({found:false});
  assert.equal(await handleNavigationAttacker(harness,{hp:20,maxHp:30,dead:false},{fight}),false);
});

test('the exterior return lift route enters the west ramp and avoids its north gap', () => {
  const route=EXTERIOR_RETURN_LIFT_ROUTE;
  assert.ok(route[0].x < -7.76, 'the low-floor approach must enter west of the ramp');
  assert.ok(route.at(-1).z > 10.8, 'the route must finish on the lift platform');
  for (let index=1;index<route.length;index+=1) {
    const from=route[index-1],to=route[index];
    for (let sample=0;sample<=20;sample+=1) {
      const x=from.x+(to.x-from.x)*sample/20;
      const y=from.y+(to.y-from.y)*sample/20;
      assert.equal(x > -3 && x < -1.5 && y > -4.8, false, 'route must not cross the north gap');
    }
  }
});

test('defaults new campaign runs to the authored Ebon Hawk prologue', () => {
  assert.deepEqual(PROLOGUE_ROUTES, ['continue', 'skip']);
  assert.equal(parseArgs([]).prologueRoute, 'continue');
  assert.equal(parseArgs(['--prologue-route', 'skip']).prologueRoute, 'skip');
  assert.throws(() => parseArgs(['--prologue-route', 'teleport']), /continue, skip/i);
  assert.throws(() => parseArgs(['--resume']), /requires a checkpoint name/i);
  assert.throws(() => parseArgs(['--unknown']), /unknown argument/i);
});

test('requires the named safe world action instead of substituting a destructive fallback', () => {
  assert.equal(chooseRequiredWorldAction(['Use: Plasteel Cylinder', 'Attack'], /^Use:/, 'Cylinder'), 'Use: Plasteel Cylinder');
  assert.throws(() => chooseRequiredWorldAction(['Bash'], /^Bash$/i, 'Door'), /destructive/i);
  assert.throws(() => chooseRequiredWorldAction(['Open'], /^Use:/, 'Console'), /not offered/i);
  assert.throws(() => chooseRequiredWorldAction(null, /^Use:/), /array of strings/i);
});

test('permits a destructive world action only when its exact authored label is approved', () => {
  assert.equal(chooseExplicitWorldAction(['Bash', 'Use: Footlocker'], 'Bash', 'Spike Footlocker', {
    allowDestructive: true,
  }), 'Bash');
  assert.throws(() => chooseExplicitWorldAction(['Bash'], 'Bash', 'Footlocker'), /requires explicit approval/i);
  assert.throws(() => chooseExplicitWorldAction(['Attack'], 'Bash', 'Footlocker', {
    allowDestructive: true,
  }), /was not offered/i);
});

test('counts inventory stacks instead of treating a stack increase as no loot', () => {
  assert.equal(inventoryQuantityByName([{ name: 'Computer Spike', stack: 1 }], 'computer spike'), 1);
  assert.equal(inventoryQuantityByName([
    { name: 'Computer Spike', stack: 2 },
    { name: 'Computer Spike', stack: 3 },
    { name: 'Parts', stack: 2 },
  ], 'Computer Spike'), 5);
  assert.throws(() => inventoryQuantityByName(null, 'Computer Spike'), /array/i);
});

test('requires the authored console reply script instead of a display-order fallback', () => {
  assert.equal(chooseRequiredDialogueScript(
    ['Slice the system', 'Log out'],
    { replyScripts: ['a_ia_use_comspk', ''] },
    'a_ia_use_comspk',
    'Communications Console',
  ), 0);
  assert.throws(() => chooseRequiredDialogueScript(
    ['Log out'],
    { replyScripts: [''] },
    'a_ia_use_comspk',
    'Communications Console',
  ), /was not offered/i);
  assert.throws(() => chooseRequiredDialogueScript([], {}, '', 'Communications Console'), /non-empty string/i);
});

test('selects an unscripted terminal exit by its exact unique player-visible text', () => {
  assert.equal(chooseRequiredDialogueText(
    ['1. Slice the system. [2 Spikes]', '2. Log out.'],
    '2. Log out.',
    'Security Console',
  ), 1);
  assert.throws(() => chooseRequiredDialogueText(['Log out.'], '2. Log out.', 'Security Console'), /not offered/i);
  assert.throws(() => chooseRequiredDialogueText(['2. Log out.', '2. Log out.'], '2. Log out.', 'Security Console'), /ambiguous/i);
  assert.throws(() => chooseRequiredDialogueText(null, '2. Log out.', 'Security Console'), /array of strings/i);
});

test('completes an unscripted console sequence without display-order fallbacks', () => {
  const choose = createRequiredDialogueTextSequence(['Slice', 'Access security doors.', 'Open Inner Garage Door.', 'Log out.'], 'Security Console');
  assert.equal(choose(['Slice', 'Access security doors.']), 0);
  assert.equal(choose(['Access security doors.']), 0);
  assert.equal(choose(['Open Inner Garage Door.']), 0);
  assert.equal(choose(['Log out.']), 0);
  assert.doesNotThrow(() => choose.assertCompleted());
  assert.throws(() => choose(['Log out.']), /unexpected additional choice.*Log out/i);
});

test('completes each authored console action in sequence before allowing a checkpoint', () => {
  const choose = createRequiredDialogueScriptSequence(['a_ia_use_comspk', 'a_set001dr'], 'Communications Console');
  assert.equal(choose(['Slice', 'Log out'], { replyScripts: ['a_ia_use_comspk', ''] }), 0);
  assert.equal(choose(['Open door', 'Log out'], { replyScripts: ['a_set001dr', ''] }), 0);
  assert.doesNotThrow(() => choose.assertCompleted());
  assert.equal(choose(['Log out'], { replyScripts: [''] }), 0);
  assert.throws(() => choose(['Stay'], { replyScripts: [''] }), /no 'log out\.' was offered/i);

  const incomplete = createRequiredDialogueScriptSequence(['a_ia_use_comspk', 'a_set001dr'], 'Communications Console');
  assert.equal(incomplete(['Slice'], { replyScripts: ['a_ia_use_comspk'] }), 0);
  assert.throws(() => incomplete.assertCompleted(), /1\/2/i);
  assert.throws(() => createRequiredDialogueScriptSequence([], 'Communications Console'), /non-empty array/i);
});

test('runs Peragus medical-bay prerequisites before the first combat checkpoint', () => {
  assert.ok(CHECKPOINT_ORDER.indexOf('ebon-console-sliced') > CHECKPOINT_ORDER.indexOf('prologue-start'));
  assert.ok(CHECKPOINT_ORDER.indexOf('ebon-console-sliced') < CHECKPOINT_ORDER.indexOf('peragus-arrival'));
  assert.ok(CHECKPOINT_ORDER.indexOf('ebon-main-hold-open') > CHECKPOINT_ORDER.indexOf('ebon-console-sliced'));
  assert.ok(CHECKPOINT_ORDER.indexOf('ebon-main-hold-open') < CHECKPOINT_ORDER.indexOf('peragus-arrival'));
  assert.ok(CHECKPOINT_ORDER.indexOf('ebon-spikes-recovered') > CHECKPOINT_ORDER.indexOf('ebon-main-hold-open'));
  assert.ok(CHECKPOINT_ORDER.indexOf('ebon-security-sliced') > CHECKPOINT_ORDER.indexOf('ebon-spikes-recovered'));
  assert.ok(CHECKPOINT_ORDER.indexOf('ebon-inner-garage-open') > CHECKPOINT_ORDER.indexOf('ebon-security-sliced'));
  assert.ok(CHECKPOINT_ORDER.indexOf('ebon-low-security-open') > CHECKPOINT_ORDER.indexOf('ebon-inner-garage-open'));
  assert.ok(CHECKPOINT_ORDER.indexOf('ebon-second-low-security-open') > CHECKPOINT_ORDER.indexOf('ebon-low-security-open'));
  assert.ok(CHECKPOINT_ORDER.indexOf('ebon-first-mine-disarmed') > CHECKPOINT_ORDER.indexOf('ebon-exterior-arrival'));
  assert.ok(CHECKPOINT_ORDER.indexOf('ebon-second-mine-recovered') > CHECKPOINT_ORDER.indexOf('ebon-first-mine-disarmed'));
  assert.ok(CHECKPOINT_ORDER.indexOf('ebon-proton-missile-recovered') > CHECKPOINT_ORDER.indexOf('ebon-second-mine-recovered'));
  assert.ok(CHECKPOINT_ORDER.indexOf('ebon-engine-parts-recovered') > CHECKPOINT_ORDER.indexOf('ebon-proton-missile-recovered'));
  assert.ok(CHECKPOINT_ORDER.indexOf('ebon-proton-missile-recovered') < CHECKPOINT_ORDER.indexOf('peragus-arrival'));
  assert.ok(CHECKPOINT_ORDER.indexOf('ebon-engine-parts-recovered') < CHECKPOINT_ORDER.indexOf('peragus-arrival'));
  assert.ok(CHECKPOINT_ORDER.indexOf('ebon-spikes-recovered') < CHECKPOINT_ORDER.indexOf('peragus-arrival'));
  assert.equal(CHECKPOINT_ORDER.filter((checkpoint) => checkpoint === 'ebon-main-hold-open').length, 1);
  assert.ok(CHECKPOINT_ORDER.indexOf('kolto-tank') > CHECKPOINT_ORDER.indexOf('peragus-arrival'));
  assert.ok(CHECKPOINT_ORDER.indexOf('kolto-tank') < CHECKPOINT_ORDER.indexOf('medbay-door'));
  assert.ok(CHECKPOINT_ORDER.indexOf('medbay-swept') > CHECKPOINT_ORDER.indexOf('medbay-looted'));
  assert.ok(CHECKPOINT_ORDER.indexOf('consoles-used') > CHECKPOINT_ORDER.indexOf('medbay-swept'));
  assert.ok(CHECKPOINT_ORDER.indexOf('morgue-door') > CHECKPOINT_ORDER.indexOf('consoles-used'));
  assert.ok(CHECKPOINT_ORDER.indexOf('kreia-awakened') > CHECKPOINT_ORDER.indexOf('morgue-door'));
  assert.ok(CHECKPOINT_ORDER.indexOf('first-kill') > CHECKPOINT_ORDER.indexOf('kreia-awakened'));
});

test('limits the progression sweep to named medical-bay quest fixtures', () => {
  assert.deepEqual(MEDBAY_FIXTURE_TAGS, ['MedCom']);
  assert.equal(MEDBAY_MAX_NAVIGATION_ATTEMPTS, 2);
});

test('rejects a stale resume that does not contain the checkpoint claim', () => {
  assert.equal(CHECKPOINT_PREFIX, 'VRPT-20260824-E2E');
  assert.match(validateCheckpointSnapshot('peragus-arrival', {
    moduleName: '001ebo', inventoryCount: 5,
  }).reason, /loaded module 001ebo; expected 101per/i);
  assert.deepEqual(validateCheckpointSnapshot('medbay-looted', {
    moduleName: '101per', inventoryCount: 1,
  }), { ok: true });
  assert.match(validateCheckpointSnapshot('medbay-looted', {
    moduleName: '101per', inventoryCount: 0,
  }).reason, /inventory 0/i);
});

test('validates checkpoint claims before SaveCurrentGame can write them', () => {
  const source = require('node:fs').readFileSync(require.resolve('./playthrough-steps'), 'utf8');
  const checkpointBody = source.match(/async function checkpoint\(harness, name\) \{([\s\S]*?)\n\}/);
  assert.ok(checkpointBody, 'checkpoint function must exist');
  assert.match(checkpointBody[1], /validateCheckpointSnapshot\(name,/);
  assert.match(checkpointBody[1], /refusing to write checkpoint/);
  assert.ok(
    checkpointBody[1].indexOf('validateCheckpointSnapshot(name,') < checkpointBody[1].indexOf('SaveCurrentGame'),
    'checkpoint validation must occur before the save write',
  );
});

test('conversation menus block locomotion progression', () => {
  assert.equal(isProgressBlockingForeground('InGameDialog'), true);
  assert.equal(isProgressBlockingForeground('InGameComputer'), true);
  assert.equal(isProgressBlockingForeground('MenuContainer'), false);
});

test('returns Galaxy Map to gameplay before the next authored world use', () => {
  assert.ok(GAMEPLAY_RETURN_MENU_NAMES.includes('MenuGalaxyMap'));
  assert.ok(GAMEPLAY_RETURN_MENU_NAMES.includes('MenuContainer'));
  assert.ok(GAMEPLAY_RETURN_MENU_NAMES.includes('InGameComputer'));
});

test('allows hit-radius margin at intermediate walkmesh waypoints', () => {
  assert.equal(INTERMEDIATE_WAYPOINT_RANGE, 0.8);
});

test('keeps a local direct-stick request distinct from route-planned navigation', () => {
  const source = require('node:fs').readFileSync(require.resolve('./playthrough-steps'), 'utf8');
  assert.match(source, /async function navigateTo\(harness, \{[\s\S]*?usePath = true,[\s\S]*?\}\)/);
  assert.match(source, /moveTo\(harness, \{ x, y, z, range, label, usePath: attemptUsesPath \}\)/);
  assert.match(source, /if \(!usePath && attempt >= maxAttempts\) \{[\s\S]*?refusing walkmesh door recovery/);
});

test('allows a story route to refuse unapproved automatic door interactions', () => {
  const source = require('node:fs').readFileSync(require.resolve('./playthrough-steps'), 'utf8');
  assert.match(source, /permittedDoorPromptIds = null/);
  assert.match(source, /permittedDoorPromptIds\.includes\(door\.promptId\)/);
  assert.match(source, /refusing automatic interaction with unapproved doors/);
  assert.match(source, /tag: 'lift_to_002',[\s\S]*?permittedDoorPromptIds: \[\]/);
});

test('keeps the authored mine alternatives distinct and validates their outcomes', () => {
  const source = require('node:fs').readFileSync(require.resolve('./playthrough-steps'), 'utf8');
  assert.match(source, /async function resolveExteriorMine\(harness, \{ mine, actionLabel \}\)/);
  assert.match(source, /actionLabel !== 'Disarm' && actionLabel !== 'Recover'/);
  assert.match(source, /actionLabel === 'Recover' && after\.inventoryCount <= before\.inventoryCount/);
  assert.match(source, /actionLabel === 'Disarm' && after\.inventoryCount !== before\.inventoryCount/);
  assert.match(source, /resolveExteriorMine\(harness, \{ mine, actionLabel: 'Disarm' \}\)/);
  assert.match(source, /resolveExteriorMine\(harness, \{ mine, actionLabel: 'Recover' \}\)/);
});

test('can pin a repeated authored tag to one exact module object', () => {
  const source = require('node:fs').readFileSync(require.resolve('./playthrough-steps'), 'utf8');
  assert.match(source, /targetId = null/);
  assert.match(source, /matches\.find\(\(candidate\) => candidate\.id === targetId\)/);
  assert.match(source, /tag: '001EBODrSec',[\s\S]*?actionLabel: 'Security',[\s\S]*?targetId: target\.id/);
});

test('selects a concrete tagged exterior target before probing its VR action', () => {
  const source = require('node:fs').readFileSync(require.resolve('./playthrough-steps'), 'utf8');
  assert.match(source, /findObjectByTag\(harness, 'ProtonMis'\)\)\.sort\(\(left, right\) => left\.distance - right\.distance\)\[0\]/);
});

test('uses the proton missile only through its exact verified VR action', () => {
  const source = require('node:fs').readFileSync(require.resolve('./playthrough-steps'), 'utf8');
  assert.match(source, /chooseExplicitWorldAction\(prompt\.actions, 'Use: Proton Missile', 'Proton Missile'/);
  assert.match(source, /resolveOpenedContainer\(harness\)/);
  assert.match(source, /Recovering Proton Missile added no inventory item/);
});

test('recovers exterior Parts only through each exact verified VR action', () => {
  const source = require('node:fs').readFileSync(require.resolve('./playthrough-steps'), 'utf8');
  assert.match(source, /async function recoverPartsFromWorldContainer\(harness,/);
  assert.match(source, /chooseExplicitWorldAction\(prompt\.actions, actionLabel, objectName/);
  assert.match(source, /waitForWorldPrompt\(harness, target\.promptId\)/);
  assert.match(source, /menu\.LB_ITEMS\.select\(parts\)/);
  assert.match(source, /menu\.BTN_OK\.click\(\)/);
  assert.match(source, /Get Items did not add Parts/);
  assert.match(source, /recover the Engine Port Parts through the verified VR action/);
  assert.match(source, /tag: 'eng_port', objectName: 'Engine Port', actionLabel: 'Use: Engine Port'/);
  assert.match(source, /recover Quadlasers Parts through the verified VR action/);
  assert.match(source, /tag: 'Quad', objectName: 'Quadlasers', actionLabel: 'Use: Quadlasers', minimumParts: 5/);
});

test('uses the return lift only through its authored VR prompt', () => {
  const source = require('node:fs').readFileSync(require.resolve('./playthrough-steps'), 'utf8');
  assert.match(source, /tag: 'lift_to_001'/);
  assert.match(source, /actionPattern: \/\^Use:\/i/);
  assert.match(source, /capture the Quadlasers-to-lift walkmesh route before traversal/);
  assert.match(source, /chooseRequiredDialogueText\(\s*replies,\s*'1\. \[Go inside\.\]'/);
  assert.match(source, /await waitForModule\(harness, '001ebo'\)/);
  assert.match(source, /Utility Lift Go inside did not return to 001EBO/);
  assert.match(source, /return lift activation/);
});

test('uses the returned Ebon Hawk state to take the authored Galaxy Map completion route', () => {
  const source = require('node:fs').readFileSync(require.resolve('./playthrough-steps'), 'utf8');
  assert.match(source, /RETURNED_TO_EBON_HAWK\.has\(args\.resume\)/);
  assert.match(source, /survey the authored Ebon Hawk objective after returning from the exterior/);
  assert.match(source, /return-lift checkpoint loaded \$\{state\.moduleName\}; expected 001ebo/);
  assert.match(source, /Workbench is an optional garage-access tutorial/);
  assert.match(source, /tag: 'Galaxymap'/);
  assert.match(source, /LBL_Tutorial/);
  assert.match(source, /await waitForModule\(harness, '101per'\)/);
  assert.match(source, /checkpoint\(harness, 'peragus-arrival'\)/);
});

test('the Galaxy Map approach enters the cockpit before turning towards its port wall', () => {
  const [entrance, approach] = EBON_GALAXY_MAP_APPROACH;
  // 001EBO14's port boundary ends at (51.6,73.13); 001EBO15's
  // connected entrance extends east to x=53.8. Stay north of that wall.
  assert.ok(entrance.x > 51.6 && entrance.x < 53.8 && entrance.y > 73.3);
  assert.equal(entrance.usePath, true);
  assert.ok(approach.y > 73.3 && approach.x > 50.67);
  assert.equal(approach.usePath, false);
  assert.ok(Math.hypot(approach.x - 50.6733, approach.y - 73.9424) < 1.6);
});

test('the Communications Console approach walks west of the angled room wall', () => {
  const [corner, approach] = EBON_COMMUNICATIONS_APPROACH;
  assert.ok(corner.x + corner.range < 55.96 && corner.y > 63.62);
  assert.ok(approach.x + approach.range < 55.96 && approach.y + approach.range < 63.62);
  assert.equal(corner.usePath, false);
  assert.equal(approach.usePath, false);
  assert.ok(Math.hypot(approach.x - 56, approach.y - 62.5342) + approach.range < 1.6);
});

test('validates world-prompt readiness inputs before polling the emulator', async () => {
  await assert.rejects(() => waitForWorldPrompt({}, ''), /non-empty string/i);
  await assert.rejects(() => waitForWorldPrompt({}, 'module-object:36', 0), /positive integer/i);
});

test('includes finite positions in area survey rows so trigger routes are actionable', () => {
  const source = require('node:fs').readFileSync(require.resolve('./playthrough-steps'), 'utf8');
  assert.match(source, /position: o\.position \? \{[\s\S]*?x: \+o\.position\.x\.toFixed\(2\)/);
  assert.match(source, /const triggers = \(area\.triggers \|\| \[\]\)\.map\(\(t\) => describe\(t, 'trigger'\)\)/);
});

test('rejects malformed read-only walkmesh route probes before they can invoke a harness', async () => {
  await assert.rejects(
    () => describeWalkmeshRoute({}, { x: Number.NaN, y: 0, z: 0 }),
    /finite coordinates/i,
  );
  await assert.rejects(
    () => describeWalkmeshRoute({}, { x: 0, y: 0, z: 0, label: '' }),
    /label must be non-empty/i,
  );
});

test('bounds computer revisits and recognizes repeated dialogue branches', () => {
  assert.equal(MEDICAL_COMPUTER_MAX_VISITS, 6);
  assert.equal(dialogueTranscriptKey([' Log A ', '', '> Choice']), 'Log A\n> Choice');
  assert.throws(() => dialogueTranscriptKey(null), /array/i);
});

test('prefers the authored Morgue-unlock reply when it is live', () => {
  assert.equal(chooseMorgueUnlockReply(['log', 'unlock'], {
    replyScripts: ['', 'a_setmor'],
  }), 1);
  assert.equal(chooseMorgueUnlockReply(['log'], { replyScripts: [''] }), 0);
});

test('walks each authored medical log once before selecting the Morgue unlock', () => {
  const choose = createMorgueUnlockChooser();
  assert.equal(choose(['log 12', 'log 15', 'exit'], {
    replyScripts: ['a_setmedlog1', 'a_setmedlog2', ''],
  }), 0);
  assert.equal(choose(['log 12', 'log 15', 'exit'], {
    replyScripts: ['a_setmedlog1', 'a_setmedlog2', ''],
  }), 1);
  assert.equal(choose(['log 12', 'unlock'], {
    replyScripts: ['a_setmedlog1', 'a_setmor'],
  }), 1);
});

test('returns to the medical console after reading all three authored logs', () => {
  const choose = createMorgueUnlockChooser();
  for (const script of ['a_setmedlog1', 'a_setmedlog2', 'a_setmedlog3']) {
    assert.equal(choose(['log'], { replyScripts: [script] }), 0);
  }
  assert.equal(choose(['log again', 'Access main console options.'], {
    replyScripts: ['a_setmedlog1', ''],
  }), 1);
});

test('reads action scripts from resolved displayed replies, excluding continue nodes', () => {
  const continueReply = { isContinueDialog: () => true, script: { name: 'skip_me' } };
  const unlockReply = { isContinueDialog: () => false, script: { name: 'a_setmor' } };
  assert.deepEqual(getDisplayedReplyScriptNames([continueReply, unlockReply]), ['a_setmor']);
  assert.deepEqual(getDisplayedReplyScriptNames(null), []);
});

test('converts a world-forward target to the WebXR forward stick axis', () => {
  const axes = computeHeadRelativeMoveAxes({
    targetX: 0, targetY: 10, playerX: 0, playerY: 0, referenceFacing: 0,
  });
  assert.equal(axes.x, 0);
  assert.equal(axes.y, -1);
  assert.equal(axes.distance, 10);
});

test('rotates a world-right target into head-relative forward input', () => {
  const axes = computeHeadRelativeMoveAxes({
    targetX: 10, targetY: 0, playerX: 0, playerY: 0, referenceFacing: -Math.PI / 2,
  });
  assert.ok(Math.abs(axes.x) < 1e-12);
  assert.ok(Math.abs(axes.y + 1) < 1e-12);
});

test('returns a released stick at the destination and rejects invalid inputs', () => {
  assert.deepEqual(computeHeadRelativeMoveAxes({
    targetX: 3, targetY: 4, playerX: 3, playerY: 4, referenceFacing: 0,
  }), { x: 0, y: 0, distance: 0 });
  assert.throws(() => computeHeadRelativeMoveAxes({
    targetX: Number.NaN, targetY: 0, playerX: 0, playerY: 0, referenceFacing: 0,
  }), /finite/i);
});

test('uses finer thumbstick samples for tight walkmesh corners', () => {
  assert.equal(navigationInputDurationMs(10, .3), 900);
  assert.equal(navigationInputDurationMs(5, .3), 350);
  assert.equal(navigationInputDurationMs(3, .3), 180);
  assert.equal(navigationInputDurationMs(.9, .3), 60);
  assert.equal(navigationInputDurationMs(.4, .3), 20);
  assert.equal(navigationInputDurationMs(.3, .3), 0);
  assert.throws(() => navigationInputDurationMs(NaN, .3), /finite/);
  assert.throws(() => navigationInputDurationMs(1, 0), /positive/);
});

test('derives a normalized horizontal locomotion yaw from the world quaternion', () => {
  const rootHalfTurn = Math.SQRT1_2;
  assert.ok(Math.abs(computeReferenceFacingFromQuaternion({ x: 0, y: rootHalfTurn, z: 0, w: rootHalfTurn }) - Math.PI / 2) < 1e-12);
  // The XR-to-game basis sends headset forward (-Z) to the positive game-Y
  // ground direction. That is creature-facing zero, not a 180 degree turn.
  assert.ok(Math.abs(computeReferenceFacingFromQuaternion({ x: rootHalfTurn, y: 0, z: 0, w: rootHalfTurn })) < 1e-12);
  assert.throws(() => computeReferenceFacingFromQuaternion({ x: 0, y: 0, z: 0, w: 1 }), /horizontal component/i);
});

test('identifies module exit doors by tag, destination module, or raw/compiled name', () => {
  assert.equal(isModuleExitDoor({ tag: '102PERDoor', name: 'Emergency Hatch' }), true);
  assert.equal(isModuleExitDoor({ tag: 'Hatch_103PERDoor', name: 'Turbolift' }), true);
  assert.equal(isModuleExitDoor({ tag: 'PERDoor105', linkedToModule: '105per', name: 'Docking Door' }), true);
  assert.equal(isModuleExitDoor({ tag: '151HARDoor', linkedToModule: '151har', name: 'Door' }), true);
  assert.equal(isModuleExitDoor({ tag: 'Door', name: 'Door{102PER}' }), true);
  assert.equal(isModuleExitDoor({ tag: 'Door', rawName: 'Emergency Hatch{102PER}', name: 'Emergency Hatch' }), true);
  assert.equal(isModuleExitDoor({ tag: 'PeragusDoor1', name: 'Door' }), false);
  assert.equal(isModuleExitDoor({ tag: 'MorgueDoor', name: 'Morgue Door' }), false);
  assert.equal(isModuleExitDoor(null), false);
  assert.equal(isModuleExitDoor(undefined), false);
});

test('navigation arrival stays inside the actual interaction range', () => {
  assert.equal(isWithinNavigationRange(1.91, 1.6), false);
  assert.equal(isWithinNavigationRange(1.6, 1.6), true);
  assert.equal(isWithinNavigationRange(0, 1.6), true);
  assert.throws(() => isWithinNavigationRange(NaN, 1.6), /finite/);
  assert.throws(() => isWithinNavigationRange(1, 0), /positive/);
});

test('a short wall collision gets a planned route attempt before failing', () => {
  assert.equal(canRetryPlannedApproach({ usePath: true, attemptUsesPath: false, attempt: 1, maxAttempts: 4 }), true);
  assert.equal(canRetryPlannedApproach({ usePath: true, attemptUsesPath: true, attempt: 2, maxAttempts: 4 }), false);
  assert.equal(canRetryPlannedApproach({ usePath: false, attemptUsesPath: false, attempt: 1, maxAttempts: 4 }), false);
  assert.equal(canRetryPlannedApproach({ usePath: true, attemptUsesPath: false, attempt: 4, maxAttempts: 4 }), false);
  assert.throws(() => canRetryPlannedApproach({ usePath: true, attemptUsesPath: false, attempt: 0, maxAttempts: 4 }), /bounds/);
});

test('invalid automatic levelling options fail before touching the engine', async () => {
  const harness = { evaluate: () => { throw new Error('engine must not be accessed'); } };
  await assert.rejects(clearHostiles(harness, { autoLevel: 'false' }), /autoLevel must be boolean/);
});

test('navigation uses the authored conversation handler even before a dialog menu appears', async () => {
  const played = { finished: true, turns: 4, transcript: ['Atton grants the code'] };
  let reads = 0;
  const harness = { campaignAcceptance: true,
    evaluate: async () => (++reads === 1 ? { engineMode: 3, menuStack: ['InGameOverlay'] } : { engineMode: 1 }),
    navigationDialogueHandler: async (label) => { assert.equal(label, 'prison approach'); return played; } };
  assert.equal(await clearProgressBlockingDialogue(harness, 'prison approach'), played);
  assert.equal(reads, 2);
  harness.evaluate = async () => ({ engineMode: 3, menuStack: ['InGameOverlay'] });
  harness.navigationDialogueHandler = async () => ({ finished: false });
  await assert.rejects(clearProgressBlockingDialogue(harness, 'prison approach'), /did not finish/);
});
