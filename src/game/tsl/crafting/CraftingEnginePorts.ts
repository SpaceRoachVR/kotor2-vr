import { GameState } from "@/GameState";
import { ResourceLoader } from "@/loaders";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { GFFObject } from "@/resource/GFFObject";
import type { ModuleCreature, ModuleItem } from "@/module";
import type { CraftingStation, Recipe } from "@/game/tsl/crafting/CraftingRules";
import type { CraftingItem, CraftingPorts } from "@/game/tsl/crafting/CraftingSession";

/** A party inventory entry as the session sees it, keeping the engine item for removal. */
export interface EngineCraftingItem extends CraftingItem {
  moduleItem: ModuleItem;
}

/**
 * The main character: the party member flagged as the player, else the
 * PartyManager's player record when it is flagged, else the station's user.
 * When the Exile is not loaded at all (scripted solo segments) breakdown thus
 * uses the user's Repair; retail may use the Exile's (spec open question).
 */
export function resolveMainCharacter(
  party: ModuleCreature[], player: ModuleCreature | undefined, user: ModuleCreature,
): ModuleCreature {
  const member = (party ?? []).find((creature) => creature?.isPlayer === true);
  if(member) return member;
  if(player?.isPlayer) return player;
  return user;
}

/**
 * Binds a CraftingSession to the engine for one crafting station (Lab Station
 * or Workbench): the party's chemicals or components, the user's skills, the
 * party inventory and the recipes' item templates. One instance lives as long
 * as its menu, so templates are read once per game run.
 */
export class CraftingEnginePorts {
  /** The creature using the station; see activeUser(). */
  private user: ModuleCreature | undefined;
  /** Template Cost per recipe resref, read once and kept across opens; undefined = no usable template. */
  private templateCosts = new Map<string, number | undefined>();
  /** Display items built from recipe templates, kept across opens so each is built once. */
  private displayItems = new Map<string, ModuleItem>();
  /** Resrefs whose missing template was already logged. */
  private missingTemplates = new Set<string>();
  /** One CraftingItem per engine item: the session compares inventory entries by identity. */
  private craftingItems = new WeakMap<ModuleItem, EngineCraftingItem>();
  private enginePorts: CraftingPorts | undefined;

  constructor(private readonly station: CraftingStation) {}

  /** The creature using the station; undefined falls back to the party leader. */
  setUser(user: ModuleCreature | undefined): void {
    this.user = user;
  }

  /** The station's user; the party leader when the user is gone. */
  activeUser(): ModuleCreature {
    const user = this.user as any;
    if(user && !user.destroyed) return user;
    return GameState.PartyManager.party[0] ?? GameState.PartyManager.Player;
  }

  ports(): CraftingPorts {
    if(this.enginePorts) return this.enginePorts;
    const chemicals = this.station.currency === 'chemicals';
    this.enginePorts = {
      getCurrency: () => (chemicals ? GameState.PartyManager.ChemicalCount : GameState.PartyManager.ComponentCount) || 0,
      setCurrency: (n: number) => {
        const value = Math.max(0, n);
        if(chemicals) GameState.PartyManager.ChemicalCount = value;
        else GameState.PartyManager.ComponentCount = value;
      },
      skillRank: (skill: number) => this.skillRank(skill),
      breakdownRank: () => this.breakdownRank(),
      createItem: (resref: string, overrideTag?: string) => this.createItem(resref, overrideTag),
      inventory: () => GameState.InventoryManager.getNonQuestInventory().map((item: ModuleItem) => this.toCraftingItem(item)),
      removeOne: (item: CraftingItem) => {
        GameState.InventoryManager.removeItem((item as EngineCraftingItem).moduleItem, 1);
      },
      templateCost: (resref: string) => this.templateCosts.get(resref),
    };
    return this.enginePorts;
  }

  /** The active user's total rank in `skill`. */
  skillRank(skill: number, creature: ModuleCreature = this.activeUser()): number {
    return Number(creature?.getSkillTotal?.(skill)) || 0;
  }

