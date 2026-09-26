import * as THREE from 'three';
import { XRHandRole, XRInputFrame } from './XRTypes';

/**
 * ROADMAP 3.20 (first part) — a medpac or stim held to the neck or mouth.
 *
 * The armed consumable sits in the off hand (a presentation copy, as a
 * grenade does). Bringing that hand into a small zone just below the head —
 * the neck and mouth, where retail's animation plants the injector — for a
 * short dwell uses it. World space is the game's, Z up, so "below the head"
 * is a drop along -Z from the head pose.
 *
 * Recognition only. Which item, whether it is still in the inventory, and
 * the engine action that spends it belong to the engine side.
 */
export interface VRConsumableUseGesture {
  readonly hand: XRHandRole;
  /** Distance from the hand to the zone centre when the dwell completed, metres. */
  readonly distanceMetres: number;
  readonly timestamp: number;
}

export interface VRConsumableUseGestureConfiguration {
  /** How far below the head centre the zone sits (the neck), metres. */
  readonly zoneDropMetres: number;
  /** Radius of the zone around that point, metres. */
  readonly zoneRadiusMetres: number;
  /** How long the hand must stay in the zone before it counts. */
  readonly dwellMilliseconds: number;
  /** Rest after a use before the same zone can fire again. */
  readonly cooldownMilliseconds: number;
}

export interface VRConsumableUseGestureInput {
  readonly hand: XRHandRole;
  /** False when nothing is armed: the controller then only clears its dwell. */
  readonly armed: boolean;
  readonly timestamp: number;
}

const DEFAULT_CONFIGURATION: VRConsumableUseGestureConfiguration = {
  zoneDropMetres: 0.15,
  zoneRadiusMetres: 0.22,
  dwellMilliseconds: 150,
  cooldownMilliseconds: 800,
};

const WORLD_UP = new THREE.Vector3(0, 0, 1);

export class VRConsumableUseGestureController {
  private readonly configuration: VRConsumableUseGestureConfiguration;
  private dwellStartedAt: number | null = null;
  private nextGestureAt = Number.NEGATIVE_INFINITY;

  constructor(configuration: Partial<VRConsumableUseGestureConfiguration> = {}) {
    this.configuration = { ...DEFAULT_CONFIGURATION, ...configuration };
    for (const [name, value] of Object.entries(this.configuration)) {
      if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and non-negative`);
    }
    if (this.configuration.zoneRadiusMetres <= 0) throw new RangeError('zoneRadiusMetres must be positive');
  }

  /** True while the armed hand is inside the zone (for a fill or a tint). */
  get isDwelling(): boolean {
    return this.dwellStartedAt !== null;
  }

  process(inputFrame: XRInputFrame, input: VRConsumableUseGestureInput): VRConsumableUseGesture | null {
    if (!Number.isFinite(input.timestamp) || input.timestamp < 0) {
      throw new RangeError('timestamp must be finite and non-negative');
    }
    if (input.hand !== 'left' && input.hand !== 'right') {
      throw new RangeError('hand must be left or right');
    }
    if (!input.armed) {
      this.dwellStartedAt = null;
      return null;
    }
    const hand = inputFrame.hands[input.hand];
    const head = inputFrame.head;
    if (!hand || hand.pose.trackingState === 'unavailable' || !head || head.trackingState === 'unavailable') {
      this.dwellStartedAt = null;
      return null;
    }
    const zoneCentre = head.position.clone().addScaledVector(WORLD_UP, -this.configuration.zoneDropMetres);
    const distance = hand.pose.position.distanceTo(zoneCentre);
    if (!Number.isFinite(distance) || distance > this.configuration.zoneRadiusMetres) {
      this.dwellStartedAt = null;
      return null;
    }
    if (input.timestamp < this.nextGestureAt) return null;
    if (this.dwellStartedAt === null) this.dwellStartedAt = input.timestamp;
    if (input.timestamp - this.dwellStartedAt < this.configuration.dwellMilliseconds) return null;

    this.dwellStartedAt = null;
    this.nextGestureAt = input.timestamp + this.configuration.cooldownMilliseconds;
    return { hand: input.hand, distanceMetres: distance, timestamp: input.timestamp };
  }

  reset(): void {
    this.dwellStartedAt = null;
    this.nextGestureAt = Number.NEGATIVE_INFINITY;
  }
}
