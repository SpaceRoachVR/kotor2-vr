import { describe, expect, test } from '@jest/globals';
import { createDefectRecord } from '@/qa/DefectLedger';
import { createHash } from 'crypto';

// The parity adapter runs under Node as CommonJS. This test protects the seam
// by validating its output with the production ledger contract rather than a
// duplicate validator.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toParityDefectRecords } = require('../../tools/parity/ledger-adapter');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { deriveCaptureId } = require('../../tools/parity/parity-contract');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { normalizeFindingForReport } = require('../../tools/parity/compare');

const engineArtifact = JSON.stringify({ module: '101per', loadedFromSave: false, bootstrap: 'new-game-ui', playerName: 'T3-M4', partySize: 1, engineIdentity: {
  module: '101PER', freshState: true, loadedFromSave: false, servingBundleSha256: 'a'.repeat(64),
} });
const retailArtifact = JSON.stringify({ module: '101per', retailInputs: [{ resref: '101per', restype: 'RIM', sha256: 'b'.repeat(64) }] });
const sidecarIdentity = { resref: 'metalstrain', restype: 'UTS', source: 'module', sha256: 'a'.repeat(64) };
const sidecarArtifact = JSON.stringify({ module: '101PER', records: [{ ...sidecarIdentity, kind: 'kotormcp', authority: 'parsed-retail' }] });
const hash = (contents: string): string => createHash('sha256').update(contents).digest('hex');
function promoteRetainedReport(report: { module: string; findings: unknown[]; [key: string]: unknown }, reportPath: string) {
  const comparisonArtifact = JSON.stringify({ module: report.module.toLowerCase(), findings: report.findings });
  const rawArtifacts = {
    engine: { sha256: hash(engineArtifact) }, retail: { sha256: hash(retailArtifact) },
    comparison: { sha256: hash(comparisonArtifact) }, sidecar: { sha256: hash(sidecarArtifact) },
  };
  const captureId = deriveCaptureId('101PER', rawArtifacts);
  const artifacts = Object.fromEntries(Object.entries(rawArtifacts).map(([name, artifact]) => [name, {
    ...artifact, path: `tools/parity/out/captures/101per/${captureId}/${name}.json`,
  }]));
  report.captureManifest = {
    schema: 'kotor2-vr/parity-capture@1', module: '101PER', captureId, artifacts,
  };
  return toParityDefectRecords(report, reportPath, { readArtifact: (artifactPath: string): string | undefined => ({
    [`tools/parity/out/captures/101per/${captureId}/engine.json`]: engineArtifact,
    [`tools/parity/out/captures/101per/${captureId}/retail.json`]: retailArtifact,
    [`tools/parity/out/captures/101per/${captureId}/comparison.json`]: comparisonArtifact,
    [`tools/parity/out/captures/101per/${captureId}/sidecar.json`]: sidecarArtifact,
  })[artifactPath] });
}

describe('parity ledger adapter', () => {
  test('every promoted parity record satisfies the real ledger contract', () => {
    const report = {
      module: '101PER',
      evidenceRefs: ['tools/parity/out/101per.engine.json', 'tools/parity/out/101per.retail.json'],
      findings: [
        {
          classification: 'engine-defect', code: 'sound:play-style', object: 'metalstrain#0',
          expected: 'loop', observed: 'oneshot',
          resourceIdentity: sidecarIdentity,
          evidenceRefs: ['tools/parity/out/101per.evidence.json'],
        },
        {
          classification: 'missing-evidence', code: 'sound:continuous', object: 'rumble#1',
          expected: 'loop', observed: 'unknown', evidenceRefs: ['tools/parity/out/101per.evidence.json'],
        },
      ],
    };
    const records = promoteRetainedReport(report, 'tools/parity/out/101per.parity.json');

    expect(records).toHaveLength(1);
    for (const record of records) {
      expect(() => createDefectRecord(record)).not.toThrow();
    }
  });

  test('accepts normalized comparator arrays and nulls through the real ledger contract', () => {
    const finding = normalizeFindingForReport({
      confidence: 'defect', code: 'powers', object: 't3m4#0', retail: [100, 101], engine: null,
    });
    const report = {
      module: '101PER', findings: [finding],
      evidenceRefs: ['tools/parity/out/101per.engine.json', 'tools/parity/out/101per.retail.json'],
    };
    const [record] = promoteRetainedReport(report, 'tools/parity/out/101per.parity.json');

    expect(record.expected).toBe('[100,101]');
    expect(record.observed).toBe('null');
    expect(() => createDefectRecord(record)).not.toThrow();
  });
});
