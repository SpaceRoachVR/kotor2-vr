import { describe, expect, jest, test } from '@jest/globals';
jest.mock('@/GameState', () => ({ GameState: {
  PartyManager: { party: [] as unknown[] }, ModuleObjectManager: { RemoveObject: jest.fn() },
} }));
jest.mock('@/utility/ConfigClient', () => ({ ConfigClient: {} }));

import * as THREE from 'three';
import { GameState } from '@/GameState';
import { AreaMap } from '@/module/AreaMap';
import { ModuleArea } from '@/module/ModuleArea';
import { ModuleEncounter } from '@/module/ModuleEncounter';

describe('encounter ownership on module unload', () => {
  test('repeated area unloads detach encounter meshes and release their area references exactly once', () => {
    const scene = new THREE.Group();
    for (let cycle = 0; cycle < 3; cycle++) {
      const area = Object.create(ModuleArea.prototype) as ModuleArea;
      Object.assign(area, { areaMap: new AreaMap(), rooms: [], areaOfEffects: [], creatures: [],
        items: [], placeables: [], doors: [], triggers: [], encounters: [], waypoints: [], sounds: [],
        weather: { destroy: jest.fn() } });
      const encounters = [new ModuleEncounter(), new ModuleEncounter()];
      const disposals = encounters.map(encounter => {
        encounter.area = area;
        encounter.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
        encounter.mesh.userData.moduleObject = encounter;
        scene.add(encounter.mesh);
        area.encounters.push(encounter);
        const geometry = jest.fn(), material = jest.fn();
        encounter.mesh.geometry.addEventListener('dispose', geometry);
        (encounter.mesh.material as THREE.Material).addEventListener('dispose', material);
        return { geometry, material };
      });
      area.dispose();
      area.dispose();
      expect(scene.children).toHaveLength(0);
      expect(area.encounters).toHaveLength(0);
      for (const [index, encounter] of encounters.entries()) {
        expect(encounter.area).toBeUndefined();
        expect(encounter.mesh).toBeUndefined();
        expect(encounter.destroyed).toBe(true);
        expect(GameState.ModuleObjectManager.RemoveObject).toHaveBeenCalledWith(encounter);
        expect(disposals[index].geometry).toHaveBeenCalledTimes(1);
        expect(disposals[index].material).toHaveBeenCalledTimes(1);
      }
    }
  });
});
