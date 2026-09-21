/** Converts confirmed parity findings into DefectLedger-compatible records. */

const DEFECT_CLASSIFICATION = 'engine-defect';
const fs = require('fs');
const { validateCanonicalCaptureManifest, validateCaptureManifestPaths, resolveRetainedArtifactPath } = require('./parity-contract');
const SEVERITIES = new Set(['blocker', 'critical', 'major', 'minor', 'cosmetic']);
const SEVERITY_ORDER = ['cosmetic', 'minor', 'major', 'critical', 'blocker'];

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`Parity ledger adapter requires ${field}`);
  return value;
}

function optionalStringArray(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`Parity ledger adapter requires ${field} to be an array`);
  return value.map((entry, index) => nonEmptyString(entry, `${field}[${index}]`));
}

function serializeFindingValue(value, field) {
  if (value === undefined) throw new TypeError(`Promoted parity finding requires ${field}`);
  if (typeof value === 'string' && value.length > 0) return value;
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string' || serialized.length === 0) throw new TypeError('not JSON serializable');
    return serialized;
  } catch (error) {
    throw new TypeError(`Promoted parity finding requires JSON-serializable ${field}: ${error.message}`);
  }
}

function defectId(module, code) {
  const normalizedCode = code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!normalizedCode) throw new TypeError('Promoted parity finding requires a usable code');
  return `parity-${module.toLowerCase()}-${normalizedCode}`;
}

function normalizedCode(code) {
  return code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function findingObject(finding) {
  return typeof finding.object === 'string' && finding.object.trim() ? finding.object : '(module-wide)';
}

function groupConfirmedFindings(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const code = nonEmptyString(finding.code, 'finding code');
    const key = normalizedCode(code);
    if (!key) throw new TypeError('Promoted parity finding requires a usable code');
    if (!groups.has(key)) groups.set(key, { codes: new Set(), findings: [] });
    groups.get(key).codes.add(code);
    groups.get(key).findings.push(finding);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, group]) => ({ code: [...group.codes].sort(compareText)[0], findings: group.findings }));
}

function sortedFindings(findings) {
  return [...findings].sort((left, right) => {
    const byObject = findingObject(left).localeCompare(findingObject(right));
    return byObject || JSON.stringify(left).localeCompare(JSON.stringify(right));
  });
}

function groupedValue(findings, field) {
  if (findings.length === 1) return serializeFindingValue(findings[0][field], field);
  return JSON.stringify(findings.map((finding) => ({ object: findingObject(finding), value: finding[field] })));
}

function chooseSeverity(findings) {
  const requested = findings.map((finding) => finding.severity === undefined ? 'major' : finding.severity);
  for (const severity of requested) if (!SEVERITIES.has(severity)) throw new TypeError(`Promoted parity finding has unsupported severity: ${severity}`);
  return requested.reduce((highest, severity) => SEVERITY_ORDER.indexOf(severity) > SEVERITY_ORDER.indexOf(highest) ? severity : highest, 'cosmetic');
}

function groupedSteps(findings, module) {
  const procedures = findings
    .map((finding) => optionalStringArray(finding.reproductionSteps, 'reproduction steps'))
    .filter((steps) => steps.length > 0);
  if (procedures.length === 0) return [`node tools/parity/compare.js --module ${module}`];

  // Steps are a temporal procedure, not an unordered set.  Deduplicate only
  // identical whole procedures; flattening preserves each retained procedure's
  // authored order.
  const seenProcedures = new Set();
  return procedures.flatMap((steps) => {
    const key = JSON.stringify(steps);
    if (seenProcedures.has(key)) return [];
    seenProcedures.add(key);
    return steps;
  });
}

function retainedEvidenceReferences(capture, module, findings) {
  const immutableArtifacts = Object.values(capture.manifest.artifacts || {})
    .filter((artifact) => artifact && typeof artifact.path === 'string')
    .map((artifact) => artifact.path);
  const immutablePaths = new Set(immutableArtifacts);
  const mutableSidecar = `tools/parity/out/${module.toLowerCase()}.evidence.json`;
  const retainedSidecar = capture.manifest.artifacts.sidecar && capture.manifest.artifacts.sidecar.path;
  const references = [];
  for (const finding of findings) {
    for (const reference of optionalStringArray(finding.evidenceRefs, 'finding evidence references')) {
      if (reference === mutableSidecar && typeof retainedSidecar === 'string') {
        references.push(retainedSidecar);
      } else if (immutablePaths.has(reference)) {
        references.push(reference);
      } else {
        throw new TypeError(`Promoted parity finding references unretained mutable evidence: ${reference}`);
      }
    }
  }
  return [...new Set(references)];
}

