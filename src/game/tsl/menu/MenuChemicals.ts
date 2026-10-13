import { GameMenu } from "@/gui";
import type { GUILabel, GUIListBox, GUIButton, GUIControl } from "@/gui";
import { GameState } from "@/GameState";
import { ResourceLoader } from "@/loaders";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { GFFObject } from "@/resource/GFFObject";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { BitWise } from "@/utility/BitWise";
import type { ModuleCreature, ModuleItem } from "@/module";
import { GUIInventoryItem } from "@/game/tsl/gui/GUIInventoryItem";
import {
  CraftingCategory, LAB_STATION, Recipe, breakdownYield, parseRecipes,
} from "@/game/tsl/crafting/CraftingRules";
import {
  CraftingItem, LabStationPorts, LabStationSession, RecipeView,
} from "@/game/tsl/crafting/LabStationSession";

/** A party inventory entry as the session sees it, keeping the engine item for removal. */
interface EngineCraftingItem extends CraftingItem {
  moduleItem: ModuleItem;
}

type CategoryKey = CraftingCategory['key'];

/**
 * Breakdown-mode labels. The store's Examine strings (41937 "Show Buy List",
 * 41938 "Show Sell List") do not fit here; dialog.tlk has the crafting
 * screens' own strings beside the GUI's "View Breakdown Items" (48373) and
 * "Create Item" (48379), plus "Breakdown Inventory Items" and "Chemical Value".
 */
const TLK_VIEW_CREATEABLE_ITEMS = 48375;
const TLK_BREAKDOWN_ITEM = 48380;
const TLK_CHEMICAL_VALUE = 115432;
const TLK_BREAKDOWN_INVENTORY_ITEMS = 115425;