  /** The rank that decides breakdown yield: the user's, or the main character's, per the station. */
  breakdownRank(): number {
    const user = this.activeUser();
    const creature = this.station.breakdownRankFrom === 'mainCharacter'
      ? resolveMainCharacter(GameState.PartyManager.party, GameState.PartyManager.Player, user)
      : user;
    return this.skillRank(this.station.breakdownSkill, creature);
  }

  /**
   * Adds one item from the `resref` template to the party inventory. The
   * template's Tag becomes `overrideTag` before the item is built, so the item
   * carries it from the start (stacking matches by tag). Any failure resolves
   * false so the session refunds the currency.
   */
  private async createItem(resref: string, overrideTag?: string): Promise<boolean> {
    try {
      const buffer = await ResourceLoader.loadResource(ResourceTypes['uti'], resref);
      if(!buffer) return false;
      const gff = new GFFObject(buffer);
      if(overrideTag) gff.RootNode.getFieldByLabel('Tag')?.setValue(overrideTag);
      return !!GameState.InventoryManager.addItem(gff, true);
    } catch (e) {
      console.warn(`[CraftingEnginePorts] could not create "${resref}"`, e);
      return false;
    }
  }

  toCraftingItem(item: ModuleItem): EngineCraftingItem {
    let entry = this.craftingItems.get(item);
    if(!entry){
      entry = { resref: '', name: '', cost: 0, stackSize: 0, plot: false, storePanelSort: 0, moduleItem: item };
      this.craftingItems.set(item, entry);
    }
    entry.resref = String(item.getTemplateResRef?.() || item.getTag?.() || '').toLowerCase();
    entry.name = String(item.getName?.() ?? '');
    entry.cost = Number(item.cost) || 0;
    entry.stackSize = Number(item.getStackSize?.()) || 1;
    entry.plot = !!item.plot;
    entry.storePanelSort = Number(item.baseItem?.storePanelSort) || 0;
    return entry;
  }

  /** The display item built from `resref`'s template, if it had a usable one. */
  displayItem(resref: string): ModuleItem | undefined {
    return this.displayItems.get(resref);
  }

  /** Every display item built so far, by recipe resref. */
  displayItemMap(): ReadonlyMap<string, ModuleItem> {
    return this.displayItems;
  }

  /**
   * Reads each recipe's template once for the adapter's lifetime (game data
   * does not change while the game runs), keeping its Cost and a display item.
   */
  async preloadTemplates(recipes: Recipe[]): Promise<void> {
    for(const recipe of recipes){
      const resref = recipe.resref;
      if(this.templateCosts.has(resref)) continue;
      try {
        const buffer = await ResourceLoader.loadResource(ResourceTypes['uti'], resref);
        const gff = new GFFObject(buffer);
        const cost = gff.RootNode.hasField('Cost') ? Number(gff.getFieldByLabel('Cost').getValue()) : NaN;
        if(!Number.isFinite(cost)) throw new Error('template has no Cost');
        this.templateCosts.set(resref, cost);
        if(!this.displayItems.has(resref)){
          const item = new GameState.Module.ModuleArea.ModuleItem(gff);
          item.initProperties();
          item.load();
          item.setStackSize(1);
          // Only a picture for the recipe list: keep it out of the module's
          // object registry, which a module load resets and re-numbers.
          CraftingEnginePorts.unregister(item);
          this.displayItems.set(resref, item);
        }
      } catch (e) {
        this.templateCosts.set(resref, undefined);
        if(!this.missingTemplates.has(resref)){
          this.missingTemplates.add(resref);
          console.warn(`[CraftingEnginePorts] recipe "${resref}" has no usable item template; it is not listed`, e);
        }
      }
    }
  }

  /** A display item's constructor registers it with ModuleObjectManager; undo that. */
  private static unregister(item: ModuleItem){
    const manager = GameState.ModuleObjectManager;
    if(manager?.ObjectList?.get(item.id) === item) manager.RemoveObjectById(item.id);
  }
}
