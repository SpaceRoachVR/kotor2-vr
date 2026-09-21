const test = require('node:test');
const assert = require('node:assert');
const {
  createCaptureIdentity,
  deriveCaptureId,
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
const freshState = { module: '101per', loadedFromSave: false, bootstrap: 'new-game-ui', playerName: 'T3-M4', partySize: 1 };

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
  const identity = createEngineIdentity(freshState, {
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
  const identity = createEngineIdentity(freshState, {
    engineCommit: null, bundleMtime: null, servingBundleSha256: 'a'.repeat(64),
  });
  assert.equal(identity.engineCommit, null);
  assert.equal(identity.bundleMtime, null);
});

test('serving bundle identity uses trusted CDP observation rather than page-owned APIs', async () => {
  const identity = await identifyServingBundle({ getTrustedServingBundle: async () => (
    { url: `http://127.0.0.1:9447/bundles/${'a'.repeat(64)}/KotOR.js`, sha256: 'a'.repeat(64) }
  ) });
  assert.equal(identity.sha256, 'a'.repeat(64));
});

test('serving bundle identity rejects a token-bearing URL returned by trusted observation', async () => {
  await assert.rejects(
    identifyServingBundle({ getTrustedServingBundle: async () => ({ url: 'http://127.0.0.1:9447/KotOR.js?token=secret', sha256: 'a'.repeat(64) }) }),
    /unsafe serving bundle URL/i,
  );
});

test('serving bundle identity fails closed when a bundle swap cannot match the executed content-addressed URL', async () => {
  await assert.rejects(
    identifyServingBundle({ getTrustedServingBundle: async () => ({
      url: `http://127.0.0.1:9447/bundles/${'a'.repeat(64)}/KotOR.js`, sha256: 'b'.repeat(64),
    }) }),
    /immutable executed-byte identity/i,
  );
});

test('external URLs cannot claim canonical serving provenance through page-provided data', async () => {
  await assert.rejects(
    identifyServingBundle({ evaluate: async () => ({ url: `https://remote.invalid/bundles/${'a'.repeat(64)}/KotOR.js`, sha256: 'a'.repeat(64) }) }),
    /trusted external CDP observation/i,
  );
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
  const rawArtifacts = { engine: artifact('engine.json', engine), retail: artifact('retail.json', retail), comparison: artifact('comparison.json', comparison) };
  const captureId = deriveCaptureId('101PER', rawArtifacts);
  const artifacts = Object.fromEntries(Object.entries(rawArtifacts).map(([name, entry]) => [name, {
    ...entry, path: `tools/parity/out/captures/101per/${captureId}/${entry.path}`,
  }]));
  const contents = Object.fromEntries(Object.entries(artifacts).map(([name, entry]) => [entry.path, ({ engine, retail, comparison })[name]]));
  assert.throws(() => validateCanonicalCaptureManifest({
    schema: 'kotor2-vr/parity-capture@1', module: '101PER', captureId, artifacts,
  }, contents), /save-derived/i);
});

test('canonical manifest rejects a foreign or stale DeNCS sidecar', () => {
  const hash = (contents) => require('crypto').createHash('sha256').update(contents).digest('hex');
  const engine = JSON.stringify({ ...freshState, engineIdentity: { module: '101PER', freshState: true, loadedFromSave: false, servingBundleSha256: 'a'.repeat(64) } });
  const retail = JSON.stringify({ module: '101per', retailInputs: [{ resref: 'a_script', restype: 'NCS', sha256: 'b'.repeat(64) }] });
  const comparison = JSON.stringify({ module: '101per', findings: [] });
  const sidecar = JSON.stringify({ module: '102PER', records: [{ kind: 'dencs', resref: 'a_script', restype: 'NCS', sha256: 'c'.repeat(64), authority: 'hypothesis', path: 'a_script.nss' }] });
  const sourceContents = { 'engine.json': engine, 'retail.json': retail, 'comparison.json': comparison, 'sidecar.json': sidecar };
  const rawArtifacts = Object.fromEntries(Object.entries(sourceContents).map(([name, contents]) => [name.replace('.json', ''), { path: name, sha256: hash(contents) }]));
  const captureId = deriveCaptureId('101PER', rawArtifacts);
  const manifestArtifacts = Object.fromEntries(Object.entries(rawArtifacts).map(([name, entry]) => [name, {
    ...entry, path: `tools/parity/out/captures/101per/${captureId}/${entry.path}`,
  }]));
  const artifacts = Object.fromEntries(Object.entries(manifestArtifacts).map(([name, entry]) => [entry.path, sourceContents[`${name}.json`]]));
  assert.throws(() => validateCanonicalCaptureManifest({ schema: 'kotor2-vr/parity-capture@1', module: '101PER', captureId, artifacts: manifestArtifacts }, artifacts), /sidecar module|DeNCS/i);
});

test('canonical manifest rejects numeric sidecar resource identities', () => {
  const hash = (contents) => require('crypto').createHash('sha256').update(contents).digest('hex');
  const engine = JSON.stringify({ ...freshState, engineIdentity: { module: '101PER', freshState: true, loadedFromSave: false, servingBundleSha256: 'a'.repeat(64) } });
  const retail = JSON.stringify({ module: '101per', retailInputs: [{ resref: 'a_script', restype: 'NCS', sha256: 'b'.repeat(64) }] });
  const comparison = JSON.stringify({ module: '101per', findings: [] });
  const sidecar = JSON.stringify({ module: '101PER', records: [{ kind: 'dencs', resref: 123, restype: 456, sha256: 'b'.repeat(64), authority: 'hypothesis' }] });
  const sourceContents = { 'engine.json': engine, 'retail.json': retail, 'comparison.json': comparison, 'sidecar.json': sidecar };
  const rawArtifacts = Object.fromEntries(Object.entries(sourceContents).map(([name, contents]) => [name.replace('.json', ''), { path: name, sha256: hash(contents) }]));
  const captureId = deriveCaptureId('101PER', rawArtifacts);
  const manifestArtifacts = Object.fromEntries(Object.entries(rawArtifacts).map(([name, entry]) => [name, {
    ...entry, path: `tools/parity/out/captures/101per/${captureId}/${entry.path}`,
  }]));
  const artifacts = Object.fromEntries(Object.entries(manifestArtifacts).map(([name, entry]) => [entry.path, sourceContents[`${name}.json`]]));
  assert.throws(() => validateCanonicalCaptureManifest({ schema: 'kotor2-vr/parity-capture@1', module: '101PER', captureId, artifacts: manifestArtifacts }, artifacts), /typed authority|identity/i);
});

test('canonical manifest rejects mutable, forged, and cross-capture artifact paths', () => {
  const hash = (contents) => require('crypto').createHash('sha256').update(contents).digest('hex');
  const sourceContents = {
    engine: JSON.stringify({ module: '101per', engineIdentity: { module: '101PER', freshState: true, loadedFromSave: false, servingBundleSha256: 'a'.repeat(64) } }),
    retail: JSON.stringify({ module: '101per', retailInputs: [{ resref: '101per', restype: 'RIM', sha256: 'b'.repeat(64) }] }),
    comparison: JSON.stringify({ module: '101per', findings: [] }),
  };
  const rawArtifacts = Object.fromEntries(Object.entries(sourceContents).map(([name, contents]) => [name, { path: `${name}.json`, sha256: hash(contents) }]));
  const captureId = deriveCaptureId('101PER', rawArtifacts);
  const makeManifest = (paths, id = captureId) => ({ schema: 'kotor2-vr/parity-capture@1', module: '101PER', captureId: id, artifacts: Object.fromEntries(
    Object.entries(rawArtifacts).map(([name, entry]) => [name, { ...entry, path: paths[name] }]),
  ) });
  const validPaths = Object.fromEntries(Object.keys(rawArtifacts).map((name) => [name, `tools/parity/out/captures/101per/${captureId}/${name}.json`]));
  const retained = Object.fromEntries(Object.entries(validPaths).map(([name, filePath]) => [filePath, sourceContents[name]]));
  assert.throws(() => validateCanonicalCaptureManifest(makeManifest({ ...validPaths, engine: 'tools/parity/out/101per.engine.json' }), retained), /content-addressed capture directory/i);
  assert.throws(() => validateCanonicalCaptureManifest(makeManifest({ ...validPaths, retail: `tools/parity/out/captures/101per/${'c'.repeat(64)}/retail.json` }), retained), /content-addressed capture directory/i);
  assert.throws(() => validateCanonicalCaptureManifest(makeManifest({ ...validPaths, engine: `C:/foreign/tools/parity/out/captures/101per/${captureId}/engine.json` }), retained), /content-addressed capture directory/i);
  assert.throws(() => validateCanonicalCaptureManifest(makeManifest({ ...validPaths, retail: `tools/parity/out/captures/101per/${captureId}/../retail.json` }), retained), /content-addressed capture directory/i);
  assert.throws(() => validateCanonicalCaptureManifest(makeManifest({ ...validPaths, comparison: `tools/parity/out/captures/101per/${captureId}/nested/comparison.json` }), retained), /artifact path is invalid/i);
  assert.throws(() => validateCanonicalCaptureManifest(makeManifest({ ...validPaths, comparison: `tools\\parity\\out\\captures\\101per\\${captureId}\\comparison.json` }), retained), /content-addressed capture directory/i);
  assert.throws(() => validateCanonicalCaptureManifest(makeManifest(validPaths, 'd'.repeat(64)), retained), /captureId does not match/i);
  assert.throws(() => validateCanonicalCaptureManifest(makeManifest({ ...validPaths, engine: `${validPaths.engine}:stream` }), retained), /artifact path is invalid/i);
  const extra = makeManifest(validPaths);
  extra.artifacts.unverified = { path: 'C:/untrusted-parent/evidence.json', sha256: 'e'.repeat(64) };
  assert.throws(() => validateCanonicalCaptureManifest(extra, retained), /unsupported artifact/i);
});

test('retained artifact filesystem resolution rejects junctions and does not depend on cwd', () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const { resolveRetainedArtifactPath } = require('./parity-contract');
  const captureId = require('crypto').randomBytes(32).toString('hex');
  const moduleRoot = path.resolve(__dirname, 'out/captures/path_test');
  const captureRoot = path.join(moduleRoot, captureId);
  const foreignRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-path-test-'));
  const reference = `tools/parity/out/captures/path_test/${captureId}/engine.json`;
  fs.mkdirSync(moduleRoot, { recursive: true });
  try {
    fs.writeFileSync(path.join(foreignRoot, 'engine.json'), '{}');
    fs.symlinkSync(foreignRoot, captureRoot, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => resolveRetainedArtifactPath(reference), /symlink|reparse/i);
    fs.unlinkSync(captureRoot);
    fs.mkdirSync(captureRoot);
    fs.writeFileSync(path.join(captureRoot, 'engine.json'), '{}');
    assert.equal(resolveRetainedArtifactPath(reference), path.join(captureRoot, 'engine.json'));
    const fromForeignCwd = require('child_process').execFileSync(process.execPath, [
      '-e', 'process.stdout.write(require(process.argv[1]).resolveRetainedArtifactPath(process.argv[2]))',
      path.join(__dirname, 'parity-contract.js'), reference,
    ], { cwd: foreignRoot, encoding: 'utf8' });
    assert.equal(fromForeignCwd, path.join(captureRoot, 'engine.json'));
    assert.throws(() => resolveRetainedArtifactPath(`${reference}:stream`), /artifact path/i);
    assert.throws(() => resolveRetainedArtifactPath(`C:/untrusted-parent/${reference}`), /artifact path/i);
  } finally {
    if (fs.existsSync(captureRoot) && fs.lstatSync(captureRoot).isSymbolicLink()) fs.unlinkSync(captureRoot);
    else fs.rmSync(captureRoot, { recursive: true, force: true });
    fs.rmSync(foreignRoot, { recursive: true, force: true });
  }
});
