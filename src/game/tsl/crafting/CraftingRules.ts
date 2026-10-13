import { SkillType } from '@/enums/nwscript/SkillType';

/**
 * Pure rules for TSL's Lab Station crafting screen. Sources: the game's
 * chemicalcreate.2da (one row per recipe: label = item resref, skilllevel =
 * rank needed, group = tab, base_skill = skill the recipe uses) and the
 * StrategyWiki Lab Station page (item value = half the credit cost, chemicals
 * spent equal that value, breakdown returns 5% of value per Treat Injury rank
 * up to rank 20, and recipes show up to 8 ranks above the user's own).
 * Nothing here touches the engine, so it can be unit-tested without a game.
 */

export interface CraftingCategory {
  key: 'health' | 'stims' | 'grenades' | 'mines';
  groups: number[];
}

export interface CraftingStation {
  id: 'lab';
  recipeTable: 'chemicalcreate';
  valueRate: number;
  breakdownSkill: number;
  categories: CraftingCategory[];
  excludedGroups: number[];
}

export interface Recipe {
  resref: string;
  requiredRank: number;
  group: number;
  skill: number;
}

/** How many ranks above the user's own a recipe is still listed. */
const VISIBLE_RANK_MARGIN = 8;
/** Breakdown yield stops growing at this skill rank. */
const BREAKDOWN_RANK_CAP = 20;

export const LAB_STATION: CraftingStation = {
  id: 'lab',
  recipeTable: 'chemicalcreate',
  valueRate: 0.5,
  breakdownSkill: SkillType.TREAT_INJURY,
  categories: [
    { key: 'health', groups: [0] },
    { key: 'stims', groups: [1] },
    { key: 'grenades', groups: [3] },
    { key: 'mines', groups: [2] },
  ],
  excludedGroups: [5],
};

/**
 * Builds recipes from `TwoDAObject.rows`. Rows in an excluded group and rows
 * with an empty or `****` label are dropped; resrefs are lower-cased.
 */
export function parseRecipes(rows: Record<string, Record<string, string>>, station: CraftingStation): Recipe[] {
  const recipes: Recipe[] = [];
  for (const key of Object.keys(rows)) {
    const row = rows[key];
    const label = (row.label ?? '').trim();
    if (label === '' || label === '****') continue;
    const group = parseInt(row.group, 10);
    if (station.excludedGroups.includes(group)) continue;
    recipes.push({
      resref: label.toLowerCase(),
      requiredRank: parseInt(row.skilllevel, 10),
      group,
      skill: parseInt(row.base_skill, 10),
    });
  }
  return recipes;
}

export function recipesForCategory(recipes: Recipe[], category: CraftingCategory): Recipe[] {
  return recipes.filter((r) => category.groups.includes(r.group));
}

export function isRecipeVisible(recipe: Recipe, userRank: number): boolean {
  return recipe.requiredRank <= userRank + VISIBLE_RANK_MARGIN;
}

/** The crafting value of an item: its credit cost scaled by the station rate, rounded down. */
export function itemValue(cost: number, station: CraftingStation): number {
  return Math.floor(cost * station.valueRate);
}

export function canCreate(recipe: Recipe, userRank: number, value: number, chemicals: number): boolean {
  return userRank >= recipe.requiredRank && chemicals >= value;
}

/**
 * Chemicals returned for breaking an item down, per the spec:
 * rank < 1 ? 1 : floor(value * min(rank, 20) * 0.05). A low-value item at a
 * low rank can yield 0. Dividing by 20 is the same 5% without 0.05's binary
 * rounding error.
 */
export function breakdownYield(value: number, breakdownRank: number): number {
  if (!(breakdownRank >= 1)) return 1;
  const rank = Math.min(breakdownRank, BREAKDOWN_RANK_CAP);
  return Math.floor((value * rank) / BREAKDOWN_RANK_CAP);
}

/** Only items the lab can make can be broken down. */
export function isBreakable(resref: string, recipes: Recipe[]): boolean {
  const lower = resref.toLowerCase();
  return recipes.some((r) => r.resref === lower);
}
