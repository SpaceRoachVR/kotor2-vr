import * as THREE from 'three';
import { handVelocity } from './XRPoseMotion';
import { XRHandRole, XRInputFrame, XRWorldPose } from './XRTypes';

export type VRForceGestureKind = 'push' | 'pull';

export interface VRForceGesture {
  readonly kind: VRForceGestureKind;
  readonly hand: XRHandRole;
  readonly pose: XRWorldPose;
  readonly speedMetresPerSecond: number;
  readonly timestamp: number;
}

export interface VRForceGestureConfiguration {
  readonly minimumFlickSpeedMetresPerSecond: number;
  readonly cooldownMilliseconds: number;
}

const DEFAULT_CONFIGURATION: VRForceGestureConfiguration = {
  minimumFlickSpeedMetresPerSecond: 1.2,
  cooldownMilliseconds: 650,
};

/**
 * How far off the locked target the weapon hand may point for a Force
 * gesture to release. Locked by Allen (2026-10-13): the 2.5 s lock stays for
 * the ring and the wheel, but a cast needs the weapon on the target.
 */
export const VR_FORCE_WEAPON_AIM_CONE_DEGREES = 30;

/**
 * Whether the weapon hand's ray points within `coneDegrees` of the target.
 *
 * The lock outlives the aim by 2.5 s so a swing crossing the target keeps it,
 * and a thrust 1.2 s after the sword went to the floor cast Stun Droid on it
 * (F14); a push flick with the hand turned 90 degrees away still pushed the
 * locked trooper (Bolt, round 17, findings 3 and 4). Both gestures now ask
 * this first. No target or no usable ray refuses.
 */
export function isVRWeaponHandOnTarget(
  rayPose: XRWorldPose | null | undefined,
  targetPoint: THREE.Vector3 | null | undefined,
  coneDegrees: number = VR_FORCE_WEAPON_AIM_CONE_DEGREES,
): boolean {
  if (!rayPose || !targetPoint || rayPose.trackingState === 'unavailable') return false;
  const toTarget = targetPoint.clone().sub(rayPose.position);
  if (!Number.isFinite(toTarget.lengthSq()) || toTarget.lengthSq() < 1e-8) return false;
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(rayPose.orientation);
  if (!Number.isFinite(forward.lengthSq()) || forward.lengthSq() < 1e-8) return false;
  return THREE.MathUtils.radToDeg(forward.angleTo(toTarget)) <= coneDegrees;
}

/** Recognizes deliberate grip-modified forward/backward Force flicks. */
export class VRForceGestureController {
  private readonly configuration: VRForceGestureConfiguration;
  private nextGestureAt = Number.NEGATIVE_INFINITY;
  /** Last pose per hand, to measure speed when the runtime reports none. */
  private readonly previous: Partial<Record<XRHandRole, { position: THREE.Vector3; trackingToWorld?: THREE.Matrix4; timestamp: number }>> = {};

  constructor(configuration: Partial<VRForceGestureConfiguration> = {}) {
    this.configuration = { ...DEFAULT_CONFIGURATION, ...configuration };
    for (const [name, value] of Object.entries(this.configuration)) {
      if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and positive`);
    }
  }

  process(
    inputFrame: XRInputFrame,
    gripModifierHeld: boolean,
    timestamp: number,
    dominantHand: XRHandRole = 'right',
  ): VRForceGesture | null {
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new RangeError('timestamp must be finite and non-negative');
    }
    const controller = inputFrame.hands[dominantHand];
    if (!controller || controller.pose.trackingState === 'unavailable') {
      delete this.previous[dominantHand];
      return null;
    }
    // Virtual Desktop reports no pose velocity, so the flick never fired in
    // the headset (round 15); measure it from the last frame's position.
    let velocity = controller.pose.linearVelocity;
    const before = this.previous[dominantHand];
    this.previous[dominantHand] = { position: controller.pose.position.clone(), trackingToWorld: controller.pose.trackingToWorld?.clone(), timestamp };
    if (!velocity || !Number.isFinite(velocity.lengthSq())) {
      const dt = before ? (timestamp - before.timestamp) / 1000 : 0;
      if (!before || !(dt > 0.001 && dt < 0.2)) return null;
      velocity = handVelocity(before.position, before, controller.pose.position, controller.pose, dt);
    }
    if (!gripModifierHeld || timestamp < this.nextGestureAt) return null;

    const forward = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(inputFrame.head.orientation)
      .normalize();
    const signedSpeed = velocity.dot(forward);
    if (Math.abs(signedSpeed) < this.configuration.minimumFlickSpeedMetresPerSecond) return null;
    this.nextGestureAt = timestamp + this.configuration.cooldownMilliseconds;
    return {
      kind: signedSpeed > 0 ? 'push' : 'pull',
      hand: dominantHand,
      pose: VRForceGestureController.clonePose(controller.pose),
      speedMetresPerSecond: Math.abs(signedSpeed),
      timestamp,
    };
  }

  reset(): void {
    this.nextGestureAt = Number.NEGATIVE_INFINITY;
    delete this.previous.left;
    delete this.previous.right;
  }

  private static clonePose(pose: XRWorldPose): XRWorldPose {
    return {
      position: pose.position.clone(), orientation: pose.orientation.clone(),
      linearVelocity: pose.linearVelocity?.clone() ?? null,
      angularVelocity: pose.angularVelocity?.clone() ?? null,
      trackingState: pose.trackingState,
    };
  }
}
