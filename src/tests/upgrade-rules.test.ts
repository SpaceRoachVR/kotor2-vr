import { describe, expect, test } from '@jest/globals';
import {
  categoryFor, slotTypes, isSlotOpen, fits, parseUpgradeTable, rowForTemplate, slotMinLevel, upgradeTypeName,
} from '@/game/tsl/crafting/UpgradeRules';

describe('UpgradeRules', () => {
  test('categories from storepanelsort', () => {
    expect([40, 45].map(categoryFor)).toEqual(['ranged', 'ranged']);
    expect([20, 25].map(categoryFor)).toEqual(['melee', 'melee']);
    expect([4, 5, 10, 15].map(categoryFor)).toEqual(['armor', 'armor', 'armor', 'armor']);
    expect([30, 50, 0].map(categoryFor)).toEqual([undefined, undefined, undefined]);
  });
  test('slot layout per category', () => {
    expect(slotTypes('ranged')).toEqual([4, 6, 5]);
    expect(slotTypes('melee')).toEqual([7, 8, 9]);
    expect(slotTypes('armor')).toEqual([10, 11]);
  });
  test('slots open by item level', () => {
    expect([4, 6, 5].map(t => isSlotOpen(1, t))).toEqual([true, false, false]);
    expect([4, 6, 5].map(t => isSlotOpen(2, t))).toEqual([true, true, false]);
    expect([4, 6, 5].map(t => isSlotOpen(3, t))).toEqual([true, true, true]);
    expect([7, 8, 9].map(t => isSlotOpen(1, t))).toEqual([true, true, false]);
    expect(isSlotOpen(0, 4)).toBe(false);
  });
  test('a part fits by type and level', () => {
    expect(fits({ type: 4, level: 1 }, 4, 1)).toBe(true);
    expect(fits({ type: 5, level: 3 }, 5, 2)).toBe(false);
    expect(fits({ type: 11, level: 2 }, 11, 1)).toBe(false);
    expect(fits({ type: 4, level: 1 }, 6, 3)).toBe(false);
  });
  test('parses upgrade.2da', () => {
    const t = parseUpgradeTable({
      0: { label: 'Rubat_crystal', template: 'u_l_crys_02', upgradetype: '0' },
      16: { label: 'Scope', template: 'G_I_UPGRADE001', upgradetype: '4' },
      17: { label: 'x', template: '****', upgradetype: '5' },
    });
    expect(t).toEqual([{ row: 0, template: 'u_l_crys_02', type: 0 }, { row: 16, template: 'g_i_upgrade001', type: 4 }]);
    expect(rowForTemplate(t, 'G_I_UPGRADE001')?.row).toBe(16);
  });
});

test('type names and unknown slot level', () => {
  expect([4, 5, 6, 7, 8, 9, 10, 11].map(upgradeTypeName)).toEqual(
    ['Targeting', 'Power Pack', 'Firing Chamber', 'Grip', 'Edge', 'Energy Cell', 'Overlay', 'Underlay']);
  expect(slotMinLevel(99)).toBe(Infinity);
});
