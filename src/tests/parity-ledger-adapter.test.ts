import { describe, expect, test } from '@jest/globals';
import { createDefectRecord } from '@/qa/DefectLedger';
import { createHash } from 'crypto';

// The parity adapter runs under Node as CommonJS. This test protects the seam
// by validating its output with the production ledger contract rather than a
// duplicate validator.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toParityDefectRecords } = require('../../tools/parity/ledger-adapter');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { normalizeFindingForReport } = require('../../tools/parity/compare');

const engineArtifact = JSON.stringify({ module: '101per', engineIdentity: {
  module: '101PER', freshState: true, loadedFromSave: false, servingBundleSha256: 'a'.repeat(64),
} });
const retailArtifact = JSON.stringify({ module: '101per', retailInputs: [{ resref: '101per', restype: 'RIM', sha256: 'b'.repeat(64) }] });
const comparisonArtifact = JSON.stringify({ module: '101per', findings: [] });
const hash = (contents: string): string => createHash('sha256').update(contents).digest('hex');
const canonicalCaptureManifest = {
  schema: 'kotor2-vr/parity-capture@1', module: '101PER', artifacts: {
    engine: { path: 'engine.json', sha256: hash(engineArtifact) },
    retail: { path: 'retail.json', sha256: hash(retailArtifact) },
    comparison: { path: 'comparison.json', sha256: hash(comparisonArtifact) },
  },
};
const readRetainedArtifact = (artifactPath: string): string | undefined => ({
  'engine.json': engineArtifact, 'retail.json': retailArtifact, 'comparison.json': comparisonArtifact,
})[artifactPath];

describe('parity ledger adapter', () => {
  test('every promoted parity record satisfies the real ledger contract', () => {
    const records = toParityDefectRecords({
      module: '101PER',
      captureManifest: canonicalCaptureManifest,
      evidenceRefs: ['tools/parity/out/101per.engine.json', 'tools/parity/out/101per.retail.json'],
      findings: [
        {
          classification: 'engine-defect', code: 'sound:play-style', object: 'metalstrain#0',
          expected: 'loop', observed: 'oneshot',
          evidenceRefs: ['tools/parity/out/101per.evidence.json'],
        },
        {
          classification: 'missing-evidence', code: 'sound:continuous', object: 'rumble#1',
          expected: 'loop', observed: 'unknown', evidenceRefs: ['tools/parity/out/101per.evidence.json'],
        },
      ],
    }, 'tools/parity/out/101per.parity.json', { readArtifact: readRetainedArtifact });

    expect(records).toHaveLength(1);
    for (const record of records) {
      expect(() => createDefectRecord(record)).not.toThrow();
    }
  });

  test('accepts normalized comparator arrays and nulls through the real ledger contract', () => {
    const finding = normalizeFindingForReport({
      confidence: 'defect', code: 'powers', object: 't3m4#0', retail: [100, 101], engine: null,
    });
    const [record] = toParityDefectRecords({
      module: '101PER', findings: [finding],
      captureManifest: canonicalCaptureManifest,
      evidenceRefs: ['tools/parity/out/101per.engine.json', 'tools/parity/out/101per.retail.json'],
    }, 'tools/parity/out/101per.parity.json', { readArtifact: readRetainedArtifact });

    expect(record.expected).toBe('[100,101]');
    expect(record.observed).toBe('null');
    expect(() => createDefectRecord(record)).not.toThrow();
  });
});
