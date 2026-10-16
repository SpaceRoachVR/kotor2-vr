import { describe, expect, test } from '@jest/globals';
import { LAB_STATION, parseRecipes, recipesForCategory, isRecipeVisible, itemValue, canCreate, breakdownYield, isBreakable, WORKBENCH_STATION, breakdownTabFor, isBreakableAt } from '@/game/tsl/crafting/CraftingRules';

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

describe('workbench station rules', () => {
  test('workbench value is 5% of the credit cost', () => {
    expect(itemValue(1750, WORKBENCH_STATION)).toBe(87);
  });
  test('workbench recipes keep their own skill and override tag', () => {
    const rows = {
      0: { label: 'u_r_targ_01', skill: '4', group: '1', level: '0', align: '0', base_skill: '3', dunno: '0', overridetag: '' },
      1: { label: 'g_i_parts01', skill: '1', group: '4', level: '0', align: '0', base_skill: '5', dunno: '0', overridetag: 'K_REPAIR_PART' },
      2: { label: 'G_I_DRDREPEQP001', skill: '1', group: '4', level: '0', align: '0', base_skill: '5', dunno: '0', overridetag: '****' },
    };
    const r = parseRecipes(rows, WORKBENCH_STATION);
    expect(r).toEqual([
      { resref: 'u_r_targ_01', requiredRank: 4, group: 1, skill: 3, overrideTag: undefined },
      { resref: 'g_i_parts01', requiredRank: 1, group: 4, skill: 5, overrideTag: 'K_REPAIR_PART' },
      { resref: 'g_i_drdrepeqp001', requiredRank: 1, group: 4, skill: 5, overrideTag: undefined },
    ]);
  });
  test('workbench create tabs map to groups', () => {
    expect(WORKBENCH_STATION.categories.map(c => [c.key, c.groups])).toEqual(
      [['armor', [0]], ['ranged', [1]], ['melee', [2]], ['lightsaber', [3]], ['other', [4]]]);
  });
  test('breakdown tabs come from storepanelsort', () => {
    expect([20, 25, 30, 40, 45].map(s => breakdownTabFor(s, WORKBENCH_STATION))).toEqual(Array(5).fill('weapons'));
    expect([4, 5, 10, 15, 55, 60, 65, 70].map(s => breakdownTabFor(s, WORKBENCH_STATION))).toEqual(Array(8).fill('armor'));
    expect([1, 2, 50, 75, 80, 85, 90].map(s => breakdownTabFor(s, WORKBENCH_STATION))).toEqual(Array(7).fill('useable'));
    expect([35, 95, 100, 0].map(s => breakdownTabFor(s, WORKBENCH_STATION))).toEqual(Array(4).fill('misc'));
    expect(breakdownTabFor(20, LAB_STATION)).toBeUndefined();
  });
  test('workbench breaks down any non-plot item except lab items', () => {
    const lab = new Set(['g_i_medeqpmnt01']);
    expect(isBreakableAt(WORKBENCH_STATION, { resref: 'w_blaste_01', plot: false }, [], lab)).toBe(true);
    expect(isBreakableAt(WORKBENCH_STATION, { resref: 'G_I_MEDEQPMNT01', plot: false }, [], lab)).toBe(false);
    expect(isBreakableAt(WORKBENCH_STATION, { resref: 'w_blaste_01', plot: true }, [], lab)).toBe(false);
  });
  test('lab station breakability is unchanged', () => {
    const labRecipes = parseRecipes({ 0: { label: 'g_i_medeqpmnt01', skilllevel: '1', group: '0', base_skill: '7' } }, LAB_STATION);
    expect(isBreakableAt(LAB_STATION, { resref: 'g_i_medeqpmnt01', plot: false }, labRecipes, new Set())).toBe(true);
    expect(isBreakableAt(LAB_STATION, { resref: 'w_blaste_01', plot: false }, labRecipes, new Set())).toBe(false);
  });
});
