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
  identifyServingBundle,
  createSnapshotArtifact,
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

test('serving bundle identity is read through the authenticated browser session without exposing tokens', async () => {
  let source = '';
  const identity = await identifyServingBundle({ evaluate: async (expression) => {
    source = expression;
    return { url: 'http://127.0.0.1:9447/KotOR.js', sha256: 'a'.repeat(64) };
  } });
  assert.equal(identity.sha256, 'a'.repeat(64));
  assert.match(source, /credentials: 'same-origin'/);
  assert.doesNotMatch(source, /token|authorization|cookie/i);
});

test('external URL snapshot artifact never emits local build metadata', () => {
  const output = createSnapshotArtifact({
    module: '101per', buildStamp: 'forged-harness-stamp', bundleMtime: 'forged-harness-mtime',
  }, {
    externalUrl: true, buildStamp: '2026-09-20T00:00:00.000Z', bundleMtime: '2026-09-20T00:00:00.000Z',
  });
  assert.equal(output.buildStamp, null);
  assert.equal(output.bundleMtime, null);
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

test('canonical manifest rejects a foreign or stale DeNCS sidecar', () => {
  const hash = (contents) => require('crypto').createHash('sha256').update(contents).digest('hex');
  const engine = JSON.stringify({ module: '101per', engineIdentity: { module: '101PER', freshState: true, loadedFromSave: false, servingBundleSha256: 'a'.repeat(64) } });
  const retail = JSON.stringify({ module: '101per', retailInputs: [{ resref: 'a_script', restype: 'NCS', sha256: 'b'.repeat(64) }] });
  const comparison = JSON.stringify({ module: '101per', findings: [] });
  const sidecar = JSON.stringify({ module: '102PER', records: [{ kind: 'dencs', resref: 'a_script', restype: 'NCS', sha256: 'c'.repeat(64), authority: 'hypothesis', path: 'a_script.nss' }] });
  const artifacts = { 'engine.json': engine, 'retail.json': retail, 'comparison.json': comparison, 'sidecar.json': sidecar };
  const artifact = (name) => ({ path: name, sha256: hash(artifacts[name]) });
  assert.throws(() => validateCanonicalCaptureManifest({ schema: 'kotor2-vr/parity-capture@1', module: '101PER', artifacts: {
    engine: artifact('engine.json'), retail: artifact('retail.json'), comparison: artifact('comparison.json'), sidecar: artifact('sidecar.json'),
  } }, artifacts), /sidecar module|DeNCS/i);
});

test('canonical manifest rejects numeric sidecar resource identities', () => {
  const hash = (contents) => require('crypto').createHash('sha256').update(contents).digest('hex');
  const engine = JSON.stringify({ module: '101per', engineIdentity: { module: '101PER', freshState: true, loadedFromSave: false, servingBundleSha256: 'a'.repeat(64) } });
  const retail = JSON.stringify({ module: '101per', retailInputs: [{ resref: 'a_script', restype: 'NCS', sha256: 'b'.repeat(64) }] });
  const comparison = JSON.stringify({ module: '101per', findings: [] });
  const sidecar = JSON.stringify({ module: '101PER', records: [{ kind: 'dencs', resref: 123, restype: 456, sha256: 'b'.repeat(64), authority: 'hypothesis' }] });
  const artifacts = { 'engine.json': engine, 'retail.json': retail, 'comparison.json': comparison, 'sidecar.json': sidecar };
  const artifact = (name) => ({ path: name, sha256: hash(artifacts[name]) });
  assert.throws(() => validateCanonicalCaptureManifest({ schema: 'kotor2-vr/parity-capture@1', module: '101PER', artifacts: {
    engine: artifact('engine.json'), retail: artifact('retail.json'), comparison: artifact('comparison.json'), sidecar: artifact('sidecar.json'),
  } }, artifacts), /typed authority|identity/i);
});
