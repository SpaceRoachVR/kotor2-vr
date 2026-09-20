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
  assert.deepEqual(records[0].reproductionSteps, ['Inspect panel_a.', 'Load fresh 101PER.']);
  assert.equal(records[0].room, '101PER_02');
  assert.equal(records[0].severity, 'minor');
});

test('rejects a promotable finding that lacks exact comparison evidence', () => {
  assert.throws(() => toParityDefectRecords(reportWith([{
    classification: 'engine-defect', code: 'stat:str', object: 't3m4#0', expected: 10, observed: 0,
  }]), ''), /report path/i);
});

test('groups repeated defect codes deterministically into one ledger record', () => {
  const first = toParityDefectRecords(reportWith([
    { classification: 'engine-defect', code: 'stat:str', object: 't3m4#1', expected: 10, observed: 8 },
    { classification: 'engine-defect', code: 'stat:str', object: 't3m4#0', expected: 12, observed: 9 },
  ]), 'tools/parity/out/101per.parity.json');
  const second = toParityDefectRecords(reportWith([
    { classification: 'engine-defect', code: 'stat:str', object: 't3m4#0', expected: 12, observed: 9 },
    { classification: 'engine-defect', code: 'stat:str', object: 't3m4#1', expected: 10, observed: 8 },
  ]), 'tools/parity/out/101per.parity.json');

  assert.equal(first.length, 1);
  assert.equal(first[0].id, 'parity-101per-stat-str');
  assert.deepEqual(first, second);
  assert.equal(first[0].expected, '[{"object":"t3m4#0","value":12},{"object":"t3m4#1","value":10}]');
  assert.equal(first[0].observed, '[{"object":"t3m4#0","value":9},{"object":"t3m4#1","value":8}]');
});

test('serializes comparator-shaped arrays and nulls and accepts baseline provenance without a sidecar', () => {
  const { normalizeFindingForReport } = require('./compare');
  const finding = normalizeFindingForReport({
    confidence: 'defect', code: 'powers', object: 't3m4#0', retail: [100, 101], engine: null,
  });
  const [record] = toParityDefectRecords({
    module: '101PER', findings: [finding],
    evidenceRefs: ['tools/parity/out/101per.engine.json', 'tools/parity/out/101per.retail.json'],
  }, 'tools/parity/out/101per.parity.json');

  assert.equal(record.expected, '[100,101]');
  assert.equal(record.observed, 'null');
  assert.deepEqual(record.evidenceRefs, [
    'tools/parity/out/101per.parity.json',
    'tools/parity/out/101per.engine.json',
    'tools/parity/out/101per.retail.json',
  ]);
});

test('does not infer defects from a confidence label', () => {
  const records = toParityDefectRecords(reportWith([{
    confidence: 'defect', code: 'sound:volume', object: 'rumble#0', expected: 75, observed: 25,
  }]), 'tools/parity/out/101per.parity.json');
  assert.deepEqual(records, []);
});
