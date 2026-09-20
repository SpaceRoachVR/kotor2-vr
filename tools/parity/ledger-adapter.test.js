const test = require('node:test');
const assert = require('node:assert/strict');

const { toParityDefectRecords } = require('./ledger-adapter');

function reportWith(findings) {
  return { module: '101PER', findings };
}

test('only confirmed engine defects become ledger records', () => {
  const records = toParityDefectRecords(reportWith([
    {
      classification: 'engine-defect', code: 'sound:play-style', object: 'metalstrain#0',
      expected: 'loop', observed: 'oneshot', evidenceRefs: ['tools/parity/out/101per.evidence.json'],
    },
    { classification: 'missing-evidence', code: 'sound:continuous', object: 'rumble#1' },
    { classification: 'variable-runtime-output', code: 'stat:hitPoints', object: 't3m4#0' },
  ]), 'tools/parity/out/101per.parity.json');

  assert.equal(records.length, 1);
  assert.match(records[0].id, /^parity-101per-sound-play-style$/);
});

test('keeps exact report and finding evidence references without duplicates', () => {
  const records = toParityDefectRecords(reportWith([{
    classification: 'engine-defect', code: 'texture:wrong-layer', object: 'panel_a#3',
    expected: 'module', observed: 'key-bif',
    evidenceRefs: ['tools/parity/out/101per.evidence.json', 'tools/parity/out/101per.evidence.json'],
    reproductionSteps: ['Load fresh 101PER.', 'Inspect panel_a.'], room: '101PER_02', severity: 'minor',
  }]), 'tools/parity/out/101per.parity.json');

  assert.deepEqual(records[0].evidenceRefs, [
    'tools/parity/out/101per.parity.json',
    'tools/parity/out/101per.evidence.json',
  ]);
  assert.deepEqual(records[0].reproductionSteps, ['Load fresh 101PER.', 'Inspect panel_a.']);
  assert.equal(records[0].room, '101PER_02');
  assert.equal(records[0].severity, 'minor');
});

test('rejects a promotable finding that lacks exact comparison evidence', () => {
  assert.throws(() => toParityDefectRecords(reportWith([{
    classification: 'engine-defect', code: 'stat:str', object: 't3m4#0', expected: 10, observed: 0,
  }]), ''), /report path/i);
});

test('does not infer defects from a confidence label', () => {
  const records = toParityDefectRecords(reportWith([{
    confidence: 'defect', code: 'sound:volume', object: 'rumble#0', expected: 75, observed: 25,
  }]), 'tools/parity/out/101per.parity.json');
  assert.deepEqual(records, []);
});
