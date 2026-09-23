import * as THREE from 'three';
import { CombatWeaponMode, XRHandRole, XRInputFrame, XRWorldPose } from './XRTypes';

export interface VRCombatInputConfiguration {
  readonly minimumSwingSpeedMetresPerSecond: number;
  readonly visualSwingCooldownMilliseconds: number;
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
  /**
   * ROADMAP 3.16. How far beyond the target's own radius the weapon may pass
   * and still count as swung *at* it. Deliberately generous: this exists to
   * stop a swing at empty air counting, not to make hitting harder.
   */
  readonly targetContactSlackMetres: number;
  /** Nominal weapon length from the hand, for the contact test. */
  readonly bladeLengthMetres: number;
  /** An unarmed "weapon" is the fist. */
  readonly fistReachMetres: number;
  /**
   * A fast movement arms a swing for this long, so the blade may reach the
   * target a moment after the hand crossed the speed threshold.
   */
  readonly swingWindowMilliseconds: number;
}

/**
 * The space a target occupies, for the contact test: a vertical capsule on the
 * creature's feet. KOTOR world is Z-up.
 */
export interface VRCombatTargetVolume {
  readonly base: THREE.Vector3;
  readonly heightMetres: number;
  readonly radiusMetres: number;
}

export interface VRCombatInputContext {
  readonly actorId: string;
  readonly nominatedTargetId: string | null;
  readonly weaponMode: CombatWeaponMode;
  readonly timestamp: number;
  readonly offhandGrip: boolean;
  readonly weaponActionPressed: boolean;
  /** Physical controller used for the equipped weapon and aimed powers. */
  readonly dominantHand: XRHandRole;
  /** The other controller; grenade release and a two-handed hilt use it. */
  readonly offhandHand: XRHandRole;
  /** True only when the head queued intent consumes an aimed trigger. */
  readonly allowDominantTrigger: boolean;
  /**
   * ROADMAP 3.16. When present, a melee swing counts only if the weapon passes
   * through this volume. Absent keeps the old speed-only rule.
   */
  readonly nominatedTargetVolume?: VRCombatTargetVolume | null;
}

export interface VRCombatSwingEvent {
  readonly actorId: string;
  readonly nominatedTargetId: string | null;
  readonly hand: XRHandRole;
  readonly weaponMode: CombatWeaponMode;
  readonly speedMetresPerSecond: number;
  readonly pose: XRWorldPose;
  readonly timestamp: number;
  /** The deliberate physical input that created this candidate action. */
  readonly input: 'dominant-swing' | 'dominant-trigger';
  /**
   * Hand separation when a two-handed grip was resolved, for on-device tuning
   * of `twoHandedGripMaxSeparationMetres`. Absent for one-handed swings.
   */
  readonly gripSeparationMetres?: number;
  /**
   * How far the weapon passed from the target volume's surface, when a volume
   * was given; negative inside it. For on-device tuning of the slack.
   */
  readonly targetContactMetres?: number;
}

/** A fast swing that ended without reaching the target, reported for tuning. */
export interface VRCombatSwingMiss {
  readonly closestMetres: number;
  readonly weaponMode: CombatWeaponMode;
}

const DEFAULT_CONFIGURATION: VRCombatInputConfiguration = {
  minimumSwingSpeedMetresPerSecond: 0.8,
  visualSwingCooldownMilliseconds: 120,
  bladeSampleDistanceMetres: 0.6,
  twoHandedGripMaxSeparationMetres: 0.35,
  targetContactSlackMetres: 0.75,
  bladeLengthMetres: 0.9,
  fistReachMetres: 0.15,
  swingWindowMilliseconds: 250,
};

/**
 * Converts tracked controller movement into bounded combat input events. It
 * has no knowledge of d20 timing: GameState evaluates each event against the
 * current CombatRound immediately before it queues an engine action.
 */
