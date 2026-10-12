const assert = require('node:assert/strict');
const test = require('node:test');

const { CHECKS } = require('./checks');

const textureCheck = CHECKS.find((check) => check.id === 'texture-resolution-baseline');
const bashCheck = CHECKS.find((check) => check.id === 'weapon-bash-route');
const scrollCheck = CHECKS.find(check => check.id === 'save-list-thumbstick-scroll');

test('save-list scrolling requires movement, neutral stability, bounds, and preserved selection/module', () => {
  const sample = { found: true, presenting: true, before: 0, down: 200, neutral: 200,
    neutralAfter: 200, up: 0, bottom: 1000, maxScroll: 1000, selectedUnchanged: true, moduleUnchanged: true };
  assert.equal(scrollCheck.run({ saveListScroll: sample }).ok, true);
  assert.equal(scrollCheck.run({}).ok, false);
  for (const override of [{ found: false }, { presenting: false }, { maxScroll: 0 }, { down: 0 },
    { up: 200 }, { up: -1 }, { bottom: 1001 }, { neutralAfter: 201 },
    { selectedUnchanged: false }, { moduleUnchanged: false }, { down: NaN }]) {
    assert.equal(scrollCheck.run({ saveListScroll: { ...sample, ...override } }).ok, false);
  }
});

test('Bash acceptance requires a real locked target and an explicit selection', () => {
  const weaponBash = { hook: true, lockedCount: 1, unselectedBlocked: true, started: true, secondStarted: false };
  assert.equal(bashCheck.run({ weaponBash }).ok, true);
  assert.equal(bashCheck.run({ weaponBash: { ...weaponBash, lockedCount: 0 } }).ok, false);
  assert.equal(bashCheck.run({ weaponBash: { ...weaponBash, unselectedBlocked: false } }).ok, false);
  assert.equal(bashCheck.run({ weaponBash: { ...weaponBash, secondStarted: true } }).ok, false);
});

test('Bash refusal acceptance requires an authored prompt with no Bash entry', () => {
  const weaponBash = { hook: true, lockedCount: 1, unselectedBlocked: true, started: false, secondStarted: false, authoredBashAbsent: true };
  assert.equal(bashCheck.run({ weaponBash }).ok, true);
  assert.equal(bashCheck.run({ weaponBash: { ...weaponBash, authoredBashAbsent: false } }).ok, false);
  assert.equal(bashCheck.run({}).ok, false);
});

function checkTextures(resrefs) {
  return textureCheck.run({
    textures: {
      distinctFailing: resrefs.length,
      missing: resrefs.length,
      total: 100,
      failing: resrefs.map((resref) => ({ resref, status: 'missing', count: 1 })),
    },
  });
}

test('accepts the sixteen retail-verified absent textures even when all are requested', () => {
  const result = checkTextures([
    'bluefill', 'yellowfill', 'invent2', 'invent1', 'confirm2', 'confirm1',
    '1600x1200back', 'po_pcarth', 'po_no', 'uparrow', 'lbl_wupitems',
    'boxline4', 'boxline3', 'n_mainof', 'p_attonh', 'pmbamc',
  ]);
  assert.equal(result.ok, true, result.detail);
});

test('rejects an unexpected missing texture even below the old count threshold', () => {
  const result = checkTextures(['bluefill', 'per_fl03']);
  assert.equal(result.ok, false, result.detail);
  assert.match(result.detail, /per_fl03/);
});

test('rejects a decode error for a known-absent resref', () => {
  const result = textureCheck.run({
    textures: {
      distinctFailing: 1,
      missing: 0,
      total: 100,
      failing: [{ resref: 'bluefill', status: 'decode-error', count: 1 }],
    },
  });
  assert.equal(result.ok, false, result.detail);
});