function requireBaselineEvidence(report, module) {
  const refs = optionalStringArray(report.evidenceRefs, 'report evidence references');
  const expected = [
    `tools/parity/out/${module.toLowerCase()}.engine.json`,
    `tools/parity/out/${module.toLowerCase()}.retail.json`,
  ];
  const available = new Set(refs);
  for (const evidenceRef of expected) {
    if (!available.has(evidenceRef)) {
      throw new TypeError(`Parity ledger adapter requires retained ${evidenceRef.includes('.engine.') ? 'engine' : 'retail'} baseline evidence: ${evidenceRef}`);
    }
  }
  return refs;
}

function validatePromotedFindings(findings) {
  for (const finding of findings) {
    nonEmptyString(finding.code, 'finding code');
    if (finding.expected === undefined) throw new TypeError('Promoted parity finding requires expected');
    if (finding.observed === undefined) throw new TypeError('Promoted parity finding requires observed');
  }
}

function toParityDefectRecords(report, reportPath, options = {}) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new TypeError('Parity ledger adapter requires a report object');
  const module = nonEmptyString(report.module, 'report module').toUpperCase();
  const reportReference = nonEmptyString(reportPath, 'report path');

  if (!report.captureManifest) throw new TypeError('Parity ledger adapter requires a verified canonical capture manifest');
  validateCaptureManifestPaths(report.captureManifest);
  const readArtifact = typeof options.readArtifact === 'function'
    ? options.readArtifact
    : (artifactPath) => fs.readFileSync(resolveRetainedArtifactPath(artifactPath), 'utf8');
  const artifacts = {};
  for (const artifact of Object.values(report.captureManifest.artifacts || {})) {
    if (artifact && artifact.path) artifacts[artifact.path] = readArtifact(artifact.path);
  }
  const capture = validateCanonicalCaptureManifest(report.captureManifest, artifacts);
  if (capture.module !== module) throw new TypeError('Parity ledger adapter capture manifest module mismatch');
  if (!Array.isArray(capture.comparison.findings)) throw new TypeError('Parity ledger adapter retained comparison requires findings');
  const confirmed = capture.comparison.findings.filter((finding) => finding && typeof finding === 'object'
    && finding.classification === DEFECT_CLASSIFICATION);
  if (confirmed.length === 0) return [];
  validatePromotedFindings(confirmed);

  // A report pathname says where a claim was written, not what was compared.
  // Retained engine and retail snapshot references are mandatory provenance.
  // Do not carry mutable tools/parity/out/<module> convenience pointers into
  // the ledger.  A ledger record must keep resolving to the exact capture it
  // was promoted from even after a later capture replaces the latest files.
  const evidenceBase = [
    capture.manifest.artifacts.comparison.path,
    capture.manifest.artifacts.engine.path,
    capture.manifest.artifacts.retail.path,
    ...(capture.manifest.artifacts.sidecar ? [capture.manifest.artifacts.sidecar.path] : []),
  ];
  return groupConfirmedFindings(confirmed).map(({ code, findings }) => {
    const ordered = sortedFindings(findings);
    const rooms = [...new Set(ordered.map((finding) => typeof finding.room === 'string' && finding.room.trim() ? finding.room : '(module-wide)'))];
    const evidenceRefs = [...new Set([...evidenceBase, ...retainedEvidenceReferences(capture, module, ordered)])];
    return {
      id: defectId(module, code), title: `${code} in ${module}`, module,
      room: rooms.length === 1 ? rooms[0] : '(module-wide)', severity: chooseSeverity(ordered), status: 'open',
      expected: groupedValue(ordered, 'expected'), observed: groupedValue(ordered, 'observed'),
      reproductionSteps: groupedSteps(ordered, module), evidenceRefs,
    };
  });
}

module.exports = { toParityDefectRecords };