export class VRCombatInputController {
  private readonly configuration: VRCombatInputConfiguration;
  private previousPose: XRWorldPose | null = null;
  private previousSamplePoint: THREE.Vector3 | null = null;
  private previousTimestamp: number | null = null;
  private lastVisualSwingAt = Number.NEGATIVE_INFINITY;
  private weaponActionHeld = false;
  private swingArmedUntil = Number.NEGATIVE_INFINITY;
  private swingClosestMetres = Number.POSITIVE_INFINITY;
  private swingContacted = false;
  private readonly misses: VRCombatSwingMiss[] = [];

  constructor(configuration: Partial<VRCombatInputConfiguration> = {}) {
    this.configuration = { ...DEFAULT_CONFIGURATION, ...configuration };
    VRCombatInputController.validateConfiguration(this.configuration);
  }

  process(inputFrame: XRInputFrame, context: VRCombatInputContext): readonly VRCombatSwingEvent[] {
    VRCombatInputController.validateContext(context);
    const triggerEvents = this.processDominantTrigger(
      inputFrame,
      context,
      context.weaponMode === 'blaster' || context.allowDominantTrigger,
    );
    if (context.weaponMode === 'blaster') {
      this.resetMeleeSample();
      return triggerEvents;
    }
    // Unarmed counts as melee: a punch is the only way an unarmed character
    // can attack, because embodied VR turns off the engine's automatic
    // basic-attack queue and the wheel's plain Attack is not an engine click.
    if (!VRCombatInputController.isMelee(context.weaponMode) && context.weaponMode !== 'unarmed') {
      this.resetMeleeSample();
      return triggerEvents;
    }

    const dominantPose = inputFrame.hands[context.dominantHand]?.pose;
    if (!dominantPose || dominantPose.trackingState === 'unavailable') {
      this.resetMeleeSample();
      return triggerEvents;
    }
    // ROADMAP 3.3. A two-handed grip is a physical claim, not just a held
    // button: both hands must be tracked and close enough to be on one hilt.
    const offhandPose = inputFrame.hands[context.offhandHand]?.pose ?? null;
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

    const fast = speed >= this.configuration.minimumSwingSpeedMetresPerSecond;
    const volume = context.nominatedTargetVolume ?? null;
    let contactMetres: number | undefined;
    if (volume) {
      // ROADMAP 3.16. A fast movement arms a short window; the swing counts
      // when the weapon passes through the target volume inside it.
      if (fast) {
        if (context.timestamp > this.swingArmedUntil) {
          this.swingClosestMetres = Number.POSITIVE_INFINITY;
          this.swingContacted = false;
        }
        this.swingArmedUntil = context.timestamp + this.configuration.swingWindowMilliseconds;
      } else if (context.timestamp > this.swingArmedUntil) {
        this.finishSwingWindow(context.weaponMode);
        return triggerEvents;
      }
      contactMetres = this.resolveTargetContact(
        dominantPose,
        inputFrame.hands[context.dominantHand]?.targetRayPose ?? null,
        grip?.offhandPose ?? null,
        context.weaponMode,
        volume,
      );
      this.swingClosestMetres = Math.min(this.swingClosestMetres, contactMetres);
      if (contactMetres > this.configuration.targetContactSlackMetres) return triggerEvents;
      this.swingContacted = true;
    } else if (!fast) {
      return triggerEvents;
    }
    if (context.timestamp - this.lastVisualSwingAt < this.configuration.visualSwingCooldownMilliseconds) {
      return triggerEvents;
    }

    this.lastVisualSwingAt = context.timestamp;
    return [...triggerEvents, {
      actorId: context.actorId,
      nominatedTargetId: context.nominatedTargetId,
      hand: context.dominantHand,
      weaponMode: grip ? 'melee-two-handed' : context.weaponMode,
      speedMetresPerSecond: speed,
      pose: VRCombatInputController.clonePose(dominantPose),
      timestamp: context.timestamp,
      input: 'dominant-swing',
      ...(grip ? { gripSeparationMetres: grip.separationMetres } : {}),
      ...(contactMetres !== undefined ? { targetContactMetres: contactMetres } : {}),
    }];
  }

  /**
   * Fast swings that ended without the weapon reaching the target, oldest
   * first, since the last call. For tuning the slack from real headset play.
   */
  drainMisses(): readonly VRCombatSwingMiss[] {
    return this.misses.splice(0, this.misses.length);
  }

