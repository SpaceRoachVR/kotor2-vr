import * as THREE from 'three';
import { XRHandRole, XRInputFrame, XRWorldPose } from './XRTypes';

/**
 * ROADMAP 3.19 — the one generic Force cast gesture.
 *
 * Push and Pull keep their grip-held dominant-hand flick
 * (`VRForceGestureController`). Every other queued Force power releases on an
 * open-palm thrust of the *off* hand toward the locked target, which keeps
 * the gesture set at three instead of one per power. The palm is "open" when
 * the caller reports neither grip nor trigger held on that hand — the same
 * signal that opens the rigged WebXR hand.
 *
 * This is presentation-side recognition only: the stats, range, Force-point
 * cost and saves stay with the spell the engine dispatches.
 */
export interface VRForceCastGesture {
  readonly kind: 'cast';
  readonly hand: XRHandRole;
  readonly pose: XRWorldPose;
  /** Thrust speed along the cast direction, metres per second. */
  readonly speedMetresPerSecond: number;
  /** Cosine between the hand's velocity and the cast direction. */
  readonly alignment: number;
  /** True when the direction came from a target point rather than the head. */
  readonly towardTarget: boolean;
  readonly timestamp: number;
}

export interface VRForceCastGestureConfiguration {
  /** Speed along the cast direction that counts as a thrust, not a drift. */
  readonly minimumThrustSpeedMetresPerSecond: number;
  /**
   * Minimum cosine between hand velocity and the cast direction. 0.5 accepts
   * a thrust within 60 degrees of the target, so a natural arm extension
   * from the shoulder still counts while a sideways wave does not.
   */
  readonly minimumAlignmentCosine: number;
  readonly cooldownMilliseconds: number;
}

export interface VRForceCastGestureInput {
  readonly hand: XRHandRole;
  /** Neither grip nor trigger held on `hand`. */
  readonly palmOpen: boolean;
  /**
   * Where the thrust must go, in the same world space as the input frame.
   * Null falls back to the head's forward, for callers with no locked point.
   */
  readonly targetPoint: THREE.Vector3 | null;
  readonly timestamp: number;
}

const DEFAULT_CONFIGURATION: VRForceCastGestureConfiguration = {
  minimumThrustSpeedMetresPerSecond: 1.2,
  minimumAlignmentCosine: 0.5,
  cooldownMilliseconds: 650,
};

export class VRForceCastGestureController {
  private readonly configuration: VRForceCastGestureConfiguration;
  private nextGestureAt = Number.NEGATIVE_INFINITY;

  constructor(configuration: Partial<VRForceCastGestureConfiguration> = {}) {
    this.configuration = { ...DEFAULT_CONFIGURATION, ...configuration };
    const { minimumThrustSpeedMetresPerSecond, cooldownMilliseconds, minimumAlignmentCosine } = this.configuration;
    if (!Number.isFinite(minimumThrustSpeedMetresPerSecond) || minimumThrustSpeedMetresPerSecond <= 0) {
      throw new RangeError('minimumThrustSpeedMetresPerSecond must be finite and positive');
    }
    if (!Number.isFinite(cooldownMilliseconds) || cooldownMilliseconds <= 0) {
      throw new RangeError('cooldownMilliseconds must be finite and positive');
    }
    if (!Number.isFinite(minimumAlignmentCosine) || minimumAlignmentCosine <= 0 || minimumAlignmentCosine > 1) {
      throw new RangeError('minimumAlignmentCosine must be in (0, 1]');
    }
  }

  process(inputFrame: XRInputFrame, input: VRForceCastGestureInput): VRForceCastGesture | null {
    if (!Number.isFinite(input.timestamp) || input.timestamp < 0) {
      throw new RangeError('timestamp must be finite and non-negative');
    }
    if (input.hand !== 'left' && input.hand !== 'right') {
      throw new RangeError('hand must be left or right');
    }
    if (!input.palmOpen || input.timestamp < this.nextGestureAt) return null;
    const controller = inputFrame.hands[input.hand];
    const velocity = controller?.pose.linearVelocity;
    if (!controller || controller.pose.trackingState === 'unavailable' || !velocity ||
      !Number.isFinite(velocity.lengthSq())) {
      return null;
    }
    const speed = velocity.length();
    if (speed < this.configuration.minimumThrustSpeedMetresPerSecond) return null;

    const direction = VRForceCastGestureController.resolveDirection(inputFrame, controller.pose, input.targetPoint);
    if (!direction) return null;
    const alignment = velocity.dot(direction) / speed;
    if (alignment < this.configuration.minimumAlignmentCosine) return null;
    const alongSpeed = velocity.dot(direction);
    if (alongSpeed < this.configuration.minimumThrustSpeedMetresPerSecond) return null;

    this.nextGestureAt = input.timestamp + this.configuration.cooldownMilliseconds;
    return {
      kind: 'cast',
      hand: input.hand,
      pose: VRForceCastGestureController.clonePose(controller.pose),
      speedMetresPerSecond: alongSpeed,
      alignment,
      towardTarget: input.targetPoint !== null,
      timestamp: input.timestamp,
    };
  }

  reset(): void {
    this.nextGestureAt = Number.NEGATIVE_INFINITY;
  }

  private static resolveDirection(
    inputFrame: XRInputFrame,
    handPose: XRWorldPose,
    targetPoint: THREE.Vector3 | null,
  ): THREE.Vector3 | null {
    if (targetPoint) {
      const toTarget = targetPoint.clone().sub(handPose.position);
      // A target on top of the hand has no direction; let the head decide.
      if (toTarget.lengthSq() > 1e-4 && Number.isFinite(toTarget.lengthSq())) return toTarget.normalize();
    }
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(inputFrame.head.orientation);
    return forward.lengthSq() > 1e-6 ? forward.normalize() : null;
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
