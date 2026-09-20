/**
 * Converts confirmed parity mismatches into the shared DefectLedger input
 * shape. This is intentionally a one-way boundary: observations with any
 * other classification remain in the parity report and cannot enter the
 * defect work queue.
 */

const DEFECT_CLASSIFICATION = 'engine-defect';
const SEVERITIES = new Set(['blocker', 'critical', 'major', 'minor', 'cosmetic']);

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`Parity ledger adapter requires ${field}`);
  }
  return value;
}

function requiredFindingValue(finding, field) {
  if (finding[field] === undefined || finding[field] === null) {
    throw new TypeError(`Promoted parity finding requires ${field}`);
  }
  return String(finding[field]);
}

function requiredStringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`Promoted parity finding requires ${field}`);
  }
  return value.map((entry, index) => nonEmptyString(entry, `${field}[${index}]`));
}

function defectId(module, code) {
  const normalizedCode = code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!normalizedCode) throw new TypeError('Promoted parity finding requires a usable code');
  return `parity-${module.toLowerCase()}-${normalizedCode}`;
}

function toParityDefectRecords(report, reportPath) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new TypeError('Parity ledger adapter requires a report object');
  }
  const module = nonEmptyString(report.module, 'report module').toUpperCase();
  if (!Array.isArray(report.findings)) {
    throw new TypeError('Parity ledger adapter requires report findings');
  }

  const confirmedFindings = report.findings.filter((finding) =>
    finding && typeof finding === 'object' && finding.classification === DEFECT_CLASSIFICATION,
  );
  if (confirmedFindings.length === 0) return [];

  const exactReportPath = nonEmptyString(reportPath, 'report path');
  const emittedIds = new Set();
  return confirmedFindings.map((finding) => {
    const code = nonEmptyString(finding.code, 'finding code');
    const id = defectId(module, code);
    if (emittedIds.has(id)) {
      throw new TypeError(`Promoted parity findings require unique ledger ids: ${id}`);
    }
    emittedIds.add(id);

    const severity = finding.severity === undefined ? 'major' : finding.severity;
    if (!SEVERITIES.has(severity)) {
      throw new TypeError(`Promoted parity finding has unsupported severity: ${severity}`);
    }
    const evidenceRefs = [exactReportPath, ...requiredStringArray(finding.evidenceRefs || [], 'evidence references')];
    return {
      id,
      title: `${code} in ${module}`,
      module,
      room: typeof finding.room === 'string' && finding.room.trim() ? finding.room : '(module-wide)',
      severity,
      status: 'open',
      expected: requiredFindingValue(finding, 'expected'),
      observed: requiredFindingValue(finding, 'observed'),
      reproductionSteps: finding.reproductionSteps === undefined
        ? [`node tools/parity/compare.js --module ${module}`]
        : requiredStringArray(finding.reproductionSteps, 'reproduction steps'),
      evidenceRefs: [...new Set(evidenceRefs)],
    };
  });
}

module.exports = { toParityDefectRecords };
