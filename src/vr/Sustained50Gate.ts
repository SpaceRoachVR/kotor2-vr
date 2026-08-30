import type { PerfWindowReport } from './PerfSampler';

export const SUSTAINED_VR_MINIMUM_FPS = 50;
export const SUSTAINED_VR_FRAME_BUDGET_MS = 20;
export const SUSTAINED_VR_P90_LIMIT_MS = 33.33;
export const SUSTAINED_VR_P99_LIMIT_MS = 50;

export type Sustained50CheckName =
  | 'minimumFps'
  | 'cadenceIntegrity'
  | 'walkingWindow'
  | 'pathConfirmed'
  | 'p90'
  | 'p99'
  | 'roomCulling'
  | 'memoryStability';

export interface Sustained50GateEvidence {
  report: PerfWindowReport;
  memoryStability: 'pass' | 'fail' | 'incomplete';
}

export interface Sustained50GateVerdict {
  status: 'pass' | 'fail' | 'incomplete';
  checks: Record<Sustained50CheckName, boolean | null>;
  failed: Sustained50CheckName[];
  missing: Sustained50CheckName[];
}

const CHECK_ORDER: Sustained50CheckName[] = [
  'minimumFps',
  'cadenceIntegrity',
  'walkingWindow',
  'pathConfirmed',
  'p90',
  'p99',
  'roomCulling',
  'memoryStability',
];

/** Evaluate the user-approved sustained-50 continuation gate. */
export function evaluateSustained50Gate(
  evidence: Sustained50GateEvidence
): Sustained50GateVerdict {
  const { report } = evidence;
  const cadence = report.xrCadence;
  const world = report.world;
  const minimumWalkingFrames = Math.ceil(SUSTAINED_VR_MINIMUM_FPS * 60);
  const checks: Record<Sustained50CheckName, boolean | null> = {
    minimumFps: report.presenting && report.fps >= SUSTAINED_VR_MINIMUM_FPS,
    cadenceIntegrity: cadence?.integrity.trustworthy ?? false,
    walkingWindow:
      report.label === 'stereo-walking' &&
      report.durationSec >= 60 &&
      report.frames >= minimumWalkingFrames,
    pathConfirmed:
      world !== null &&
      world.module?.toUpperCase() === '101PER' &&
      world.path.samples >= 100 &&
      world.path.distanceMetres >= 10 &&
      world.path.maxDisplacementMetres >= 2 &&
      world.path.roomsTraversed.length >= 2,
    p90: report.frametimeMs.p90 <= SUSTAINED_VR_P90_LIMIT_MS,
    p99: report.frametimeMs.p99 < SUSTAINED_VR_P99_LIMIT_MS,
    roomCulling:
      world !== null &&
      world.roomsTotal > 0 &&
      world.roomsVisible > 0 &&
      world.roomsVisible < world.roomsTotal,
    memoryStability:
      evidence.memoryStability === 'incomplete' ? null : evidence.memoryStability === 'pass',
  };

  const failed = CHECK_ORDER.filter((name) => checks[name] === false);
  const missing = CHECK_ORDER.filter((name) => checks[name] === null);
  const status = failed.length ? 'fail' : missing.length ? 'incomplete' : 'pass';

  return { status, checks, failed, missing };
}
