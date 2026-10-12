import { describe, expect, jest, test } from '@jest/globals';
jest.mock('@/GameState', () => ({ GameState: { PartyManager: { party: [] as unknown[] } } }));
jest.mock('@/utility/ConfigClient', () => ({ ConfigClient: {} }));

import * as THREE from 'three';
import { AreaMap } from '@/module/AreaMap';
import { ModuleWaypoint } from '@/module/ModuleWaypoint';
import { ModuleObject } from '@/module/ModuleObject';
import { ModuleArea } from '@/module/ModuleArea';
import { ModulePath } from '@/module/ModulePath';

describe('module area resource ownership', () => {
  test('area teardown detaches and releases its path helper', () => {
    const area = Object.create(ModuleArea.prototype) as ModuleArea;
    Object.assign(area, { areaMap: new AreaMap(), rooms: [], areaOfEffects: [], creatures: [],
      items: [], placeables: [], doors: [], triggers: [], encounters: [], waypoints: [], sounds: [], weather: { destroy: jest.fn() } });
    area.path = new ModulePath(area);
    area.path.helperMesh = new THREE.LineSegments(area.path.helperGeometry, area.path.helperMaterial);
    const scene = new THREE.Scene();
    scene.add(area.path.helperMesh);
    const geometryDisposed = jest.fn();
    area.path.helperGeometry.addEventListener('dispose', geometryDisposed);
    area.dispose();
    area.dispose();
    expect(scene.children).toHaveLength(0);
    expect(geometryDisposed).toHaveBeenCalledTimes(1);
    expect(area.path).toBeUndefined();
  });

  test('path teardown handles a load that failed before creating its helper mesh', () => {
    const path = new ModulePath({ name: '101PER' } as ModuleArea);
    expect(() => { path.dispose(); path.dispose(); }).not.toThrow();
  });
  test('releases replaced and unloaded map fog textures exactly once', () => {
    const map = new AreaMap();
    map.init();
    const first = map.fogAlphaTexture;
    const firstDisposed = jest.fn();
    first.addEventListener('dispose', firstDisposed);
    map.setResX(44);
    const secondDisposed = jest.fn();
    map.fogAlphaTexture.addEventListener('dispose', secondDisposed);
    map.dispose();
    map.dispose();
    expect(firstDisposed).toHaveBeenCalledTimes(1);
    expect(secondDisposed).toHaveBeenCalledTimes(1);
    expect(map.fogAlphaTexture).toBeUndefined();
  });

  test('a waypoint releases replaced and unloaded scene helpers', () => {
    const waypoint = Object.create(ModuleWaypoint.prototype) as ModuleWaypoint & {
      setSceneHelper(helper: THREE.Object3D): void;
    };
    const group = new THREE.Group();
    const first = new THREE.Object3D();
    const second = new THREE.Object3D();
    group.add(first, second);
    const destroy = jest.spyOn(ModuleObject.prototype, 'destroy').mockImplementation(() => {});
    try {
      waypoint.setSceneHelper(first);
      waypoint.setSceneHelper(second);
      expect(first.parent).toBeNull();
      waypoint.destroy();
      expect(second.parent).toBeNull();
      expect(group.children).toHaveLength(0);
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(() => waypoint.setSceneHelper(null as never)).toThrow(TypeError);
    } finally { destroy.mockRestore(); }
  });
});
