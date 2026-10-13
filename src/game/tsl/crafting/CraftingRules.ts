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
  key: 'health' | 'stims' | 'grenades' | 'mines' | 'armor' | 'ranged' | 'melee' | 'lightsaber' | 'other';
  groups: number[];
}

/** A breakdown list filter, matched against baseitems.2da `storepanelsort`. */
export interface BreakdownTab {
  key: 'all' | 'weapons' | 'armor' | 'useable' | 'misc';
  storePanelSorts: number[] | 'all' | 'other';
}

export interface CraftingStation {
  id: 'lab' | 'workbench';
  recipeTable: string;
  currency: 'chemicals' | 'components';
  valueRate: number;
  breakdownSkill: number;
  breakdownRankFrom: 'user' | 'mainCharacter';
  breakable: 'recipes' | 'anyNonPlotExceptLab';
  breakdownTabs: BreakdownTab[];
  categories: CraftingCategory[];
  excludedGroups: number[];
}

export interface Recipe {
  resref: string;
  requiredRank: number;
  group: number;
  skill: number;
  overrideTag?: string;
}

/** How many ranks above the user's own a recipe is still listed. */
const VISIBLE_RANK_MARGIN = 8;
/** Breakdown yield stops growing at this skill rank. */
const BREAKDOWN_RANK_CAP = 20;

export const LAB_STATION: CraftingStation = {
  id: 'lab',
  recipeTable: 'chemicalcreate',
  currency: 'chemicals',
  valueRate: 0.5,
  breakdownSkill: SkillType.TREAT_INJURY,
  breakdownRankFrom: 'user',
  breakable: 'recipes',
  breakdownTabs: [],
  categories: [
    { key: 'health', groups: [0] },
    { key: 'stims', groups: [1] },
    { key: 'grenades', groups: [3] },
    { key: 'mines', groups: [2] },
  ],
  excludedGroups: [5],
};

export const WORKBENCH_STATION: CraftingStation = {
  id: 'workbench',
  recipeTable: 'itemcreate',
  currency: 'components',
  valueRate: 0.05,
  breakdownSkill: SkillType.REPAIR,
  breakdownRankFrom: 'mainCharacter',
  breakable: 'anyNonPlotExceptLab',
  breakdownTabs: [
    { key: 'all', storePanelSorts: 'all' },
    { key: 'weapons', storePanelSorts: [20, 25, 30, 40, 45] },
    { key: 'armor', storePanelSorts: [4, 5, 10, 15, 55, 60, 65, 70] },
    { key: 'useable', storePanelSorts: [1, 2, 50, 75, 80, 85, 90] },
    { key: 'misc', storePanelSorts: 'other' },
  ],
  categories: [
    { key: 'armor', groups: [0] },
    { key: 'ranged', groups: [1] },
    { key: 'melee', groups: [2] },
    { key: 'lightsaber', groups: [3] },
    { key: 'other', groups: [4] },
  ],
  excludedGroups: [],
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
    const tag = (row.overridetag ?? '').trim();
    recipes.push({
      resref: label.toLowerCase(),
      requiredRank: parseInt(row.skilllevel ?? row.skill, 10),
      group,
      skill: parseInt(row.base_skill, 10),
      overrideTag: tag === '' || tag === '****' ? undefined : tag,
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

export function canCreate(recipe: Recipe, userRank: number, value: number, available: number): boolean {
  return userRank >= recipe.requiredRank && available >= value;
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

/**
 * Which breakdown tab an item with this `storepanelsort` lands in: the first
 * matching non-`all` tab, `misc` when nothing matches, undefined if the
 * station has no tabs (or no `misc` tab to fall back to).
 */
export function breakdownTabFor(storePanelSort: number, station: CraftingStation): BreakdownTab['key'] | undefined {
  if (station.breakdownTabs.length === 0) return undefined;
  for (const tab of station.breakdownTabs) {
    if (tab.key === 'all') continue;
    if (Array.isArray(tab.storePanelSorts) && tab.storePanelSorts.includes(storePanelSort)) return tab.key;
  }
  return station.breakdownTabs.some((t) => t.key === 'misc') ? 'misc' : undefined;
}

/**
 * Whether the station can break this item down. Plot items never; the lab only
 * takes its own recipes; the workbench takes anything that is not a lab
 * recipe (labResrefs holds the lab recipe resrefs, lower-case).
 */
export function isBreakableAt(
  station: CraftingStation,
  item: { resref: string; plot: boolean },
  stationRecipes: Recipe[],
  labResrefs: Set<string>,
): boolean {
  if (item.plot) return false;
  if (station.breakable === 'recipes') return isBreakable(item.resref, stationRecipes);
  return !labResrefs.has(item.resref.toLowerCase());
}
