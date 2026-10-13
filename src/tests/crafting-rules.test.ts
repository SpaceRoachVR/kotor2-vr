import { describe, expect, test } from '@jest/globals';
import { LAB_STATION, parseRecipes, recipesForCategory, isRecipeVisible, itemValue, canCreate, breakdownYield, isBreakable } from '@/game/tsl/crafting/CraftingRules';

const rows = {
  0: { label: 'g_i_medeqpmnt01', skilllevel: '1', group: '0', base_skill: '7' },
  1: { label: 'G_I_CMBTSHOT002', skilllevel: '23', group: '1', base_skill: '7' },
  2: { label: 'g_i_trapkit018', skilllevel: '15', group: '2', base_skill: '1' },
  3: { label: 'g_w_fraggren01', skilllevel: '3', group: '3', base_skill: '1' },
  4: { label: 'hk_part', skilllevel: '50', group: '5', base_skill: '1' },
  5: { label: '****', skilllevel: '1', group: '0', base_skill: '7' },
};
const recipes = parseRecipes(rows, LAB_STATION);

describe('lab station crafting rules', () => {
  test('parses rows, lower-cases resrefs, drops group 5 and blank labels', () => {
    expect(recipes.map(r => r.resref)).toEqual(['g_i_medeqpmnt01', 'g_i_cmbtshot002', 'g_i_trapkit018', 'g_w_fraggren01']);
    expect(recipes[1]).toEqual({ resref: 'g_i_cmbtshot002', requiredRank: 23, group: 1, skill: 7 });
  });
  test('categories map tabs to groups', () => {
    const mines = LAB_STATION.categories.find(c => c.key === 'mines')!;
    expect(recipesForCategory(recipes, mines).map(r => r.resref)).toEqual(['g_i_trapkit018']);
  });
  test('visible up to rank + 8', () => {
    expect(isRecipeVisible(recipes[1], 15)).toBe(true);   // 23 <= 23
    expect(isRecipeVisible(recipes[1], 14)).toBe(false);  // 23 > 22
  });
  test('value is half the credit cost, rounded down', () => {
    expect(itemValue(75, LAB_STATION)).toBe(37);
    expect(itemValue(150, LAB_STATION)).toBe(75);
  });
  test('creatable needs the rank and the chemicals', () => {
    expect(canCreate(recipes[0], 1, 20, 20)).toBe(true);   // exactly enough
    expect(canCreate(recipes[0], 1, 20, 19)).toBe(false);  // one short
    expect(canCreate(recipes[1], 22, 50, 999)).toBe(false); // rank too low
  });
  test('breakdown yields 1 below rank 1, 5% per rank, capped at rank 20', () => {
    expect(breakdownYield(75, 0)).toBe(1);
    expect(breakdownYield(75, 1)).toBe(3);
    expect(breakdownYield(75, 10)).toBe(37);
    expect(breakdownYield(75, 20)).toBe(75);
    expect(breakdownYield(75, 25)).toBe(75);
  });
  test('breakdown yield follows the spec exactly: only rank below 1 is floored at 1', () => {
    expect(breakdownYield(3, 1)).toBe(0);  // floor(3 x 1 x 0.05)
    expect(breakdownYield(0, 5)).toBe(0);
    expect(breakdownYield(0, 0)).toBe(1);
  });
  test('breakable only for lab recipes, case-insensitively', () => {
    expect(isBreakable('G_I_MEDEQPMNT01', recipes)).toBe(true);
    expect(isBreakable('hk_part', recipes)).toBe(false);
    expect(isBreakable('w_blaste_01', recipes)).toBe(false);
  });
});
