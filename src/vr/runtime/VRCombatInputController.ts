import * as THREE from 'three';
import { CombatWeaponMode, XRHandRole, XRInputFrame, XRWorldPose } from './XRTypes';

export interface VRCombatInputConfiguration {
  readonly minimumSwingSpeedMetresPerSecond: number;
  readonly visualSwingCooldownMilliseconds: number;
  readonly rollCooldownMilliseconds: number;
}

export interface VRCombatInputContext {
  readonly actorId: string;
  readonly nominatedTargetId: string | null;
  readonly weaponMode: CombatWeaponMode;
  readonly timestamp: number;
  readonly offhandGrip: boolean;
  readonly weaponActionPressed: boolean;
}

export interface VRCombatSwingEvent {
  readonly actorId: string;
  readonly nominatedTargetId: string | null;
  readonly hand: XRHandRole;
  readonly weaponMode: CombatWeaponMode;
  readonly speedMetresPerSecond: number;
  readonly rollEligible: boolean;
  readonly pose: XRWorldPose;
  readonly timestamp: number;
}

const DEFAULT_CONFIGURATION: VRCombatInputConfiguration = {
  minimumSwingSpeedMetresPerSecond: 0.8,
  visualSwingCooldownMilliseconds: 120,
  rollCooldownMilliseconds: 3_000,
};

/**
 * Converts tracked controller movement into bounded combat requests. It emits
 * every legitimate physical swing for presentation, while the engine receives
 * a d20-authorized request only at the configured round cadence.
 */
export class VRCombatInputController {
  private readonly configuration: VRCombatInputConfiguration;
  private previousPose: XRWorldPose | null = null;
  private previousTimestamp: number | null = null;
  private lastVisualSwingAt = Number.NEGATIVE_INFINITY;
  private nextRollAt = Number.NEGATIVE_INFINITY;
  private weaponActionHeld = false;

  constructor(configuration: Partial<VRCombatInputConfiguration> = {}) {
    this.configuration = { ...DEFAULT_CONFIGURATION, ...configuration };
    VRCombatInputController.validateConfiguration(this.configuration);
  }

  /**
   * Round-timer readiness for the diegetic hilt indicator (ROADMAP 3.5):
   * 0 right after a roll-eligible swing/shot, 1 once the next one is
   * eligible again. `timestamp` should be the same clock `process()` is
   * driven with.
   */
  getRollReadiness(timestamp: number): number {
    if (!Number.isFinite(timestamp)) {
      throw new TypeError('timestamp must be finite');
    }
    if (this.nextRollAt === Number.NEGATIVE_INFINITY) return 1;
    const remaining = this.nextRollAt - timestamp;
    if (remaining <= 0) return 1;
    return 1 - Math.min(1, remaining / this.configuration.rollCooldownMilliseconds);
  }

  process(inputFrame: XRInputFrame, context: VRCombatInputContext): readonly VRCombatSwingEvent[] {
    VRCombatInputController.validateContext(context);
    if (context.weaponMode === 'blaster') return this.processBlaster(inputFrame, context);
    if (!VRCombatInputController.isMelee(context.weaponMode)) {
      this.resetMeleeSample();
      return [];
    }

    const dominantPose = inputFrame.hands.right?.pose;
    if (!dominantPose || dominantPose.trackingState === 'unavailable') {
      this.resetMeleeSample();
      return [];
    }
    const speed = this.resolveSpeed(dominantPose, context.timestamp);
    this.previousPose = VRCombatInputController.clonePose(dominantPose);
    this.previousTimestamp = context.timestamp;
    if (speed < this.configuration.minimumSwingSpeedMetresPerSecond ||
      context.timestamp - this.lastVisualSwingAt < this.configuration.visualSwingCooldownMilliseconds) {
      return [];
    }

    this.lastVisualSwingAt = context.timestamp;
    const rollEligible = context.timestamp >= this.nextRollAt;
    if (rollEligible) this.nextRollAt = context.timestamp + this.configuration.rollCooldownMilliseconds;
    return [{
      actorId: context.actorId,
      nominatedTargetId: context.nominatedTargetId,
      hand: 'right',
      weaponMode: context.offhandGrip && context.weaponMode === 'melee-one-handed'
        ? 'melee-two-handed'
        : context.weaponMode,
      speedMetresPerSecond: speed,
      rollEligible,
      pose: VRCombatInputController.clonePose(dominantPose),
      timestamp: context.timestamp,
    }];
  }

  reset(): void {
    this.resetMeleeSample();
    this.lastVisualSwingAt = Number.NEGATIVE_INFINITY;
    this.nextRollAt = Number.NEGATIVE_INFINITY;
    this.weaponActionHeld = false;
  }

  private processBlaster(inputFrame: XRInputFrame, context: VRCombatInputContext): readonly VRCombatSwingEvent[] {
    this.resetMeleeSample();
    const wasHeld = this.weaponActionHeld;
    this.weaponActionHeld = context.weaponActionPressed;
    if (!context.weaponActionPressed || wasHeld) return [];
    const pose = inputFrame.hands.right?.targetRayPose;
    if (!pose || pose.trackingState === 'unavailable') return [];
    const rollEligible = context.timestamp >= this.nextRollAt;
    if (rollEligible) this.nextRollAt = context.timestamp + this.configuration.rollCooldownMilliseconds;
    return [{
      actorId: context.actorId,
      nominatedTargetId: context.nominatedTargetId,
      hand: 'right',
      weaponMode: 'blaster',
      speedMetresPerSecond: 0,
      rollEligible,
      pose: VRCombatInputController.clonePose(pose),
      timestamp: context.timestamp,
    }];
  }

  private resolveSpeed(pose: XRWorldPose, timestamp: number): number {
    if (pose.linearVelocity && Number.isFinite(pose.linearVelocity.length())) {
      return pose.linearVelocity.length();
    }
    if (!this.previousPose || this.previousTimestamp === null) return 0;
    const elapsedSeconds = (timestamp - this.previousTimestamp) / 1_000;
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;
    return pose.position.distanceTo(this.previousPose.position) / elapsedSeconds;
  }

  private resetMeleeSample(): void {
    this.previousPose = null;
    this.previousTimestamp = null;
  }

  private static isMelee(mode: CombatWeaponMode): boolean {
    return mode === 'melee-one-handed' || mode === 'melee-two-handed' ||
      mode === 'melee-double-bladed' || mode === 'melee-dual-wield';
  }

  private static clonePose(pose: XRWorldPose): XRWorldPose {
    return {
      position: pose.position.clone(), orientation: pose.orientation.clone(),
      linearVelocity: pose.linearVelocity?.clone() ?? null,
      angularVelocity: pose.angularVelocity?.clone() ?? null,
      trackingState: pose.trackingState,
    };
  }

  private static validateContext(context: VRCombatInputContext): void {
    if (!context || typeof context !== 'object' || !context.actorId.trim()) {
      throw new TypeError('combat context requires a non-empty actorId');
    }
    if (!Number.isFinite(context.timestamp) || context.timestamp < 0) {
      throw new RangeError('combat context timestamp must be finite and non-negative');
    }
  }

  private static validateConfiguration(configuration: VRCombatInputConfiguration): void {
    for (const [name, value] of Object.entries(configuration)) {
      if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and positive`);
    }
  }
}
