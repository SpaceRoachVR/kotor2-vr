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

/** One walkable triangle, as `OdysseyWalkMesh.walkableFaces` carries it. */
export interface VRWalkFace {
  readonly triangle: THREE.Triangle;
}

/** A walkmesh's walkable faces — a room's `collisionManager.walkmesh`. */
export interface VRWalkFaceSource {
  readonly walkableFaces: readonly VRWalkFace[];
}

/** How far above or below the avatar's feet a floor may be and still be this floor. */
export const VR_SOFT_BLOCK_FLOOR_TOLERANCE_METRES = 1;

/** Height of a triangle's plane at (x, y), or null for a vertical face. */
function planeHeightAt(triangle: THREE.Triangle, x: number, y: number): number | null {
  const { a, b, c } = triangle;
  const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
  const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
  const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(nz) < 1e-9) return null;
  return a.z - (nx * (x - a.x) + ny * (y - a.y)) / nz;
}

function containsPoint2d(triangle: THREE.Triangle, x: number, y: number): boolean {
  const { a, b, c } = triangle;
  const d1 = (x - b.x) * (a.y - b.y) - (a.x - b.x) * (y - b.y);
  const d2 = (x - c.x) * (b.y - c.y) - (b.x - c.x) * (y - c.y);
  const d3 = (x - a.x) * (c.y - a.y) - (c.x - a.x) * (y - a.y);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

/**
 * The floor the player is standing on, across the room they are in and the
 * rooms it links to.
 *
 * The soft-block used to test the head against the current room's walkmesh
 * alone, so leaning through a doorway counted as a wall and pulled the view
 * back across it. And `isPointWalkable` is a 2D test with a 3D nearest-point
 * search, so on a layered area — the Ebon Hawk's exterior walkway runs over
 * the hull — the correction could pick a face on another level entirely.
 *
 * Sources are checked in order and the first that contains the point wins,
 * so passing the player's own room first keeps the common case to one room.
 */
export function createFloorWalkableQuery(
  sources: readonly (VRWalkFaceSource | null | undefined)[],
  floorZ: number,
  toleranceMetres = VR_SOFT_BLOCK_FLOOR_TOLERANCE_METRES,
): VRWalkmeshQuery | null {
  const meshes = sources.filter((source): source is VRWalkFaceSource =>
    !!source && Array.isArray(source.walkableFaces) && source.walkableFaces.length > 0);
  if (meshes.length === 0 || !Number.isFinite(floorZ)) return null;

  const onThisFloor = (triangle: THREE.Triangle, x: number, y: number): boolean => {
    const height = planeHeightAt(triangle, x, y);
    return height !== null && Math.abs(height - floorZ) <= toleranceMetres;
  };

  return {
    isPointWalkable(point: THREE.Vector3): boolean {
      for (const mesh of meshes) {
        for (const face of mesh.walkableFaces) {
          if (containsPoint2d(face.triangle, point.x, point.y) && onThisFloor(face.triangle, point.x, point.y)) {
            return true;
          }
        }
      }
      return false;
    },
    getNearestWalkablePoint(point: THREE.Vector3): THREE.Vector3 {
      const probe = new THREE.Vector3(point.x, point.y, floorZ);
      const candidate = new THREE.Vector3();
      const nearest = probe.clone();
      let nearestDistance = Infinity;
      for (const mesh of meshes) {
        for (const face of mesh.walkableFaces) {
          face.triangle.closestPointToPoint(probe, candidate);
          if (Math.abs(candidate.z - floorZ) > toleranceMetres) continue;
          const distance = candidate.distanceToSquared(probe);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest.copy(candidate);
          }
        }
      }
      return nearest;
    },
  };
}
