/** Converts confirmed parity findings into DefectLedger-compatible records. */

const DEFECT_CLASSIFICATION = 'engine-defect';
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

function findingObject(finding) {
  return typeof finding.object === 'string' && finding.object.trim() ? finding.object : '(module-wide)';
}

function groupConfirmedFindings(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const code = nonEmptyString(finding.code, 'finding code');
    const key = code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!key) throw new TypeError('Promoted parity finding requires a usable code');
    if (!groups.has(key)) groups.set(key, { code, findings: [] });
    groups.get(key).findings.push(finding);
  }
  return [...groups.values()].sort((left, right) => left.code.localeCompare(right.code));
}

function sortedFindings(findings) {
  return [...findings].sort((left, right) => {
    const byObject = findingObject(left).localeCompare(findingObject(right));
    return byObject || JSON.stringify(left).localeCompare(JSON.stringify(right));
  });
}

function groupedValue(findings, field) {
  if (findings.length === 1) return serializeFindingValue(findings[0][field], field);
  return JSON.stringify(findings.map((finding) => ({ object: findingObject(finding), value: finding[field] === undefined ? null : finding[field] })));
}

function chooseSeverity(findings) {
  const requested = findings.map((finding) => finding.severity === undefined ? 'major' : finding.severity);
  for (const severity of requested) if (!SEVERITIES.has(severity)) throw new TypeError(`Promoted parity finding has unsupported severity: ${severity}`);
  return requested.reduce((highest, severity) => SEVERITY_ORDER.indexOf(severity) > SEVERITY_ORDER.indexOf(highest) ? severity : highest, 'cosmetic');
}

function groupedSteps(findings, module) {
  const steps = findings.flatMap((finding) => optionalStringArray(finding.reproductionSteps, 'reproduction steps'));
  return steps.length > 0 ? [...new Set(steps)].sort() : [`node tools/parity/compare.js --module ${module}`];
}

function toParityDefectRecords(report, reportPath) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new TypeError('Parity ledger adapter requires a report object');
  const module = nonEmptyString(report.module, 'report module').toUpperCase();
  if (!Array.isArray(report.findings)) throw new TypeError('Parity ledger adapter requires report findings');
  const confirmed = report.findings.filter((finding) => finding && typeof finding === 'object' && finding.classification === DEFECT_CLASSIFICATION);
  if (confirmed.length === 0) return [];

  // The retained parity report is universal evidence. compare.js adds both
  // baseline snapshots at report level; finding sidecars are supplementary.
  const evidenceBase = [nonEmptyString(reportPath, 'report path'), ...optionalStringArray(report.evidenceRefs, 'report evidence references')];
  return groupConfirmedFindings(confirmed).map(({ code, findings }) => {
    const ordered = sortedFindings(findings);
    const rooms = [...new Set(ordered.map((finding) => typeof finding.room === 'string' && finding.room.trim() ? finding.room : '(module-wide)'))];
    const evidenceRefs = [...new Set([...evidenceBase, ...ordered.flatMap((finding) => optionalStringArray(finding.evidenceRefs, 'finding evidence references'))])];
    return {
      id: defectId(module, code), title: `${code} in ${module}`, module,
      room: rooms.length === 1 ? rooms[0] : '(module-wide)', severity: chooseSeverity(ordered), status: 'open',
      expected: groupedValue(ordered, 'expected'), observed: groupedValue(ordered, 'observed'),
      reproductionSteps: groupedSteps(ordered, module), evidenceRefs,
    };
  });
}

module.exports = { toParityDefectRecords };
