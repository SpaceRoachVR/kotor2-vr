import { GameMenu } from "@/gui";
import type { GUIButton, GUILabel, GUIListBox } from "@/gui";
import { GameState } from "@/GameState";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { BitWise } from "@/utility/BitWise";
import type { ModuleCreature, ModuleItem } from "@/module";
import { MenuUpgradeSelect as K1_MenuUpgradeSelect } from "@/game/kotor/KOTOR";
import { GUIInventoryItem } from "@/game/tsl/gui/GUIInventoryItem";
import { ItemCategory, slotTypes, upgradeTypeName } from "@/game/tsl/crafting/UpgradeRules";
import { UpgradeEnginePorts, UpgradeableEntry } from "@/game/tsl/crafting/UpgradeEnginePorts";

export type UpgradeTab = 'all' | ItemCategory;

/** Default Workbench recipe table, for the Create Items hop. */
const DEFAULT_RECIPE_TABLE = 'itemcreate';

/**
 * A list row for GUIInventoryItem: the item's icon and stack, with a name
 * that also says who wears it.
 */
export function upgradeListNode(entry: UpgradeableEntry){
  const { item, wearer } = entry;
  return {
    entry,
    getName: () => {
      const name = String(item.getName?.() ?? '');
      const who = wearer ? String(wearer.getName?.() ?? '') : '';
      return who ? `${name} (${who})` : name;
    },
    getStackSize: () => item.getStackSize?.() ?? 1,
    getIcon: () => item.getIcon?.() ?? '',
  };
}

