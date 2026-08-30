import * as THREE from 'three';
import { XRWorldPose } from './XRTypes';

/**
 * Where a blink-teleport would land, aimed with a controller ray.
 *
 * The original blink took its destination from the stick direction and always
 * travelled exactly `maxDistanceMetres`, with nothing drawn: the player could
 * neither choose a distance nor see the landing spot before committing. Aiming
 * by ray fixes both — the destination is wherever the ray meets the floor, so
 * distance is chosen by pointing, and the point can be drawn as a marker.
 *
 * The world is Z-up here (the ground plane is XY), matching the walkmesh and
 * the rest of the locomotion code.
 */
export interface VRTeleportAim {
  /** Where the ray meets the floor plane, already clamped to maximum range. */
  readonly point: THREE.Vector3;
  /** False when the ray met the floor beyond range and the point was pulled in. */
  readonly withinRange: boolean;
  readonly distanceMetres: number;
}

export interface VRTeleportAimRequest {
  readonly rayPose: XRWorldPose;
  /** The player's feet, which define the floor plane the ray is cast against. */
  readonly feet: THREE.Vector3;
  readonly maxDistanceMetres: number;
}

/**
 * A ray aimed at or above the horizon never meets the floor ahead of the
 * player. Requiring a real downward component also stops a near-horizontal ray
 * from resolving to a point hundreds of metres away that then clamps to a
 * direction the player did not mean to indicate.
 */
const MIN_DOWNWARD_COMPONENT = 0.05;

/** Resolves the aimed floor point, or null when the ray cannot reach the floor. */
export function resolveVRTeleportAim(request: VRTeleportAimRequest): VRTeleportAim | null {
  const { rayPose, feet, maxDistanceMetres } = request;
  if (!Number.isFinite(maxDistanceMetres) || maxDistanceMetres <= 0) {
    throw new RangeError('maxDistanceMetres must be finite and positive');
  }

  const origin = new THREE.Vector3().copy(rayPose.position);
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(rayPose.orientation).normalize();
  if (!Number.isFinite(direction.z) || direction.z > -MIN_DOWNWARD_COMPONENT) return null;

  // Distance along the ray to the floor plane through the player's feet.
  const travel = (feet.z - origin.z) / direction.z;
  if (!Number.isFinite(travel) || travel <= 0) return null;

  const floorPoint = origin.clone().addScaledVector(direction, travel);
  // Range is measured across the ground, not along the ray: how far the player
  // walks is a ground distance, and the controller's height must not count.
  const groundOffset = new THREE.Vector2(floorPoint.x - feet.x, floorPoint.y - feet.y);
  const groundDistance = groundOffset.length();

  if (groundDistance <= maxDistanceMetres) {
    return { point: floorPoint, withinRange: true, distanceMetres: groundDistance };
  }

  // Out of range aims still resolve, pulled back along their own bearing, so
  // the marker keeps tracking the ray instead of vanishing at the limit.
  const clamped = groundOffset.normalize().multiplyScalar(maxDistanceMetres);
  return {
    point: new THREE.Vector3(feet.x + clamped.x, feet.y + clamped.y, floorPoint.z),
    withinRange: false,
    distanceMetres: maxDistanceMetres,
  };
}
