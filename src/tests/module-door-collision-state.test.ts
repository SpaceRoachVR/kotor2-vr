import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { synchronizeDoorWalkmeshCollisionState } from '@/module/DoorWalkmeshCollisionState';

describe('ModuleDoor collision-state synchronization', () => {
  test('removes a persisted-open door walkmesh from every collision registry', () => {
    const mesh = new THREE.Object3D();
    const walkmesh = { mesh };
    const roomWalkmeshes = new THREE.Group();
    const doorWalkmeshes = [walkmesh];
    const walkmeshList = [mesh];
    roomWalkmeshes.add(mesh);

    synchronizeDoorWalkmeshCollisionState({
      isPassable: true,
      walkmesh,
      roomWalkmeshes,
      doorWalkmeshes,
      walkmeshList,
    });

    expect(doorWalkmeshes).toEqual([]);
    expect(walkmeshList).toEqual([]);
    expect(mesh.parent).toBeNull();
  });

  test('registers a closed door walkmesh exactly once after it was opened', () => {
    const mesh = new THREE.Object3D();
    const walkmesh = { mesh };
    const roomWalkmeshes = new THREE.Group();
    const doorWalkmeshes: typeof walkmesh[] = [];
    const walkmeshList: THREE.Object3D[] = [];

    synchronizeDoorWalkmeshCollisionState({
      isPassable: false,
      walkmesh,
      roomWalkmeshes,
      doorWalkmeshes,
      walkmeshList,
    });
    synchronizeDoorWalkmeshCollisionState({
      isPassable: false,
      walkmesh,
      roomWalkmeshes,
      doorWalkmeshes,
      walkmeshList,
    });

    expect(doorWalkmeshes).toEqual([walkmesh]);
    expect(walkmeshList).toEqual([mesh]);
    expect(mesh.parent).toBe(roomWalkmeshes);
  });
});
