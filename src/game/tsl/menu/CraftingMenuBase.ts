import { GameMenu } from "@/gui";
import type { GUILabel, GUIListBox, GUIButton, GUIControl } from "@/gui";
import { GameState } from "@/GameState";
import type { ModuleCreature, ModuleItem } from "@/module";
import { GUIInventoryItem } from "@/game/tsl/gui/GUIInventoryItem";
import {
  BreakdownTab, CraftingCategory, CraftingStation, breakdownYield,
} from "@/game/tsl/crafting/CraftingRules";
import { CraftingSession, RecipeView } from "@/game/tsl/crafting/CraftingSession";
import { CraftingEnginePorts, EngineCraftingItem } from "@/game/tsl/crafting/CraftingEnginePorts";

export type CategoryKey = CraftingCategory['key'];
export type BreakdownTabKey = BreakdownTab['key'];

/**
 * Breakdown-mode labels shared by both crafting screens. The store's Examine
 * strings (41937 "Show Buy List", 41938 "Show Sell List") do not fit here;
 * dialog.tlk has the crafting screens' own strings beside the GUI's "View
 * Breakdown Items" (48373) and "Create Item" (48379), plus "Breakdown
 * Inventory Items" and the stations' "Chemical Value" / "Component Value".
 */
const TLK_VIEW_CREATEABLE_ITEMS = 48375;
const TLK_BREAKDOWN_ITEM = 48380;
const TLK_BREAKDOWN_INVENTORY_ITEMS = 115425;
/**
 * English texts of 48375 and 48380, for a dialog.tlk that lacks them. The
 * GUI's own create-mode strings cannot stand in: on the breakdown screen
 * "Create Item" would label the button that breaks an item down.
 */
const FALLBACK_VIEW_CREATEABLE_ITEMS = 'View Createable Items';
const FALLBACK_BREAKDOWN_ITEM = 'Breakdown Item';
/** Text colour of a recipe the user cannot create yet. */
const GREYED_TEXT = 0.5;

