const test = require('node:test');
const assert = require('node:assert/strict');

const { toParityDefectRecords: promote } = require('./ledger-adapter');
const { deriveCaptureId } = require('./parity-contract');
const crypto = require('crypto');

const fixtureEngine = JSON.stringify({ module: '101per', loadedFromSave: false, bootstrap: 'new-game-ui', playerName: 'T3-M4', partySize: 1, engineIdentity: { module: '101PER', freshState: true, loadedFromSave: false, servingBundleSha256: 'a'.repeat(64) } });
const fixtureIdentity = { resref: 'resource_a', restype: 'UTS', source: 'module', sha256: 'a'.repeat(64) };
const fixtureRetail = JSON.stringify({ module: '101per', retailInputs: [
  { resref: '101per', restype: 'RIM', sha256: 'b'.repeat(64) }, fixtureIdentity,
] });
const fixtureSidecar = JSON.stringify({ module: '101PER', records: [{ ...fixtureIdentity, kind: 'kotormcp', authority: 'parsed-retail' }] });
const fixtureHash = (contents) => crypto.createHash('sha256').update(contents).digest('hex');
function toParityDefectRecords(report, reportPath, options = {}) {
  const comparison = JSON.stringify({ module: String(report.module || '').toLowerCase(), findings: report.findings });
  const referencesMutableSidecar = Array.isArray(report.findings) && report.findings.some((finding) => Array.isArray(finding.evidenceRefs)
    && finding.evidenceRefs.includes('tools/parity/out/101per.evidence.json'));
  if (!report.captureManifest) {
    const contents = { engine: fixtureEngine, retail: fixtureRetail, comparison, ...(referencesMutableSidecar ? { sidecar: fixtureSidecar } : {}) };
    const rawArtifacts = Object.fromEntries(Object.entries(contents).map(([name, value]) => [name, { sha256: fixtureHash(value) }]));
    const captureId = deriveCaptureId('101PER', rawArtifacts);
    const artifacts = Object.fromEntries(Object.entries(rawArtifacts).map(([name, artifact]) => [name, {
      ...artifact, path: `tools/parity/out/captures/101per/${captureId}/${name}.json`,
    }]));
    report.captureManifest = { schema: 'kotor2-vr/parity-capture@1', module: '101PER', captureId, artifacts };
    const retainedContents = Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => [artifact.path, contents[name]]));
    return promote(report, reportPath, { readArtifact: (name) => retainedContents[name], ...options });
  }
  return promote(report, reportPath, options);
}

function reportWith(findings) {
  return {
    module: '101PER', findings,
    evidenceRefs: ['tools/parity/out/101per.engine.json', 'tools/parity/out/101per.retail.json'],
  };
}

test('rejects external-prefix manifest paths before calling any artifact reader', () => {
  const rawArtifacts = { engine: { sha256: fixtureHash(fixtureEngine) }, retail: { sha256: fixtureHash(fixtureRetail) }, comparison: { sha256: fixtureHash('{}') } };
  const captureId = deriveCaptureId('101PER', rawArtifacts);
  const artifacts = Object.fromEntries(Object.entries(rawArtifacts).map(([name, entry]) => [name, {
    ...entry, path: `C:/untrusted-parent/tools/parity/out/captures/101per/${captureId}/${name}.json`,
  }]));
  let readCount = 0;
  assert.throws(() => promote({ module: '101PER', captureManifest: {
    schema: 'kotor2-vr/parity-capture@1', module: '101PER', captureId, artifacts,
  } }, 'report.json', { readArtifact: () => { readCount++; return '{}'; } }), /content-addressed capture directory/i);
  assert.equal(readCount, 0);
});

function assertImmutableCaptureReferences(references, expectedFiles) {
  assert.deepEqual(references.map((reference) => reference.split('/').pop()).sort(), [...expectedFiles].sort());
  for (const reference of references) {
    assert.match(reference, /^tools\/parity\/out\/captures\/101per\/[a-f0-9]{64}\/[a-z]+\.json$/);
    assert.doesNotMatch(reference, /^tools\/parity\/out\/101per\./);
  }
}

test('only confirmed engine defects become ledger records', () => {
  const records = toParityDefectRecords(reportWith([
    {
      classification: 'engine-defect', code: 'sound:play-style', object: 'metalstrain#0',
      expected: 'loop', observed: 'oneshot', evidenceRefs: ['tools/parity/out/101per.evidence.json'],
      resourceIdentity: fixtureIdentity,
    },
    { classification: 'missing-evidence', code: 'sound:continuous', object: 'rumble#1' },
    { classification: 'variable-runtime-output', code: 'stat:hitPoints', object: 't3m4#0' },
  ]), 'tools/parity/out/101per.parity.json');

  assert.equal(records.length, 1);
  assert.match(records[0].id, /^parity-101per-sound-play-style$/);
});

