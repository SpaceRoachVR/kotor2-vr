const CLASSIFICATIONS = Object.freeze([
  'engine-defect', 'authored-retail-behavior', 'unsupported-but-nonblocking',
  'missing-evidence', 'variable-runtime-output',
]);
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const SHA256 = /^[a-f0-9]{64}$/i;
const EVIDENCE_AUTHORITIES = Object.freeze({ kotormcp: 'parsed-retail', holocron: 'human-review', dencs: 'hypothesis' });
const CAPTURE_ARTIFACT_NAMES = Object.freeze(['engine', 'retail', 'comparison', 'sidecar']);
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..');

function requireSha256(value, field) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${field} requires a SHA-256 hash`);
  return value.toLowerCase();
}

function deriveCaptureId(module, artifacts) {
  const normalizedModule = String(module || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{1,16}$/.test(normalizedModule)) throw new TypeError('Canonical capture requires a valid module identifier');
  if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) throw new TypeError('Canonical capture requires artifacts');
  const sourceHashes = {};
  for (const name of ['engine', 'retail', 'comparison']) {
    if (!artifacts[name]) throw new TypeError(`Canonical capture requires retained ${name} artifact`);
    sourceHashes[name] = requireSha256(artifacts[name].sha256, `Canonical capture ${name} artifact`);
  }
  if (artifacts.sidecar) sourceHashes.sidecar = requireSha256(artifacts.sidecar.sha256, 'Canonical capture sidecar artifact');
  return crypto.createHash('sha256').update(JSON.stringify({ module: normalizedModule, sourceHashes })).digest('hex');
}

function requireCaptureArtifactPath(artifact, artifactName, module, captureId) {
  if (!artifact || typeof artifact.path !== 'string' || !artifact.path.trim()) throw new TypeError(`Canonical capture requires retained ${artifactName} artifact`);
  const normalizedModule = module.toLowerCase();
  const expectedDirectory = `tools/parity/out/captures/${normalizedModule}/${captureId}/`;
  // Manifest paths are deliberately workspace-relative POSIX paths.  Accepting
  // an absolute suffix (or a path merely containing this directory) lets a
  // foreign capture masquerade as retained evidence.
  if (artifact.path.includes('\\') || path.posix.normalize(artifact.path) !== artifact.path
      || !artifact.path.startsWith(expectedDirectory)) {
    throw new TypeError(`Canonical capture ${artifactName} artifact is not beneath its content-addressed capture directory`);
  }
  const suffix = artifact.path.slice(expectedDirectory.length);
  if (suffix !== `${artifactName}.json`) {
    throw new TypeError(`Canonical capture ${artifactName} artifact path is invalid`);
  }
  return artifact.path;
}

/** Resolve retained evidence against this checkout, never the caller's cwd. */
function resolveRetainedArtifactPath(reference) {
  if (typeof reference !== 'string'
      || !/^tools\/parity\/out\/captures\/[a-z0-9_]{1,16}\/[a-f0-9]{64}\/(engine|retail|comparison|sidecar)\.json$/.test(reference)) {
    throw new TypeError('Canonical capture artifact path is invalid');
  }
  return assertUnlinkedWorkspacePath(path.resolve(WORKSPACE_ROOT, reference), true);
}

/** Also used before retention so a pre-existing junction cannot redirect writes. */
function assertUnlinkedWorkspacePath(absolutePath, requireFile = false) {
  const relative = path.relative(WORKSPACE_ROOT, absolutePath);
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep).includes('..')) {
    throw new TypeError('Canonical capture path escaped the workspace');
  }
  let current = fs.realpathSync(WORKSPACE_ROOT);
  const segments = relative.split(path.sep);
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    const stats = fs.lstatSync(current);
    if (stats.isSymbolicLink() || fs.realpathSync(current) !== current) {
      throw new TypeError('Canonical capture path contains a symlink or reparse point');
    }
    const isFile = requireFile && index === segments.length - 1;
    if (isFile ? !stats.isFile() : !stats.isDirectory()) throw new TypeError('Canonical capture path has an unexpected file type');
  }
  return path.resolve(WORKSPACE_ROOT, relative);
}

function createCaptureIdentity(input) {
  if (!input || input.freshState !== true || input.loadedFromSave === true) {
    throw new TypeError('Canonical parity capture must be fresh and not save-derived');
  }

  for (const field of ['module']) {
    if (typeof input[field] !== 'string' || !input[field].trim()) {
      throw new TypeError(`Capture identity requires ${field}`);
    }
  }
  if (typeof input.servingBundleSha256 !== 'string' || !input.servingBundleSha256.trim()) {
    throw new TypeError('Canonical capture identity requires serving bundle SHA-256');
  }
  requireSha256(input.servingBundleSha256, 'Canonical capture serving bundle');

  if (!Array.isArray(input.retailInputs) || input.retailInputs.length === 0) {
    throw new TypeError('Capture identity requires retail inputs');
  }

  return Object.freeze({
    ...input,
    module: input.module.toUpperCase(),
    engineCommit: typeof input.engineCommit === 'string' && input.engineCommit.trim() ? input.engineCommit : null,
    bundleMtime: typeof input.bundleMtime === 'string' && input.bundleMtime.trim() ? input.bundleMtime : null,
    retailInputs: Object.freeze([...input.retailInputs]),
  });
}

function artifactText(artifacts, artifact, name, module, captureId) {
  const artifactPath = requireCaptureArtifactPath(artifact, name, module, captureId);
  requireSha256(artifact.sha256, `Canonical capture ${name} artifact`);
  const text = artifacts && artifacts[artifactPath];
  if (typeof text !== 'string') throw new TypeError(`Canonical capture ${name} artifact is not retained: ${artifactPath}`);
  const actual = crypto.createHash('sha256').update(text).digest('hex');
  if (actual !== artifact.sha256.toLowerCase()) throw new TypeError(`Canonical capture ${name} artifact hash does not match retained content`);
  try { return JSON.parse(text); } catch { throw new TypeError(`Canonical capture ${name} artifact is not valid JSON`); }
}

function validateManifestSidecar(sidecar, retail, module) {
  if (!sidecar || String(sidecar.module || '').toUpperCase() !== module) throw new TypeError('Canonical capture sidecar module mismatch');
  if (!Array.isArray(sidecar.records)) throw new TypeError('Canonical capture sidecar requires records');
  const retailHashes = new Map(retail.retailInputs.map((input) => [
    `${String(input.resref).toLowerCase()}:${String(input.restype).toUpperCase()}`, requireSha256(input.sha256, 'Canonical capture retail input'),
  ]));
  for (const record of sidecar.records) {
    if (!record || typeof record !== 'object') throw new TypeError('Canonical capture sidecar record must be an object');
    const kind = String(record.kind || '').toLowerCase();
    if (typeof record.resref !== 'string' || !record.resref.trim()
        || typeof record.restype !== 'string' || !record.restype.trim()) {
      throw new TypeError('Canonical capture sidecar requires typed string resource identity');
    }
    const resref = record.resref.trim().toLowerCase();
    const restype = record.restype.trim().toUpperCase();
    const sha256 = requireSha256(record.sha256 || record.hash, 'Canonical capture sidecar record');
    if (!resref || !restype || !EVIDENCE_AUTHORITIES[kind] || record.authority !== EVIDENCE_AUTHORITIES[kind]) {
      throw new TypeError('Canonical capture sidecar has invalid typed authority');
    }
    if (kind === 'dencs' && (restype !== 'NCS' || retailHashes.get(`${resref}:${restype}`) !== sha256)) {
      throw new TypeError('Canonical capture DeNCS sidecar hash does not match retail NCS');
    }
  }
}

function validateCaptureManifestPaths(manifest) {
  if (!manifest || manifest.schema !== 'kotor2-vr/parity-capture@1') throw new TypeError('Canonical capture manifest has an unsupported schema');
  const module = String(manifest.module || '').trim().toUpperCase();
  if (!module) throw new TypeError('Canonical capture manifest requires module');
  const captureId = typeof manifest.captureId === 'string' && /^[a-f0-9]{64}$/i.test(manifest.captureId)
    ? manifest.captureId.toLowerCase()
    : null;
  if (!captureId) throw new TypeError('Canonical capture manifest requires a content-addressed captureId');
  const manifestArtifacts = manifest.artifacts;
  if (deriveCaptureId(module, manifestArtifacts) !== captureId) throw new TypeError('Canonical capture manifest captureId does not match retained artifact hashes');
  for (const [name, artifact] of Object.entries(manifestArtifacts)) {
    if (!CAPTURE_ARTIFACT_NAMES.includes(name)) throw new TypeError('Canonical capture manifest contains an unsupported artifact');
    requireCaptureArtifactPath(artifact, name, module, captureId);
  }
  return { module, captureId, manifestArtifacts };
}

function validateCanonicalCaptureManifest(manifest, artifacts) {
  const { module, captureId, manifestArtifacts } = validateCaptureManifestPaths(manifest);
  const engine = artifactText(artifacts, manifestArtifacts && manifestArtifacts.engine, 'engine', module, captureId);
  const retail = artifactText(artifacts, manifestArtifacts && manifestArtifacts.retail, 'retail', module, captureId);
  const comparison = artifactText(artifacts, manifestArtifacts && manifestArtifacts.comparison, 'comparison', module, captureId);
  if (String(engine.module || '').toUpperCase() !== module || String(retail.module || '').toUpperCase() !== module
      || String(comparison.module || '').toUpperCase() !== module) {
    throw new TypeError('Canonical capture manifest artifact module mismatch');
  }
  const identity = engine.engineIdentity;
  if (!identity || identity.freshState !== true || identity.loadedFromSave !== false) {
    throw new TypeError('Canonical capture manifest rejects save-derived or unverified engine provenance');
  }
  if (String(identity.module || '').toUpperCase() !== module) throw new TypeError('Canonical capture engine identity module mismatch');
  requireSha256(identity.servingBundleSha256, 'Canonical capture serving bundle');
  if (!Array.isArray(retail.retailInputs) || retail.retailInputs.length === 0) throw new TypeError('Canonical capture requires hashed retail inputs');
  for (const input of retail.retailInputs) {
    if (!input || typeof input.resref !== 'string' || typeof input.restype !== 'string') throw new TypeError('Canonical capture retail input identity is incomplete');
    requireSha256(input.sha256, 'Canonical capture retail input');
  }
  const sidecar = manifestArtifacts.sidecar ? artifactText(artifacts, manifestArtifacts.sidecar, 'sidecar', module, captureId) : null;
  if (sidecar) validateManifestSidecar(sidecar, retail, module);
  return Object.freeze({ module, engine, retail, comparison, sidecar, identity, manifest: Object.freeze({ ...manifest }) });
}

function validateEvidenceRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new TypeError('Evidence record must be an object');
  }

  for (const field of ['kind', 'resref', 'hash', 'authority']) {
    if (typeof record[field] !== 'string' || !record[field].trim()) {
      throw new TypeError(`Evidence record requires ${field}`);
    }
  }

  return Object.freeze({ ...record });
}

module.exports = {
  CLASSIFICATIONS, createCaptureIdentity, validateEvidenceRecord, validateCanonicalCaptureManifest, deriveCaptureId,
  validateCaptureManifestPaths, resolveRetainedArtifactPath, assertUnlinkedWorkspacePath,
};
