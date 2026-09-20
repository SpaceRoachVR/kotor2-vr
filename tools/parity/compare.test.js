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
} = require('./compare');

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

test('snapshot comparator omits a continuous mismatch when documented play-style mapping matches the engine observation', () => {
  const findings = [];
  compareAudio({
    module: '101per',
    audio: { area: {}, tracks: {}, sounds: [{ status: 'ok', template: 'rumble', gitIndex: 0, continuous: true, sounds: [] }] },
  }, {
    loadedFromSave: false,
    audio: {
      area: {},
      playStyleMapping: { true: 'loop', false: 'oneshot' },
      sounds: [{ template: 'rumble', continuous: false, playStyle: 'loop', playStyleAvailable: true, sounds: [] }],
    },
  }, (finding) => findings.push(finding));
  assert.deepStrictEqual(findings, []);
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

test('links matching evidence paths without changing a finding classification', () => {
  const finding = { object: 'a_script#0', code: 'sound:files', confidence: 'coverage' };
  const linked = linkEvidence(finding, [{
    kind: 'dencs', resref: 'a_script', restype: 'NCS', sha256: 'a'.repeat(64),
    authority: 'hypothesis', path: 'tools/parity/out/101per.evidence.json',
  }]);
  assert.deepStrictEqual(linked.evidenceRefs, ['tools/parity/out/101per.evidence.json']);
  assert.strictEqual(linked.confidence, 'coverage');
});
