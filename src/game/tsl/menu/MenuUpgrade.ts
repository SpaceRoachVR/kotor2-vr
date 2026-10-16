import type { GUIListBox, GUILabel, GUIButton, GUIControl } from "@/gui";
import type { ModuleCreature, ModuleItem } from "@/module";
import { MenuUpgrade as K1_MenuUpgrade } from "@/game/kotor/KOTOR";
import { GUIInventoryItem } from "@/game/tsl/gui/GUIInventoryItem";
import { upgradeTypeName } from "@/game/tsl/crafting/UpgradeRules";
import { UpgradeLayout, fittedListHeight, hiddenInLayout, offersRemove, slotNameText } from "@/game/tsl/menu/UpgradeLayout";
import { SlotView, UpgradePart, UpgradeSession } from "@/game/tsl/crafting/UpgradeSession";
import { UpgradeEnginePorts } from "@/game/tsl/crafting/UpgradeEnginePorts";

/** Text colour of a closed slot's label. */
const GREYED_TEXT = 0.5;
const REMOVE_TEXT = 'Remove';
const REMOVE_DESCRIPTION = 'Take the upgrade out of this slot and return it to the inventory.';
const EMPTY_TEXT = 'Empty';
/** GUI units between the cut-down LB_ITEMS and the slot buttons below it. */
const LIST_GAP = 6;

/** One LB_ITEMS row: a part that fits the selected slot, or the Remove row. */
export type UpgradeListRow = { kind: 'part'; part: UpgradePart } | { kind: 'remove' };

