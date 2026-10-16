import { GameState } from "@/GameState";
import { ResourceLoader } from "@/loaders";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { GFFObject } from "@/resource/GFFObject";
import type { ModuleCreature, ModuleItem } from "@/module";
import { OdysseyModel3D } from "@/three/odyssey";
import { COLOUR_SLOT, ItemCategory, SaberKind, UpgradeRow, categoryFor, parseUpgradeTable, saberKindFor } from "@/game/tsl/crafting/UpgradeRules";
import { ColourRow, colourCrystalFor, isColourCrystal, modelVariationFor, parseColourTable } from "@/game/tsl/crafting/ColourCrystals";
import type { ColourPort, UpgradeBagPorts, UpgradeItemPort, UpgradePart } from "@/game/tsl/crafting/UpgradeSession";

/** An upgradeable item and, when it is equipped, the party member wearing it. */
export interface UpgradeableEntry {
  item: ModuleItem;
  wearer?: ModuleCreature;
}

/** Equipment keys an upgradeable item can occupy (weapons, both sets, and armor). */
const EQUIPMENT_KEYS = ['RIGHTHAND', 'LEFTHAND', 'RIGHTHAND2', 'LEFTHAND2', 'ARMOR'];

/** The creature model's attachment node for an equipped hand item (as equipItem attaches it). */
const HAND_NODES: Record<string, 'rhand' | 'lhand'> = { RIGHTHAND: 'rhand', LEFTHAND: 'lhand' };

/**
 * The latest reloadWorn per item, and the model it attached. An older reload
 * that finishes later is dropped.
 */
const reloads = new WeakMap<ModuleItem, { generation: number; model?: unknown }>();

const resrefOf = (item: ModuleItem): string =>
  String(item?.getTemplateResRef?.() || item?.getTag?.() || '').toLowerCase();

/**
 * Binds UpgradeSession to the engine for TSL's Upgrade Workbench: the item's
 * slots (ModuleItem.getUpgradeSlot / setUpgradeSlot), the party inventory as
 * the bag of parts, and upgrade.2da rows resolved to part templates. Part
 * templates are read through the synchronous UTI cache (retail parts live in
 * templates.bif, cached at startup), so the session's ports stay synchronous;
 * a row whose template is not cached is never offered.
 */
export class UpgradeEnginePorts {
  private tableSource: unknown;
  private rows: UpgradeRow[] = [];
  private rowsByTemplate = new Map<string, UpgradeRow>();
  /** Parts by upgrade.2da row; undefined = no usable template. */
  private parts = new Map<number, UpgradePart | undefined>();
  /** Display items built from part templates, by resref. */
  private displayItems = new Map<string, ModuleItem>();
  private bagPorts: UpgradeBagPorts | undefined;
  private colourSource: unknown;
  private colourRows: ColourRow[] = [];
  /** Saber template ModelVariation by resref; undefined = template not cached. */
  private variations = new Map<string, number | undefined>();

  /** The item's category, when the workbench can upgrade it at all. */
  static categoryOf(item: ModuleItem | undefined): ItemCategory | undefined {
    if(!item) return undefined;
    const baseItem = Number(item.getBaseItemId?.() ?? (item as any).baseItemId);
    return categoryFor(Number(item.baseItem?.storePanelSort), Number.isFinite(baseItem) ? baseItem : undefined);
  }

  /** Category known and UpgradeLevel >= 1. */
  static isUpgradeable(item: ModuleItem | undefined): boolean {
    return !!UpgradeEnginePorts.categoryOf(item) && Number(item?.getUpgradeLevel?.()) >= 1;
  }

  /**
   * upgrade.2da rows whose part template is in the UTI cache, parsed once per
   * loaded table object.
   */
  table(): UpgradeRow[] {
    const source = GameState.TwoDAManager?.datatables?.get('upgrade');
    if(source !== this.tableSource){
      this.tableSource = source;
      this.parts.clear();
      this.rows = parseUpgradeTable(((source as any)?.rows ?? {}) as Record<string, Record<string, string>>)
        .filter((row) => !!ResourceLoader.loadCachedResource(ResourceTypes['uti'], row.template));
      this.rowsByTemplate.clear();
      for(const row of this.rows){
        if(!this.rowsByTemplate.has(row.template)) this.rowsByTemplate.set(row.template, row);
      }
    }
    return this.rows;
  }

  /** upcrystals.2da's colour-crystal rows, parsed once per loaded table object. */
  colourTable(): ColourRow[] {
    const source = GameState.TwoDAManager?.datatables?.get('upcrystals');
    if(source !== this.colourSource){
      this.colourSource = source;
      this.colourRows = parseColourTable(((source as any)?.rows ?? {}) as Record<string, Record<string, string>>);
    }
    return this.colourRows;
  }

