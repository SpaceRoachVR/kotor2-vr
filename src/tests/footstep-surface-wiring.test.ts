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
import { SWFootStep } from '@/engine/rules/SWFootStep';
import { ModuleCreature } from '@/module/ModuleCreature';
import { ModuleCreatureAnimState } from '@/enums/module/ModuleCreatureAnimState';

describe('SWFootStep Surface Material Sound Resolution', () => {
  function createSampleFootStep(): SWFootStep {
    const fs = new SWFootStep();
    fs.id = 0;
    fs.label = 'Biped';
    fs.dirt0 = 'fs_dirt0';
    fs.dirt1 = 'fs_dirt1';
    fs.dirt2 = 'fs_dirt2';
    fs.grass0 = 'fs_grass0';
    fs.grass1 = 'fs_grass1';
    fs.grass2 = 'fs_grass2';
    fs.stone0 = 'fs_stone0';
    fs.stone1 = 'fs_stone1';
    fs.stone2 = 'fs_stone2';
    fs.wood0 = 'fs_wood0';
    fs.wood1 = 'fs_wood1';
    fs.wood2 = 'fs_wood2';
    fs.water0 = 'fs_water0';
    fs.water1 = 'fs_water1';
    fs.water2 = 'fs_water2';
    fs.carpet0 = 'fs_carpet0';
    fs.carpet1 = 'fs_carpet1';
    fs.carpet2 = 'fs_carpet2';
    fs.metal0 = 'fs_metal0';
    fs.metal1 = 'fs_metal1';
    fs.metal2 = 'fs_metal2';
    fs.puddles0 = 'fs_puddles0';
    fs.puddles1 = 'fs_puddles1';
    fs.puddles2 = 'fs_puddles2';
    fs.leaves0 = 'fs_leaves0';
    fs.leaves1 = 'fs_leaves1';
    fs.leaves2 = 'fs_leaves2';
    return fs;
  }

  test('resolves standard surfaces correctly', () => {
    const fs = createSampleFootStep();
    expect(['fs_dirt0', 'fs_dirt1', 'fs_dirt2']).toContain(fs.getSurfaceSoundResRef(1));
    expect(['fs_grass0', 'fs_grass1', 'fs_grass2']).toContain(fs.getSurfaceSoundResRef(3));
    expect(['fs_stone0', 'fs_stone1', 'fs_stone2']).toContain(fs.getSurfaceSoundResRef(4));
    expect(['fs_wood0', 'fs_wood1', 'fs_wood2']).toContain(fs.getSurfaceSoundResRef(5));
    expect(['fs_water0', 'fs_water1', 'fs_water2']).toContain(fs.getSurfaceSoundResRef(6));
    expect(['fs_carpet0', 'fs_carpet1', 'fs_carpet2']).toContain(fs.getSurfaceSoundResRef(9));
    expect(['fs_metal0', 'fs_metal1', 'fs_metal2']).toContain(fs.getSurfaceSoundResRef(10));
    expect(['fs_puddles0', 'fs_puddles1', 'fs_puddles2']).toContain(fs.getSurfaceSoundResRef(11));
    expect(['fs_leaves0', 'fs_leaves1', 'fs_leaves2']).toContain(fs.getSurfaceSoundResRef(14));
  });

  test('resolves Swamp (12) and Mud (13) to puddles sounds', () => {
    const fs = createSampleFootStep();
    expect(['fs_puddles0', 'fs_puddles1', 'fs_puddles2']).toContain(fs.getSurfaceSoundResRef(12));
    expect(['fs_puddles0', 'fs_puddles1', 'fs_puddles2']).toContain(fs.getSurfaceSoundResRef(13));
  });

  test('resolves DeepWater (17) to water sounds', () => {
    const fs = createSampleFootStep();
    expect(['fs_water0', 'fs_water1', 'fs_water2']).toContain(fs.getSurfaceSoundResRef(17));
  });

  test('falls back to dirt sounds for unknown surfaces', () => {
    const fs = createSampleFootStep();
    expect(['fs_dirt0', 'fs_dirt1', 'fs_dirt2']).toContain(fs.getSurfaceSoundResRef(999));
    expect(['fs_dirt0', 'fs_dirt1', 'fs_dirt2']).toContain(fs.getSurfaceSoundResRef(0));
  });

  test('rolling droids return rolling sound regardless of surface', () => {
    const fs = new SWFootStep();
    fs.rolling = 'fs_wheel_droid';
    expect(fs.isRolling()).toBe(true);
    expect(fs.getRollingResRef()).toBe('fs_wheel_droid');
  });

  test('normalizes 1-indexed force audio columns (force1..force3) from retail 2DA', () => {
    const fs = SWFootStep.From2DA({
      __index: 0,
      label: 'Test',
      force1: 'fs_force_a',
      force2: 'fs_force_b',
      force3: 'fs_force_c',
    });
    expect(fs.force0).toBe('fs_force_a');
    expect(fs.force1).toBe('fs_force_b');
    expect(fs.force2).toBe('fs_force_c');
  });
});

