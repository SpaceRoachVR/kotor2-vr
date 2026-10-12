import { describe, expect, jest, test } from '@jest/globals';

jest.mock('@/GameState', () => ({ GameState: {
  ModuleObjectManager: { AddObjectById: jest.fn() },
  FactionManager: { AddCreatureToFaction: jest.fn() },
  SWRuleSet: { heads: [] as unknown[] },
} }));

import { GameState } from '@/GameState';
import { ModuleCreature } from '@/module/ModuleCreature';
import { GameEffect } from '@/effects/GameEffect';
import { EffectRacialType } from '@/effects/EffectRacialType';
import { GameEffectDurationType } from '@/enums/effects/GameEffectDurationType';
import { MDLLoader } from '@/loaders';
import { OdysseyModel3D } from '@/three/odyssey/OdysseyModel3D';

function retainedCreature(initialized: boolean): ModuleCreature {
  const creature = Object.create(ModuleCreature.prototype) as ModuleCreature;
  Object.assign(creature, {
    initialized, debugLabel: {}, effects: [{ duration: 30, expireTime: 12345 }],
    inventory: [{}], equipment: { RIGHTHAND: {} },
    getTemplateResRef: jest.fn(() => ''),
    initProperties: jest.fn(), loadScripts: jest.fn(),
    isDead: jest.fn(() => false), isPartyMember: jest.fn(() => true),
  });
  return creature;
}

describe('retained creature module reload', () => {
  test('keeps live effects, expiry and items while refreshing script and object registration', () => {
    const creature = retainedCreature(true);
    const effects = creature.effects;
    const inventory = creature.inventory;
    const weapon = creature.equipment.RIGHTHAND;
    for (let transition = 0; transition < 4; transition++) creature.load();
    expect(creature.initProperties).not.toHaveBeenCalled();
    expect(creature.effects).toBe(effects);
    expect(creature.effects).toEqual([{ duration: 30, expireTime: 12345 }]);
    expect(creature.inventory).toBe(inventory);
    expect(creature.equipment.RIGHTHAND).toBe(weapon);
    expect(creature.loadScripts).toHaveBeenCalledTimes(4);
    expect(GameState.ModuleObjectManager.AddObjectById).toHaveBeenCalledWith(creature);
    expect(GameState.FactionManager.AddCreatureToFaction).toHaveBeenCalledWith(creature);
  });

  test('hydrates a newly created savegame creature normally', () => {
    const creature = retainedCreature(false);
    creature.load();
    expect(creature.initProperties).toHaveBeenCalledTimes(1);
    expect(creature.loadScripts).toHaveBeenCalledTimes(1);
  });

  test('releases a parentless head source subscription when the retained player rebuilds its head', async () => {
    const creature = retainedCreature(true);
    const previous = new OdysseyModel3D();
    const unsubscribe = jest.fn();
    (previous as any).sourceModelUnsubscribe = unsubscribe;
    const replacement = new OdysseyModel3D();
    Object.assign(creature, { head: previous, creatureAppearance: { normalhead: 0, modeltype: 'B' },
      getGoodEvil: () => 50, model: { attachHead: jest.fn() } });
    GameState.SWRuleSet.heads[0] = { head: 'head', getTextureGoodEvil: () => '' } as never;
    const load = jest.spyOn(MDLLoader.loader, 'load').mockResolvedValue({} as never);
    const build = jest.spyOn(OdysseyModel3D, 'FromMDL').mockResolvedValue(replacement);
    try {
      await creature.loadHead();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(creature.head).toBe(replacement);
    } finally { load.mockRestore(); build.mockRestore(); }
  });

  test('reuses its innate racial effect on repeated spawns, without removing authored effects', () => {
    const creature = retainedCreature(true);
    const authored = new EffectRacialType();
    authored.setDurationType(GameEffectDurationType.PERMANENT);
    creature.effects = [authored];
    Object.assign(creature, {
      getRace: jest.fn(() => 6), initPerceptionList: jest.fn(), updateCollision: jest.fn(),
      addEffect: jest.fn((effect: GameEffect) => creature.effects.push(effect)),
    });
    for (let arrival = 0; arrival < 4; arrival++) creature.initEffects();
    expect(creature.effects).toHaveLength(2);
    expect(creature.effects[0]).toBe(authored);
    expect(creature.effects[1].getInt(0)).toBe(6);
    expect(creature.effects[1].skipOnLoad).toBe(true);
    expect(creature.effects[1].getDurationType()).toBe(GameEffectDurationType.INNATE);
    expect(creature.addEffect).toHaveBeenCalledTimes(1);
  });
});
