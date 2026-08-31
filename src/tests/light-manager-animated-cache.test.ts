import { beforeEach, describe, expect, test } from '@jest/globals';
import * as THREE from 'three';
import { LightManager } from '@/managers/LightManager';

/**
 * `ModuleArea.updateRoomAnimatedLights` skips any material whose recorded
 * `animatedLightCacheID` still matches the manager's. A stable ID means no
 * uniform upload and no `material.needsUpdate` — the latter making three
 * re-resolve that material's shader program.
 *
 * The cache was written but inert: `updateDynamicLights` reallocated
 * `animatedLights` every frame, so every slot read back `undefined`, every
 * light counted as changed, and the ID advanced on every single frame for
 * every non-lightmapped material in every visible room.
 */
describe('animated light uniform cache', () => {
  let manager: LightManager;

  /** A pooled PointLight carrying an animated Odyssey light, as the pool holds. */
  const pooledLight = (uuid: string, radius = 10) => {
    const node = new THREE.PointLight(0xffffff, 1, 0, 1);
    node.userData.odysseyLight = { uuid, isAnimated: true, getRadius: () => radius };
    return node;
  };

  beforeEach(() => {
    manager = new LightManager();
    manager.context = { renderer: { physicallyCorrectLights: false } };
    manager.light_pool = [];
    manager.animatedLights.length = 0;
    manager.animatedLightsCacheID = 0;
  });

  test('holds the cache ID steady while nothing about a light changes', () => {
    manager.light_pool = [pooledLight('a'), pooledLight('b')];

    manager.syncAnimatedLights();
    const afterFirst = manager.animatedLightsCacheID;
    for(let frame = 0; frame < 10; frame++) manager.syncAnimatedLights();

    expect(manager.animatedLights).toHaveLength(2);
    expect(manager.animatedLightsCacheID).toBe(afterFirst);
  });

  test('notices a light that moved', () => {
    // The old code stored `position` by reference to the light node's own
    // vector, so the cached entry and the candidate were the same object and
    // equals() compared it with itself. A moving light never updated.
    const node = pooledLight('a');
    manager.light_pool = [node];
    manager.syncAnimatedLights();
    const before = manager.animatedLightsCacheID;

    node.position.set(5, 0, 0);
    manager.syncAnimatedLights();

    expect(manager.animatedLightsCacheID).toBeGreaterThan(before);
    expect(manager.animatedLights[0].position.equals(new THREE.Vector3(5, 0, 0))).toBe(true);
  });

  test('notices a light that changed colour or intensity', () => {
    const node = pooledLight('a');
    manager.light_pool = [node];
    manager.syncAnimatedLights();
    const before = manager.animatedLightsCacheID;

    node.intensity = 0.25;
    manager.syncAnimatedLights();

    expect(manager.animatedLightsCacheID).toBeGreaterThan(before);
  });

  test('keeps every light when one changes and an earlier one does not', () => {
    // The unchanged branch used to `continue` without advancing the write
    // index, so a changed light overwrote the unchanged one's slot and the
    // trailing truncation dropped a light entirely.
    const first = pooledLight('a');
    const second = pooledLight('b');
    manager.light_pool = [first, second];
    manager.syncAnimatedLights();

    second.position.set(0, 3, 0);
    manager.syncAnimatedLights();

    expect(manager.animatedLights).toHaveLength(2);
    expect(manager.animatedLights[0].position.equals(new THREE.Vector3(0, 0, 0))).toBe(true);
    expect(manager.animatedLights[1].position.equals(new THREE.Vector3(0, 3, 0))).toBe(true);
  });

  test('does not mistake a reordered pool for an unchanged one', () => {
    // Slot comparison is positional. Two lights identical in all four uniform
    // values would compare equal after a swap without an identity check.
    manager.light_pool = [pooledLight('a'), pooledLight('b')];
    manager.syncAnimatedLights();
    const before = manager.animatedLightsCacheID;

    manager.light_pool = [manager.light_pool[1], manager.light_pool[0]];
    manager.syncAnimatedLights();

    expect(manager.animatedLightsCacheID).toBeGreaterThan(before);
  });

  test('advances the cache ID when the animated light count changes', () => {
    manager.light_pool = [pooledLight('a'), pooledLight('b')];
    manager.syncAnimatedLights();
    const before = manager.animatedLightsCacheID;

    manager.light_pool = [manager.light_pool[0]];
    manager.syncAnimatedLights();

    expect(manager.animatedLights).toHaveLength(1);
    expect(manager.animatedLightsCacheID).toBeGreaterThan(before);
  });

  test('ignores pooled lights that are not animated', () => {
    const still = new THREE.PointLight(0xffffff, 1, 0, 1);
    still.userData.odysseyLight = { uuid: 'c', isAnimated: false, getRadius: () => 4 };
    manager.light_pool = [pooledLight('a'), still];

    manager.syncAnimatedLights();

    expect(manager.animatedLights).toHaveLength(1);
  });

  test('keeps the array identity stable so materials can hold it as a uniform', () => {
    // ModuleArea assigns this array itself as the uniform value. Replacing it
    // each frame would leave every material pointing at a dead array.
    manager.light_pool = [pooledLight('a')];
    manager.syncAnimatedLights();
    const uniformValue = manager.animatedLights;

    manager.light_pool[0].position.set(1, 2, 3);
    manager.syncAnimatedLights();

    expect(manager.animatedLights).toBe(uniformValue);
    expect(uniformValue[0].position.equals(new THREE.Vector3(1, 2, 3))).toBe(true);
  });
});
