import * as THREE from 'three';
import { XRWorldPose } from './XRTypes';

export const VR_RADIAL_LAYOUT = Object.freeze({
  outerRadiusMetres: 0.33,
  innerRadiusMetres: 0.105,
  touchDepthMetres: 0.06,
  hoverExtrusionMetres: 0.025,
  gapRadians: THREE.MathUtils.degToRad(2),
});

export interface VRRadialSector {
  readonly index: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

export type VRRadialHit =
  | { readonly kind: 'center' }
  | { readonly kind: 'entry'; readonly index: number };

export interface VRRadialResolvedHit {
  readonly hit: VRRadialHit;
  readonly localPoint: THREE.Vector3;
  readonly worldPoint: THREE.Vector3;
  readonly distanceMetres: number;
}

const MINIMUM_ENTRY_COUNT = 1;
const MAXIMUM_ENTRY_COUNT = 8;
const MINIMUM_DIRECTION_LENGTH_SQUARED = 1e-12;
const MATRIX_DETERMINANT_EPSILON = 1e-12;

/**
 * Builds clockwise sectors centered on the local positive-Y axis.  Sector
 * boundaries are deliberately inset so rendering and every hit mode share
 * the same two-degree dead zones.
 */
export function createVRRadialSectors(count: number): readonly VRRadialSector[] {
  validateCount(count);
  const stepRadians = (Math.PI * 2) / count;
  const sectorWidthRadians = stepRadians - VR_RADIAL_LAYOUT.gapRadians;

  return Array.from({ length: count }, (_, index): VRRadialSector => {
    const centerAngle = (Math.PI / 2) - (index * stepRadians);
    return Object.freeze({
      index,
      startAngle: centerAngle - (sectorWidthRadians / 2),
      endAngle: centerAngle + (sectorWidthRadians / 2),
    });
  });
}

/** Classifies a point in the menu root's local XY plane. */
export function resolveVRRadialPoint(point: THREE.Vector2, count: number): VRRadialHit | null {
  validateCount(count);
  validateFiniteVector2('point', point);

  const radiusSquared = point.lengthSq();
  if (radiusSquared <= VR_RADIAL_LAYOUT.innerRadiusMetres ** 2) {
    return { kind: 'center' };
  }
  if (radiusSquared > VR_RADIAL_LAYOUT.outerRadiusMetres ** 2) {
    return null;
  }

  const pointAngle = Math.atan2(point.y, point.x);
  const sectors = createVRRadialSectors(count);
  for (const sector of sectors) {
    const centerAngle = (sector.startAngle + sector.endAngle) / 2;
    if (Math.abs(normalizeSignedAngle(pointAngle - centerAngle)) <= (sector.endAngle - sector.startAngle) / 2) {
      return { kind: 'entry', index: sector.index };
    }
  }

  return null;
}

/** Resolves the controller target ray against the menu's local Z=0 plane. */
export function resolveVRRadialRay(
  root: THREE.Object3D,
  pose: XRWorldPose,
  count: number
): VRRadialResolvedHit | null {
  validateCount(count);
  validatePose(pose);
  const rootMatrix = getValidatedRootMatrix(root);
  const rootPosition = new THREE.Vector3().setFromMatrixPosition(rootMatrix);
  const rootOrientation = root.getWorldQuaternion(new THREE.Quaternion());
  validateFiniteQuaternion('root world orientation', rootOrientation);

  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(pose.orientation);
  if (!isFiniteVector3(direction) || direction.lengthSq() <= MINIMUM_DIRECTION_LENGTH_SQUARED) {
    throw new RangeError('target ray direction must be finite and non-zero');
  }
  direction.normalize();

  const planeNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(rootOrientation);
  if (!isFiniteVector3(planeNormal) || planeNormal.lengthSq() <= MINIMUM_DIRECTION_LENGTH_SQUARED) {
    throw new RangeError('radial root plane normal must be finite and non-zero');
  }
  planeNormal.normalize();

  const denominator = planeNormal.dot(direction);
  if (!Number.isFinite(denominator)) {
    throw new RangeError('target ray intersection must be finite');
  }
  if (Math.abs(denominator) <= Number.EPSILON) {
    return null;
  }

  const distanceMetres = rootPosition.clone().sub(pose.position).dot(planeNormal) / denominator;
  if (!Number.isFinite(distanceMetres)) {
    throw new RangeError('target ray intersection distance must be finite');
  }
  if (distanceMetres < 0) {
    return null;
  }

  const worldPoint = pose.position.clone().addScaledVector(direction, distanceMetres);
  return resolveWorldPoint(rootMatrix, worldPoint, count, distanceMetres);
}

/** Resolves a direct-touch world probe near the menu plane. */
export function resolveVRRadialTouch(
  root: THREE.Object3D,
  worldProbe: THREE.Vector3,
  count: number
): VRRadialResolvedHit | null {
  validateCount(count);
  validateFiniteVector3('world probe', worldProbe);
  const rootMatrix = getValidatedRootMatrix(root);
  const inverseRootMatrix = rootMatrix.clone().invert();
  validateFiniteMatrix('inverted radial root matrix', inverseRootMatrix);
  const localPoint = worldProbe.clone().applyMatrix4(inverseRootMatrix);
  validateFiniteVector3('local touch point', localPoint);

  if (Math.abs(localPoint.z) > VR_RADIAL_LAYOUT.touchDepthMetres) {
    return null;
  }

  return resolveLocalPoint(localPoint, worldProbe, count, Math.abs(localPoint.z));
}

function resolveWorldPoint(
  rootMatrix: THREE.Matrix4,
  worldPoint: THREE.Vector3,
  count: number,
  distanceMetres: number
): VRRadialResolvedHit | null {
  const inverseRootMatrix = rootMatrix.clone().invert();
  validateFiniteMatrix('inverted radial root matrix', inverseRootMatrix);
  const localPoint = worldPoint.clone().applyMatrix4(inverseRootMatrix);
  validateFiniteVector3('local ray point', localPoint);
  return resolveLocalPoint(localPoint, worldPoint, count, distanceMetres);
}

function resolveLocalPoint(
  localPoint: THREE.Vector3,
  worldPoint: THREE.Vector3,
  count: number,
  distanceMetres: number
): VRRadialResolvedHit | null {
  const hit = resolveVRRadialPoint(new THREE.Vector2(localPoint.x, localPoint.y), count);
  if (!hit) {
    return null;
  }

  return {
    hit,
    localPoint: localPoint.clone(),
    worldPoint: worldPoint.clone(),
    distanceMetres,
  };
}

function getValidatedRootMatrix(root: THREE.Object3D): THREE.Matrix4 {
  if (!root || typeof root.updateWorldMatrix !== 'function') {
    throw new TypeError('radial root must be a THREE.Object3D');
  }

  root.updateWorldMatrix(true, false);
  validateFiniteMatrix('radial root matrix', root.matrixWorld);
  if (Math.abs(root.matrixWorld.determinant()) <= MATRIX_DETERMINANT_EPSILON) {
    throw new RangeError('radial root matrix must be invertible');
  }
  return root.matrixWorld.clone();
}

function validateCount(count: number): void {
  if (!Number.isInteger(count) || count < MINIMUM_ENTRY_COUNT || count > MAXIMUM_ENTRY_COUNT) {
    throw new RangeError(`radial entry count must be an integer from ${MINIMUM_ENTRY_COUNT} through ${MAXIMUM_ENTRY_COUNT}`);
  }
}

function validatePose(pose: XRWorldPose): void {
  if (!pose || typeof pose !== 'object') {
    throw new TypeError('target ray pose is required');
  }
  validateFiniteVector3('target ray position', pose.position);
  validateFiniteQuaternion('target ray orientation', pose.orientation);
}

function validateFiniteVector2(name: string, vector: THREE.Vector2): void {
  if (!vector || !Number.isFinite(vector.x) || !Number.isFinite(vector.y)) {
    throw new RangeError(`${name} must contain finite coordinates`);
  }
}

function validateFiniteVector3(name: string, vector: THREE.Vector3): void {
  if (!vector || !isFiniteVector3(vector)) {
    throw new RangeError(`${name} must contain finite coordinates`);
  }
}

function validateFiniteQuaternion(name: string, quaternion: THREE.Quaternion): void {
  if (!quaternion || !Number.isFinite(quaternion.x) || !Number.isFinite(quaternion.y)
    || !Number.isFinite(quaternion.z) || !Number.isFinite(quaternion.w)) {
    throw new RangeError(`${name} must contain finite coordinates`);
  }
}

function validateFiniteMatrix(name: string, matrix: THREE.Matrix4): void {
  if (!matrix || matrix.elements.some((value) => !Number.isFinite(value))) {
    throw new RangeError(`${name} must contain finite elements`);
  }
}

function isFiniteVector3(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function normalizeSignedAngle(angle: number): number {
  return THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI;
}
