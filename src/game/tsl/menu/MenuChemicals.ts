import type { GUILabel, GUIListBox, GUIButton } from "@/gui";
import { GameState } from "@/GameState";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { BitWise } from "@/utility/BitWise";
import type { ModuleCreature } from "@/module";
import { LAB_STATION, parseRecipes } from "@/game/tsl/crafting/CraftingRules";
import { CraftingSession } from "@/game/tsl/crafting/CraftingSession";
import { CraftingEnginePorts } from "@/game/tsl/crafting/CraftingEnginePorts";
import { CategoryKey, CraftingMenuBase } from "@/game/tsl/menu/CraftingMenuBase";

/** dialog.tlk "Chemical Value": LBL_COST in breakdown mode. */
const TLK_CHEMICAL_VALUE = 115432;

/**
 * MenuChemicals class: TSL's Lab Station ("Create New Items").
 *
 * The party spends chemicals (PartyManager.ChemicalCount) to create the
 * recipes in chemicalcreate.2da, and breaks lab items down into chemicals.
 * The screen behaviour is CraftingMenuBase's; this class binds it to the
 * retail chemical_p layout and its four create tabs.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file MenuChemicals.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class MenuChemicals extends CraftingMenuBase {

  declare LBL_BAR2: GUILabel;
  declare LB_DESCRIPTIONINV: GUIListBox;
  declare LBL_BAR1: GUILabel;
  declare LBL_CREDITS: GUILabel;
  declare LBL_STOCK: GUILabel;
  declare LBL_TITLE2: GUILabel;
  declare BTN_CREATE_HEALTH: GUIButton;
  declare BTN_CREATE_STIMS: GUIButton;
  declare BTN_CREATE_GRENADES: GUIButton;
  declare BTN_CREATE_MINES: GUIButton;
  declare LBL_BAR3: GUILabel;

  category: CategoryKey = 'health';
  protected readonly station = LAB_STATION;
  protected readonly engine = new CraftingEnginePorts(LAB_STATION);
  protected readonly breakdownValueStrref = TLK_CHEMICAL_VALUE;

  constructor(){
    super();
    this.gui_resref = 'chemical_p';
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
      [this.BTN_CREATE_HEALTH, 'health'],
      [this.BTN_CREATE_STIMS, 'stims'],
      [this.BTN_CREATE_GRENADES, 'grenades'],
      [this.BTN_CREATE_MINES, 'mines'],
    ];
  }

  /**
   * Opens the Lab Station for `user` (the party leader when it is not a valid
   * creature). Recipe templates are read on the first open and kept, so the
   * session can price every recipe synchronously. Opens on the Health tab.
   */
  async openFor(user?: ModuleCreature): Promise<void> {
    this.user = BitWise.InstanceOfObject(user, ModuleObjectType.ModuleCreature) ? user : undefined;
    const table = GameState.TwoDAManager.datatables.get(LAB_STATION.recipeTable);
    const recipes = parseRecipes((table?.rows ?? {}) as any, LAB_STATION);
    this.engine.setUser(this.user);
    await this.engine.preloadTemplates(recipes);
    this.session = new CraftingSession(recipes, this.engine.ports(), LAB_STATION);
    this.category = 'health';
    this.breakdownMode = false;
    this.open();
  }

}