test('maps a mutable latest sidecar reference to its retained immutable artifact without duplicates', () => {
  const records = toParityDefectRecords(reportWith([{
    classification: 'engine-defect', code: 'texture:wrong-layer', object: 'panel_a#3',
    expected: 'module', observed: 'key-bif',
    evidenceRefs: ['tools/parity/out/101per.evidence.json', 'tools/parity/out/101per.evidence.json'],
    resourceIdentity: fixtureIdentity,
    reproductionSteps: ['Load fresh 101PER.', 'Inspect panel_a.'], room: '101PER_02', severity: 'minor',
  }]), 'tools/parity/out/101per.parity.json');

  assertImmutableCaptureReferences(records[0].evidenceRefs, ['comparison.json', 'engine.json', 'retail.json', 'sidecar.json']);
  assert.deepEqual(records[0].reproductionSteps, ['Load fresh 101PER.', 'Inspect panel_a.']);
  assert.equal(records[0].room, '101PER_02');
  assert.equal(records[0].severity, 'minor');
});

test('a sidecar linked to resource A is not inherited by promoted resource B', () => {
  const records = toParityDefectRecords(reportWith([
    { classification: 'missing-evidence', code: 'resource:a', resourceIdentity: fixtureIdentity,
      evidenceRefs: ['tools/parity/out/101per.evidence.json'] },
    { classification: 'engine-defect', code: 'resource:b', expected: 10, observed: 8,
      resourceIdentity: { ...fixtureIdentity, resref: 'resource_b' } },
  ]), 'report.json');
  assert.equal(records.length, 1);
  assertImmutableCaptureReferences(records[0].evidenceRefs, ['comparison.json', 'engine.json', 'retail.json']);
});

test('sidecar promotion rejects references without matching full finding identity', () => {
  for (const resourceIdentity of [undefined, { ...fixtureIdentity, resref: 'resource_b' },
    ...[undefined, '', '   ', 'Module', ' module'].map((source) => ({ ...fixtureIdentity, source }))]) {
    assert.throws(() => toParityDefectRecords(reportWith([{
      classification: 'engine-defect', code: 'resource:b', expected: 10, observed: 8,
      resourceIdentity, evidenceRefs: ['tools/parity/out/101per.evidence.json'],
    }]), 'report.json'), /matching full resource identity/);
  }
});

function promoteWithSidecarRecords(finding, records) {
  const contents = {
    engine: fixtureEngine,
    retail: fixtureRetail,
    comparison: JSON.stringify({ module: '101per', findings: [finding] }),
    sidecar: JSON.stringify({ module: '101PER', records }),
  };
  const rawArtifacts = Object.fromEntries(Object.entries(contents).map(([name, value]) => [name, { sha256: fixtureHash(value) }]));
  const captureId = deriveCaptureId('101PER', rawArtifacts);
  const artifacts = Object.fromEntries(Object.entries(rawArtifacts).map(([name, artifact]) => [name, {
    ...artifact, path: `tools/parity/out/captures/101per/${captureId}/${name}.json`,
  }]));
  const retainedContents = Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => [artifact.path, contents[name]]));
  const report = reportWith([finding]);
  report.captureManifest = { schema: 'kotor2-vr/parity-capture@1', module: '101PER', captureId, artifacts };
  return toParityDefectRecords(report, 'report.json', {
    readArtifact: (artifactPath) => retainedContents[artifactPath],
  });
}

test('promotion rejects self-consistent forged evidence even beside a valid retail record', () => {
  const invented = { resref: 'resource_b', restype: 'UTS', source: 'other-module', sha256: 'c'.repeat(64) };
  const forgedFinding = {
    classification: 'engine-defect', code: 'sound:volume', expected: 10, observed: 8,
    resourceIdentity: invented, evidenceRefs: ['tools/parity/out/101per.evidence.json'],
  };
  const forgedRecord = { ...invented, kind: 'holocron', authority: 'human-review' };
  const validRecord = { ...fixtureIdentity, kind: 'kotormcp', authority: 'parsed-retail' };
  for (const records of [[forgedRecord], [validRecord, forgedRecord]]) {
    assert.throws(() => promoteWithSidecarRecords(forgedFinding, records), /matching full resource identity/);
  }
  const validFinding = { ...forgedFinding, resourceIdentity: fixtureIdentity };
  assert.throws(() => promoteWithSidecarRecords(validFinding, [validRecord, forgedRecord]), /matching full resource identity/);
  assert.equal(promoteWithSidecarRecords(validFinding, [validRecord]).length, 1);
});

