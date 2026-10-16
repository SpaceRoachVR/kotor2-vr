import { GameMenu } from "@/gui";
import type { GUIButton, GUILabel, GUIListBox } from "@/gui";
import { GameState } from "@/GameState";
import { TextureLoader } from "@/loaders";
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
const CREATE_ITEMS_TEXT = 'Create Items';
/** GUI units between Upgrade Item and Create Items when they share the bottom row. */
const BOTTOM_ROW_GAP = 4;

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
 * Ranged / Melee / Armor / Lightsaber tabs. Upgrade Items opens MenuUpgrade for the selected item; Create
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
  /** BTN_UPGRADEITEMS's GUI extent and text, before the bottom row is split. */
  private upgradeExtent: { left: number; top: number; width: number; height: number } | undefined;
  private upgradeText: string | undefined;

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
      this.BTN_LIGHTSABER.addEventListener('click', (e) => { e.stopPropagation(); this.setTab('lightsaber'); });

      this.BTN_UPGRADEITEMS.addEventListener('click', (e) => {
        e.stopPropagation();
        const entry = this.selectedEntry();
        if(!entry) return;
        (GameState.MenuManager.MenuUpgrade as any).openFor(entry.item, entry.wearer).catch((err: unknown) => {
          console.error('[MenuUpgradeSelect] the upgrade screen failed to open', err);
        });
      });

      this.styleCreateButton();
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

  /**
   * Retail upgradesel_p puts BTN_CREATEITEMS on the frame's bottom-right
   * corner art (53x26, no border), where "Create Items" cannot fit. It takes
   * BTN_UPGRADEITEMS's border and highlight here, and layoutBottomRow() gives
   * it the right half of the Upgrade Item button's slot when it is shown.
   */
  private styleCreateButton(){
    const create = this.BTN_CREATEITEMS, upgrade = this.BTN_UPGRADEITEMS;
    if(!create || !upgrade) return;
    this.upgradeExtent = { ...upgrade.extent };
    for(const part of ['border', 'highlight'] as const){
      const from = upgrade[part] as any, to = create[part] as any;
      to.edge = from.edge;
      to.corner = from.corner;
      to.fill.texture = from.fill.texture;
      to.dimension = from.dimension;
      to.inneroffset = from.inneroffset;
      to.inneroffsety = from.inneroffsety;
      to.color?.copy?.(from.color);
    }
    create.hasBorder = true;
    create.hasHighlight = true;
    // The GUI gave it no border textures, so initTextures() disabled them at
    // build time: load the copied ones and enable them as Upgrade Item's are.
    create.initTextures();
    create.borderEnabled = upgrade.borderEnabled;
    create.highlightEnabled = upgrade.highlightEnabled;
    void TextureLoader.LoadQueue();
  }

  /** Upgrade Item spans the row alone, or shares it with Create Items (left / right half). */
  private layoutBottomRow(split: boolean){
    const create = this.BTN_CREATEITEMS, upgrade = this.BTN_UPGRADEITEMS, full = this.upgradeExtent;
    if(!create || !upgrade || !full) return;
    const half = Math.floor((full.width - BOTTOM_ROW_GAP) / 2);
    const place = (control: GUIButton, left: number, width: number, text: string) => {
      control.extent.left = left;
      control.extent.top = full.top;
      control.extent.width = width;
      control.extent.height = full.height;
      control.resizeControl();
      control.recalculate();
      control.setText(text);
    };
    const upgradeText = this.upgradeText ??= String(upgrade.getText?.() ?? '');
    if(split){
      place(upgrade, full.left, half, upgradeText);
      place(create, full.left + full.width - half, half, CREATE_ITEMS_TEXT);
    }else{
      place(upgrade, full.left, full.width, upgradeText);
    }
  }

  private tabButtons(): [GUIButton, UpgradeTab][] {
    return [[this.BTN_ALL, 'all'], [this.BTN_RANGED, 'ranged'], [this.BTN_MELEE, 'melee'], [this.BTN_ARMOR, 'armor'], [this.BTN_LIGHTSABER, 'lightsaber']];
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
      this.layoutBottomRow(this.allowCreate);
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