  /**
   * The ModelVariation of a saber template in the UTI cache (the blade colour
   * a colour crystal gives), or undefined when it is not cached. Cached,
   * misses included.
   */
  variationOf(template: string): number | undefined {
    const key = String(template).toLowerCase();
    if(this.variations.has(key)) return this.variations.get(key);
    let variation: number | undefined;
    const buffer = ResourceLoader.loadCachedResource(ResourceTypes['uti'], key);
    if(buffer){
      try {
        const root = new GFFObject(buffer).RootNode;
        if(root.hasField('ModelVariation')){
          const v = Number(root.getFieldByLabel('ModelVariation').getValue());
          if(Number.isFinite(v)) variation = v;
        }
      } catch (e) {
        console.warn(`[UpgradeEnginePorts] saber template "${key}" could not be read`, e);
      }
    }
    this.variations.set(key, variation);
    return variation;
  }

  /** A colour crystal as a part (name from its template; the resref when not cached). */
  colourPart(resref: string): UpgradePart {
    const key = String(resref).toLowerCase();
    const display = this.displayItem(key);
    return {
      resref: key,
      row: -1,
      type: COLOUR_SLOT,
      level: 0,
      name: String(display?.getName?.() ?? key),
    };
  }

  /** The part an upgrade.2da row names, or undefined when its template is unusable. */
  partFor(row: number): UpgradePart | undefined {
    const rows = this.table();
    if(this.parts.has(row)) return this.parts.get(row);
    const entry = rows.find((r) => r.row === row);
    let part: UpgradePart | undefined;
    if(entry){
      const display = this.displayItem(entry.template);
      if(display){
        part = {
          resref: entry.template,
          row: entry.row,
          type: entry.type,
          level: display.getUpgradeLevel(),
          name: String(display.getName?.() ?? entry.template),
        };
      }
    }
    this.parts.set(row, part);
    return part;
  }

  /** The part a party-inventory resref is, when it is one. */
  partForResref(resref: string): UpgradePart | undefined {
    this.table();
    const row = this.rowsByTemplate.get(String(resref).toLowerCase());
    return row ? this.partFor(row.row) : undefined;
  }

  /**
   * A display item built from a part template (for its name, icon and
   * description), kept out of the module's object registry.
   */
  displayItem(resref: string): ModuleItem | undefined {
    const key = String(resref).toLowerCase();
    if(this.displayItems.has(key)) return this.displayItems.get(key);
    const buffer = ResourceLoader.loadCachedResource(ResourceTypes['uti'], key);
    if(!buffer) return undefined;
    try {
      const item = new GameState.Module.ModuleArea.ModuleItem(new GFFObject(buffer));
      item.initProperties();
      item.load();
      item.setStackSize(1);
      UpgradeEnginePorts.unregister(item);
      this.displayItems.set(key, item);
      return item;
    } catch (e) {
      console.warn(`[UpgradeEnginePorts] part template "${key}" could not be read`, e);
      return undefined;
    }
  }

  /** Takes an item no inventory holds out of the module's object registry. */
  private static unregister(item: ModuleItem): void {
    const manager = GameState.ModuleObjectManager;
    if(manager?.ObjectList?.get(item.id) === item) manager.RemoveObjectById(item.id);
  }

  /** The session's view of `item`, or undefined when it cannot be upgraded. */
  itemPort(item: ModuleItem): UpgradeItemPort | undefined {
    const category = UpgradeEnginePorts.categoryOf(item);
    const level = Number(item?.getUpgradeLevel?.()) || 0;
    if(!category || level < 1) return undefined;
    const port: UpgradeItemPort = {
      category,
      level,
      get name(){
        try { return String(item?.getName?.() || resrefOf(item)); } catch (e) { return resrefOf(item); }
      },
      getSlot: (i: number) => item.getUpgradeSlot(i),
      setSlot: (i: number, row: number) => {
        UpgradeEnginePorts.splitOffRest(item);
        item.setUpgradeSlot(i, row);
      },
    };
    const kind = category === 'lightsaber' ? saberKindFor(Number(item.getBaseItemId())) : undefined;
    if(kind) port.colour = this.colourPort(item, kind);
    return port;
  }

