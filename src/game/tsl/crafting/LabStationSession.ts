import {
  CraftingCategory, CraftingStation, LAB_STATION, Recipe,
  breakdownYield, canCreate, isBreakable, isRecipeVisible, itemValue, recipesForCategory,
} from '@/game/tsl/crafting/CraftingRules';

/**
 * GUI-free create/breakdown logic for the Lab Station. The engine is reached
 * only through LabStationPorts, so this can be unit-tested with a fake.
 */

export interface CraftingItem {
  resref: string;
  name: string;
  cost: number;
  stackSize: number;
}

export interface LabStationPorts {
  getChemicals(): number;
  setChemicals(n: number): void;
  skillRank(skill: number): number;
  createItem(resref: string): Promise<boolean>;
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

export class LabStationSession {
  constructor(
    private readonly recipes: Recipe[],
    private readonly ports: LabStationPorts,
    private readonly station: CraftingStation = LAB_STATION,
  ) {}

  recipeViews(categoryKey: CraftingCategory['key']): RecipeView[] {
    const category = this.station.categories.find((c) => c.key === categoryKey);
    if (!category) return [];
    const inventory = this.ports.inventory();
    const chemicals = this.ports.getChemicals();
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
      views.push({ recipe, value, creatable: canCreate(recipe, rank, value, chemicals), carried });
    }
    return views;
  }

  async create(recipe: Recipe): Promise<boolean> {
    const cost = this.ports.templateCost(recipe.resref);
    if (cost === undefined) return false;
    const value = itemValue(cost, this.station);
    const chemicals = this.ports.getChemicals();
    if (!canCreate(recipe, this.ports.skillRank(recipe.skill), value, chemicals)) return false;
    this.ports.setChemicals(chemicals - value);
    if (!(await this.ports.createItem(recipe.resref))) {
      this.ports.setChemicals(chemicals);
      return false;
    }
    return true;
  }

  breakableItems(): CraftingItem[] {
    return this.ports.inventory().filter((i) => isBreakable(i.resref, this.recipes));
  }

  breakdownValue(item: CraftingItem): number {
    return itemValue(item.cost, this.station);
  }

  breakdown(item: CraftingItem): boolean {
    if (!this.ports.inventory().includes(item)) return false;
    if (!isBreakable(item.resref, this.recipes)) return false;
    const gained = breakdownYield(this.breakdownValue(item), this.ports.skillRank(this.station.breakdownSkill));
    this.ports.removeOne(item);
    this.ports.setChemicals(this.ports.getChemicals() + gained);
    return true;
  }
}
