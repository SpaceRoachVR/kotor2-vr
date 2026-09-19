const test = require('node:test');
const assert = require('node:assert');
const { createCaptureIdentity, validateEvidenceRecord } = require('./parity-contract');

test('capture identity rejects save-derived canonical evidence', () => {
  assert.throws(() => createCaptureIdentity({
    module: '101PER', freshState: true, loadedFromSave: true,
    engineCommit: 'abc', bundleMtime: '2026-09-19T00:00:00.000Z', retailInputs: [],
  }), /save-derived/i);
});

test('evidence record requires a resource hash and authority', () => {
  assert.throws(() => validateEvidenceRecord({ kind: 'dencs', resref: 'a_script', hash: '', authority: '' }), /hash|authority/i);
});
