import * as THREE from 'three';

/**
 * Structural subset of `OdysseyWalkMesh` this module needs. Kept narrow so
 * VR runtime code doesn't couple directly to the concrete walkmesh class.
 */
export interface VRWalkmeshQuery {
  isPointWalkable(point: THREE.Vector3): boolean;
  getNearestWalkablePoint(point: THREE.Vector3): THREE.Vector3;
}

/**
 * Room-scale head tracking can put the physical player's head past a wall
 * even when the joystick-driven avatar body never walked through one — the
 * avatar's own movement is already walkmesh-collision-checked, but physical
 * tracked motion within the play area is layered on top of that and isn't.
 *
 * Resolves a push-back correction for the VR rig when the tracked head has
 * crossed into non-walkable space: no fade, no hard stop, just the delta
 * needed to land the head back at the nearest walkable point. Returns null
 * when no correction is needed (or no walkmesh is available to check
 * against, e.g. during a module transition).
 */
export function resolveWallSoftBlockCorrection(
  headPosition: THREE.Vector3,
  walkmesh: VRWalkmeshQuery | null | undefined
): THREE.Vector3 | null {
  if (!walkmesh) return null;
  if (walkmesh.isPointWalkable(headPosition)) return null;

  const nearest = walkmesh.getNearestWalkablePoint(headPosition);
  const correction = nearest.clone().sub(headPosition);
  // The rig moves in the ground plane only — vertical correction belongs to
  // floor tracking, not this check.
  correction.z = 0;
  return correction;
}
