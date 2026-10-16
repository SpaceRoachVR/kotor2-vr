import { describe, expect, jest, test } from '@jest/globals';

jest.mock('@/GameState', () => ({ GameState: {
  ModuleObjectManager: { AddObjectById: jest.fn() },
  FactionManager: { AddCreatureToFaction: jest.fn() },
  SWRuleSet: { heads: [] as unknown[] },
} }));

import { ModuleCreature } from '@/module/ModuleCreature';
import { CombatFeatType } from '@/enums/combat/CombatFeatType';

/** A saber-like item whose deflection modifier is fixed. */
const item = (modifier: number, lightsaber = false) => ({
  isLightsaber: () => lightsaber,
  getBlasterDeflectionModifier: () => modifier,
});

function jedi(equipment: Record<string, unknown>, feats: number[] = [CombatFeatType.JEDI_DEFENSE]): ModuleCreature {
  const creature = Object.create(ModuleCreature.prototype) as ModuleCreature;
  Object.assign(creature, {
    equipment, effects: [], classes: [{ level: 10 }],
    getHasFeat: (feat: number) => feats.includes(feat),
  });
  return creature;
}

describe('ModuleCreature.getBlasterDeflectionBonus with item properties', () => {
  test('a saber holding Jenruax (+5) and a Pure Kunda lens (+2) adds 7', () => {
    expect(jedi({ RIGHTHAND: item(7, true) }).getBlasterDeflectionBonus()).toBe(7);
  });

  test('items in other active slots count too; the inactive weapon set does not', () => {
    const creature = jedi({
      RIGHTHAND: item(4, true), LEFTHAND: item(-2, true),
      RIGHTHAND2: item(5, true), LEFTHAND2: item(5, true),
      ARMOR: undefined,
    });
    expect(creature.getBlasterDeflectionBonus()).toBe(2);
  });

  test('items add on top of the Jedi Defense tier', () => {
    const creature = jedi({ RIGHTHAND: item(3, true) }, [CombatFeatType.JEDI_DEFENSE, CombatFeatType.ADVANCED_JEDI_DEFENSE]);
    expect(creature.getBlasterDeflectionBonus()).toBe(6);
  });

  test('without Jedi Defense an item gives no deflection at all', () => {
    expect(jedi({ RIGHTHAND: item(5, true) }, []).getBlasterDeflectionBonus()).toBeNull();
  });

  test('without a lightsaber in the main hand there is no deflection', () => {
    expect(jedi({ RIGHTHAND: item(5, false) }).getBlasterDeflectionBonus()).toBeNull();
  });
});
