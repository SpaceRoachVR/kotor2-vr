export type DefectSeverity = 'blocker' | 'critical' | 'major' | 'minor' | 'cosmetic';
export type DefectStatus = 'open' | 'verified' | 'resolved' | 'not-reproducible';

export interface DefectRecordInput {
  id: string;
  title: string;
  module: string;
  room: string;
  severity: DefectSeverity;
  status: DefectStatus;
  expected: string;
  observed: string;
  reproductionSteps: string[];
  evidenceRefs: string[];
}

export interface DefectRecord {
  readonly id: string;
  readonly title: string;
  readonly module: string;
  readonly room: string;
  readonly severity: DefectSeverity;
  readonly status: DefectStatus;
  readonly expected: string;
  readonly observed: string;
  readonly reproductionSteps: readonly string[];
  readonly evidenceRefs: readonly string[];
}

const SEVERITIES = new Set<DefectSeverity>(['blocker', 'critical', 'major', 'minor', 'cosmetic']);
const STATUSES = new Set<DefectStatus>(['open', 'verified', 'resolved', 'not-reproducible']);

/**
 * Produces an immutable, evidence-ready defect record. Validation happens at
 * the ledger boundary so incomplete records cannot be promoted as QA evidence.
 */
export function createDefectRecord(input: DefectRecordInput): DefectRecord {
  assertRecord(input, 'input');
  assertNonEmptyString(input.id, 'id');
  assertNonEmptyString(input.title, 'title');
  assertNonEmptyString(input.module, 'module');
  assertNonEmptyString(input.room, 'room');
  assertNonEmptyString(input.expected, 'expected behavior');
  assertNonEmptyString(input.observed, 'observed behavior');

  if (!SEVERITIES.has(input.severity)) {
    throw invalidDefect('severity is unsupported');
  }
  if (!STATUSES.has(input.status)) {
    throw invalidDefect('status is unsupported');
  }

  return Object.freeze({
    id: input.id,
    title: input.title,
    module: input.module,
    room: input.room,
    severity: input.severity,
    status: input.status,
    expected: input.expected,
    observed: input.observed,
    reproductionSteps: freezeStringArray(input.reproductionSteps, 'reproduction steps'),
    evidenceRefs: freezeStringArray(input.evidenceRefs, 'evidence references'),
  });
}

function freezeStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidDefect(`${field} must contain at least one entry`);
  }
  const copy = value.map((entry, index) => {
    assertNonEmptyString(entry, `${field} entry ${index}`);
    return entry;
  });
  return Object.freeze(copy);
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidDefect(`${field} must be an object`);
  }
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidDefect(`${field} must be a non-empty string`);
  }
}

function invalidDefect(message: string): TypeError {
  return new TypeError(`Invalid defect record: ${message}`);
}
