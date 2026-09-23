const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMedcomBehaviorChain, createMedcomReplyChooser } = require('./engine-snapshot');

const observed = {
  target: { located: true, id: 42, tag: 'MedCom', onUsedScript: 'a_compdlg' },
  before: { located: true, declared: true, value: 0 },
  action: { located: true, name: 'ActionUseObject', targetId: 42, sequence: 1 },
  event: { located: true, name: 'OnUsed', scriptName: 'a_compdlg', sequence: 2 },
  reply: { located: true, scriptName: 'a_setmedlog1', sequence: 3 },
  after: { located: true, declared: true, value: 1 },
};

test('MedCom chain requires an observed action, OnUsed script, selected reply script and global transition', () => {
  assert.deepEqual(buildMedcomBehaviorChain(observed), {
    coverage: 'complete',
    interactionId: '101per:medcom:medical-log-1',
    eventDispatchLocated: true,
    actionQueueLocated: true,
    resultStateLocated: true,
    actionEventTrace: [
      { action: 'ActionUseObject', event: 'OnUsed' },
      { action: 'selectReply', event: 'a_setmedlog1' },
    ],
    resultState: { globalNumber: { '101PER_Med_Log': 1 } },
    beforeState: { globalNumber: { '101PER_Med_Log': 0 } },
  });
});

test('MedCom chain cannot promote a forged or out-of-order observation', () => {
  for (const bad of [
    { action: { ...observed.action, targetId: 7 } },
    { event: { ...observed.event, sequence: 1 } },
    { reply: { ...observed.reply, scriptName: 'a_setmedlog2' } },
    { before: { ...observed.before, declared: false } },
    { after: { ...observed.after, value: 0 } },
    { event: { ...observed.event, scriptName: 'wrong_script' } },
  ]) {
    const result = buildMedcomBehaviorChain({ ...observed, ...bad });
    assert.equal(result.coverage, 'missing-evidence');
    assert.equal(result.resultStateLocated, false);
  }
});

test('MedCom chooser follows authored medical-log text and selects the scripted first log', () => {
  const choose = createMedcomReplyChooser();
  assert.equal(choose(['Access medical logs.', 'Log out.'],
    { conversationName: 'medlog', replyScripts: ['', ''] }), 0);
  assert.equal(choose(['Access Log 253-12.', 'Access Log 253-15.'],
    { conversationName: 'medlog', replyScripts: ['a_setmedlog1', 'a_setmedlog2'] }), 0);
  const wrongScript = createMedcomReplyChooser();
  wrongScript(['Access medical logs.'], { conversationName: 'medlog', replyScripts: [''] });
  assert.throws(() => wrongScript(['Access Log 253-12.'],
    { conversationName: 'medlog', replyScripts: [''] }), /a_setmedlog1/);
});

test('medbay route approves only the unlocked PeragusDoor1 doors beside MedCom', () => {
  const { selectMedbayRouteDoors } = require('./engine-snapshot');
  const medcom = { x: -9.36, y: -0.92, z: 9.06 };
  const door = (promptId, x, y, locked, extra = {}) =>
    ({ kind: 'door', tag: 'PeragusDoor1', promptId, position: { x, y, z: 9 }, locked, ...extra });
  // The live 101PER layout: the medbay's two doors, and the next one ~23m away.
  assert.deepEqual(selectMedbayRouteDoors([
    door('module-object:400', -10.77, 6.78, false),
    door('module-object:402', -13.35, -4.21, false),
    door('module-object:410', -19.19, -22.29, false),
  ], medcom), ['module-object:400', 'module-object:402']);
  // Same tag on a placeable is never a door to approve.
  assert.deepEqual(selectMedbayRouteDoors([
    { ...door('module-object:1', -9, -1, false), kind: 'placeable' }, door('module-object:402', -13.35, -4.21, false),
  ], medcom), ['module-object:402']);
  assert.throws(() => selectMedbayRouteDoors([door('module-object:402', -13.35, -4.21, true)], medcom), /unlocked/);
  assert.throws(() => selectMedbayRouteDoors([door('module-object:402', -13.35, -4.21, null)], medcom), /unlocked/);
  assert.throws(() => selectMedbayRouteDoors([door('module-object:410', -19.19, -22.29, false)], medcom), /beside MedCom/);
  assert.throws(() => selectMedbayRouteDoors(null, medcom), TypeError);
  assert.throws(() => selectMedbayRouteDoors([], null), TypeError);
});
