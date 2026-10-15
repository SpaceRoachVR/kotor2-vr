import type { GUILabel, GUIListBox, GUIButton } from "@/gui";
import { GameState } from "@/GameState";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { BitWise } from "@/utility/BitWise";
import type { ModuleCreature } from "@/module";
import { ResourceLoader } from "@/loaders";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { TwoDAObject } from "@/resource/TwoDAObject";
import { LAB_STATION, WORKBENCH_STATION, parseRecipes } from "@/game/tsl/crafting/CraftingRules";
import { CraftingSession } from "@/game/tsl/crafting/CraftingSession";
import { CraftingEnginePorts } from "@/game/tsl/crafting/CraftingEnginePorts";
import { BreakdownTabKey, CategoryKey, CraftingMenuBase } from "@/game/tsl/menu/CraftingMenuBase";

/** dialog.tlk "Component Value": LBL_COST in breakdown mode. */
const TLK_COMPONENT_VALUE = 48398;

/**
 * MenuComponent class: TSL's Workbench item creation screen (component_p).
 *
 * The party spends components (PartyManager.ComponentCount) to create the
 * recipes in itemcreate.2da (or the script's override table, itemcreatemira
 * for Mira and tutitemcreate for the prologue), and breaks any non-plot
 * inventory item except Lab Station items down into components. The yield
 * uses the main character's Repair, whoever uses the bench. The screen
 * behaviour is CraftingMenuBase's; this class binds it to component_p's five
 * create tabs and five breakdown tabs (shown in breakdown mode only).
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file MenuComponent.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class MenuComponent extends CraftingMenuBase {

  declare LBL_BAR2: GUILabel;
  declare LB_DESCRIPTIONINV: GUIListBox;
  declare LBL_BAR1: GUILabel;
  declare LBL_CREDITS: GUILabel;
  declare LBL_STOCK: GUILabel;
  declare BTN_CREATE_RANGED: GUIButton;
  declare BTN_CREATE_MELEE: GUIButton;
  declare BTN_CREATE_ARMOR: GUIButton;
  declare BTN_CREATE_LIGHTSABER: GUIButton;
  declare BTN_CREATE_MISC: GUIButton;
  declare BTN_BREAK_ALL: GUIButton;
  declare BTN_BREAK_WEAPONS: GUIButton;
  declare BTN_BREAK_ARMOR: GUIButton;
  declare BTN_BREAK_USEABLE: GUIButton;
  declare BTN_BREAK_MISC: GUIButton;
  declare LBL_TITLE2: GUILabel;
  declare LBL_BAR3: GUILabel;

  category: CategoryKey = 'ranged';
  protected readonly station = WORKBENCH_STATION;
  protected readonly engine = new CraftingEnginePorts(WORKBENCH_STATION);
  protected readonly breakdownValueStrref = TLK_COMPONENT_VALUE;
  /** The recipe table the open session uses (itemcreate unless a script overrode it). */
  recipeTable = WORKBENCH_STATION.recipeTable;

  constructor(){
    super();
    this.gui_resref = 'component_p';
    this.background = '';
    this.voidFill = true;
  }

  async menuControlInitializer(skipInit: boolean = false) {
    await super.menuControlInitializer(true);
    if(skipInit) return;
    return new Promise<void>((resolve, reject) => {
      this.bindCraftingControls();
      resolve();
    });
  }

  protected createTabs(): [GUIButton, CategoryKey][] {
    return [
      [this.BTN_CREATE_RANGED, 'ranged'],
      [this.BTN_CREATE_MELEE, 'melee'],
      [this.BTN_CREATE_ARMOR, 'armor'],
      [this.BTN_CREATE_LIGHTSABER, 'lightsaber'],
      [this.BTN_CREATE_MISC, 'other'],
    ];
  }

  protected breakdownTabs(): [GUIButton, BreakdownTabKey][] {
    return [
      [this.BTN_BREAK_ALL, 'all'],
      [this.BTN_BREAK_WEAPONS, 'weapons'],
      [this.BTN_BREAK_ARMOR, 'armor'],
      [this.BTN_BREAK_USEABLE, 'useable'],
      [this.BTN_BREAK_MISC, 'misc'],
    ];
  }

  /**
   * Opens the Workbench for `user` (the party leader when it is not a valid
   * creature) with the recipes of `recipeTable` (ShowUpgradeScreen's
   * sOverride2DA). A table that cannot be loaded falls back to itemcreate
   * with a warning. Opens on the Ranged tab.
   */
  async openFor(user?: ModuleCreature, recipeTable: string = WORKBENCH_STATION.recipeTable): Promise<void> {
    this.user = BitWise.InstanceOfObject(user, ModuleObjectType.ModuleCreature) ? user : undefined;
    let name = String(recipeTable || WORKBENCH_STATION.recipeTable).toLowerCase();
    let table = await MenuComponent.loadTable(name);
    if(!table && name !== WORKBENCH_STATION.recipeTable){
      console.warn(`[MenuComponent] recipe table "${name}" could not be loaded; using ${WORKBENCH_STATION.recipeTable}`);
      name = WORKBENCH_STATION.recipeTable;
      table = await MenuComponent.loadTable(name);
    }
    this.recipeTable = name;
    const recipes = parseRecipes((table?.rows ?? {}) as any, WORKBENCH_STATION);
    this.engine.setUser(this.user);
    await this.engine.preloadTemplates(recipes);
    this.session = new CraftingSession(recipes, this.engine.ports(), WORKBENCH_STATION, MenuComponent.labResrefs());
    this.category = 'ranged';
    this.breakdownMode = false;
    this.breakTab = 'all';
    this.open();
  }

  /** A 2DA by name: the loaded table, else read through the resource loader and kept. */
  private static async loadTable(name: string): Promise<TwoDAObject | undefined> {
    const tables = GameState.TwoDAManager.datatables;
    const loaded = tables.get(name);
    if(loaded) return loaded;
    try {
      const buffer = await ResourceLoader.loadResource(ResourceTypes['2da'], name);
      if(!buffer) return undefined;
      const table = new TwoDAObject(buffer);
      if(!table.rows || !Object.keys(table.rows).length) return undefined;
      tables.set(name, table);
      return table;
    } catch (e) {
      return undefined;
    }
  }

  /** The Lab Station's item resrefs (every chemicalcreate.2da label), lower-case: the bench will not break these down. */
  private static labResrefs(): Set<string> {
    const rows = (GameState.TwoDAManager.datatables.get(LAB_STATION.recipeTable)?.rows ?? {}) as Record<string, Record<string, string>>;
    const resrefs = new Set<string>();
    for(const row of Object.values(rows)){
      const label = String(row?.label ?? '').trim().toLowerCase();
      if(label && label !== '****') resrefs.add(label);
    }
    return resrefs;
  }

}