/**
 * MenuUpgrade class: TSL's Upgrade Workbench slot screen (upgrade_p).
 *
 * Shows one item's upgrade slots (BTN_UPGRADE31..33 / LBL_UPGRADE31..33: the
 * slot type, the installed or staged part as the button's icon, closed slots
 * greyed and not selectable; LBL_SLOTNAME names the selected slot's part).
 * Selecting a slot lists the bag's parts that fit it in
 * LB_ITEMS, plus Remove when the slot holds or stages a part; the selected
 * row's description fills LB_DESC / LBL_PROPERTY, and clicking a row stages
 * it. Assemble commits every staged change at once (UpgradeSession); Back and
 * OK (hidden: it sits on Assemble) discard uncommitted changes and return to
 * the item list. A lightsaber opens the six-slot _LS layout (colour crystal
 * in slot 1) and shows 3D_MODEL_LS; every other item uses the standard three
 * slots with the 3D preview controls hidden.
 * See docs/superpowers/specs/2026-10-15-upgrade-screen-design.md.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file MenuUpgrade.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class MenuUpgrade extends K1_MenuUpgrade {

  declare LB_ITEMS: GUIListBox;
  declare _3D_MODEL: GUILabel;
  declare _3D_MODEL_LS: GUILabel;
  declare LBL_UPGRADE33: GUILabel;
  declare LBL_UPGRADE31: GUILabel;
  declare LBL_UPGRADE32: GUILabel;
  declare BTN_UPGRADE33: GUIButton;
  declare BTN_UPGRADE31: GUIButton;
  declare BTN_UPGRADE32: GUIButton;
  declare LBL_PROPERTY: GUILabel;
  declare LBL_SLOTNAME: GUILabel;
  declare BTN_ASSEMBLE: GUIButton;
  declare LBL_TITLE: GUILabel;
  declare BTN_BACK: GUIButton;
  declare LBL_UPGRADE31_LS: GUILabel;
  declare LBL_UPGRADE32_LS: GUILabel;
  declare LBL_UPGRADE33_LS: GUILabel;
  declare BTN_UPGRADE31_LS: GUIButton;
  declare BTN_UPGRADE32_LS: GUIButton;
  declare BTN_UPGRADE33_LS: GUIButton;
  declare LBL_UPGRADE34_LS: GUILabel;
  declare LBL_UPGRADE35_LS: GUILabel;
  declare LBL_UPGRADE36_LS: GUILabel;
  declare BTN_UPGRADE34_LS: GUIButton;
  declare BTN_UPGRADE35_LS: GUIButton;
  declare BTN_UPGRADE36_LS: GUIButton;
  declare LB_DESC: GUIListBox;
  declare BTN_OK: GUIButton;
  declare LBL_TITLE2: GUILabel;

  readonly engine = new UpgradeEnginePorts();
  item: ModuleItem | undefined;
  wearer: ModuleCreature | undefined;
  session: UpgradeSession | undefined;
  /** The slot whose parts LB_ITEMS lists; -1 when the item has no open slot. */
  selectedSlot = -1;
  /** LB_ITEMS rows, index-aligned with the list. */
  listRows: UpgradeListRow[] = [];
  /** Text colours the GUI gives the slot labels, restored when a slot opens. */
  private labelColours = new Map<GUILabel, { r: number; g: number; b: number }>();
  /** Fill textures the GUI gives the slot buttons, shown when a slot is empty. */
  private buttonFills = new Map<GUIButton, string>();
  /** Which slot controls the screen shows; set per item in openFor. */
  layout: UpgradeLayout = 'standard';
  /** LB_ITEMS's height as the GUI built it, before fitItemList cuts it. */
  private listHeight: number | undefined;

  constructor(){
    super();
    this.gui_resref = 'upgrade_p';
    this.background = '';
    this.voidFill = true;
  }

  async menuControlInitializer(skipInit: boolean = false) {
    await super.menuControlInitializer(true);
    if(skipInit) return;
    return new Promise<void>((resolve, reject) => {
      this.LB_ITEMS.setProtoBuilder(GUIInventoryItem);
      this.LB_ITEMS.onSelected = () => this.showPartDescription();

      for(const control of this.hiddenControls()) control.hide();

      this.BTN_UPGRADE31.addEventListener('click', (e) => { e.stopPropagation(); this.selectSlot(0); });
      this.BTN_UPGRADE32.addEventListener('click', (e) => { e.stopPropagation(); this.selectSlot(1); });
      this.BTN_UPGRADE33.addEventListener('click', (e) => { e.stopPropagation(); this.selectSlot(2); });
      [this.BTN_UPGRADE31_LS, this.BTN_UPGRADE32_LS, this.BTN_UPGRADE33_LS,
        this.BTN_UPGRADE34_LS, this.BTN_UPGRADE35_LS, this.BTN_UPGRADE36_LS].forEach((button, i) => {
        button?.addEventListener('click', (e) => { e.stopPropagation(); this.selectSlot(i); });
      });
      for(const layout of ['standard', 'lightsaber'] as const){
        for(const [button, label] of this.slotControlsFor(layout)){
          const c = label?.text?.color;
          if(label && c) this.labelColours.set(label, { r: c.r, g: c.g, b: c.b });
          if(button) this.buttonFills.set(button, String(button.getFillTextureName?.() ?? ''));
        }
      }
      // BTN_OK sits exactly on BTN_ASSEMBLE in upgrade_p; Back (BTN_BACK) closes.
      this.BTN_OK?.hide();
      this.fitItemList();

      this.BTN_ASSEMBLE.addEventListener('click', (e) => {
        e.stopPropagation();
        this.assemble();
      });
      this.BTN_BACK.addEventListener('click', (e) => {
        e.stopPropagation();
        this.leave();
      });
      this.BTN_OK?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.leave();
      });
      this._button_b = this.BTN_BACK;
      resolve();
    });
  }

  /** The controls the current layout does not use, plus the standard 3D preview. */
  private hiddenControls(): GUIControl[] {
    const out: GUIControl[] = [];
    for(const key of Object.keys(this)){
      if(!hiddenInLayout(key, this.layout)) continue;
      const control = (this as any)[key];
      if(control && typeof control.hide === 'function') out.push(control);
    }
    return out;
  }

  /**
   * upgrade_p's LB_ITEMS spans the whole left column, under the slot buttons,
   * LBL_SLOTNAME and LBL_PROPERTY; rows past the third would land on the slot
   * buttons and take their pointer hits. The list is cut to end just above the
   * slot buttons (three rows; the right stick scrolls the rest). In the
   * lightsaber layout it ends above the topmost _LS button it overlaps, or is
   * left whole when none overlaps. The GUI's own height is kept and restored
   * for the standard layout.
   */
  private fitItemList(){
    const list = this.LB_ITEMS;
    if(!list?.extent) return;
    this.listHeight ??= list.extent.height;
    const saber = this.layout === 'lightsaber';
    const buttons = this.slotControls().map(([button]) => button?.extent).filter((e) => !!e);
    const original = { left: list.extent.left, top: list.extent.top, width: list.extent.width, height: this.listHeight };
    const height = fittedListHeight(original, saber ? buttons : buttons.slice(0, 1), LIST_GAP, !saber);
    if(height === list.extent.height) return;
    list.extent.height = height;
    list.resizeControl();
    list.calculatePosition();
  }

  private slotControls(): [GUIButton, GUILabel][] {
    return this.slotControlsFor(this.layout);
  }

  private slotControlsFor(layout: UpgradeLayout): [GUIButton, GUILabel][] {
    if(layout === 'lightsaber'){
      return [
        [this.BTN_UPGRADE31_LS, this.LBL_UPGRADE31_LS],
        [this.BTN_UPGRADE32_LS, this.LBL_UPGRADE32_LS],
        [this.BTN_UPGRADE33_LS, this.LBL_UPGRADE33_LS],
        [this.BTN_UPGRADE34_LS, this.LBL_UPGRADE34_LS],
        [this.BTN_UPGRADE35_LS, this.LBL_UPGRADE35_LS],
        [this.BTN_UPGRADE36_LS, this.LBL_UPGRADE36_LS],
      ];
    }
    return [
      [this.BTN_UPGRADE31, this.LBL_UPGRADE31],
      [this.BTN_UPGRADE32, this.LBL_UPGRADE32],
      [this.BTN_UPGRADE33, this.LBL_UPGRADE33],
    ];
  }

  /** Whether the workbench can upgrade `item` (category known, UpgradeLevel >= 1). */
  canUpgrade(item: ModuleItem | undefined): boolean {
    return !!item && !!this.engine.itemPort(item);
  }

  /**
   * Opens the slot screen for `item` (`wearer` = the party member wearing it,
   * if any). An item the workbench cannot upgrade opens nothing.
   */
  async openFor(item: ModuleItem, wearer?: ModuleCreature): Promise<void> {
    const port = this.engine.itemPort(item);
    if(!port){
      console.warn('[MenuUpgrade] item cannot be upgraded', item?.getTemplateResRef?.());
      return;
    }
    this.item = item;
    this.layout = port.category === 'lightsaber' ? 'lightsaber' : 'standard';
    this.wearer = wearer ?? UpgradeEnginePorts.wearerOf(item);
    this.session = new UpgradeSession(port, this.engine.bag(), this.engine.table(), (row) => this.engine.partFor(row));
    this.selectedSlot = this.session.slots().findIndex((slot) => slot.open);
    this.open();
  }

  show(){
    super.show();
    for(const control of this.hiddenControls()) control.hide();
    if(this.layout === 'lightsaber') this._3D_MODEL_LS?.show();
    this.fitItemList();
    this.refresh();
  }

  /** The current slot views (empty when nothing is open). */
  slots(): SlotView[] {
    return this.session ? this.session.slots() : [];
  }

  /** The part a slot shows: staged (null = staged removal) over installed. */
  static shownPart(slot: SlotView): UpgradePart | undefined {
    if(slot.staged === null) return undefined;
    return slot.staged ?? slot.installed;
  }

  selectSlot(index: number){
    const slot = this.slots()[index];
    if(!slot || !slot.open) return;
    this.selectedSlot = index;
    this.refresh();
  }

  /**
   * Rebuilds the title, the slot buttons and labels, and the selected slot's
   * part list with the part the slot shows selected. `keepScroll` keeps the
   * list where it was (after staging); a slot change starts at the top.
   */
  refresh(keepScroll = false){
    if(!this.session || !this.item || !this.LB_ITEMS) return;
    this.LBL_TITLE?.setText(String(this.item.getName?.() ?? ''));
    const slots = this.slots();
    this.slotControls().forEach(([button, label], i) => {
      const slot = slots[i];
      if(!slot){
        button?.hide();
        label?.hide();
        return;
      }
      button?.show();
      label?.show();
      const part = MenuUpgrade.shownPart(slot);
      // The 64-unit slot box fits the type name, not a part name: the part
      // shows as the button's icon, and by name in LBL_SLOTNAME when selected.
      label?.setText(upgradeTypeName(slot.type));
      if(button){
        this.setSlotIcon(button, part);
        button.disableSelection = !slot.open;
        button.pulsing = slot.open && i === this.selectedSlot;
        button.resetPulse?.();
      }
      if(label){
        const c = slot.open ? this.labelColours.get(label) : undefined;
        try {
          if(c) label.setTextColor(c.r, c.g, c.b);
          else if(!slot.open) label.setTextColor(GREYED_TEXT, GREYED_TEXT, GREYED_TEXT);
        } catch (e) { /* label text not built */ }
      }
    });

    const slot = slots[this.selectedSlot];
    const shown = slot ? MenuUpgrade.shownPart(slot) : undefined;
    this.LBL_SLOTNAME?.setText(slot ? slotNameText(slot.type, shown?.name, EMPTY_TEXT) : '');
    this.listRows = slot ? this.rowsFor(slot) : [];
    const counts = new Map<string, number>();
    for(const { part, count } of this.engine.bag().parts()) counts.set(part.resref, count);
    const nodes = this.listRows.map((row) => this.nodeFor(row, counts));
    const index = shown ? this.listRows.findIndex((r) => r.kind === 'part' && r.part.resref === shown.resref) : -1;
    this.LB_DESC?.setItem(null);
    this.LBL_PROPERTY?.setText('');
    this.LB_ITEMS.setItems(nodes, {
      getItemOptions: (_node: unknown, i: number) => ({ onClick: () => this.choose(i) }),
      selectIndex: index,
      keepScroll,
    } as any);
    this.LB_ITEMS.markListRttDirty?.();
    this.showPartDescription();
  }

  /** The slot button shows the part's icon, or the GUI's own fill when empty. */
  private setSlotIcon(button: GUIButton, part: UpgradePart | undefined){
    const icon = part ? String(this.engine.displayItem(part.resref)?.getIcon?.() ?? '') : '';
    const name = icon || this.buttonFills.get(button) || '';
    if(String(button.getFillTextureName?.() ?? '') === name) return;
    if(name){
      button.setFillTextureName(name);
    }else{
      button.border.fill.texture = '';
      if(button.border.fill.material) button.border.fill.material.visible = false;
    }
  }

  /**
   * LB_ITEMS rows for a slot: the staged part (it is no longer a free
   * candidate), the bag's parts that fit, and Remove when the slot holds or
   * stages a part.
   */
  private rowsFor(slot: SlotView): UpgradeListRow[] {
    const rows: UpgradeListRow[] = [];
    const staged = slot.staged ?? undefined;
    const candidates = this.session!.candidates(slot.index);
    if(staged && !candidates.some((p) => p.resref === staged.resref)) rows.push({ kind: 'part', part: staged });
    for(const part of candidates) rows.push({ kind: 'part', part });
    if(offersRemove(slot.type, !!MenuUpgrade.shownPart(slot))) rows.push({ kind: 'remove' });
    return rows;
  }

  /** A list node for `row`; `counts` = bag units by part resref, read once per refresh. */
  private nodeFor(row: UpgradeListRow, counts: ReadonlyMap<string, number>){
    if(row.kind === 'remove'){
      return { row, getName: () => REMOVE_TEXT, getStackSize: () => 1, getIcon: () => '' };
    }
    const display = this.engine.displayItem(row.part.resref);
    const count = counts.get(row.part.resref) ?? 0;
    return {
      row,
      getName: () => row.part.name,
      getStackSize: () => count,
      getIcon: () => display?.getIcon?.() ?? '',
    };
  }

  private selectedRowIndex(): number {
    const selected = this.LB_ITEMS?.selectedItem;
    if(!selected || !selected.selected) return -1;
    return this.LB_ITEMS.children.indexOf(selected);
  }

  /** LB_DESC / LBL_PROPERTY: the selected row's part. */
  showPartDescription(){
    const row = this.listRows[this.selectedRowIndex()];
    if(!row){
      this.LB_DESC?.setItem(null);
      this.LBL_PROPERTY?.setText('');
      return;
    }
    if(row.kind === 'remove'){
      this.LBL_PROPERTY?.setText(REMOVE_TEXT);
      this.LB_DESC?.setItem(REMOVE_DESCRIPTION);
      return;
    }
    const display = this.engine.displayItem(row.part.resref);
    this.LBL_PROPERTY?.setText(row.part.name);
    this.LB_DESC?.setItem(String(display?.getDescription?.() ?? '') || null);
  }

  /** Stages the clicked row into the selected slot. */
  choose(index: number){
    const row = this.listRows[index];
    if(!this.session || !row || this.selectedSlot < 0) return;
    const ok = this.session.stage(this.selectedSlot, row.kind === 'remove' ? null : row.part);
    if(!ok) console.warn('[MenuUpgrade] could not stage', row.kind === 'remove' ? 'removal' : row.part.resref);
    this.refresh(true);
  }

  /**
   * Commits the staged changes. A stacked item is split first (ruling R8,
   * UpgradeEnginePorts.splitOffRest): `this.item` stays the one upgraded unit
   * and the rest stays plain in the inventory. Item stats read installed parts live
   * (ModuleItem.getEffectiveProperties), so an equipped item's wearer needs no
   * re-equip: equipping itself only adds disguise effects, which parts do not
   * carry.
   */
  assemble(): boolean {
    if(!this.session || !this.session.hasChanges()) return false;
    const ok = this.session.assemble();
    if(!ok) console.warn('[MenuUpgrade] Assemble refused: a staged part is no longer in the inventory; nothing changed');
    this.refresh(true);
    return ok;
  }

  /** Back / OK: discard uncommitted changes and return to the item list. */
  leave(){
    this.session?.cancel();
    this.close();
  }

}
