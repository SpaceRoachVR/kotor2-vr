import { describe, expect, test } from '@jest/globals';
import * as THREE from 'three';
import {
  findCullingBoundsAnomalies,
  describeCullingBoundsAnomalies,
  DETACHED_BOUNDS_DISTANCE,
  BoundsSample,
} from '@/module/CullingBoundsAudit';

function sample(overrides: Partial<BoundsSample> = {}): BoundsSample {
  return {
    name: 'Main Hold Door',
    kind: 'door',
    position: { x: 48.74, y: 53.67, z: 1.81 },
    empty: false,
    center: { x: 48.74, y: 53.67, z: 1.81 },
    radius: 1.4,
    ...overrides,
  };
}

describe('findCullingBoundsAnomalies', () => {
  test('says nothing about an object whose bounds sit on it', () => {
    expect(findCullingBoundsAnomalies([sample()])).toEqual([]);
  });

  test('reports an empty box, which culls against the world origin', () => {
    const found = findCullingBoundsAnomalies([
      sample({ empty: true, center: { x: 0, y: 0, z: 0 }, radius: 0 }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].reason).toBe('empty-box');
    // The offset is the object's own distance from the origin it culls against.
    expect(found[0].offset).toBeCloseTo(Math.hypot(48.74, 53.67, 1.81), 2);
  });

  test('reports an empty box once, not also as zero-radius or detached', () => {
    const found = findCullingBoundsAnomalies([
      sample({ empty: true, center: { x: 0, y: 0, z: 0 }, radius: 0 }),
    ]);
    expect(found.map((a) => a.reason)).toEqual(['empty-box']);
  });

  test('reports a stale box parked away from its object', () => {
    const found = findCullingBoundsAnomalies([
      sample({ center: { x: 0, y: 0, z: 0 } }),
    ]);
    expect(found.map((a) => a.reason)).toEqual(['detached-from-object']);
  });

  test('tolerates a bounding centre offset within the threshold', () => {
    const near = sample({
      center: { x: 48.74 + (DETACHED_BOUNDS_DISTANCE - 1), y: 53.67, z: 1.81 },
    });
    expect(findCullingBoundsAnomalies([near])).toEqual([]);
  });

  test('skips samples carrying non-finite vectors rather than throwing', () => {
    expect(findCullingBoundsAnomalies([
      sample({ position: { x: NaN, y: 0, z: 0 } }),
      sample({ center: { x: Infinity, y: 0, z: 0 } }),
    ])).toEqual([]);
  });
});

/**
 * The engine behaviour this audit exists to detect, pinned against the real
 * three version rather than asserted from memory: an empty Box3 yields a sphere
 * at the world origin, and the frustum then accepts it only while the origin
 * itself is in view.
 */
describe('why an empty box hides an object everywhere but one direction', () => {
  test('an empty Box3 produces a zero-radius sphere at the world origin', () => {
    const box = new THREE.Box3();
    expect(box.isEmpty()).toBe(true);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    expect(sphere.center.toArray()).toEqual([0, 0, 0]);
    expect(sphere.radius).toBe(0);
  });

  test('such an object is drawn only while the origin is inside the frustum', () => {
    const box = new THREE.Box3();
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);

    const frustumFacing = (lookAt: THREE.Vector3) => {
      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
      camera.position.set(0, 0, 5);
      camera.lookAt(lookAt);
      camera.updateMatrixWorld(true);
      return new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      );
    };

    expect(frustumFacing(new THREE.Vector3(0, 0, 0)).intersectsSphere(sphere)).toBe(true);
    expect(frustumFacing(new THREE.Vector3(0, 0, 50)).intersectsSphere(sphere)).toBe(false);
  });
});

describe('describeCullingBoundsAnomalies', () => {
  test('is quiet when there is nothing to report', () => {
    expect(describeCullingBoundsAnomalies([])).toBe('culling bounds: no anomalies');
  });

  test('counts by reason and names each offender', () => {
    const text = describeCullingBoundsAnomalies(findCullingBoundsAnomalies([
      sample({ name: '001EBODr1', empty: true, center: { x: 0, y: 0, z: 0 }, radius: 0 }),
      sample({ name: '3CFD', kind: 'creature', center: { x: 0, y: 0, z: 0 } }),
    ]));
    expect(text).toContain('empty-box=1');
    expect(text).toContain('detached-from-object=1');
    expect(text).toContain("door '001EBODr1'");
    expect(text).toContain("creature '3CFD'");
  });
});
