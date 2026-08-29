/**
 * Aggregation for the module sweep: turns per-module reports into the two
 * things the roadmap actually needs from a sweep.
 *
 *   1. **A root-cause ranking.** The sweep's value is not the raw finding list;
 *      it is knowing which faults are systemic. `MenuJournal.BTN_EXIT` unwired
 *      and the `feats.2da` padding hole were each found by walking into them
 *      once, in one area, with no way to see that the same cause was breaking
 *      dozens of others. Ranking by how many modules a code touches puts fixes
 *      in blast-radius order instead of encounter order.
 *   2. **A coverage number that moves.** "N of 82 modules load and render
 *      clean" is a single figure that goes up per session, which prose in a
 *      1,200-line roadmap cannot do.
 *
 * Pure functions only — no I/O, no engine, no browser. The driver does the
 * running; this decides what the run means, so it can be tested without either.
 */

/** Severity order, most severe first. Matches src/qa/DefectLedger.ts. */
const SEVERITY_ORDER = ['blocker', 'critical', 'major', 'minor', 'cosmetic'];

function severityRank(severity) {
  const index = SEVERITY_ORDER.indexOf(severity);
  return index < 0 ? SEVERITY_ORDER.length : index;
}

/**
 * Groups every finding by its code, across all modules.
 *
 * Ranked by module count first and occurrence count second, because a fault in
 * 40 modules is a bigger prize than one throwing 400 times in a single area —
 * the first is a systemic engine defect, the second is usually one bad asset.
 * Severity breaks the tie so a blocker never sorts under a cosmetic.
 *
 * @param {object[]} reports per-module reports from the probe
 * @returns {object[]} ranked root causes
 */
function rankRootCauses(reports) {
  const byCode = new Map();
  for (const report of reports) {
    for (const finding of report.findings || []) {
      let entry = byCode.get(finding.code);
      if (!entry) {
        entry = {
          code: finding.code,
          severity: finding.severity,
          modules: new Set(),
          occurrences: 0,
          examples: [],
        };
        byCode.set(finding.code, entry);
      }
      // Keep the most severe severity ever seen for a code; the same code can be
      // raised at different severities by different probes.
      if (severityRank(finding.severity) < severityRank(entry.severity)) {
        entry.severity = finding.severity;
      }
      entry.modules.add(report.module);
      entry.occurrences += 1;
      if (entry.examples.length < 5) {
        entry.examples.push({
          module: report.module,
          subject: finding.subject,
          detail: finding.detail,
        });
      }
    }
    // Findings suppressed by the per-code cap still count toward blast radius.
    for (const [code, total] of Object.entries(report.truncated || {})) {
      const entry = byCode.get(code);
      if (entry) entry.occurrences += Math.max(0, total - entry.occurrences);
    }
  }

  return Array.from(byCode.values())
    .map((entry) => ({
      code: entry.code,
      severity: entry.severity,
      moduleCount: entry.modules.size,
      modules: Array.from(entry.modules).sort(),
      occurrences: entry.occurrences,
      examples: entry.examples,
    }))
    .sort((a, b) =>
      b.moduleCount - a.moduleCount ||
      b.occurrences - a.occurrences ||
      severityRank(a.severity) - severityRank(b.severity) ||
      a.code.localeCompare(b.code));
}

/**
 * Whole-run coverage.
 *
 * `clean` is deliberately stricter than `loaded`: a module that loads but
 * renders a frame exception is not a module that works, and calling it one is
 * how a coverage metric stops being worth reading.
 */
function summarize(reports) {
  const total = reports.length;
  const loaded = reports.filter((r) => r.phase !== 'load' && r.phase !== 'bootstrap').length;
  const clean = reports.filter((r) => (r.findings || []).length === 0).length;
  const blocked = reports.filter((r) =>
    (r.findings || []).some((f) => f.severity === 'blocker')).length;

  const bySeverity = {};
  for (const severity of SEVERITY_ORDER) bySeverity[severity] = 0;
  let skippedProbes = 0;
  for (const report of reports) {
    for (const finding of report.findings || []) {
      bySeverity[finding.severity] = (bySeverity[finding.severity] || 0) + 1;
    }
    skippedProbes += (report.skipped || []).length;
  }

  return {
    modulesSwept: total,
    modulesLoaded: loaded,
    modulesClean: clean,
    modulesBlocked: blocked,
    findings: Object.values(bySeverity).reduce((a, b) => a + b, 0),
    bySeverity,
    skippedProbes,
    totalMs: reports.reduce((sum, r) => sum + (r.ms || 0), 0),
  };
}

/**
 * Emits one `DefectRecord`-shaped object per (code, module) pair.
 *
 * Shaped to satisfy `createDefectRecord`'s validation in src/qa/DefectLedger.ts,
 * so ledger entries produced by the sweep are the same artefact as ones written
 * by hand. `room` is `(module-wide)` rather than a guess: the battery works at
 * module scope, and inventing a room to satisfy a required field would put a
 * fabricated location into evidence.
 */
function toDefectRecords(reports, evidencePath) {
  const records = [];
  for (const report of reports) {
    const byCode = new Map();
    for (const finding of report.findings || []) {
      if (!byCode.has(finding.code)) byCode.set(finding.code, []);
      byCode.get(finding.code).push(finding);
    }
    for (const [code, findings] of byCode) {
      const subjects = findings
        .map((f) => f.subject)
        .filter(Boolean)
        .slice(0, 10);
      records.push({
        id: `sweep-${report.module.toLowerCase()}-${code}`,
        title: `${code} in ${report.module} (${findings.length}×)`,
        module: report.module,
        room: '(module-wide)',
        severity: findings[0].severity,
        status: 'open',
        expected: `${report.module} loads and renders with no ${code} finding.`,
        observed: `${findings.length} occurrence(s). ${findings[0].detail}` +
          (subjects.length ? ` Subjects: ${subjects.join(', ')}.` : ''),
        reproductionSteps: [
          `npm run vr:sweep -- --modules ${report.module}`,
          `Read the ${code} findings in the emitted report.`,
        ],
        evidenceRefs: [evidencePath || 'tools/vr-emulator/evidence/module-sweep.jsonl'],
      });
    }
  }
  return records;
}

/** Renders the ranked causes as a fixed-width table for the terminal. */
function renderRanking(ranked, limit = 20) {
  if (!ranked.length) return '  (no findings)';
  const rows = ranked.slice(0, limit);
  const codeWidth = Math.max(4, ...rows.map((r) => r.code.length));
  const lines = [
    `  ${'CODE'.padEnd(codeWidth)}  SEVERITY   MODULES  OCCURRENCES`,
    `  ${'-'.repeat(codeWidth)}  ---------  -------  -----------`,
  ];
  for (const row of rows) {
    lines.push(
      `  ${row.code.padEnd(codeWidth)}  ${row.severity.padEnd(9)}  ` +
      `${String(row.moduleCount).padStart(7)}  ${String(row.occurrences).padStart(11)}`
    );
  }
  if (ranked.length > limit) {
    lines.push(`  … and ${ranked.length - limit} more codes`);
  }
  return lines.join('\n');
}

module.exports = {
  SEVERITY_ORDER,
  severityRank,
  rankRootCauses,
  summarize,
  toDefectRecords,
  renderRanking,
};