describe('Creature Locomotion Animation & Audio Wiring', () => {
  test('transitions to RUNNING when moved via forceVector (VR locomotion)', () => {
    const creature = new ModuleCreature();
    creature.isReady = true;
    creature.hitPoints = 20;
    creature.maxHitPoints = 20;
    creature.force = 1;
    creature.forceVector.set(0, 1, 0); // As set by CreatureLocomotionAdapter
    creature.speed = 4.0;
    jest.spyOn(creature, 'getMovementSpeed').mockReturnValue(4.0);
    jest.spyOn(creature, 'getRunSpeed').mockReturnValue(4.0);
    jest.spyOn(creature, 'canMove').mockReturnValue(true);
    jest.spyOn(creature, 'isDead').mockReturnValue(false);
    jest.spyOn(creature, 'updateRegen').mockImplementation(() => {});

    const setAnimSpy = jest.spyOn(creature, 'setAnimationState');
    creature.update(0.016);

    expect(setAnimSpy).toHaveBeenCalledWith(ModuleCreatureAnimState.RUNNING);
  });

  test('transitions to WALKING when movement speed is low', () => {
    const creature = new ModuleCreature();
    creature.isReady = true;
    creature.hitPoints = 20;
    creature.maxHitPoints = 20;
    creature.force = 1;
    creature.forceVector.set(0, 1, 0);
    creature.speed = 1.0;
    jest.spyOn(creature, 'getMovementSpeed').mockReturnValue(4.0);
    jest.spyOn(creature, 'getRunSpeed').mockReturnValue(4.0);
    jest.spyOn(creature, 'canMove').mockReturnValue(true);
    jest.spyOn(creature, 'isDead').mockReturnValue(false);
    jest.spyOn(creature, 'updateRegen').mockImplementation(() => {});

    const setAnimSpy = jest.spyOn(creature, 'setAnimationState');
    creature.update(0.016);

    expect(setAnimSpy).toHaveBeenCalledWith(ModuleCreatureAnimState.WALKING);
  });

  test('stops looping footstep emitter when creature comes to a stop', () => {
    const creature = new ModuleCreature();
    creature.isReady = true;
    creature.hitPoints = 20;
    creature.maxHitPoints = 20;
    creature.animationState.index = ModuleCreatureAnimState.RUNNING;
    creature.force = 0;
    creature.speed = 0;
    creature.forceVector.set(0, 0, 0);

    const emitter = (creature as any).footstepEmitter;
    if (emitter) {
      emitter.isLooping = true;
      const stopSpy = jest.spyOn(emitter, 'stop');
      creature.update(0.016);
      expect(stopSpy).toHaveBeenCalled();
      expect(emitter.isLooping).toBe(false);
      expect(creature.animationState.index).toBe(ModuleCreatureAnimState.IDLE);
    }
  });
});
