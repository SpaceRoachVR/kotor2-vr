import type { PerfWindowReport } from './PerfSampler';

export type Native90CheckName =
  | 'targetRate'
  | 'cadenceIntegrity'
  | 'walkingWindow'
  | 'pathConfirmed'
  | 'noMissedCallbacks'
  | 'p90'
  | 'p99'
  | 'overBudget'
  | 'roomCulling'
  | 'memoryStability'
  | 'nativeCompositor';

export interface Native90GateEvidence {
  report: PerfWindowReport;
  memoryStability: 'pass' | 'fail' | 'incomplete';
  /** Null when the runtime/tooling did not expose native-vs-synthetic evidence. */
  nativeCompositorEvidence: boolean | null;
}

export interface Native90GateVerdict {
  status: 'pass' | 'fail' | 'incomplete';
  checks: Record<Native90CheckName, boolean | null>;
  failed: Native90CheckName[];
  missing: Native90CheckName[];
}

const CHECK_ORDER: Native90CheckName[] = [
  'targetRate',
  'cadenceIntegrity',
  'walkingWindow',
  'pathConfirmed',
  'noMissedCallbacks',
  'p90',
  'p99',
  'overBudget',
  'roomCulling',
  'memoryStability',
  'nativeCompositor',
];

/** Evaluate the locked Quest 3/VDXR/RTX 3060 native-90 continuation gate. */
export function evaluateNative90Gate(evidence: Native90GateEvidence): Native90GateVerdict {
  const { report } = evidence;
  const cadence = report.xrCadence;
  const world = report.world;
  const checks: Record<Native90CheckName, boolean | null> = {
    targetRate:
      report.presenting &&
      cadence !== null &&
      Math.abs(cadence.targetHz - 90) <= 0.5 &&
      Math.abs(report.overBudget.budgetMs - 1000 / 90) <= 0.01,
    cadenceIntegrity: cadence?.integrity.trustworthy ?? false,
    walkingWindow:
      report.label === 'stereo-walking' && report.durationSec >= 60 && report.frames >= 5130,
    pathConfirmed:
      world !== null &&
      world.module?.toUpperCase() === '101PER' &&
      world.path.samples >= 100 &&
      world.path.distanceMetres >= 10 &&
      world.path.maxDisplacementMetres >= 2 &&
      world.path.roomsTraversed.length >= 2,
    noMissedCallbacks: cadence !== null && cadence.callbacks.estimatedMissed === 0,
    p90: report.frametimeMs.p90 <= 11.11,
    p99: report.frametimeMs.p99 < 16.67,
    overBudget: report.overBudget.percent <= 5,
    roomCulling:
      world !== null &&
      world.roomsTotal > 0 &&
      world.roomsVisible > 0 &&
      world.roomsVisible < world.roomsTotal,
    memoryStability:
      evidence.memoryStability === 'incomplete' ? null : evidence.memoryStability === 'pass',
    nativeCompositor: evidence.nativeCompositorEvidence,
  };

  const failed = CHECK_ORDER.filter((name) => checks[name] === false);
  const missing = CHECK_ORDER.filter((name) => checks[name] === null);
  const status = failed.length ? 'fail' : missing.length ? 'incomplete' : 'pass';

  return { status, checks, failed, missing };
}
