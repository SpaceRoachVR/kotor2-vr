import { describe, expect, test } from '@jest/globals';
import {
  createDefectRecord,
  type DefectRecordInput,
} from '@/qa/DefectLedger';

function completeDefect(): DefectRecordInput {
  return {
    id: 'peragus-door-001',
    title: 'Blast door ignores authored key requirement',
    module: '101PER',
    room: '101PER_01',
    severity: 'blocker',
    status: 'open',
    expected: 'The blast door requires its authored key path.',
    observed: 'Security is offered before the key path completes.',
    reproductionSteps: ['Load a new 101PER save.', 'Target the blast door.'],
    evidenceRefs: ['checkpoint:101PER-start', 'trace:door-18'],
  };
}

describe('defect ledger records', () => {
  test('creates a complete immutable evidence record', () => {
    const input = completeDefect();

    const record = createDefectRecord(input);

    expect(record).toEqual(completeDefect());
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.reproductionSteps)).toBe(true);

    input.reproductionSteps[0] = 'Mutated after capture';

    expect(record.reproductionSteps[0]).toBe('Load a new 101PER save.');
  });

  test.each([
    ['id', (input: DefectRecordInput) => { input.id = ''; }],
    ['title', (input: DefectRecordInput) => { input.title = ' '; }],
    ['expected behavior', (input: DefectRecordInput) => { input.expected = ''; }],
    ['observed behavior', (input: DefectRecordInput) => { input.observed = ''; }],
    ['reproduction step', (input: DefectRecordInput) => { input.reproductionSteps = ['']; }],
    ['evidence reference', (input: DefectRecordInput) => { input.evidenceRefs = ['']; }],
    ['severity', (input: DefectRecordInput) => { input.severity = 'urgent' as never; }],
  ])('rejects an invalid or empty %s', (_field, mutate) => {
    const input = completeDefect();
    mutate(input);

    expect(() => createDefectRecord(input)).toThrow(/defect/i);
  });
});
