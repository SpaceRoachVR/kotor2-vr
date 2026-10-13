jest.mock('@/GameState', () => ({
  GameState: {
    SWRuleSet: { footSteps: {}, ranges: [] as any[] },
    TwoDAManager: { datatables: new Map() },
    Mode: 1,
    module: {
      area: { module: { readyToProcessEvents: true } },
      readyToProcessEvents: true,
    },
    PartyManager: { party: [] as any[] },
    getCurrentPlayer: (): any => undefined,
  },
}));
jest.mock('@/three/odyssey', () => {
  const THREE = jest.requireActual('three') as typeof import('three');
  return {
    OdysseyModel3D: class extends THREE.Object3D {},
    OdysseyObject3D: class extends THREE.Object3D {},
  };
});
jest.mock('@/nwscript/NWScriptInstance', () => ({ NWScriptInstance: class {} }));
jest.mock('@/nwscript/NWScript', () => ({ NWScript: class {} }));
jest.mock('@/loaders', () => ({ MDLLoader: class {}, ResourceLoader: class {}, TextureLoader: class {} }));
jest.mock('@/odyssey', () => ({ OdysseyModel: class {}, OdysseyModelAnimation: class {}, OdysseyWalkMesh: class {} }));

import { describe, expect, test, jest } from '@jest/globals';
import { ModuleCreature } from '@/module/ModuleCreature';

/**
 * A wielder that enters combat readies its weapon (a lightsaber ignites) at
 * once, not only at its first attack roll: one that opened with a Force power,
 * or was attacked first, fought with an unlit blade.
 */
describe('updateExcitedDuration readies the weapon on entering combat', () => {
  const creature = (inCombat: boolean, excited: number) => {
    const powered: boolean[] = [];
    const fake: any = {
      excitedDuration: excited,
      combatData: { combatState: inCombat },
      isDead: () => false,
      cancelCombat: (): void => undefined,
      weaponPowered: (on: boolean) => { powered.push(on); },
    };
    return { fake, powered };
  };

  test('entering combat powers the weapon once', () => {
    const { fake, powered } = creature(false, 10000);
    ModuleCreature.prototype.updateExcitedDuration.call(fake, 0.016);
    expect(fake.combatData.combatState).toBe(true);
    expect(powered).toEqual([true]);
    ModuleCreature.prototype.updateExcitedDuration.call(fake, 0.016);
    expect(powered).toEqual([true]);
  });

  test('staying in combat does not replay the power-up', () => {
    const { fake, powered } = creature(true, 5000);
    ModuleCreature.prototype.updateExcitedDuration.call(fake, 0.016);
    expect(powered).toEqual([]);
  });

  test('leaving combat still powers it down', () => {
    const { fake, powered } = creature(true, 0);
    ModuleCreature.prototype.updateExcitedDuration.call(fake, 0.016);
    expect(fake.combatData.combatState).toBe(false);
    expect(powered).toEqual([false]);
  });
});
