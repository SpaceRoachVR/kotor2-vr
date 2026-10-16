import { GameState } from "@/GameState";
import { ResourceLoader } from "@/loaders";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { GFFObject } from "@/resource/GFFObject";
import type { ModuleCreature, ModuleItem } from "@/module";
import { ItemCategory, UpgradeRow, categoryFor, parseUpgradeTable } from "@/game/tsl/crafting/UpgradeRules";
import type { UpgradeBagPorts, UpgradeItemPort, UpgradePart } from "@/game/tsl/crafting/UpgradeSession";

/** An upgradeable item and, when it is equipped, the party member wearing it. */
export interface UpgradeableEntry {
  item: ModuleItem;
  wearer?: ModuleCreature;
}

/** Equipment keys an upgradeable item can occupy (weapons, both sets, and armor). */
const EQUIPMENT_KEYS = ['RIGHTHAND', 'LEFTHAND', 'RIGHTHAND2', 'LEFTHAND2', 'ARMOR'];

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

  /** The item's category, when the workbench can upgrade it at all. */
  static categoryOf(item: ModuleItem | undefined): ItemCategory | undefined {
    if(!item) return undefined;
    return categoryFor(Number(item.baseItem?.storePanelSort));
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
      const manager = GameState.ModuleObjectManager;
      if(manager?.ObjectList?.get(item.id) === item) manager.RemoveObjectById(item.id);
      this.displayItems.set(key, item);
      return item;
    } catch (e) {
      console.warn(`[UpgradeEnginePorts] part template "${key}" could not be read`, e);
      return undefined;
    }
  }

  /** The session's view of `item`, or undefined when it cannot be upgraded. */
  itemPort(item: ModuleItem): UpgradeItemPort | undefined {
    const category = UpgradeEnginePorts.categoryOf(item);
    const level = Number(item?.getUpgradeLevel?.()) || 0;
    if(!category || level < 1) return undefined;
    return {
      category,
      level,
      getSlot: (i: number) => item.getUpgradeSlot(i),
      setSlot: (i: number, row: number) => item.setUpgradeSlot(i, row),
    };
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
          return !!GameState.InventoryManager.addItem(new GFFObject(buffer), true);
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
