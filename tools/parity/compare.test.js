const test = require('node:test');
const assert = require('node:assert');
const {
  pairCreatures,
  diffSets,
  textureLayer,
  SLOT_MAP,
  linkEvidence,
  classifyAudioSemantic,
  classifyModelPresentation,
  compareAudio,
  compareModelPresentation,
  normalizeFindingForReport,
  reportEvidenceRefs,
  validateEvidenceSidecar,
  retainCaptureArtifacts,
  compareBehaviorChain,
} = require('./compare');

test('retains engine and retail snapshot provenance on every parity report', () => {
  assert.deepStrictEqual(reportEvidenceRefs('101PER', 'tools/parity/out/101per.evidence.json'), [
    'tools/parity/out/101per.engine.json',
    'tools/parity/out/101per.retail.json',
    'tools/parity/out/101per.evidence.json',
  ]);
});

test('normalizes confirmed comparator output into ledger-ready expected and observed fields', () => {
  assert.deepStrictEqual(normalizeFindingForReport({
    confidence: 'defect', code: 'stat:str', retail: 10, engine: 8,
  }), {
    confidence: 'defect', classification: 'engine-defect', code: 'stat:str',
    retail: 10, engine: 8, expected: 10, observed: 8,
  });
});

test('continuous audio is not an engine defect without a captured play-style mapping', () => {
  assert.strictEqual(
    classifyAudioSemantic({ continuous: true }, { continuous: false }, null),
    'missing-evidence',
  );
});

test('a placeable creature model is authored bind-pose evidence, not an animation defect', () => {
  assert.strictEqual(
    classifyModelPresentation(
      { objectType: 'placeable', modelKind: 'creature' },
      { animationApplied: false },
    ),
    'authored-retail-behavior',
  );
});

test('unavailable audio semantics retain independent volume mismatch evidence', () => {
  const findings = [];
  compareAudio({
    module: '101per',
    audio: { area: {}, tracks: {}, sounds: [{ status: 'ok', template: 'rumble', gitIndex: 0, continuous: true, volume: 75, sounds: [] }] },
  }, {
    loadedFromSave: false,
    audio: {
      area: {},
      sounds: [{ template: 'rumble', continuous: false, playStyle: null, playStyleAvailable: false, volume: 25, sounds: [] }],
    },
  }, (finding) => findings.push(finding));
  assert.deepStrictEqual(findings, [{
    area: 'audio',
    code: 'sound:play-style',
    confidence: 'coverage',
    classification: 'missing-evidence',
    object: 'rumble#0',
    retail: true,
    engine: null,
    detail: 'retail play-style mapping is missing; engine play-style observation is unavailable',
  }, {
    area: 'audio', code: 'sound:volume', confidence: 'defect', object: 'rumble#0', retail: 75, engine: 25,
  }]);
});

test('an incomplete selected retail audio mapping is reported as missing evidence', () => {
  const findings = [];
  compareAudio({
    module: '101per',
    audio: { area: {}, tracks: {}, sounds: [{ status: 'ok', template: 'rumble', gitIndex: 0, continuous: true, sounds: [] }] },
  }, {
    loadedFromSave: false,
    audio: {
      area: {},
      playStyleMapping: { true: '   ', false: 'oneshot' },
      sounds: [{ template: 'rumble', continuous: false, playStyle: 'loop', playStyleAvailable: true, sounds: [] }],
    },
  }, (finding) => findings.push(finding));
  assert.strictEqual(findings[0].classification, 'missing-evidence');
  assert.strictEqual(findings[0].detail, 'retail play-style mapping is missing');
});

test('matching audio semantic mapping retains scalar and sound-file mismatches', () => {
  const findings = [];
  compareAudio({
    module: '101per',
    audio: { area: {}, tracks: {}, sounds: [{
      status: 'ok', template: 'rumble', gitIndex: 0, continuous: true, volume: 75,
      sounds: ['rumble_a'],
    }] },
  }, {
    loadedFromSave: false,
    audio: {
      area: {},
      playStyleMapping: { true: 'loop', false: 'oneshot' },
      sounds: [{
        template: 'rumble', continuous: false, playStyle: 'loop', playStyleAvailable: true, volume: 25,
        sounds: ['rumble_b'],
      }],
    },
  }, (finding) => findings.push(finding));
  assert.deepStrictEqual(findings, [{
    area: 'audio', code: 'sound:volume', confidence: 'defect', object: 'rumble#0', retail: 75, engine: 25,
  }, {
    area: 'audio', code: 'sound:files', confidence: 'defect', object: 'rumble#0', retail: ['rumble_a'], engine: ['rumble_b'],
  }]);
});

test('snapshot comparator records an ordinary requested but unapplied placeable animation as missing evidence', () => {
  const findings = [];
  compareModelPresentation({
    modelPresentation: [{ status: 'ok', template: 'plc_console', gitIndex: 0, objectType: 'placeable', modelKind: 'placeable' }],
  }, {
    modelPresentation: [{ template: 'plc_console', requestedAnimation: 'open', currentAnimation: null, animationApplied: false }],
  }, (finding) => findings.push(finding));
  assert.deepStrictEqual(findings, [{
    area: 'model',
    code: 'model:presentation',
    confidence: 'coverage',
    classification: 'missing-evidence',
    object: 'plc_console#0',
    retail: null,
    engine: null,
    detail: 'animation application requires additional retail presentation evidence',
  }]);
});