  /**
   * A saber's blade colour: its ModelVariation, read as the colour crystal
   * that gives it. Setting it changes one unit (ruling R8) and, when the
   * saber is worn, reloads the blade in the hand.
   */
  private colourPort(item: ModuleItem, kind: SaberKind): ColourPort {
    const variationOf = (template: string) => this.variationOf(template);
    const variationFor = (resref: string) => this.variationForCrystal(item, resref, kind);
    return {
      current: () => {
        const crystal = colourCrystalFor(this.colourTable(), kind, item.getModelVariation(), variationOf);
        return crystal ? this.colourPart(crystal) : undefined;
      },
      accepts: (resref: string) => variationFor(resref) !== undefined,
      set: (resref: string) => {
        const variation = variationFor(resref);
        if(variation === undefined) return false;
        try {
          // A split that throws (clone, addItem) refuses the colour, so the
          // session rolls its takes and returns back.
          UpgradeEnginePorts.splitOffRest(item);
        } catch (e) {
          console.error(`[UpgradeEnginePorts] colour "${resref}": the stack could not be split`, e);
          return false;
        }
        const previous = Number(item.modelVariation) || 0;
        let reloading = false;
        try {
          item.setModelVariation(variation);
          reloading = true;
          UpgradeEnginePorts.reloadWorn(item);
          return true;
        } catch (e) {
          // What can throw here is synchronous: the template write in
          // setModelVariation, or finding the wearer. A blade that fails to
          // load does so later, which is why accepts() checks the model first.
          console.error(`[UpgradeEnginePorts] colour "${resref}" could not be applied`, e);
          item.modelVariation = previous;
          try { item.setModelVariation(previous); } catch (e2) { /* the field above is restored */ }
          if(reloading){
            try { UpgradeEnginePorts.reloadWorn(item); } catch (e3) { /* best effort: put the old blade back */ }
          }
          return false;
        }
      },
    };
  }

  /**
   * The ModelVariation colour crystal `resref` gives saber `item`, or
   * undefined when it gives none for this saber kind. A variation whose
   * blade model is missing is never offered: the model only loads after the
   * colour is set, too late to roll the Assemble back. The colour port and
   * the upgrade screen's 3D preview both read the blade through here.
   */
  variationForCrystal(item: ModuleItem, resref: string, kind?: SaberKind): number | undefined {
    kind ??= saberKindFor(Number(item?.getBaseItemId?.()));
    if(!kind) return undefined;
    const variation = modelVariationFor(this.colourTable(), resref, kind, (template: string) => this.variationOf(template));
    return variation !== undefined && UpgradeEnginePorts.hasModelFor(item, variation) ? variation : undefined;
  }

  /** Whether `item`'s model for `variation` exists (ResourceLoader.hasModelPair). */
  static hasModelFor(item: ModuleItem, variation: number): boolean {
    try {
      return ResourceLoader.hasModelPair(item.modelResRefFor(variation));
    } catch (e) {
      console.warn('[UpgradeEnginePorts] model lookup failed', e);
      return false;
    }
  }

  /**
   * Reloads a worn item's model where it is worn, so a new variation (the
   * blade colour) shows. Deliberately not unequipSlot + equipItem: for a
   * party member onUnEquip sends the item through InventoryManager.addItem
   * (which can merge it into a same-tag stack and so duplicate it), the hand
   * slots destroy their item on unequipSlot(slot, false), and equipItem only
   * puts the item back in its slot after an await, leaving it in neither the
   * hand nor the bag meanwhile. Here the item never leaves its slot:
   * loadModel disposes the old model and the new one goes on the hand node
   * the way equipItem attaches it. When reloads overlap (an Assemble
   * rollback sets the old colour straight after the new one), only the last
   * one attaches; an earlier one's model is disposed when it lands.
   */
  static reloadWorn(item: ModuleItem): void {
    const wearer = UpgradeEnginePorts.wearerOf(item);
    if(!wearer) return;
    const equipment = (wearer as any).equipment ?? {};
    const key = EQUIPMENT_KEYS.find((k) => equipment[k] === item);
    const node = key ? HAND_NODES[key] : undefined;
    const state = { generation: (reloads.get(item)?.generation ?? 0) + 1 } as { generation: number; model?: unknown };
    reloads.set(item, state);
    item.loadModel().then((model) => {
      const latest = reloads.get(item);
      if(latest !== state){
        // Superseded. loadModel already made this item.model; when it landed
        // after the latest reload, put the latest one back.
        if(item.model === model) (item as any).model = latest?.model;
        model?.removeFromParent?.();
        model?.dispose?.();
        return;
      }
      state.model = model;
      const hand = node ? (wearer as any).model?.[node] : undefined;
      if(model instanceof OdysseyModel3D && item.model === model && hand && equipment[key!] === item) hand.add(model);
    }).catch((e) => console.error('[UpgradeEnginePorts] blade model reload failed', e));
  }

