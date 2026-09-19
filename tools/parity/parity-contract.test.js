const test = require('node:test');
const assert = require('node:assert');
const { createCaptureIdentity, validateEvidenceRecord } = require('./parity-contract');
const { assertCanonicalEngineState } = require('./engine-snapshot');

test('capture identity rejects save-derived canonical evidence', () => {
  assert.throws(() => createCaptureIdentity({
    module: '101PER', freshState: true, loadedFromSave: true,
    engineCommit: 'abc', bundleMtime: '2026-09-19T00:00:00.000Z', retailInputs: [],
  }), /save-derived/i);
});

test('evidence record requires a resource hash and authority', () => {
  assert.throws(() => validateEvidenceRecord({ kind: 'dencs', resref: 'a_script', hash: '', authority: '' }), /hash|authority/i);
});

test('canonical snapshot refuses a saved module', () => {
  assert.throws(
    () => assertCanonicalEngineState({ loadedFromSave: true, playerName: 'T3-M4', partySize: 1 }),
    /save-derived/i,
  );
});

test('canonical snapshot requires the Peragus bootstrap identity', () => {
  assert.throws(
    () => assertCanonicalEngineState({ loadedFromSave: false, playerName: 'Exile', partySize: 1 }),
    /T3-M4/i,
  );
});

test('canonical snapshot refuses an unverifiable save origin', () => {
  assert.throws(
    () => assertCanonicalEngineState({ loadedFromSave: null, playerName: 'T3-M4', partySize: 1 }),
    /save origin/i,
  );
});
