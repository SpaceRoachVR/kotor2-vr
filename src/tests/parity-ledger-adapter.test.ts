import { describe, expect, test } from '@jest/globals';
import { createDefectRecord } from '@/qa/DefectLedger';

// The parity adapter runs under Node as CommonJS. This test protects the seam
// by validating its output with the production ledger contract rather than a
// duplicate validator.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toParityDefectRecords } = require('../../tools/parity/ledger-adapter');

describe('parity ledger adapter', () => {
  test('every promoted parity record satisfies the real ledger contract', () => {
    const records = toParityDefectRecords({
      module: '101PER',
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
    }, 'tools/parity/out/101per.parity.json');

    expect(records).toHaveLength(1);
    for (const record of records) {
      expect(() => createDefectRecord(record)).not.toThrow();
    }
  });
});