  /**
   * Ruling R8: a part upgrades one unit, never a whole stack (weapons stack,
   * and the item list shows a stack as one row). Before a stacked item's
   * slots change, `item` keeps one unit (the same object, so the screen and
   * any wearer still hold it) and the rest becomes a plain copy (clone(), as
   * ModuleCreature.equipItem splits a stack). In the party inventory the copy
   * goes in right after the item: InventoryManager.addItem would merge it
   * straight back into the still-plain unit. An equipped stack's rest goes to
   * the bag through addItem, joining any plain stack there. Once upgraded,
   * the unit no longer merges (findItemStackTarget skips upgraded items).
   */
  static splitOffRest(item: ModuleItem): void {
    const count = Number(item?.getStackSize?.()) || 1;
    if(count <= 1) return;
    const rest = item.clone();
    rest.setStackSize(count - 1);
    item.setStackSize(1);
    try {
      const inventory = GameState.InventoryManager.inventory as ModuleItem[];
      const at = inventory.indexOf(item);
      if(at >= 0) inventory.splice(at + 1, 0, rest);
      else GameState.InventoryManager.addItem(rest);
    } catch (e) {
      // The rest never landed: the stack stays whole.
      item.setStackSize(count);
      throw e;
    }
  }

  /** The party inventory as the bag of upgrade parts. */
  bag(): UpgradeBagPorts {
    if(this.bagPorts) return this.bagPorts;
    this.bagPorts = {
      parts: () => {
        const counts = new Map<string, { part: UpgradePart; count: number }>();
        for(const item of GameState.InventoryManager.inventory as ModuleItem[]){
          const part = this.partForResref(resrefOf(item));
          if(!part) continue;
          const entry = counts.get(part.resref);
          const n = Number(item.getStackSize?.()) || 1;
          if(entry) entry.count += n;
          else counts.set(part.resref, { part, count: n });
        }
        return [...counts.values()];
      },
      colourCrystals: () => {
        const table = this.colourTable();
        const counts = new Map<string, { part: UpgradePart; count: number }>();
        for(const item of GameState.InventoryManager.inventory as ModuleItem[]){
          const resref = resrefOf(item);
          if(!resref || !isColourCrystal(table, resref)) continue;
          const entry = counts.get(resref);
          const n = Number(item.getStackSize?.()) || 1;
          if(entry) entry.count += n;
          else counts.set(resref, { part: this.colourPart(resref), count: n });
        }
        return [...counts.values()];
      },
      takeOne: (resref: string) => {
        const want = String(resref).toLowerCase();
        const item = (GameState.InventoryManager.inventory as ModuleItem[]).find((i) => resrefOf(i) === want);
        if(!item) return false;
        GameState.InventoryManager.removeItem(item, 1);
        return true;
      },
      returnOne: (resref: string) => {
        const buffer = ResourceLoader.loadCachedResource(ResourceTypes['uti'], String(resref).toLowerCase());
        if(!buffer) return false;
        try {
          const part = new GameState.Module.ModuleArea.ModuleItem(new GFFObject(buffer));
          const held = GameState.InventoryManager.addItem(part, true);
          // Merged into a stack already held: the new object was registered
          // by its constructor and is now unreferenced; drop it.
          if(held && held !== part) UpgradeEnginePorts.unregister(part);
          return !!held;
        } catch (e) {
          console.warn(`[UpgradeEnginePorts] could not return part "${resref}" to the bag`, e);
          return false;
        }
      },
    };
    return this.bagPorts;
  }

  /**
   * Upgradeable items: the party inventory's non-quest items, then whatever
   * the current party members have equipped (with the wearer).
   */
  upgradeableItems(): UpgradeableEntry[] {
    const out: UpgradeableEntry[] = [];
    const seen = new Set<ModuleItem>();
    for(const item of GameState.InventoryManager.getNonQuestInventory() as ModuleItem[]){
      if(seen.has(item) || !UpgradeEnginePorts.isUpgradeable(item)) continue;
      seen.add(item);
      out.push({ item });
    }
    for(const member of (GameState.PartyManager.party ?? []) as ModuleCreature[]){
      const equipment = (member as any)?.equipment ?? {};
      for(const key of EQUIPMENT_KEYS){
        const item = equipment[key] as ModuleItem | undefined;
        if(!item || seen.has(item) || !UpgradeEnginePorts.isUpgradeable(item)) continue;
        seen.add(item);
        out.push({ item, wearer: member });
      }
    }
    return out;
  }

  /** The party member wearing `item`, if any. */
  static wearerOf(item: ModuleItem): ModuleCreature | undefined {
    for(const member of (GameState.PartyManager.party ?? []) as ModuleCreature[]){
      const equipment = (member as any)?.equipment ?? {};
      if(EQUIPMENT_KEYS.some((key) => equipment[key] === item)) return member;
    }
    return undefined;
  }
}
