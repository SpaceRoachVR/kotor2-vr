import * as THREE from "three";
import type { GUIListBox, GUILabel, GUIButton, GUIControl } from "@/gui";
import { LBL_3DView } from "@/gui";
import { MDLLoader, TextureLoader } from "@/loaders";
import { OdysseyModel3D } from "@/three/odyssey";
import type { ModuleCreature, ModuleItem } from "@/module";
import { MenuUpgrade as K1_MenuUpgrade } from "@/game/kotor/KOTOR";
import { GUIInventoryItem } from "@/game/tsl/gui/GUIInventoryItem";
import { COLOUR_SLOT, upgradeTypeName } from "@/game/tsl/crafting/UpgradeRules";
import { previewAxes, previewCameraDistance } from "@/game/tsl/menu/upgradePreviewFraming";
import { UpgradeLayout, fittedListExtent, hiddenInLayout, shownInLayout, offersRemove, slotNameText } from "@/game/tsl/menu/UpgradeLayout";
import { SlotView, UpgradePart, UpgradeSession } from "@/game/tsl/crafting/UpgradeSession";
import { UpgradeEnginePorts } from "@/game/tsl/crafting/UpgradeEnginePorts";

/** Text colour of a closed slot's label. */
const GREYED_TEXT = 0.5;
const REMOVE_TEXT = 'Remove';
const REMOVE_DESCRIPTION = 'Take the upgrade out of this slot and return it to the inventory.';
const EMPTY_TEXT = 'Empty';
/** GUI units between the cut-down LB_ITEMS and the slot buttons below it. */
const LIST_GAP = 6;
/** The 3D lightsaber preview's turn about the saber's long axis, rad/s. */
const PREVIEW_TURN_RATE = 0.6;
/** The preview renders at this multiple of 3D_MODEL_LS's GUI size (sharper in the VR panel). */
const PREVIEW_RESOLUTION = 2;
/** The saber model's lit-blade loop (ModuleItem.setPowered plays it in hand). */
const PREVIEW_ANIMATION = 'powered';
/** Intensity of the preview's key light on the hilt. */
const PREVIEW_KEY_LIGHT = 1;
const AXIS_VECTORS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) } as const;

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
  private listTop: number | undefined;
  /** The lightsaber preview on 3D_MODEL_LS; made when a saber opens, disposed on close. */
  previewView: LBL_3DView | undefined;
  /** The saber model the preview shows (undefined while loading, or when it failed). */
  previewModel: OdysseyModel3D | undefined;
  /** The model resref the preview shows or is loading; '' when none. */
  previewResRef = '';
  /** Bumped per load and on dispose: a load that lands under an older number is dropped. */
  private previewLoad = 0;
  private previewAngle = 0;
  private readonly previewAxis = new THREE.Vector3(0, 0, 1);
  private readonly previewCentre = new THREE.Vector3();
  private readonly previewTurn = new THREE.Quaternion();
  private previewKeyLight: THREE.DirectionalLight | undefined;
  /** Model resrefs whose load already logged a failure. */
  private readonly previewFailures = new Set<string>();

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
   * lightsaber layout the _LS buttons and preview sit inside the list's
   * extent, so it moves below LBL_SLOTNAME instead (LBL_PROPERTY is hidden).
   * The GUI's own top and height are kept and restored for the standard layout.
   */
  private fitItemList(){
    const list = this.LB_ITEMS;
    if(!list?.extent) return;
    this.listHeight ??= list.extent.height;
    this.listTop ??= list.extent.top;
    const original = { left: list.extent.left, top: this.listTop, width: list.extent.width, height: this.listHeight };
    const { top, height } = fittedListExtent(
      original, this.BTN_UPGRADE31?.extent, this.LBL_SLOTNAME?.extent, LIST_GAP, this.layout === 'lightsaber');
    if(height === list.extent.height && top === list.extent.top) return;
    list.extent.top = top;
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
    for(const key of Object.keys(this)){
      const control = (this as any)[key];
      if(shownInLayout(key, this.layout) && control && typeof control.show === 'function') control.show();
    }
    this.fitItemList();
    this.refresh();
    if(this.layout !== 'lightsaber') this.disposePreview();
  }

  close(){
    this.disposePreview();
    super.close();
  }

  update(delta: number = 0){
    super.update(delta);
    if(!this.bVisible || !this.previewView) return;
    if(this.previewModel){
      this.previewAngle = (this.previewAngle + PREVIEW_TURN_RATE * delta) % (Math.PI * 2);
      this.posePreviewModel();
    }
    try {
      // LBL_3DView renders through renderGuiSceneToTexture, which bumps the
      // GUI surface revision, so the VR panel repaints the turning saber.
      this.previewView.render(delta);
      // render() marks the fill transparent; the hilt's materials write a low
      // alpha into the view, which then blended to near-black over the panel.
      // The view is cleared opaque black, so draw it opaque.
      const fill = this._3D_MODEL_LS?.getFill?.()?.material as any;
      if(fill) fill.transparent = false;
    } catch (e) {
      // A render that throws once throws every frame: stop rather than spam.
      console.warn('[MenuUpgrade] lightsaber preview render failed', this.previewResRef, e);
      this.disposePreview();
    }
  }

  /** The ModelVariation the preview shows: the staged colour crystal's, else the item's own. */
  previewVariation(): number {
    const own = Number(this.item?.getModelVariation?.()) || 0;
    const staged = this.slots().find((slot) => slot.type === COLOUR_SLOT)?.staged;
    if(!this.item || !staged) return own;
    return this.engine.variationForCrystal(this.item, staged.resref) ?? own;
  }

  /**
   * Shows the saber at previewVariation() on 3D_MODEL_LS: makes the view the
   * first time a saber opens, and loads the model when the previewed resref
   * changes (staging a colour, Assemble). Any other layout disposes it.
   */
  updatePreview(){
    const control = this._3D_MODEL_LS;
    if(this.layout !== 'lightsaber' || !this.item || !control){
      this.disposePreview();
      return;
    }
    let resref = '';
    try {
      resref = this.item.modelResRefFor(this.previewVariation());
    } catch (e) {
      console.warn('[MenuUpgrade] lightsaber preview has no model resref', e);
    }
    if(!this.previewView) this.createPreviewView(control);
    if(resref === this.previewResRef) return;
    this.previewResRef = resref;
    if(!resref){
      this.previewLoad++;
      this.removePreviewModel();
      return;
    }
    void this.loadPreviewModel(resref);
  }

  /** An LBL_3DView on `control`, wired the way MenuCharacter wires LBL_3DCHAR. */
  private createPreviewView(control: GUILabel){
    const width = Number(control.extent?.width) || 168;
    const height = Number(control.extent?.height) || 228;
    const view = new LBL_3DView(width * PREVIEW_RESOLUTION, height * PREVIEW_RESOLUTION);
    view.visible = true;
    view.camera.aspect = width / height;
    view.camera.updateProjectionMatrix();
    const material = control.getFill?.()?.material as any;
    if(material?.uniforms?.map) material.uniforms.map.value = view.texture.texture;
    if(material) material.transparent = false;
    view.setControl(control);
    if(material) material.visible = true;
    // The view has no area lights: without these the hilt renders near black
    // (the blade is self-lit). An ambient fill plus a key light from the camera.
    view.scene.add(view.globalLight);
    this.previewKeyLight = new THREE.DirectionalLight(0xffffff, PREVIEW_KEY_LIGHT);
    view.scene.add(this.previewKeyLight);
    this.previewAngle = 0;
    this.previewView = view;
  }

  /** Loads `resref` into the preview; a load overtaken by a newer one (or a close) is disposed. */
  private async loadPreviewModel(resref: string){
    const generation = ++this.previewLoad;
    const view = this.previewView;
    if(!view) return;
    const current = () => generation === this.previewLoad && view === this.previewView;
    let model: OdysseyModel3D | undefined;
    try {
      const mdl = await MDLLoader.loader.load(resref);
      if(!mdl) throw new Error('model not found');
      if(!current()) return;
      model = await OdysseyModel3D.FromMDL(mdl, { context: view as any, lighting: true } as any);
    } catch (e) {
      if(!current()) return;
      this.removePreviewModel();
      if(!this.previewFailures.has(resref)){
        this.previewFailures.add(resref);
        console.warn('[MenuUpgrade] lightsaber preview model failed to load', resref, e);
      }
      return;
    }
    if(!current()){
      model?.dispose?.();
      return;
    }
    this.removePreviewModel();
    this.previewModel = model;
    view.addModel(model);
    // The lit blade: in hand ModuleItem.setPowered holds a saber on 'off'
    // until it powers up, then loops 'powered'. The preview always shows it lit.
    if(model.odysseyAnimationMap?.has?.(PREVIEW_ANIMATION)) model.playAnimation(PREVIEW_ANIMATION, true);
    this.framePreview(model, view);
    TextureLoader.LoadQueue().catch((e: unknown) => console.warn('[MenuUpgrade] lightsaber preview textures failed', resref, e));
  }

  /**
   * Centres the model's bounding box on the origin and puts the camera on an
   * axis perpendicular to its long axis, at a distance that fits it turning.
   */
  private framePreview(model: OdysseyModel3D, view: LBL_3DView){
    model.position.set(0, 0, 0);
    model.quaternion.identity();
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    if(box.isEmpty()){
      this.previewCentre.set(0, 0, 0);
    }else{
      box.getCenter(this.previewCentre);
      box.getSize(size);
    }
    const axes = previewAxes(size);
    this.previewAxis.copy(AXIS_VECTORS[axes.long]);
    const camera = view.camera;
    const distance = previewCameraDistance(size, camera.fov, camera.aspect);
    camera.up.copy(this.previewAxis);
    camera.position.copy(AXIS_VECTORS[axes.view]).multiplyScalar(distance);
    camera.near = Math.max(0.01, distance / 100);
    camera.far = distance * 10;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    // Key light from the camera's side, raised along the long axis.
    this.previewKeyLight?.position.copy(camera.position).addScaledVector(this.previewAxis, distance * 0.5);
    this.posePreviewModel();
  }

  /** Turns the model by previewAngle about its long axis through its box centre. */
  private posePreviewModel(){
    const model = this.previewModel;
    if(!model) return;
    this.previewTurn.setFromAxisAngle(this.previewAxis, this.previewAngle);
    model.quaternion.copy(this.previewTurn);
    model.position.copy(this.previewCentre).negate().applyQuaternion(this.previewTurn);
  }

  private removePreviewModel(){
    const model = this.previewModel;
    this.previewModel = undefined;
    if(!model) return;
    this.previewView?.removeModel(model);
    model.removeFromParent();
    try { model.dispose(); } catch (e) { console.warn('[MenuUpgrade] lightsaber preview model dispose failed', e); }
  }

  /** Removes and disposes the model and releases the view's render targets; update() stops rendering. */
  disposePreview(){
    this.previewLoad++;
    this.previewResRef = '';
    this.removePreviewModel();
    const view = this.previewView;
    this.previewView = undefined;
    this.previewKeyLight?.dispose();
    this.previewKeyLight = undefined;
    view?.dispose();
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
    this.updatePreview();
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