test('promotion rejects contradictory sidecar hash aliases', () => {
  const finding = {
    classification: 'engine-defect', code: 'sound:volume', expected: 10, observed: 8,
    resourceIdentity: fixtureIdentity, evidenceRefs: ['tools/parity/out/101per.evidence.json'],
  };
  assert.throws(() => promoteWithSidecarRecords(finding, [{
    ...fixtureIdentity, hash: 'c'.repeat(64), kind: 'kotormcp', authority: 'parsed-retail',
  }]), /hash and sha256 must match/);
});

test('preserves temporal step order and only deduplicates identical whole procedures', () => {
  const [record] = toParityDefectRecords(reportWith([
    { classification: 'engine-defect', code: 'stat:str', object: 't3m4#0', expected: 10, observed: 8, reproductionSteps: ['Load fresh 101PER.', 'Inspect T3-M4.'] },
    { classification: 'engine-defect', code: 'stat:str', object: 't3m4#1', expected: 12, observed: 9, reproductionSteps: ['Load fresh 101PER.', 'Inspect T3-M4.'] },
    { classification: 'engine-defect', code: 'stat:str', object: 't3m4#2', expected: 11, observed: 7, reproductionSteps: ['Trigger the panel.', 'Inspect resulting state.'] },
  ]), 'tools/parity/out/101per.parity.json');
  assert.deepEqual(record.reproductionSteps, [
    'Load fresh 101PER.', 'Inspect T3-M4.', 'Trigger the panel.', 'Inspect resulting state.',
  ]);
});

test('rejects an unretained mutable finding evidence reference', () => {
  assert.throws(() => toParityDefectRecords(reportWith([{
    classification: 'engine-defect', code: 'stat:str', object: 't3m4#0', expected: 10, observed: 8,
    evidenceRefs: ['tools/parity/out/101per.unretained.evidence.json'],
  }]), 'tools/parity/out/101per.parity.json'), /unretained mutable evidence/i);
});

test('rejects a promotable finding that lacks exact comparison evidence', () => {
  assert.throws(() => toParityDefectRecords(reportWith([{
    classification: 'engine-defect', code: 'stat:str', object: 't3m4#0', expected: 10, observed: 0,
  }]), ''), /report path/i);
});

test('uses the verified capture manifest instead of mutable latest baseline path strings', () => {
  const finding = { classification: 'engine-defect', code: 'stat:str', object: 't3m4#0', expected: 10, observed: 0 };
  const records = toParityDefectRecords({ module: '101PER', findings: [finding] }, 'tools/parity/out/101per.parity.json');
  assertImmutableCaptureReferences(records[0].evidenceRefs, ['comparison.json', 'engine.json', 'retail.json']);
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
  assert.deepEqual(
    first.map(({ evidenceRefs, ...record }) => record),
    second.map(({ evidenceRefs, ...record }) => record),
  );
  assertImmutableCaptureReferences(first[0].evidenceRefs, ['comparison.json', 'engine.json', 'retail.json']);
  assertImmutableCaptureReferences(second[0].evidenceRefs, ['comparison.json', 'engine.json', 'retail.json']);
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
  assertImmutableCaptureReferences(record.evidenceRefs, ['comparison.json', 'engine.json', 'retail.json']);
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

  assert.deepEqual(
    first.map(({ evidenceRefs, ...record }) => record),
    second.map(({ evidenceRefs, ...record }) => record),
  );
  assertImmutableCaptureReferences(first[0].evidenceRefs, ['comparison.json', 'engine.json', 'retail.json']);
  assertImmutableCaptureReferences(second[0].evidenceRefs, ['comparison.json', 'engine.json', 'retail.json']);
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
  const records = toParityDefectRecords(report, 'report.json');
  assert.equal(records.length, 1);
});

test('promotion ignores mutable report findings and uses only retained comparison findings', () => {
  const report = reportWith([{ classification: 'engine-defect', code: 'invented:defect', expected: 'retail', observed: 'engine' }]);
  const comparison = JSON.stringify({ module: '101per', findings: [] });
  const rawArtifacts = {
    engine: { sha256: fixtureHash(fixtureEngine) }, retail: { sha256: fixtureHash(fixtureRetail) }, comparison: { sha256: fixtureHash(comparison) },
  };
  const captureId = deriveCaptureId('101PER', rawArtifacts);
  report.captureManifest = { schema: 'kotor2-vr/parity-capture@1', module: '101PER', captureId, artifacts: Object.fromEntries(
    Object.entries(rawArtifacts).map(([name, artifact]) => [name, { ...artifact, path: `tools/parity/out/captures/101per/${captureId}/${name}.json` }]),
  ) };
  const records = promote(report, 'report.json', { readArtifact: (name) => ({
    [`tools/parity/out/captures/101per/${captureId}/engine.json`]: fixtureEngine,
    [`tools/parity/out/captures/101per/${captureId}/retail.json`]: fixtureRetail,
    [`tools/parity/out/captures/101per/${captureId}/comparison.json`]: comparison,
  })[name] });
  assert.deepEqual(records, []);
});
