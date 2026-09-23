import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { ModuleCreatureArmorSlot } from '@/enums/module/ModuleCreatureArmorSlot';
import { canEquipInSlot, resolveEquipableSlotMask } from '@/engine/rules/EquipmentSlotRules';

/**
 * Round 8, N6: the equipment screen listed no weapons for the second weapon
 * set. baseitems.2da equipableslots, read from the install: Blaster Pistol,
 * Vibroblade and Lightsaber 0x00030 (either hand), Blaster Carbine and
 * Double-Bladed Lightsaber 0x00010 (main hand only). No row carries the second
 * set's bits.
 */
const EITHER_HAND = 0x00030;
const MAIN_HAND_ONLY = 0x00010;

describe('equipment slot rules', () => {
  test('the second set takes its rules from the first', () => {
    expect(resolveEquipableSlotMask(ModuleCreatureArmorSlot.RIGHTHAND2)).toBe(ModuleCreatureArmorSlot.RIGHTHAND);
    expect(resolveEquipableSlotMask(ModuleCreatureArmorSlot.LEFTHAND2)).toBe(ModuleCreatureArmorSlot.LEFTHAND);
  });

  test.each([
    ['a pistol in the second main hand', EITHER_HAND, ModuleCreatureArmorSlot.RIGHTHAND2, true],
    ['a pistol in the second off hand', EITHER_HAND, ModuleCreatureArmorSlot.LEFTHAND2, true],
    ['a carbine in the second main hand', MAIN_HAND_ONLY, ModuleCreatureArmorSlot.RIGHTHAND2, true],
    ['a carbine in the second off hand', MAIN_HAND_ONLY, ModuleCreatureArmorSlot.LEFTHAND2, false],
    ['a carbine in the first off hand', MAIN_HAND_ONLY, ModuleCreatureArmorSlot.LEFTHAND, false],
  ])('%s: %s', (_name, slots, slot, expected) => {
    expect(canEquipInSlot(slots, slot)).toBe(expected);
  });

  test('other slots are untouched', () => {
    expect(resolveEquipableSlotMask(ModuleCreatureArmorSlot.HEAD)).toBe(ModuleCreatureArmorSlot.HEAD);
    expect(canEquipInSlot(EITHER_HAND, ModuleCreatureArmorSlot.HEAD)).toBe(false);
  });

  test('InventoryManager filters through the rule', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/managers/InventoryManager.ts'), 'utf8');
    const body = source.slice(source.indexOf('static isItemUsableInSlot'));
    expect(body.slice(0, body.indexOf('\n  }'))).toContain('canEquipInSlot(');
  });
});
