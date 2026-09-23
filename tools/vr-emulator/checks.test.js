const assert = require('node:assert/strict');
const test = require('node:test');

const { CHECKS } = require('./checks');

const textureCheck = CHECKS.find((check) => check.id === 'texture-resolution-baseline');

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
