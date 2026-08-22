import * as THREE from 'three';
import { CombatWeaponMode, XRHandRole, XRInputFrame, XRWorldPose } from './XRTypes';

export interface VRCombatInputConfiguration {
  readonly minimumSwingSpeedMetresPerSecond: number;
  readonly visualSwingCooldownMilliseconds: number;
  readonly rollCooldownMilliseconds: number;
  /**
   * How far along the blade, in metres, the swing is measured when both hands
   * are on the hilt. Sampling at the hands alone is what made the off hand
   * inert: rotating a two-handed grip about the rear hand barely moves either
   * hand while sweeping the blade through a large arc.
   */
  readonly bladeSampleDistanceMetres: number;
  /**
   * Maximum distance between the hands for a two-handed grip to count. Holding
   * the offhand grip button with the hands far apart is not a two-handed grip
   * on one hilt, and should not promote.
   */
  readonly twoHandedGripMaxSeparationMetres: number;
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
  /**
   * Hand separation when a two-handed grip was resolved, for on-device tuning
   * of `twoHandedGripMaxSeparationMetres`. Absent for one-handed swings.
   */
  readonly gripSeparationMetres?: number;
}

const DEFAULT_CONFIGURATION: VRCombatInputConfiguration = {
  minimumSwingSpeedMetresPerSecond: 0.8,
  visualSwingCooldownMilliseconds: 120,
  rollCooldownMilliseconds: 3_000,
  bladeSampleDistanceMetres: 0.6,
  twoHandedGripMaxSeparationMetres: 0.35,
};

/**
 * Converts tracked controller movement into bounded combat requests. It emits
 * every legitimate physical swing for presentation, while the engine receives
 * a d20-authorized request only at the configured round cadence.
 */
export class VRCombatInputController {
  private readonly configuration: VRCombatInputConfiguration;
  private previousPose: XRWorldPose | null = null;
  private previousSamplePoint: THREE.Vector3 | null = null;
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
    // ROADMAP 3.3. A two-handed grip is a physical claim, not just a held
    // button: both hands must be tracked and close enough to be on one hilt.
    const offhandPose = inputFrame.hands.left?.pose ?? null;
    const grip = this.resolveTwoHandedGrip(context, dominantPose, offhandPose);

    // Measure the swing where the blade actually is. With both hands on the
    // hilt, rotating about the rear hand sweeps the blade through a wide arc
    // while barely moving either hand — which is exactly why sampling the
    // dominant hand alone left the off hand contributing nothing.
    const samplePoint = grip
      ? VRCombatInputController.resolveBladeSamplePoint(
        dominantPose, grip.offhandPose, this.configuration.bladeSampleDistanceMetres)
      : dominantPose.position.clone();
    const speed = grip
      ? this.resolveSampledSpeed(samplePoint, context.timestamp)
      : this.resolveSpeed(dominantPose, context.timestamp);

    this.previousPose = VRCombatInputController.clonePose(dominantPose);
    this.previousSamplePoint = samplePoint.clone();
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
      weaponMode: grip ? 'melee-two-handed' : context.weaponMode,
      speedMetresPerSecond: speed,
      rollEligible,
      pose: VRCombatInputController.clonePose(dominantPose),
      timestamp: context.timestamp,
      ...(grip ? { gripSeparationMetres: grip.separationMetres } : {}),
    }];
  }

  /**
   * Resolves a genuine two-handed grip, or null.
   *
   * Only promotes a one-handed weapon: a double-bladed saber or dual wield is
   * already a two-weapon stance and adding a second hand to it means something
   * different, which is not modelled here.
   */
  private resolveTwoHandedGrip(
    context: VRCombatInputContext,
    dominantPose: XRWorldPose,
    offhandPose: XRWorldPose | null,
  ): { readonly offhandPose: XRWorldPose; readonly separationMetres: number } | null {
    if (!context.offhandGrip) return null;
    if (context.weaponMode !== 'melee-one-handed') return null;
    if (!offhandPose || offhandPose.trackingState === 'unavailable') return null;
    const separationMetres = offhandPose.position.distanceTo(dominantPose.position);
    if (!Number.isFinite(separationMetres)) return null;
    if (separationMetres > this.configuration.twoHandedGripMaxSeparationMetres) return null;
    return { offhandPose, separationMetres };
  }

  /**
   * A point `distance` along the blade, taken as the direction from the
   * dominant (rear) hand to the off hand. Hands too close together give no
   * usable direction, so the dominant hand's own forward is used instead.
   */
  private static resolveBladeSamplePoint(
    dominantPose: XRWorldPose,
    offhandPose: XRWorldPose,
    distance: number,
  ): THREE.Vector3 {
    const along = offhandPose.position.clone().sub(dominantPose.position);
    const direction = along.lengthSq() < 1e-6
      ? new THREE.Vector3(0, 0, -1).applyQuaternion(dominantPose.orientation)
      : along.normalize();
    return dominantPose.position.clone().addScaledVector(direction, distance);
  }

  /**
   * Speed of the sampled blade point between frames. Controller linear
   * velocity cannot be used here — it describes the hand, not a point offset
   * from it, and would discard the rotational contribution this exists for.
   */
  private resolveSampledSpeed(samplePoint: THREE.Vector3, timestamp: number): number {
    if (!this.previousSamplePoint || this.previousTimestamp === null) return 0;
    const elapsedSeconds = (timestamp - this.previousTimestamp) / 1_000;
    if (!(elapsedSeconds > 0)) return 0;
    return samplePoint.distanceTo(this.previousSamplePoint) / elapsedSeconds;
  }

  /**
   * Records the physical weapon-action state for a frame this controller did
   * not process. `processBlaster` derives its firing edge from
   * `weaponActionHeld`, which only advances on frames combat actually runs — so
   * a trigger held through a world-prompt activation, an open action wheel, or
   * a foreground menu would read as a fresh press the instant combat resumed,
   * firing a shot the player never asked for. The owning runtime calls this on
   * every frame it skips combat so the held state stays continuous.
   */
  synchronizeWeaponActionHeld(pressed: boolean): void {
    this.weaponActionHeld = pressed === true;
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
    this.previousSamplePoint = null;
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