test('pairs creatures by template regardless of order, keeping leftovers', () => {
  const retail = [{ template: 'a', gitIndex: 0 }, { template: 'b', gitIndex: 1 }, { template: 'a', gitIndex: 2 }];
  const engine = [{ template: 'a' }, { template: 'c' }, { template: 'a' }];
  const { pairs, unmatchedRetail, unmatchedEngine } = pairCreatures(retail, engine);
  assert.strictEqual(pairs.length, 2);
  assert.deepStrictEqual(unmatchedRetail.map((c) => c.template), ['b']);
  assert.deepStrictEqual(unmatchedEngine.map((c) => c.template), ['c']);
});

test('diffSets counts duplicates', () => {
  assert.deepStrictEqual(diffSets([1, 1, 2], [1, 3]), { missing: [1, 2], extra: [3] });
});

test('engine texture sources collapse to retail layers', () => {
  assert.strictEqual(textureLayer('override-tga'), 'override');
  assert.strictEqual(textureLayer('override-tpc'), 'override');
  assert.strictEqual(textureLayer('active-module'), 'module');
  assert.strictEqual(textureLayer('key-bif'), 'key-bif');
  assert.strictEqual(textureLayer(undefined), 'none');
});

test('arm slots map by bit value: PyKotor RIGHT_ARM is 0x80, which TSL calls LEFTARM', () => {
  assert.strictEqual(SLOT_MAP.RIGHT_ARM, 'LEFTARMBAND');
  assert.strictEqual(SLOT_MAP.LEFT_ARM, 'RIGHTARMBAND');
});

test('links matching typed evidence paths without changing a finding classification', () => {
  const finding = { object: 'a_script#0', code: 'sound:files', confidence: 'coverage', resourceIdentity: { resref: 'a_script', restype: 'NCS' } };
  const linked = linkEvidence(finding, [{
    kind: 'dencs', resref: 'a_script', restype: 'NCS', sha256: 'a'.repeat(64),
    authority: 'hypothesis', path: 'tools/parity/out/101per.evidence.json',
  }]);
  assert.deepStrictEqual(linked.evidenceRefs, ['tools/parity/out/101per.evidence.json']);
  assert.strictEqual(linked.confidence, 'coverage');
});

test('does not link a DeNCS sidecar by bare resref when its typed identity is absent', () => {
  const linked = linkEvidence({ object: 'a_script#0' }, [{
    kind: 'dencs', resref: 'a_script', restype: 'NCS', sha256: 'a'.repeat(64), authority: 'hypothesis',
  }], 'sidecar.json');
  assert.equal(linked.evidenceRefs, undefined);
});

test('rejects stale, foreign, and edited DeNCS sidecars at Node ingestion', () => {
  const retail = { module: '101per', retailInputs: [{ resref: 'a_script', restype: 'NCS', sha256: 'a'.repeat(64) }] };
  const record = { kind: 'dencs', resref: 'a_script', restype: 'NCS', sha256: 'a'.repeat(64), authority: 'hypothesis', path: 'a_script.nss' };
  assert.throws(() => validateEvidenceSidecar({ module: '102PER', records: [record] }, retail, '101PER'), /module/i);
  assert.throws(() => validateEvidenceSidecar({ module: '101PER', records: [{ ...record, sha256: 'b'.repeat(64) }] }, retail, '101PER'), /hash/i);
  assert.throws(() => validateEvidenceSidecar({ module: '101PER', records: [{ ...record, authority: 'parsed-retail' }] }, retail, '101PER'), /authority/i);
});

test('missing or unresolved engine models are missing evidence, never bind-pose evidence', () => {
  assert.equal(classifyModelPresentation(
    { objectType: 'placeable', modelKind: 'creature' },
    { modelStatus: 'missing', animationApplied: false },
  ), 'missing-evidence');
});

test('retains immutable capture-specific copies instead of treating latest module files as evidence', () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-capture-'));
  try {
    fs.writeFileSync(path.join(root, 'engine.json'), JSON.stringify({ module: '101per', engineIdentity: { module: '101PER', freshState: true, loadedFromSave: false, servingBundleSha256: 'a'.repeat(64) } }));
    fs.writeFileSync(path.join(root, 'retail.json'), JSON.stringify({ module: '101per', retailInputs: [{ resref: '101per', restype: 'RIM', sha256: 'b'.repeat(64) }] }));
    fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify({ module: '101per' }));
    const manifest = retainCaptureArtifacts({ module: '101PER', root, files: { engine: 'engine.json', retail: 'retail.json', comparison: 'report.json' } });
    assert.match(manifest.path, /captures[\\/]101per[\\/][a-f0-9]{64}[\\/]capture\.json$/);
    assert.ok(fs.existsSync(manifest.path));
    assert.notEqual(path.dirname(manifest.path), root);
    assert.ok(manifest.manifest.artifacts.comparison.sha256);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a blocked authored behavior-chain probe is reported as missing evidence instead of inventing a result', () => {
  const findings = [];
  const coverage = compareBehaviorChain(
    { behaviorChain: { coverage: 'missing-evidence', gffDlgLocated: false, ncsLocated: false, reason: 'no bounded interaction metadata' } },
    { behaviorChain: { coverage: 'missing-evidence', eventDispatchLocated: false, actionQueueLocated: false, resultStateLocated: false } },
    (finding) => findings.push(finding),
  );
  assert.equal(coverage.coverage, 'missing-evidence');
  assert.equal(findings[0].classification, 'missing-evidence');
});
