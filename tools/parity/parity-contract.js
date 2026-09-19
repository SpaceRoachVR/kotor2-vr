const CLASSIFICATIONS = Object.freeze([
  'engine-defect', 'authored-retail-behavior', 'unsupported-but-nonblocking',
  'missing-evidence', 'variable-runtime-output',
]);

function createCaptureIdentity(input) {
  if (!input || input.freshState !== true || input.loadedFromSave === true) {
    throw new TypeError('Canonical parity capture must be fresh and not save-derived');
  }

  for (const field of ['module', 'engineCommit', 'bundleMtime']) {
    if (typeof input[field] !== 'string' || !input[field].trim()) {
      throw new TypeError(`Capture identity requires ${field}`);
    }
  }

  if (!Array.isArray(input.retailInputs) || input.retailInputs.length === 0) {
    throw new TypeError('Capture identity requires retail inputs');
  }

  return Object.freeze({
    ...input,
    module: input.module.toUpperCase(),
    retailInputs: Object.freeze([...input.retailInputs]),
  });
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

module.exports = { CLASSIFICATIONS, createCaptureIdentity, validateEvidenceRecord };
