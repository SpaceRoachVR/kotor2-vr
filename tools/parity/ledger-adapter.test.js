const test = require('node:test');
const assert = require('node:assert/strict');

const { toParityDefectRecords: promote } = require('./ledger-adapter');
const crypto = require('crypto');

const fixtureEngine = JSON.stringify({ module: '101per', engineIdentity: { module: '101PER', freshState: true, loadedFromSave: false, servingBundleSha256: 'a'.repeat(64) } });
const fixtureRetail = JSON.stringify({ module: '101per', retailInputs: [{ resref: '101per', restype: 'RIM', sha256: 'b'.repeat(64) }] });
const fixtureComparison = JSON.stringify({ module: '101per', findings: [] });
const fixtureHash = (contents) => crypto.createHash('sha256').update(contents).digest('hex');
const fixtureManifest = {
  schema: 'kotor2-vr/parity-capture@1', module: '101PER',
  artifacts: {
    engine: { path: 'engine.json', sha256: fixtureHash(fixtureEngine) },
    retail: { path: 'retail.json', sha256: fixtureHash(fixtureRetail) },
    comparison: { path: 'comparison.json', sha256: fixtureHash(fixtureComparison) },
  },
};
function toParityDefectRecords(report, reportPath, options = {}) {
  if (!report.captureManifest) report.captureManifest = fixtureManifest;
  return promote(report, reportPath, { readArtifact: (name) => ({ 'engine.json': fixtureEngine, 'retail.json': fixtureRetail, 'comparison.json': fixtureComparison })[name], ...options });
}

function reportWith(findings) {
  return {
    module: '101PER', findings,
    evidenceRefs: ['tools/parity/out/101per.engine.json', 'tools/parity/out/101per.retail.json'],
  };
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
    'comparison.json', 'engine.json', 'retail.json', 'tools/parity/out/101per.evidence.json',
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

test('uses the verified capture manifest instead of mutable latest baseline path strings', () => {
  const finding = { classification: 'engine-defect', code: 'stat:str', object: 't3m4#0', expected: 10, observed: 0 };
  const records = toParityDefectRecords({ module: '101PER', findings: [finding] }, 'tools/parity/out/101per.parity.json');
  assert.deepEqual(records[0].evidenceRefs, ['comparison.json', 'engine.json', 'retail.json']);
});

test('rejects missing expected or observed values before grouping', () => {
  assert.throws(() => toParityDefectRecords(reportWith([
    { classification: 'engine-defect', code: 'stat:str', object: 't3m4#0', observed: 8 },
    { classification: 'engine-defect', code: 'stat:str', object: 't3m4#1', expected: 10, observed: 9 },
  ]), 'tools/parity/out/101per.parity.json'), /expected/i);
  assert.throws(() => toParityDefectRecords(reportWith([
    { classification: 'engine-defect', code: 'stat:str', object: 't3m4#0', expected: 10 },
  ]), 'tools/parity/out/101per.parity.json'), /observed/i);
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
  assert.deepEqual(record.evidenceRefs, ['comparison.json', 'engine.json', 'retail.json']);
});

test('normalization-equivalent codes select a deterministic canonical title and order', () => {
  const first = toParityDefectRecords(reportWith([
    { classification: 'engine-defect', code: 'sound:play style', object: 'sound#1', expected: 'loop', observed: 'oneshot' },
    { classification: 'engine-defect', code: 'sound-play-style', object: 'sound#0', expected: 'loop', observed: 'oneshot' },
  ]), 'tools/parity/out/101per.parity.json');
  const second = toParityDefectRecords(reportWith([
    { classification: 'engine-defect', code: 'sound-play-style', object: 'sound#0', expected: 'loop', observed: 'oneshot' },
    { classification: 'engine-defect', code: 'sound:play style', object: 'sound#1', expected: 'loop', observed: 'oneshot' },
  ]), 'tools/parity/out/101per.parity.json');

  assert.deepEqual(first, second);
  assert.equal(first[0].id, 'parity-101per-sound-play-style');
  assert.equal(first[0].title, 'sound-play-style in 101PER');
});

test('does not infer defects from a confidence label', () => {
  const records = toParityDefectRecords(reportWith([{
    confidence: 'defect', code: 'sound:volume', object: 'rumble#0', expected: 75, observed: 25,
  }]), 'tools/parity/out/101per.parity.json');
  assert.deepEqual(records, []);
});

test('promotion requires a retained verified canonical capture manifest, not mutable baseline path strings', () => {
  const report = reportWith([{ classification: 'engine-defect', code: 'stat:str', expected: 10, observed: 8 }]);
  assert.throws(() => promote(report, 'tools/parity/out/101per.parity.json'), /capture manifest/i);
  const hash = (contents) => crypto.createHash('sha256').update(contents).digest('hex');
  const engine = JSON.stringify({ module: '101per', engineIdentity: { module: '101PER', freshState: true, loadedFromSave: false, servingBundleSha256: 'a'.repeat(64) } });
  const retail = JSON.stringify({ module: '101per', retailInputs: [{ resref: '101per', restype: 'RIM', sha256: 'b'.repeat(64) }] });
  const comparison = JSON.stringify({ module: '101per', findings: [] });
  report.captureManifest = {
    schema: 'kotor2-vr/parity-capture@1', module: '101PER',
    artifacts: {
      engine: { path: 'engine.json', sha256: hash(engine) }, retail: { path: 'retail.json', sha256: hash(retail) },
      comparison: { path: 'comparison.json', sha256: hash(comparison) },
    },
  };
  const artifacts = { 'engine.json': engine, 'retail.json': retail, 'comparison.json': comparison };
  const records = toParityDefectRecords(report, 'report.json', { readArtifact: (name) => artifacts[name] });
  assert.equal(records.length, 1);
});
