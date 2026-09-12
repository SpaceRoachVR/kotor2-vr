export interface VRCombatTargetLockConfiguration {
  aimLossGraceMilliseconds?: number;
  switchDwellMilliseconds?: number;
}

export interface VRCombatTargetLockUpdate {
  candidateTargetId?: string;
  nowMilliseconds: number;
}

export interface VRCombatTargetLockSnapshot {
  readonly lockedTargetId?: string;
  readonly pendingTargetId?: string;
  readonly lockExpiresAtMilliseconds?: number;
  readonly pendingSinceMilliseconds?: number;
}

const DEFAULT_AIM_LOSS_GRACE_MILLISECONDS = 500;
const DEFAULT_SWITCH_DWELL_MILLISECONDS = 180;

/**
 * Converts validated aim candidates into a stable combat soft-lock. It has no
 * scene, XR, or engine dependency, so a controller swing cannot accidentally
 * change targets due to renderer frame timing.
 */
export class VRCombatTargetLock {
  private readonly aimLossGraceMilliseconds: number;
  private readonly switchDwellMilliseconds: number;
  private lockedTargetId: string | undefined;
  private pendingTargetId: string | undefined;
  private lockExpiresAtMilliseconds: number | undefined;
  private pendingSinceMilliseconds: number | undefined;

  constructor(configuration: Readonly<VRCombatTargetLockConfiguration> = {}) {
    this.aimLossGraceMilliseconds = validateDuration(
      configuration.aimLossGraceMilliseconds ?? DEFAULT_AIM_LOSS_GRACE_MILLISECONDS,
      "aimLossGraceMilliseconds",
    );
    this.switchDwellMilliseconds = validateDuration(
      configuration.switchDwellMilliseconds ?? DEFAULT_SWITCH_DWELL_MILLISECONDS,
      "switchDwellMilliseconds",
    );
  }

  update(update: Readonly<VRCombatTargetLockUpdate>): VRCombatTargetLockSnapshot {
    validateTimestamp(update.nowMilliseconds);
    validateCandidateTargetId(update.candidateTargetId);

    const { candidateTargetId, nowMilliseconds } = update;
    if (!this.lockedTargetId || this.isLockExpired(nowMilliseconds)) {
      this.clear();
      if (candidateTargetId) {
        this.acquire(candidateTargetId, nowMilliseconds);
      }
      return this.getSnapshot();
    }

    if (!candidateTargetId) {
      this.pendingTargetId = undefined;
      this.pendingSinceMilliseconds = undefined;
      return this.getSnapshot();
    }

    if (candidateTargetId === this.lockedTargetId) {
      this.lockExpiresAtMilliseconds = nowMilliseconds + this.aimLossGraceMilliseconds;
      this.pendingTargetId = undefined;
      this.pendingSinceMilliseconds = undefined;
      return this.getSnapshot();
    }

    if (candidateTargetId !== this.pendingTargetId) {
      this.pendingTargetId = candidateTargetId;
      this.pendingSinceMilliseconds = nowMilliseconds;
      return this.getSnapshot();
    }

    if (
      this.pendingSinceMilliseconds !== undefined &&
      nowMilliseconds - this.pendingSinceMilliseconds >= this.switchDwellMilliseconds
    ) {
      this.acquire(candidateTargetId, nowMilliseconds);
    }
    return this.getSnapshot();
  }

  getSnapshot(): VRCombatTargetLockSnapshot {
    return Object.freeze({
      lockedTargetId: this.lockedTargetId,
      pendingTargetId: this.pendingTargetId,
      lockExpiresAtMilliseconds: this.lockExpiresAtMilliseconds,
      pendingSinceMilliseconds: this.pendingSinceMilliseconds,
    });
  }

  clear(): void {
    this.lockedTargetId = undefined;
    this.pendingTargetId = undefined;
    this.lockExpiresAtMilliseconds = undefined;
    this.pendingSinceMilliseconds = undefined;
  }

  private acquire(targetId: string, nowMilliseconds: number): void {
    this.lockedTargetId = targetId;
    this.pendingTargetId = undefined;
    this.pendingSinceMilliseconds = undefined;
    this.lockExpiresAtMilliseconds = nowMilliseconds + this.aimLossGraceMilliseconds;
  }

  private isLockExpired(nowMilliseconds: number): boolean {
    return this.lockExpiresAtMilliseconds !== undefined &&
      nowMilliseconds > this.lockExpiresAtMilliseconds;
  }
}

function validateDuration(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number.`);
  }
  return value;
}

function validateTimestamp(value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError("nowMilliseconds must be finite.");
  }
}

function validateCandidateTargetId(candidateTargetId: string | undefined): void {
  if (candidateTargetId !== undefined && candidateTargetId.trim().length === 0) {
    throw new RangeError("candidateTargetId must be omitted or non-empty.");
  }
}
