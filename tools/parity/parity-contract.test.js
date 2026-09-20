const test = require('node:test');
const assert = require('node:assert');
const {
  createCaptureIdentity,
  validateEvidenceRecord,
  validateCanonicalCaptureManifest,
} = require('./parity-contract');
const {
  assertCanonicalEngineState,
  assertModuleLoadResult,
  assertRequestedModuleIdentity,
  createEngineIdentity,
} = require('./engine-snapshot');

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
    () => assertCanonicalEngineState({ loadedFromSave: true, bootstrap: 'new-game-ui', playerName: 'T3-M4', partySize: 1 }),
    /save-derived/i,
  );
});

test('canonical snapshot requires the Peragus bootstrap identity', () => {
  assert.throws(
    () => assertCanonicalEngineState({ loadedFromSave: false, bootstrap: 'new-game-ui', playerName: 'Exile', partySize: 1 }),
    /T3-M4/i,
  );
});

test('canonical snapshot refuses an unverifiable save origin', () => {
  assert.throws(
    () => assertCanonicalEngineState({ loadedFromSave: null, bootstrap: 'new-game-ui', playerName: 'T3-M4', partySize: 1 }),
    /save origin/i,
  );
});

test('canonical snapshot rejects a save-established party even when the target module is unvisited', () => {
  assert.throws(
    () => assertCanonicalEngineState({ loadedFromSave: false, bootstrap: 'save-load', playerName: 'T3-M4', partySize: 1 }),
    /fresh new-game bootstrap/i,
  );
});

test('canonical snapshot rejects a settled but wrong module identity', () => {
  assert.throws(
    () => assertRequestedModuleIdentity('102per', '101PER'),
    /module mismatch/i,
  );
});

test('canonical snapshot rejects a load failure before state validation', () => {
  assert.throws(
    () => assertModuleLoadResult({ error: 'module did not settle' }, '101PER'),
    /did not settle/i,
  );
  assert.throws(
    () => assertModuleLoadResult({ error: 'LoadModule threw: malformed GIT' }, '101PER'),
    /LoadModule threw/i,
  );
});

test('engine identity remains explicitly staged until retail inputs are hashed', () => {
  const identity = createEngineIdentity({ module: '101per', loadedFromSave: false }, {
    engineCommit: 'abc',
    bundleMtime: '2026-09-19T00:00:00.000Z',
    servingBundleSha256: 'a'.repeat(64),
  });
  assert.deepStrictEqual(identity, {
    module: '101PER',
    freshState: true,
    loadedFromSave: false,
    engineCommit: 'abc',
    bundleMtime: '2026-09-19T00:00:00.000Z',
    servingBundleSha256: 'a'.repeat(64),
  });
  assert.equal(Object.hasOwn(identity, 'retailInputs'), false);
});

test('engine identity rejects an unverified serving bundle hash', () => {
  assert.throws(() => createEngineIdentity({ module: '101per' }, {
    engineCommit: 'abc', bundleMtime: '2026-09-19T00:00:00.000Z', servingBundleSha256: 'not-a-hash',
  }), /serving bundle/i);
});

test('a remote serving bundle does not inherit checkout commit or mtime identity', () => {
  const identity = createEngineIdentity({ module: '101per' }, {
    engineCommit: null, bundleMtime: null, servingBundleSha256: 'a'.repeat(64),
  });
  assert.equal(identity.engineCommit, null);
  assert.equal(identity.bundleMtime, null);
});

test('canonical identity requires the hash of the bundle actually served to the harness', () => {
  assert.throws(() => createCaptureIdentity({
    module: '101PER', freshState: true, loadedFromSave: false,
    engineCommit: 'abc', bundleMtime: '2026-09-19T00:00:00.000Z', retailInputs: [{ resref: '101per', restype: 'RIM', sha256: 'a'.repeat(64) }],
  }), /serving bundle/i);
});

test('canonical manifest rejects a save-derived engine artifact even when its module was not visited', () => {
  const artifact = (name, contents) => ({ path: name, sha256: require('crypto').createHash('sha256').update(contents).digest('hex') });
  const engine = JSON.stringify({ module: '101per', engineIdentity: { module: '101PER', freshState: true, loadedFromSave: true, servingBundleSha256: 'a'.repeat(64) } });
  const retail = JSON.stringify({ module: '101per', retailInputs: [{ resref: '101per', restype: 'RIM', sha256: 'b'.repeat(64) }] });
  const comparison = JSON.stringify({ module: '101per', findings: [] });
  assert.throws(() => validateCanonicalCaptureManifest({
    schema: 'kotor2-vr/parity-capture@1', module: '101PER',
    artifacts: { engine: artifact('engine.json', engine), retail: artifact('retail.json', retail), comparison: artifact('comparison.json', comparison) },
  }, { 'engine.json': engine, 'retail.json': retail, 'comparison.json': comparison }), /save-derived/i);
});
