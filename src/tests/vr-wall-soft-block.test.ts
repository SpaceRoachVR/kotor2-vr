import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { resolveWallSoftBlockCorrection, VRWalkmeshQuery } from '@/vr/runtime/VRWallSoftBlock';

describe('resolveWallSoftBlockCorrection', () => {
  test('returns null when the head position is walkable', () => {
    const walkmesh: VRWalkmeshQuery = {
      isPointWalkable: () => true,
      getNearestWalkablePoint: () => { throw new Error('must not be called'); },
    };
    expect(resolveWallSoftBlockCorrection(new THREE.Vector3(1, 2, 0), walkmesh)).toBeNull();
  });

  test('returns null when there is no walkmesh to check against', () => {
    expect(resolveWallSoftBlockCorrection(new THREE.Vector3(1, 2, 0), null)).toBeNull();
    expect(resolveWallSoftBlockCorrection(new THREE.Vector3(1, 2, 0), undefined)).toBeNull();
  });

  test('pushes the head back to the nearest walkable point, flattened to the ground plane', () => {
    const nearest = new THREE.Vector3(5, 5, 9);
    const walkmesh: VRWalkmeshQuery = {
      isPointWalkable: () => false,
      getNearestWalkablePoint: () => nearest,
    };
    const correction = resolveWallSoftBlockCorrection(new THREE.Vector3(6, 5, 1), walkmesh);
    expect(correction).not.toBeNull();
    expect(correction!.x).toBeCloseTo(-1);
    expect(correction!.y).toBeCloseTo(0);
    expect(correction!.z).toBe(0);
  });
});