/**
 * MenuUpgradeSelect class: TSL's Upgrade Workbench item list (upgradesel_p).
 *
 * Lists the upgradeable items (category known, UpgradeLevel >= 1) in the
 * party inventory and equipped on party members, filtered by the All /
 * Ranged / Melee / Armor tabs (Lightsaber is a later pass and shown
 * disabled). Upgrade Items opens MenuUpgrade for the selected item; Create
 * Items opens the Workbench creation screen (MenuComponent) unless the script
 * disabled item creation. List behaviour follows the crafting screens
 * (CraftingMenuBase): selection drives the description, rebuilds keep the
 * scroll when returning to the screen.
 * See docs/superpowers/specs/2026-10-15-upgrade-screen-design.md.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file MenuUpgradeSelect.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class MenuUpgradeSelect extends K1_MenuUpgradeSelect {

  declare BTN_RANGED: GUIButton;
  declare BTN_LIGHTSABER: GUIButton;
  declare BTN_MELEE: GUIButton;
  declare BTN_ARMOR: GUIButton;
  declare LBL_TITLE: GUILabel;
  declare BTN_UPGRADEITEMS: GUIButton;
  declare BTN_BACK: GUIButton;
  declare BTN_CREATEITEMS: GUIButton;
  declare LB_DESCRIPTION: GUIListBox;
  declare LB_UPGRADELIST: GUIListBox;
  declare BTN_ALL: GUIButton;
  declare LBL_TITLE2: GUILabel;

  readonly engine = new UpgradeEnginePorts();
  /** The creature using the bench; the Create Items hop passes it on. */
  user: ModuleCreature | undefined;
  recipeTable = DEFAULT_RECIPE_TABLE;
  allowCreate = true;
  tab: UpgradeTab = 'all';
  /** Upgradeable items, index-aligned with LB_UPGRADELIST rows. */
  rows: UpgradeableEntry[] = [];

  constructor(){
    super();
    this.gui_resref = 'upgradesel_p';
    this.background = '';
    this.voidFill = true;
  }

  async menuControlInitializer(skipInit: boolean = false) {
    await super.menuControlInitializer(true);
    if(skipInit) return;
    return new Promise<void>((resolve, reject) => {
      this.LB_UPGRADELIST.setProtoBuilder(GUIInventoryItem);
      // Programmatic selection does not fire a row's onClick, so the
      // description follows the list's own selection event.
      this.LB_UPGRADELIST.onSelected = () => this.showSelection();

      this.BTN_ALL?.addEventListener('click', (e) => { e.stopPropagation(); this.setTab('all'); });
      this.BTN_RANGED.addEventListener('click', (e) => { e.stopPropagation(); this.setTab('ranged'); });
      this.BTN_MELEE.addEventListener('click', (e) => { e.stopPropagation(); this.setTab('melee'); });
      this.BTN_ARMOR.addEventListener('click', (e) => { e.stopPropagation(); this.setTab('armor'); });
      // Lightsaber upgrades are a later pass: the tab shows, greyed and inert.
      if(this.BTN_LIGHTSABER){
        this.BTN_LIGHTSABER.disableSelection = true;
        this.BTN_LIGHTSABER.resetPulse?.();
      }

      this.BTN_UPGRADEITEMS.addEventListener('click', (e) => {
        e.stopPropagation();
        const entry = this.selectedEntry();
        if(!entry) return;
        (GameState.MenuManager.MenuUpgrade as any).openFor(entry.item, entry.wearer).catch((err: unknown) => {
          console.error('[MenuUpgradeSelect] the upgrade screen failed to open', err);
        });
      });

      this.BTN_CREATEITEMS?.setText?.('Create Items');
      this.BTN_CREATEITEMS?.addEventListener('click', (e) => {
        e.stopPropagation();
        if(!this.allowCreate) return;
        GameState.MenuManager.MenuComponent.openFor(this.user, this.recipeTable).catch((err: unknown) => {
          console.error('[MenuUpgradeSelect] the Workbench failed to open', err);
        });
      });

      this.BTN_BACK.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
      });
      this._button_b = this.BTN_BACK;
      resolve();
    });
  }

  private tabButtons(): [GUIButton, UpgradeTab][] {
    return [[this.BTN_ALL, 'all'], [this.BTN_RANGED, 'ranged'], [this.BTN_MELEE, 'melee'], [this.BTN_ARMOR, 'armor']];
  }

  setTab(tab: UpgradeTab){
    this.tab = tab;
    this.refresh(0);
  }

  /**
   * Opens the item list for `user` (the party leader when it is not a valid
   * creature). `recipeTable` is what Create Items opens MenuComponent with;
   * `allowCreate` false hides that button. Opens on the All tab.
   */
  async openFor(user?: ModuleCreature, options: { recipeTable?: string; allowCreate?: boolean } = {}): Promise<void> {
    this.user = BitWise.InstanceOfObject(user, ModuleObjectType.ModuleCreature) ? user : undefined;
    this.recipeTable = String(options.recipeTable || DEFAULT_RECIPE_TABLE).toLowerCase();
    this.allowCreate = options.allowCreate !== false;
    this.tab = 'all';
    this.LB_UPGRADELIST?.clearSelection?.();
    this.open();
  }

  /**
   * The K1 parent's show() drives K1-only controls; this screen rebuilds its
   * list instead. Coming back from MenuUpgrade or MenuComponent re-shows it,
   * so the selected row and the scroll are kept.
   */
  show(){
    GameMenu.prototype.show.call(this);
    if(this.BTN_CREATEITEMS){
      if(this.allowCreate) this.BTN_CREATEITEMS.show();
      else this.BTN_CREATEITEMS.hide();
    }
    const index = this.selectedIndex();
    this.refresh(index >= 0 ? index : 0, index >= 0);
  }

  /** Rebuilds the item list for the current tab, selecting `selectIndex` (clamped). */
  refresh(selectIndex = 0, keepScroll = false){
    if(!this.LB_UPGRADELIST) return;
    this.rows = this.engine.upgradeableItems()
      .filter((entry) => this.tab === 'all' || UpgradeEnginePorts.categoryOf(entry.item) === this.tab);
    const nodes = this.rows.map((entry) => upgradeListNode(entry));
    const index = nodes.length ? Math.min(Math.max(selectIndex, 0), nodes.length - 1) : -1;
    this.LB_DESCRIPTION.setItem(null);
    this.LB_UPGRADELIST.setItems(nodes, {
      getItemOptions: () => ({ onClick: () => this.showSelection() }),
      selectIndex: index,
      keepScroll,
    } as any);
    this.LB_UPGRADELIST.markListRttDirty?.();
    for(const [button, tab] of this.tabButtons()){
      if(button) button.pulsing = this.tab === tab;
    }
    this.showSelection();
  }

  private selectedIndex(): number {
    const list = this.LB_UPGRADELIST;
    const selected = list?.selectedItem;
    if(!selected || !selected.selected) return -1;
    return list.children.indexOf(selected);
  }

  selectedEntry(): UpgradeableEntry | undefined {
    return this.rows[this.selectedIndex()];
  }

  /** LB_DESCRIPTION: the selected item's description and its installed parts. */
  showSelection(){
    const entry = this.selectedEntry();
    this.LB_DESCRIPTION.setItem(entry ? (this.describe(entry.item) || null) : null);
  }

  /** The item's description followed by one line per slot holding a part. */
  describe(item: ModuleItem): string {
    const text = String(item.getDescription?.() ?? '').trim();
    const category = UpgradeEnginePorts.categoryOf(item);
    const lines: string[] = [];
    if(category){
      slotTypes(category).forEach((type, i) => {
        const row = item.getUpgradeSlot(i);
        if(row < 0) return;
        const part = this.engine.partFor(row);
        lines.push(`${upgradeTypeName(type)}: ${part ? part.name : `upgrade ${row}`}`);
      });
    }
    if(!lines.length) return text;
    return [text, 'Installed upgrades:', ...lines].filter((s) => s.length).join('\n');
  }

}
