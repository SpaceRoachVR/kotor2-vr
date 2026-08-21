import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import {
  createVRRadialSectors,
  resolveVRRadialPoint,
  resolveVRRadialRay,
  resolveVRRadialTouch,
} from '@/vr/runtime/VRRadialMenuLayout';
import { XRWorldPose } from '@/vr/runtime/XRTypes';

describe('VR radial menu layout', () => {
  test.each([1, 2, 6, 7, 8])('creates %i equal sectors with two-degree gaps', (count) => {
    const sectors = createVRRadialSectors(count);

    expect(sectors).toHaveLength(count);
    expect(sectors[0].endAngle - sectors[0].startAngle).toBeCloseTo(
      (Math.PI * 2 / count) - THREE.MathUtils.degToRad(2)
    );
  });

  test('classifies center, entries, gaps, and outside without overlap', () => {
    expect(resolveVRRadialPoint(new THREE.Vector2(0, 0), 6)).toEqual({ kind: 'center' });
    expect(resolveVRRadialPoint(new THREE.Vector2(0, 0.2), 6)).toEqual({ kind: 'entry', index: 0 });
    expect(resolveVRRadialPoint(new THREE.Vector2(0.1, Math.sqrt(3) * 0.1), 6)).toBeNull();
    expect(resolveVRRadialPoint(new THREE.Vector2(0, 0.34), 6)).toBeNull();
  });

  test('uses the same local point for a ray and a 6cm-deep touch probe', () => {
    const root = new THREE.Group();
    root.position.set(0, 1, 1.4);
    root.rotateX(Math.PI / 2);
    root.updateWorldMatrix(true, true);
    const orientation = root.getWorldQuaternion(new THREE.Quaternion());
    const rayOrigin = new THREE.Vector3(0, 0.2, 1).applyMatrix4(root.matrixWorld);
    const touchProbe = new THREE.Vector3(0, 0.2, 0.04).applyMatrix4(root.matrixWorld);

    expect(resolveVRRadialRay(root, pose(rayOrigin, orientation), 6)?.hit).toEqual({ kind: 'entry', index: 0 });
    expect(resolveVRRadialTouch(root, touchProbe, 6)?.hit).toEqual({ kind: 'entry', index: 0 });
  });

  test('rejects invalid counts and non-finite geometry inputs', () => {
    expect(() => createVRRadialSectors(0)).toThrow(RangeError);
    expect(() => createVRRadialSectors(9)).toThrow(RangeError);
    expect(() => createVRRadialSectors(1.5)).toThrow(RangeError);
    expect(() => resolveVRRadialPoint(new THREE.Vector2(Number.NaN, 0), 6)).toThrow(RangeError);

    const root = new THREE.Group();
    root.updateWorldMatrix(true, true);
    expect(() => resolveVRRadialRay(root, pose(new THREE.Vector3(), new THREE.Quaternion(0, 0, 0, 0)), 6)).toThrow(RangeError);
    expect(() => resolveVRRadialTouch(root, new THREE.Vector3(Number.NaN, 0, 0), 6)).toThrow(RangeError);
  });

  test('rejects invalid root matrices and ray intersections behind the controller', () => {
    const invalidRoot = new THREE.Group();
    invalidRoot.position.x = Number.NaN;
    expect(() => resolveVRadialRayForTest(invalidRoot)).toThrow(RangeError);

    const root = new THREE.Group();
    root.updateWorldMatrix(true, true);
    expect(resolveVRRadialRay(root, pose(new THREE.Vector3(0, 0.2, -1), new THREE.Quaternion()), 6)).toBeNull();
  });
});

function pose(position: THREE.Vector3, orientation: THREE.Quaternion): XRWorldPose {
  return {
    position,
    orientation,
    linearVelocity: null,
    angularVelocity: null,
    trackingState: 'tracked',
  };
}

function resolveVRadialRayForTest(root: THREE.Object3D): unknown {
  return resolveVRRadialRay(root, pose(new THREE.Vector3(0, 0, 1), new THREE.Quaternion()), 6);
}
