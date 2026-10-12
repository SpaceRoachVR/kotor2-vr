import * as THREE from 'three';
import type { XRWorldPose } from './XRTypes';

/**
 * Hand motion between two frames, measured in the player's play space.
 *
 * Without runtime pose velocity (Virtual Desktop) hand speed is taken from
 * successive world positions, which also carry the rig: walking with the
 * stick, a strafe or a snap turn moved the hand fast enough to count as a
 * swing or a Force cast (critic run 11). The previous point is carried into
 * this frame's rig before differencing, so only the hand's own motion counts.
 * Poses without a rig transform (tests, old traces) fall back to world space.
 */
export function playSpaceDelta(
  previousPoint: THREE.Vector3,
  previousPose: Pick<XRWorldPose, 'trackingToWorld'> | null | undefined,
  currentPoint: THREE.Vector3,
  currentPose: Pick<XRWorldPose, 'trackingToWorld'> | null | undefined,
): THREE.Vector3 {
  const before = previousPose?.trackingToWorld;
  const now = currentPose?.trackingToWorld;
  if (!before || !now) return currentPoint.clone().sub(previousPoint);
  const carried = previousPoint.clone()
    .applyMatrix4(before.clone().invert())
    .applyMatrix4(now);
  return currentPoint.clone().sub(carried);
}

/**
 * Faster than any arm moves. A controller reacquired after occlusion (behind
 * the head, at the neck) jumps tens of centimetres in one frame, and that jump
 * dispatched a swing that killed a droid (critic run 12). A sample above this
 * is a tracking jump, not motion.
 */
export const MAX_HAND_SPEED_METRES_PER_SECOND = 10;

/** Hand velocity from two samples in play space; zero for a tracking jump. */
export function handVelocity(
  previousPoint: THREE.Vector3,
  previousPose: Pick<XRWorldPose, 'trackingToWorld'> | null | undefined,
  currentPoint: THREE.Vector3,
  currentPose: Pick<XRWorldPose, 'trackingToWorld'> | null | undefined,
  elapsedSeconds: number,
): THREE.Vector3 {
  if (!(elapsedSeconds > 0)) return new THREE.Vector3();
  const velocity = playSpaceDelta(previousPoint, previousPose, currentPoint, currentPose).divideScalar(elapsedSeconds);
  return velocity.length() > MAX_HAND_SPEED_METRES_PER_SECOND ? new THREE.Vector3() : velocity;
}