  private finishSwingWindow(weaponMode: CombatWeaponMode): void {
    if (Number.isFinite(this.swingClosestMetres) && !this.swingContacted && this.misses.length < 32) {
      this.misses.push({ closestMetres: this.swingClosestMetres, weaponMode });
    }
    this.swingClosestMetres = Number.POSITIVE_INFINITY;
    this.swingContacted = false;
    this.swingArmedUntil = Number.NEGATIVE_INFINITY;
  }

  /**
   * Distance from the weapon — hand to tip — to the surface of the target's
   * capsule; zero or negative when it is inside. The whole segment counts, so
   * a swing is not lost to a guess about which way the blade leaves the grip.
   */
  private resolveTargetContact(
    dominantPose: XRWorldPose,
    rayPose: XRWorldPose | null,
    offhandPose: XRWorldPose | null,
    weaponMode: CombatWeaponMode,
    volume: VRCombatTargetVolume,
  ): number {
    const length = weaponMode === 'unarmed'
      ? this.configuration.fistReachMetres
      : this.configuration.bladeLengthMetres;
    const along = offhandPose ? offhandPose.position.clone().sub(dominantPose.position) : null;
    const direction = along && along.lengthSq() > 1e-6
      ? along.normalize()
      // One-handed, the weapon points where the controller points: the same
      // direction the blade-contact sparks (3.13) are drawn along.
      : new THREE.Vector3(0, 0, -1).applyQuaternion((rayPose ?? dominantPose).orientation);
    const hand = dominantPose.position;
    const tip = hand.clone().addScaledVector(direction, length);
    const axisBottom = volume.base;
    const axisTop = volume.base.clone().setZ(volume.base.z + Math.max(0, volume.heightMetres));
    return segmentDistance(hand, tip, axisBottom, axisTop) - Math.max(0, volume.radiusMetres);
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
    this.weaponActionHeld = false;
    this.swingArmedUntil = Number.NEGATIVE_INFINITY;
    this.swingClosestMetres = Number.POSITIVE_INFINITY;
    this.swingContacted = false;
  }

  private processDominantTrigger(
    inputFrame: XRInputFrame,
    context: VRCombatInputContext,
    triggerAllowed: boolean,
  ): readonly VRCombatSwingEvent[] {
    const wasHeld = this.weaponActionHeld;
    this.weaponActionHeld = context.weaponActionPressed;
    if (!triggerAllowed || !context.weaponActionPressed || wasHeld) return [];
    const pose = inputFrame.hands[context.dominantHand]?.targetRayPose;
    if (!pose || pose.trackingState === 'unavailable') return [];
    return [{
      actorId: context.actorId,
      nominatedTargetId: context.nominatedTargetId,
      hand: context.dominantHand,
      weaponMode: context.weaponMode,
      speedMetresPerSecond: 0,
      pose: VRCombatInputController.clonePose(pose),
      timestamp: context.timestamp,
      input: 'dominant-trigger',
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
    if ((context.dominantHand !== 'left' && context.dominantHand !== 'right') ||
      (context.offhandHand !== 'left' && context.offhandHand !== 'right') ||
      context.dominantHand === context.offhandHand) {
      throw new TypeError('combat context requires distinct dominant and offhand roles');
    }
    if (typeof context.allowDominantTrigger !== 'boolean') {
      throw new TypeError('combat context allowDominantTrigger must be boolean');
    }
  }

  private static validateConfiguration(configuration: VRCombatInputConfiguration): void {
    for (const [name, value] of Object.entries(configuration)) {
      if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and positive`);
    }
  }
}

/** Shortest distance between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9). */
function segmentDistance(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): number {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.lengthSq();
  const e = d2.lengthSq();
  const f = d2.dot(r);
  let s: number;
  let t: number;
  if (a <= 1e-9 && e <= 1e-9) return p1.distanceTo(p2);
  if (a <= 1e-9) {
    s = 0;
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);
    if (e <= 1e-9) {
      t = 0;
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s);
  const c2 = p2.clone().addScaledVector(d2, t);
  return c1.distanceTo(c2);
}
