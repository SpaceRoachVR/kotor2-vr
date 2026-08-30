import { describe, expect, test } from '@jest/globals';
import { ModuleCreatureArmorSlot } from '@/enums/module/ModuleCreatureArmorSlot';
import { CREATURE_EQUIPMENT_PERSISTENCE_SLOTS } from '@/module/creature/CreatureEquipmentPersistence';

describe('creature equipment persistence slots', () => {
  test('contains every supported creature equipment slot exactly once', () => {
    const persistedSlots = CREATURE_EQUIPMENT_PERSISTENCE_SLOTS.map(([, slot]) => slot);
    const supportedSlots = Object.values(ModuleCreatureArmorSlot).filter(
      (value): value is ModuleCreatureArmorSlot => typeof value === 'number',
    );

    expect(new Set(persistedSlots).size).toBe(persistedSlots.length);
    expect([...persistedSlots].sort((a, b) => a - b)).toEqual(
      [...supportedSlots].sort((a, b) => a - b),
    );
  });

  test('persists both alternate weapon-set slots', () => {
    const persistedSlots = CREATURE_EQUIPMENT_PERSISTENCE_SLOTS.map(([, slot]) => slot);

    expect(persistedSlots).toContain(ModuleCreatureArmorSlot.LEFTHAND2);
    expect(persistedSlots).toContain(ModuleCreatureArmorSlot.RIGHTHAND2);
  });
});
