import {
  BreakdownTab, CraftingCategory, CraftingStation, Recipe,
  breakdownTabFor, breakdownYield, canCreate, isBreakableAt, isRecipeVisible, itemValue, recipesForCategory,
} from '@/game/tsl/crafting/CraftingRules';

/**
 * GUI-free create/breakdown logic for the crafting station (Lab Station or
 * Workbench). The engine is reached
 * only through CraftingPorts, so this can be unit-tested with a fake.
 */

export interface CraftingItem {
  resref: string;
  name: string;
  cost: number;
  stackSize: number;
  plot: boolean;
  storePanelSort: number;
}

export interface CraftingPorts {
  /** The station's currency: chemicals at the lab, components at the workbench. */
  getCurrency(): number;
  setCurrency(n: number): void;
  skillRank(skill: number): number;
  /** The skill rank that decides breakdown yield (the user's, or the main character's). */
  breakdownRank(): number;
  createItem(resref: string, overrideTag?: string): Promise<boolean>;
  inventory(): CraftingItem[];
  removeOne(item: CraftingItem): void;
  templateCost(resref: string): number | undefined;
}

export interface RecipeView {
  recipe: Recipe;
  value: number;
  creatable: boolean;
  carried: number;
}

export class CraftingSession {
  constructor(
    private readonly recipes: Recipe[],
    private readonly ports: CraftingPorts,
    private readonly station: CraftingStation,
    /** Lab recipe resrefs, lower-case; the workbench refuses to break these down. */
    private readonly labResrefs: Set<string> = new Set(),
  ) {}

  recipeViews(categoryKey: CraftingCategory['key']): RecipeView[] {
    const category = this.station.categories.find((c) => c.key === categoryKey);
    if (!category) return [];
    const inventory = this.ports.inventory();
    const currency = this.ports.getCurrency();
    const views: RecipeView[] = [];
    for (const recipe of recipesForCategory(this.recipes, category)) {
      const rank = this.ports.skillRank(recipe.skill);
      if (!isRecipeVisible(recipe, rank)) continue;
      const cost = this.ports.templateCost(recipe.resref);
      if (cost === undefined) continue;
      const value = itemValue(cost, this.station);
      const carried = inventory
        .filter((i) => i.resref.toLowerCase() === recipe.resref)
        .reduce((sum, i) => sum + i.stackSize, 0);
      views.push({ recipe, value, creatable: canCreate(recipe, rank, value, currency), carried });
    }
    return views;
  }

  async create(recipe: Recipe): Promise<boolean> {
    const cost = this.ports.templateCost(recipe.resref);
    if (cost === undefined) return false;
    const value = itemValue(cost, this.station);
    const currency = this.ports.getCurrency();
    if (!canCreate(recipe, this.ports.skillRank(recipe.skill), value, currency)) return false;
    this.ports.setCurrency(currency - value);
    if (!(await this.ports.createItem(recipe.resref, recipe.overrideTag))) {
      this.ports.setCurrency(currency);
      return false;
    }
    return true;
  }

  breakableItems(tabKey?: BreakdownTab['key']): CraftingItem[] {
    const filterTab = tabKey !== undefined && tabKey !== 'all';
    return this.ports.inventory().filter((i) => (
      isBreakableAt(this.station, i, this.recipes, this.labResrefs)
      && (!filterTab || breakdownTabFor(i.storePanelSort, this.station) === tabKey)
    ));
  }

  breakdownValue(item: CraftingItem): number {
    return itemValue(item.cost, this.station);
  }

  breakdown(item: CraftingItem): boolean {
    if (!this.ports.inventory().includes(item)) return false;
    if (!isBreakableAt(this.station, item, this.recipes, this.labResrefs)) return false;
    const gained = breakdownYield(this.breakdownValue(item), this.ports.breakdownRank());
    this.ports.removeOne(item);
    this.ports.setCurrency(this.ports.getCurrency() + gained);
    return true;
  }
}
