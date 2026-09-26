/**
 * The player's standing head height above the XR floor, used to put the
 * camera at the character's eye height rather than the player's own.
 *
 * The first calibration takes the median of the first steady frames of a
 * session. On its own that trusts whatever posture those frames caught:
 * headset round P1 entered VR automatically while the headset was still low
 * (1.09-1.17 m), so standing up added about 0.6 m and the player stood far
 * taller than every character.
 *
 * A seated player's head really is at 1.1-1.2 m, so low readings cannot be
 * thrown away. Instead the baseline is raised when the head stays well above
 * it: at least `riseMetres` higher for `riseHoldMs`. That is standing up;
 * leaning, tiptoes and a hop are smaller or shorter. The baseline is never
 * lowered automatically, so crouching stays a crouch. Recenter still resets it.
 */
export interface HeadHeightCalibrationOptions {
  /** Steady frames the first calibration takes its median over. */
  readonly calibrationFrames: number;
  /** How far above the baseline the head must stay to count as standing up. */
  readonly riseMetres: number;
  /** How long it must stay there. */
  readonly riseHoldMs: number;
}

export const DEFAULT_HEAD_HEIGHT_CALIBRATION: HeadHeightCalibrationOptions = {
  calibrationFrames: 36,
  riseMetres: 0.3,
  riseHoldMs: 1500,
};

export type HeadHeightCalibrationEvent =
  | { readonly kind: 'calibrated'; readonly baselineMetres: number }
  | { readonly kind: 'raised'; readonly baselineMetres: number; readonly previousMetres: number };

/** A head below 30 cm or above 2.5 m is tracking that has not settled, not a person. */
function isPlausibleHead(y: number): boolean {
  return Number.isFinite(y) && y >= 0.3 && y <= 2.5;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export class HeadHeightCalibration {
  private baseline: number | null = null;
  private samples: number[] = [];
  private riseStartedMs: number | null = null;
  private riseSamples: number[] = [];

  constructor(private readonly options: HeadHeightCalibrationOptions = DEFAULT_HEAD_HEIGHT_CALIBRATION) {}

  get baselineMetres(): number | null {
    return this.baseline;
  }

  /** Forget everything: a new session, or a recenter ("measure me again"). */
  reset(): void {
    this.baseline = null;
    this.samples = [];
    this.riseStartedMs = null;
    this.riseSamples = [];
  }

  /** Feed one viewer-pose height; returns an event when the baseline changes. */
  sample(headY: number, nowMs: number): HeadHeightCalibrationEvent | null {
    if (!isPlausibleHead(headY) || !Number.isFinite(nowMs)) return null;

    if (this.baseline === null) {
      this.samples.push(headY);
      if (this.samples.length < this.options.calibrationFrames) return null;
      this.baseline = median(this.samples);
      this.samples = [];
      return { kind: 'calibrated', baselineMetres: this.baseline };
    }

    if (headY < this.baseline + this.options.riseMetres) {
      this.riseStartedMs = null;
      this.riseSamples = [];
      return null;
    }
    if (this.riseStartedMs === null) this.riseStartedMs = nowMs;
    this.riseSamples.push(headY);
    if (nowMs - this.riseStartedMs < this.options.riseHoldMs) return null;

    const previousMetres = this.baseline;
    this.baseline = median(this.riseSamples);
    this.riseStartedMs = null;
    this.riseSamples = [];
    return { kind: 'raised', baselineMetres: this.baseline, previousMetres };
  }
}