/**
 * MenuChemicals class: TSL's Lab Station ("Create New Items").
 *
 * The party spends chemicals (PartyManager.ChemicalCount) to create the
 * recipes in chemicalcreate.2da, and breaks lab items down into chemicals.
 * The rules live in CraftingRules / LabStationSession; this class only binds
 * them to the retail chemical_p layout, following MenuStore's two-list pattern:
 * LB_SHOPITEMS lists recipes (create mode), LB_INVITEMS lists breakable
 * inventory (breakdown mode), and BTN_Examine toggles between them.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file MenuChemicals.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class MenuChemicals extends GameMenu {

  declare LBL_BAR2: GUILabel;
  declare LB_DESCRIPTIONINV: GUIListBox;
  declare LBL_BAR1: GUILabel;
  declare LB_DESCRIPTION: GUIListBox;
  declare LB_SHOPITEMS: GUIListBox;
  declare LB_INVITEMS: GUIListBox;
  declare LBL_CREDITS_VALUE: GUILabel;
  declare LBL_CREDITS: GUILabel;
  declare LBL_COST_VALUE: GUILabel;
  declare LBL_COST: GUILabel;
  declare LBL_STOCK: GUILabel;
  declare LBL_STOCK_VALUE: GUILabel;
  declare BTN_Accept: GUIButton;
  declare BTN_Cancel: GUIButton;
  declare BTN_Examine: GUIButton;
  declare LBL_TITLE: GUILabel;
  declare LBL_TITLE2: GUILabel;
  declare BTN_CREATE_HEALTH: GUIButton;
  declare BTN_CREATE_STIMS: GUIButton;
  declare BTN_CREATE_GRENADES: GUIButton;
  declare BTN_CREATE_MINES: GUIButton;
  declare LBL_RELATEDSKILL: GUILabel;
  declare LBL_BAR3: GUILabel;

  /** The creature using the station; see activeUser(). */
  user: ModuleCreature | undefined;
  session: LabStationSession | undefined;
  category: CategoryKey = 'health';
  breakdownMode = false;

  /** Recipe views, index-aligned with LB_SHOPITEMS rows. */
  private createViews: RecipeView[] = [];
  /** Breakable inventory, index-aligned with LB_INVITEMS rows. */
  private breakRows: EngineCraftingItem[] = [];
  /** Template Cost per recipe resref, read once per open; undefined = no usable template. */
  private templateCosts = new Map<string, number | undefined>();
  /** Display items built from recipe templates, kept across opens so each is built once. */
  private displayItems = new Map<string, ModuleItem>();
  /** Resrefs whose missing template was already logged. */
  private missingTemplates = new Set<string>();
  /** One CraftingItem per engine item: the session compares inventory entries by identity. */
  private craftingItems = new WeakMap<ModuleItem, EngineCraftingItem>();
  /** Texts the GUI file gives the create-mode controls. */
  private guiText: { accept?: string; examine?: string; cost?: string; title?: string } = {};
  private busy = false;

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
      this.guiText = {
        accept: this.BTN_Accept?.getText?.(),
        examine: this.BTN_Examine?.getText?.(),
        cost: this.LBL_COST?.getText?.(),
        title: this.LBL_TITLE?.getText?.(),
      };

      this.LB_SHOPITEMS.setProtoBuilder(GUIInventoryItem);
      this.LB_INVITEMS.setProtoBuilder(GUIInventoryItem);
      // Programmatic selection (setItems' selectIndex) does not fire a row's
      // onClick, so the detail labels follow the list's own selection event.
      this.LB_SHOPITEMS.onSelected = () => this.showSelection();
      this.LB_INVITEMS.onSelected = () => this.showSelection();

      const tabs: [GUIButton, CategoryKey][] = [
        [this.BTN_CREATE_HEALTH, 'health'],
        [this.BTN_CREATE_STIMS, 'stims'],
        [this.BTN_CREATE_GRENADES, 'grenades'],
        [this.BTN_CREATE_MINES, 'mines'],
      ];
      for(const [button, key] of tabs){
        button?.addEventListener('click', (e) => {
          e.stopPropagation();
          this.category = key;
          this.breakdownMode = false;
          this.refresh(0);
        });
      }

      this.BTN_Cancel.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
      });

      this.BTN_Examine.addEventListener('click', (e) => {
        e.stopPropagation();
        this.breakdownMode = !this.breakdownMode;
        this.refresh(0);
      });

      this.BTN_Accept.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.accept();
      });
      resolve();
    });
  }

  /**
   * Opens the Lab Station for `user` (the party leader when it is not a valid
   * creature). Recipe templates are read once per open, so the session can
   * price every recipe synchronously. Opens on the Health tab.
   */
  async openFor(user?: ModuleCreature): Promise<void> {
    this.user = BitWise.InstanceOfObject(user, ModuleObjectType.ModuleCreature) ? user : undefined;
    const table = GameState.TwoDAManager.datatables.get(LAB_STATION.recipeTable);
    const recipes = parseRecipes((table?.rows ?? {}) as any, LAB_STATION);
    await this.preloadTemplates(recipes);
    this.session = new LabStationSession(recipes, this.createPorts(), LAB_STATION);
    this.category = 'health';
    this.breakdownMode = false;
    this.open();
  }

  show(){
    super.show();
    this.refresh(0);
  }

  /** The station's user; the party leader when the user is gone. */
  activeUser(): ModuleCreature {
    const user = this.user as any;
    if(user && !user.destroyed && BitWise.InstanceOfObject(user, ModuleObjectType.ModuleCreature)) return user;
    return GameState.PartyManager.party[0] ?? GameState.PartyManager.Player;
  }

  private createPorts(): LabStationPorts {
    return {
      getChemicals: () => GameState.PartyManager.ChemicalCount || 0,
      setChemicals: (n: number) => { GameState.PartyManager.ChemicalCount = Math.max(0, n); },
      skillRank: (skill: number) => this.skillRank(skill),
      // Any failure resolves false so the session refunds the chemicals.
      createItem: async (resref: string) => {
        try {
          const buffer = await ResourceLoader.loadResource(ResourceTypes['uti'], resref);
          if(!buffer) return false;
          return !!GameState.InventoryManager.addItem(new GFFObject(buffer), true);
        } catch (e) {
          console.warn(`[MenuChemicals] could not create "${resref}"`, e);
          return false;
        }
      },
      inventory: () => GameState.InventoryManager.getNonQuestInventory().map((item: ModuleItem) => this.toCraftingItem(item)),
      removeOne: (item: CraftingItem) => {
        GameState.InventoryManager.removeItem((item as EngineCraftingItem).moduleItem, 1);
      },
      templateCost: (resref: string) => this.templateCosts.get(resref),
    };
  }

  private skillRank(skill: number): number {
    return Number(this.activeUser()?.getSkillTotal?.(skill)) || 0;
  }

  private toCraftingItem(item: ModuleItem): EngineCraftingItem {
    let entry = this.craftingItems.get(item);
    if(!entry){
      entry = { resref: '', name: '', cost: 0, stackSize: 0, moduleItem: item };
      this.craftingItems.set(item, entry);
    }
    entry.resref = String(item.getTemplateResRef?.() || item.getTag?.() || '').toLowerCase();
    entry.name = String(item.getName?.() ?? '');
    entry.cost = Number(item.cost) || 0;
    entry.stackSize = Number(item.getStackSize?.()) || 1;
    return entry;
  }

  private async preloadTemplates(recipes: Recipe[]): Promise<void> {
    this.templateCosts.clear();
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
          this.displayItems.set(resref, item);
        }
      } catch (e) {
        this.templateCosts.set(resref, undefined);
        if(!this.missingTemplates.has(resref)){
          this.missingTemplates.add(resref);
          console.warn(`[MenuChemicals] recipe "${resref}" has no usable item template; it is not listed`, e);
        }
      }
    }
  }

  /** Rebuilds the current list and the counters, selecting `selectIndex` clamped to the list. */
  refresh(selectIndex = 0){
    if(!this.session || !this.LB_SHOPITEMS) return;
    this.updateModeTexts();
    this.LB_DESCRIPTION.setItem(null);
    this.LBL_COST_VALUE.setText('');
    this.LBL_STOCK_VALUE.setText('');
    this.LBL_RELATEDSKILL.setText('');

    if(!this.breakdownMode){
      this.LB_INVITEMS.hide();
      this.createViews = this.session.recipeViews(this.category)
        .filter((view) => this.displayItems.has(view.recipe.resref));
      const items = this.createViews.map((view) => this.displayItems.get(view.recipe.resref));
      this.LB_SHOPITEMS.setItems(items, {
        getItemOptions: () => ({ onClick: () => this.showSelection() }),
        selectIndex: MenuChemicals.clampIndex(selectIndex, items.length),
      } as any);
      this.LB_SHOPITEMS.children.forEach((row: GUIControl, i: number) => {
        if(this.createViews[i] && !this.createViews[i].creatable){
          try { (row.children[0] as any)?.setTextColor(0.5, 0.5, 0.5); } catch (e) { /* label text not built */ }
        }
      });
      this.LB_SHOPITEMS.markListRttDirty?.();
      this.LB_SHOPITEMS.show();
    }else{
      this.LB_SHOPITEMS.hide();
      this.breakRows = this.session.breakableItems() as EngineCraftingItem[];
      const items = this.breakRows.map((row) => row.moduleItem);
      this.LB_INVITEMS.setItems(items, {
        getItemOptions: () => ({ onClick: () => this.showSelection() }),
        selectIndex: MenuChemicals.clampIndex(selectIndex, items.length),
      } as any);
      this.LB_INVITEMS.show();
    }

    this.BTN_CREATE_HEALTH.pulsing = !this.breakdownMode && this.category == 'health';
    this.BTN_CREATE_STIMS.pulsing = !this.breakdownMode && this.category == 'stims';
    this.BTN_CREATE_GRENADES.pulsing = !this.breakdownMode && this.category == 'grenades';
    this.BTN_CREATE_MINES.pulsing = !this.breakdownMode && this.category == 'mines';
    this.updateChemicals();
    this.showSelection();
  }

  private static clampIndex(index: number, length: number): number {
    return length ? Math.min(Math.max(index, 0), length - 1) : -1;
  }

  private updateModeTexts(){
    if(!this.breakdownMode){
      if(this.guiText.examine !== undefined) this.BTN_Examine.setText(this.guiText.examine);
      if(this.guiText.accept !== undefined) this.BTN_Accept.setText(this.guiText.accept);
      if(this.guiText.cost !== undefined) this.LBL_COST.setText(this.guiText.cost);
      if(this.guiText.title !== undefined) this.LBL_TITLE?.setText(this.guiText.title);
    }else{
      // Examine now returns to creating; Accept breaks the selected item down.
      this.BTN_Examine.setText(this.tlk(TLK_VIEW_CREATEABLE_ITEMS) || this.guiText.accept || '');
      this.BTN_Accept.setText(this.tlk(TLK_BREAKDOWN_ITEM) || this.guiText.examine || '');
      const valueLabel = this.tlk(TLK_CHEMICAL_VALUE);
      if(valueLabel) this.LBL_COST.setText(valueLabel);
      const title = this.tlk(TLK_BREAKDOWN_INVENTORY_ITEMS);
      if(title) this.LBL_TITLE?.setText(title);
    }
  }

  private tlk(id: number): string {
    try { return String(GameState.TLKManager.GetStringById(id)?.Value ?? ''); } catch (e) { return ''; }
  }

  private updateChemicals(){
    this.LBL_CREDITS_VALUE.setText(String(GameState.PartyManager.ChemicalCount || 0));
  }

  /** Index of the selected row in `list`, or -1 when nothing is selected. */
  private selectedIndex(list: GUIListBox): number {
    const selected = list.selectedItem;
    if(!selected || !selected.selected) return -1;
    return list.children.indexOf(selected);
  }

  /** Fills the description, cost, stock and skill labels from the selected row. */
  showSelection(){
    if(!this.session) return;
    if(!this.breakdownMode){
      const view = this.createViews[this.selectedIndex(this.LB_SHOPITEMS)];
      if(!view) return;
      const item = this.displayItems.get(view.recipe.resref);
      this.LB_DESCRIPTION.setItem(item?.getDescription?.() ?? null);
      this.LBL_COST_VALUE.setText(String(view.value));
      this.LBL_STOCK_VALUE.setText(String(view.carried));
      this.setRelatedSkill(view.recipe.skill);
    }else{
      const row = this.breakRows[this.selectedIndex(this.LB_INVITEMS)];
      if(!row) return;
      const rank = this.skillRank(LAB_STATION.breakdownSkill);
      this.LB_DESCRIPTION.setItem(row.moduleItem.getDescription?.() ?? null);
      this.LBL_COST_VALUE.setText(String(breakdownYield(this.session.breakdownValue(row), rank)));
      this.LBL_STOCK_VALUE.setText(String(row.stackSize));
      this.setRelatedSkill(LAB_STATION.breakdownSkill);
    }
  }

  /**
   * The GUI authors this label as the placeholder "My Skill" under a separate
   * "Current Skill:" caption; it shows the recipe's skill and the user's rank.
   */
  private setRelatedSkill(skill: number){
    const rank = this.skillRank(skill);
    const strref = Number(GameState.TwoDAManager.datatables.get('skills')?.rows?.[skill]?.name);
    const skillName = Number.isFinite(strref) ? this.tlk(strref) : '';
    this.LBL_RELATEDSKILL.setText(skillName ? `${skillName} ${rank}` : String(rank));
  }

  /** Creates (create mode) or breaks down (breakdown mode) the selected row; nothing selected does nothing. */
  async accept(): Promise<void> {
    if(!this.session || this.busy) return;
    this.busy = true;
    try {
      if(!this.breakdownMode){
        const index = this.selectedIndex(this.LB_SHOPITEMS);
        const view = this.createViews[index];
        if(view && await this.session.create(view.recipe)) this.refresh(index);
      }else{
        const index = this.selectedIndex(this.LB_INVITEMS);
        const row = this.breakRows[index];
        if(row && this.session.breakdown(row)) this.refresh(index);
      }
    } finally {
      this.busy = false;
      this.updateChemicals();
    }
  }

}