/**
 * CraftingMenuBase: the behaviour TSL's two crafting screens share, the Lab
 * Station (MenuChemicals, chemical_p) and the Workbench (MenuComponent,
 * component_p). Both follow MenuStore's two-list pattern: LB_SHOPITEMS lists
 * recipes (create mode), LB_INVITEMS lists breakable inventory (breakdown
 * mode), and BTN_Examine toggles between them. The rules live in
 * CraftingRules / CraftingSession and the engine glue in CraftingEnginePorts;
 * a subclass names its station, its tab buttons and its value label.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file CraftingMenuBase.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export abstract class CraftingMenuBase extends GameMenu {

  declare LB_DESCRIPTION: GUIListBox;
  declare LB_SHOPITEMS: GUIListBox;
  declare LB_INVITEMS: GUIListBox;
  declare LBL_CREDITS_VALUE: GUILabel;
  declare LBL_COST_VALUE: GUILabel;
  declare LBL_COST: GUILabel;
  declare LBL_STOCK_VALUE: GUILabel;
  declare BTN_Accept: GUIButton;
  declare BTN_Cancel: GUIButton;
  declare BTN_Examine: GUIButton;
  declare LBL_TITLE: GUILabel;
  declare LBL_RELATEDSKILL: GUILabel;

  /** The creature using the station; see activeUser(). */
  user: ModuleCreature | undefined;
  session: CraftingSession | undefined;
  abstract category: CategoryKey;
  breakdownMode = false;
  /** The breakdown list's filter; stations without breakdown tabs always list everything. */
  breakTab: BreakdownTabKey = 'all';

  /** Recipe views, index-aligned with LB_SHOPITEMS rows. */
  protected createViews: RecipeView[] = [];
  /** Breakable inventory, index-aligned with LB_INVITEMS rows. */
  protected breakRows: EngineCraftingItem[] = [];
  /** Texts the GUI file gives the create-mode controls. */
  protected guiText: { accept?: string; examine?: string; cost?: string; title?: string } = {};
  private busy = false;

  /** The station's rules. */
  protected abstract readonly station: CraftingStation;
  /** Engine glue; lives as long as the menu, so templates are read once. */
  protected abstract readonly engine: CraftingEnginePorts;
  /** dialog.tlk string for LBL_COST in breakdown mode ("Chemical Value" / "Component Value"). */
  protected abstract readonly breakdownValueStrref: number;

  /** Create-mode tab buttons and the category each opens. */
  protected abstract createTabs(): [GUIButton, CategoryKey][];
  /** Breakdown-mode tab buttons, shown only in breakdown mode; none by default. */
  protected breakdownTabs(): [GUIButton, BreakdownTabKey][] {
    return [];
  }

  /** Wires the lists, the tabs and the buttons; called from menuControlInitializer. */
  protected bindCraftingControls(){
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

    for(const [button, key] of this.createTabs()){
      button?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.category = key;
        this.breakdownMode = false;
        this.refresh(0);
      });
    }
    for(const [button, key] of this.breakdownTabs()){
      button?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.breakTab = key;
        this.breakdownMode = true;
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
      this.breakTab = 'all';
      this.refresh(0);
    });

    this.BTN_Accept.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.accept();
    });
  }

  show(){
    super.show();
    this.refresh(0);
  }

  /** The station's user; the party leader when the user is gone. */
  activeUser(): ModuleCreature {
    return this.engine.activeUser();
  }

  /** Display items built from recipe templates, by resref (read by the probes). */
  get displayItems(): ReadonlyMap<string, ModuleItem> {
    return this.engine.displayItemMap();
  }

  /**
   * Rebuilds the current list and the counters, selecting `selectIndex`
   * clamped to the list. `keepScroll` keeps the list where it was (after
   * Accept); tab and mode changes start at the top.
   */
  refresh(selectIndex = 0, keepScroll = false){
    if(!this.session || !this.LB_SHOPITEMS) return;
    this.updateModeTexts();
    this.LB_DESCRIPTION.setItem(null);
    this.LBL_COST_VALUE.setText('');
    this.LBL_STOCK_VALUE.setText('');
    this.LBL_RELATEDSKILL.setText('');

    if(!this.breakdownMode){
      this.LB_INVITEMS.hide();
      this.createViews = this.session.recipeViews(this.category)
        .filter((view) => !!this.engine.displayItem(view.recipe.resref));
      const items = this.createViews.map((view) => this.engine.displayItem(view.recipe.resref));
      this.LB_SHOPITEMS.setItems(items, {
        getItemOptions: () => ({ onClick: () => this.showSelection() }),
        selectIndex: CraftingMenuBase.clampIndex(selectIndex, items.length),
        keepScroll,
      } as any);
      this.LB_SHOPITEMS.children.forEach((row: GUIControl, i: number) => {
        if(this.createViews[i] && !this.createViews[i].creatable) CraftingMenuBase.greyOut(row);
      });
      this.LB_SHOPITEMS.markListRttDirty?.();
      this.LB_SHOPITEMS.show();
    }else{
      this.LB_SHOPITEMS.hide();
      const tabs = this.breakdownTabs();
      this.breakRows = this.session.breakableItems(tabs.length ? this.breakTab : undefined) as EngineCraftingItem[];
      const items = this.breakRows.map((row) => row.moduleItem);
      this.LB_INVITEMS.setItems(items, {
        getItemOptions: () => ({ onClick: () => this.showSelection() }),
        selectIndex: CraftingMenuBase.clampIndex(selectIndex, items.length),
        keepScroll,
      } as any);
      this.LB_INVITEMS.show();
    }

    // A layout with breakdown tabs (component_p) puts them where the create
    // tabs are, so only one row of tabs shows at a time; without them
    // (chemical_p) the create tabs always show.
    const breakdownTabs = this.breakdownTabs();
    for(const [button, key] of this.createTabs()){
      if(!button) continue;
      button.pulsing = !this.breakdownMode && this.category == key;
      if(breakdownTabs.length){
        if(this.breakdownMode) button.hide();
        else button.show();
      }
    }
    for(const [button, key] of breakdownTabs){
      if(!button) continue;
      button.pulsing = this.breakdownMode && this.breakTab == key;
      if(this.breakdownMode) button.show();
      else button.hide();
    }
    this.updateCurrency();
    this.showSelection();
  }

  /**
   * Greys a recipe row's label for good. Painting it once is not enough:
   * - GUIControl.update() paints a hovered, selected or pulsing control in its
   *   defaultHighlightColor and writes that into text.color, which
   *   resetPulse() then restores; GUIButton's hover-out paints defaultColor.
   *   So the label's own colours are set to grey.
   * - GUIInventoryItem's onSelect copies the row's highlight or default colour
   *   into the label text on every select and deselect, so the grey is put
   *   back after it.
   */
  protected static greyOut(row: GUIControl){
    const label = row.children[0];
    if(!label) return;
    const paintGrey = () => {
      try { label.setTextColor(GREYED_TEXT, GREYED_TEXT, GREYED_TEXT); } catch (e) { /* label text not built */ }
    };
    label.defaultColor = label.defaultColor.clone().setRGB(GREYED_TEXT, GREYED_TEXT, GREYED_TEXT);
    label.defaultHighlightColor = label.defaultHighlightColor.clone().setRGB(GREYED_TEXT, GREYED_TEXT, GREYED_TEXT);
    const rowOnSelect = row.onSelect;
    row.onSelect = function(this: unknown, ...args: unknown[]){
      if(typeof rowOnSelect === 'function') rowOnSelect.apply(this, args);
      paintGrey();
    };
    paintGrey();
  }

  protected static clampIndex(index: number, length: number): number {
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
      this.BTN_Examine.setText(this.tlk(TLK_VIEW_CREATEABLE_ITEMS) || FALLBACK_VIEW_CREATEABLE_ITEMS);
      this.BTN_Accept.setText(this.tlk(TLK_BREAKDOWN_ITEM) || FALLBACK_BREAKDOWN_ITEM);
      const valueLabel = this.tlk(this.breakdownValueStrref);
      if(valueLabel) this.LBL_COST.setText(valueLabel);
      const title = this.tlk(TLK_BREAKDOWN_INVENTORY_ITEMS);
      if(title) this.LBL_TITLE?.setText(title);
    }
  }

  protected tlk(id: number): string {
    try { return String(GameState.TLKManager.GetStringById(id)?.Value ?? ''); } catch (e) { return ''; }
  }

  /** LBL_CREDITS_VALUE shows the station's currency: chemicals or components. */
  private updateCurrency(){
    this.LBL_CREDITS_VALUE.setText(String(this.engine.ports().getCurrency()));
  }

  /** Index of the selected row in `list`, or -1 when nothing is selected. */
  protected selectedIndex(list: GUIListBox): number {
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
      const item = this.engine.displayItem(view.recipe.resref);
      this.LB_DESCRIPTION.setItem(item?.getDescription?.() ?? null);
      this.LBL_COST_VALUE.setText(String(view.value));
      this.LBL_STOCK_VALUE.setText(String(view.carried));
      this.setRelatedSkill(view.recipe.skill, this.engine.skillRank(view.recipe.skill));
    }else{
      const row = this.breakRows[this.selectedIndex(this.LB_INVITEMS)];
      if(!row) return;
      const rank = this.engine.breakdownRank();
      this.LB_DESCRIPTION.setItem(row.moduleItem.getDescription?.() ?? null);
      this.LBL_COST_VALUE.setText(String(breakdownYield(this.session.breakdownValue(row), rank)));
      this.LBL_STOCK_VALUE.setText(String(row.stackSize));
      this.setRelatedSkill(this.station.breakdownSkill, rank);
    }
  }

  /**
   * The GUI authors this label as the placeholder "My Skill" under a separate
   * "Current Skill:" caption; it shows the skill's name and the rank that
   * applies (the user's for a recipe, the breakdown rank for a breakdown).
   */
  private setRelatedSkill(skill: number, rank: number){
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
        if(view && await this.session.create(view.recipe)) this.refresh(index, true);
      }else{
        const index = this.selectedIndex(this.LB_INVITEMS);
        const row = this.breakRows[index];
        if(row && this.session.breakdown(row)) this.refresh(index, true);
      }
    } finally {
      this.busy = false;
      this.updateCurrency();
    }
  }

}
