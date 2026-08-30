import * as THREE from 'three';
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

/** Recognizes deliberate grip-modified forward/backward Force flicks. */
export class VRForceGestureController {
  private readonly configuration: VRForceGestureConfiguration;
  private nextGestureAt = Number.NEGATIVE_INFINITY;

  constructor(configuration: Partial<VRForceGestureConfiguration> = {}) {
    this.configuration = { ...DEFAULT_CONFIGURATION, ...configuration };
    for (const [name, value] of Object.entries(this.configuration)) {
      if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and positive`);
    }
  }

  process(inputFrame: XRInputFrame, gripModifierHeld: boolean, timestamp: number): VRForceGesture | null {
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new RangeError('timestamp must be finite and non-negative');
    }
    if (!gripModifierHeld || timestamp < this.nextGestureAt) return null;
    const hand = inputFrame.hands.right;
    const velocity = hand?.pose.linearVelocity;
    if (!hand || hand.pose.trackingState === 'unavailable' || !velocity || !Number.isFinite(velocity.length())) {
      return null;
    }

    const forward = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(inputFrame.head.orientation)
      .normalize();
    const signedSpeed = velocity.dot(forward);
    if (Math.abs(signedSpeed) < this.configuration.minimumFlickSpeedMetresPerSecond) return null;
    this.nextGestureAt = timestamp + this.configuration.cooldownMilliseconds;
    return {
      kind: signedSpeed > 0 ? 'push' : 'pull',
      hand: 'right',
      pose: VRForceGestureController.clonePose(hand.pose),
      speedMetresPerSecond: Math.abs(signedSpeed),
      timestamp,
    };
  }

  reset(): void {
    this.nextGestureAt = Number.NEGATIVE_INFINITY;
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
