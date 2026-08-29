import { describe, expect, test } from '@jest/globals';
import { createDefectRecord } from '@/qa/DefectLedger';

// The sweep's reporting layer is plain JS under tools/, because it runs in the
// Node driver rather than in the bundle. This suite is the seam between the two:
// it proves the records the sweep emits are accepted by the REAL ledger
// validator, not by the test's own restatement of the ledger's rules.
//
// Without this, `toDefectRecords` could drift from `createDefectRecord` and the
// first anyone would know is an hour-long sweep ending in a validation throw.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toDefectRecords, rankRootCauses, summarize } = require('../../tools/vr-emulator/sweep-report');

interface SweepFinding {
  code: string;
  severity: string;
  detail: string;
  subject: string | null;
}

interface SweepReport {
  module: string;
  phase: string;
  ms: number;
  findings: SweepFinding[];
  skipped: { probe: string; error: string }[];
  truncated: Record<string, number>;
}

const REPORTS: SweepReport[] = [
  {
    module: '101PER',
    phase: 'complete',
    ms: 1200,
    findings: [
      { code: 'creature-model-missing', severity: 'major', detail: 'object has no loaded model', subject: 'Kreia' },
      { code: 'creature-model-missing', severity: 'major', detail: 'object has no loaded model', subject: 'Mining Droid' },
      { code: 'item-property-unresolved', severity: 'major', detail: 'property did not resolve', subject: 'Vibroblade @ Atton' },
    ],
    skipped: [],
    truncated: {},
  },
  {
    module: '102PER',
    phase: 'load',
    ms: 300,
    findings: [
      { code: 'module-load-timeout', severity: 'blocker', detail: 'did not settle within 300000ms', subject: '102PER' },
    ],
    skipped: [],
    truncated: {},
  },
];

describe('module sweep ledger emission', () => {
  test('every emitted record is accepted by the real ledger validator', () => {
    const records = toDefectRecords(REPORTS, 'tools/vr-emulator/evidence/module-sweep.jsonl');

    expect(records.length).toBe(3);
    for (const record of records) {
      expect(() => createDefectRecord(record)).not.toThrow();
    }
  });

  test('a validated record survives the round trip unchanged and frozen', () => {
    const [first] = toDefectRecords(REPORTS, 'evidence/module-sweep.jsonl');

    const record = createDefectRecord(first);

    expect(record.module).toBe('101PER');
    expect(record.status).toBe('open');
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.reproductionSteps)).toBe(true);
  });

  test('a finding with no subject still yields a valid record', () => {
    // `observed` interpolates the subject list; an all-null list must not leave
    // the field empty, which the validator would reject at the end of a long run.
    const singleton: SweepReport[] = [{
      module: '001EBO',
      phase: 'complete',
      ms: 10,
      findings: [{ code: 'area-has-no-rooms', severity: 'blocker', detail: 'zero rooms', subject: null }],
      skipped: [],
      truncated: {},
    }];
    const records = toDefectRecords(singleton, 'evidence/module-sweep.jsonl');

    expect(records).toHaveLength(1);
    expect(() => createDefectRecord(records[0])).not.toThrow();
  });

  test('ranking and coverage agree on the same reports', () => {
    const ranked = rankRootCauses(REPORTS);
    const summary = summarize(REPORTS);

    expect(ranked[0].code).toBe('creature-model-missing');
    expect(summary.modulesSwept).toBe(2);
    expect(summary.modulesBlocked).toBe(1);
    expect(summary.findings).toBe(
      ranked.reduce((total: number, entry: { occurrences: number }) => total + entry.occurrences, 0)
    );
  });
});
