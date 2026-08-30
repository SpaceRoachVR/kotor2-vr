import { describe, expect, test } from '@jest/globals';
import { ModuleCreatureArmorSlot } from '@/enums/module/ModuleCreatureArmorSlot';
import {
  equipmentKeyForSlot,
  equipmentSlotMasks,
  resolveEquipmentSlotRule,
} from '@/module/CreatureEquipmentSlots';

/**
 * These pin the two defects the table replaced a hand-written switch to fix.
 *
 * `unequipSlot` detached a right-hand item via `this.model.rhand.remove(...)`
 * before clearing the slot. Droid bodies have no `rhand` node, so for T3-M4
 * that threw, the surrounding catch swallowed it, and the slot was never
 * cleared — the equipment screen accepted the click and did nothing.
 */
describe('equipment slot rules', () => {
  test('covers every slot the armour-slot enum names', () => {
    const enumMasks = Object.values(ModuleCreatureArmorSlot)
      .filter((value): value is number => typeof value === 'number');
    const covered = new Set(equipmentSlotMasks());
    expect([...enumMasks].filter((mask) => !covered.has(mask))).toEqual([]);
  });

  test('maps the numeric mask onto the equipment property name', () => {
    expect(equipmentKeyForSlot(ModuleCreatureArmorSlot.RIGHTHAND)).toBe('RIGHTHAND');
    expect(equipmentKeyForSlot(ModuleCreatureArmorSlot.ARMOR)).toBe('ARMOR');
    expect(equipmentKeyForSlot(ModuleCreatureArmorSlot.HIDE)).toBe('HIDE');
  });

  test('returns nothing for a mask that names no slot', () => {
    expect(resolveEquipmentSlotRule(0)).toBeUndefined();
    expect(equipmentKeyForSlot(0x7fffffff)).toBeUndefined();
  });

  test('attaches hand items to the matching hand node', () => {
    expect(resolveEquipmentSlotRule(ModuleCreatureArmorSlot.RIGHTHAND)?.attach).toBe('rhand');
    expect(resolveEquipmentSlotRule(ModuleCreatureArmorSlot.LEFTHAND)?.attach).toBe('lhand');
  });

  test('the belt is not attached to the right hand', () => {
    // The switch this replaced ran `this.model.rhand.remove(belt.model)`, which
    // is a copy-paste of the RIGHTHAND case and could only throw or detach
    // nothing.
    expect(resolveEquipmentSlotRule(ModuleCreatureArmorSlot.BELT)?.attach).toBeUndefined();
  });

  test('only head and body changes rebuild the creature model', () => {
    const rebuilding = equipmentSlotMasks()
      .filter((mask) => resolveEquipmentSlotRule(mask)?.reloadModelOnUnequip)
      .sort((left, right) => left - right);
    expect(rebuilding).toEqual(
      [ModuleCreatureArmorSlot.HEAD, ModuleCreatureArmorSlot.ARMOR].sort((l, r) => l - r),
    );
  });

  test('every slot names exactly one distinct equipment property', () => {
    const keys = equipmentSlotMasks().map((mask) => equipmentKeyForSlot(mask));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
