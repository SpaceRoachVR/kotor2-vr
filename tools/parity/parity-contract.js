const CLASSIFICATIONS = Object.freeze([
  'engine-defect', 'authored-retail-behavior', 'unsupported-but-nonblocking',
  'missing-evidence', 'variable-runtime-output',
]);
const crypto = require('crypto');
const SHA256 = /^[a-f0-9]{64}$/i;
const EVIDENCE_AUTHORITIES = Object.freeze({ kotormcp: 'parsed-retail', holocron: 'human-review', dencs: 'hypothesis' });

function requireSha256(value, field) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${field} requires a SHA-256 hash`);
  return value.toLowerCase();
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

function artifactText(artifacts, artifact, name) {
  if (!artifact || typeof artifact.path !== 'string' || !artifact.path.trim()) throw new TypeError(`Canonical capture requires retained ${name} artifact`);
  requireSha256(artifact.sha256, `Canonical capture ${name} artifact`);
  const text = artifacts && artifacts[artifact.path];
  if (typeof text !== 'string') throw new TypeError(`Canonical capture ${name} artifact is not retained: ${artifact.path}`);
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
    const resref = String(record.resref || '').toLowerCase();
    const restype = String(record.restype || '').toUpperCase();
    const sha256 = requireSha256(record.sha256 || record.hash, 'Canonical capture sidecar record');
    if (!resref || !restype || !EVIDENCE_AUTHORITIES[kind] || record.authority !== EVIDENCE_AUTHORITIES[kind]) {
      throw new TypeError('Canonical capture sidecar has invalid typed authority');
    }
    if (kind === 'dencs' && (restype !== 'NCS' || retailHashes.get(`${resref}:${restype}`) !== sha256)) {
      throw new TypeError('Canonical capture DeNCS sidecar hash does not match retail NCS');
    }
  }
}

function validateCanonicalCaptureManifest(manifest, artifacts) {
  if (!manifest || manifest.schema !== 'kotor2-vr/parity-capture@1') throw new TypeError('Canonical capture manifest has an unsupported schema');
  const module = String(manifest.module || '').trim().toUpperCase();
  if (!module) throw new TypeError('Canonical capture manifest requires module');
  const engine = artifactText(artifacts, manifest.artifacts && manifest.artifacts.engine, 'engine');
  const retail = artifactText(artifacts, manifest.artifacts && manifest.artifacts.retail, 'retail');
  const comparison = artifactText(artifacts, manifest.artifacts && manifest.artifacts.comparison, 'comparison');
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
  const sidecar = manifest.artifacts.sidecar ? artifactText(artifacts, manifest.artifacts.sidecar, 'sidecar') : null;
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

module.exports = { CLASSIFICATIONS, createCaptureIdentity, validateEvidenceRecord, validateCanonicalCaptureManifest };
