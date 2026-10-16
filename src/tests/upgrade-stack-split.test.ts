import { beforeEach, describe, expect, jest, test } from '@jest/globals';

/**
 * Ruling R8: a stacked weapon is upgraded one unit at a time. Assemble on a
 * stack of 2 splits one unit off, so one part buys one upgraded weapon and
 * the plain copy stays plain (final review finding 1).
 */

const PART_RESREF = 'u_r_targ_01';
const PART_ROW = 30;
const BLASTER_BASE = 4;
const PART_BASE = 90;

const datatables = new Map<string, any>([
  ['upgrade', { rows: {
    [PART_ROW]: { __index: PART_ROW, label: 'Targeting_01', template: PART_RESREF, upgradetype: '4' },
  } }],
  ['baseitems', {
    getRowByIndex: (i: number) => i === BLASTER_BASE
      ? { __index: String(i), storepanelsort: '40', stacking: '99' }
      : { __index: String(i), storepanelsort: '99', stacking: '99' },
  }],
]);

jest.mock('@/GameState', () => ({ GameState: {
  ModuleObjectManager: {
    COUNT: 1,
    ObjectList: new Map<number, unknown>(),
    AddObjectById(o: any) { if (!o.id) o.id = this.COUNT++; this.ObjectList.set(o.id, o); },
    RemoveObjectById(id: number) { return this.ObjectList.delete(id); },
  },
  SWRuleSet: { itemPropsDef: {}, costTables: {}, weaponSounds: [] as unknown[] },
  TwoDAManager: { datatables: undefined as any },
  PartyManager: { party: [] as unknown[] },
  Module: { ModuleArea: {} as any },
  InventoryManager: {} as any,
} }));

import { GameState } from '@/GameState';
import { ResourceLoader } from '@/loaders';
import { ModuleItem } from '@/module/ModuleItem';
import { GFFObject } from '@/resource/GFFObject';
import { GFFField } from '@/resource/GFFField';
import { GFFDataType } from '@/enums/resource/GFFDataType';
import { findItemStackTarget } from '@/managers/InventoryManager';
import { UpgradeEnginePorts } from '@/game/tsl/crafting/UpgradeEnginePorts';
import { UpgradeSession } from '@/game/tsl/crafting/UpgradeSession';

function itemTemplate(tag: string, baseItem: number, stack: number, upgradeLevel: number): GFFObject {
  const gff = new GFFObject();
  gff.RootNode.addField(new GFFField(GFFDataType.CEXOSTRING, 'Tag')).setValue(tag);
  gff.RootNode.addField(new GFFField(GFFDataType.RESREF, 'TemplateResRef')).setValue(tag);
  gff.RootNode.addField(new GFFField(GFFDataType.INT, 'BaseItem')).setValue(baseItem);
  gff.RootNode.addField(new GFFField(GFFDataType.WORD, 'StackSize')).setValue(stack);
  gff.RootNode.addField(new GFFField(GFFDataType.BYTE, 'UpgradeLevel')).setValue(upgradeLevel);
  gff.RootNode.addField(new GFFField(GFFDataType.LIST, 'PropertiesList'));
  return gff;
}

const partBuffer = itemTemplate(PART_RESREF, PART_BASE, 1, 0).getExportBuffer();

/** A party-inventory stand-in that merges stacks with the engine's own rule. */
const inventory = {
  inventory: [] as ModuleItem[],
  getNonQuestInventory() { return this.inventory; },
  removeItem(item: ModuleItem, n = 1) {
    const i = this.inventory.indexOf(item);
    if (i < 0) return;
    if (n >= item.getStackSize()) this.inventory.splice(i, 1);
    else item.setStackSize(item.getStackSize() - n);
  },
  addItem(template: GFFObject | ModuleItem, limitOne = false) {
    const item = template instanceof ModuleItem ? template : new ModuleItem(template);
    if (!(template instanceof ModuleItem)) item.initProperties();
    if (limitOne) item.setStackSize(1);
    const target = findItemStackTarget(this.inventory, item);
    if (target) { target.setStackSize(target.getStackSize() + item.getStackSize()); return target; }
    this.inventory.push(item);
    return item;
  },
};

function blasters(n: number): ModuleItem {
  const item = new ModuleItem(itemTemplate('w_blaste_01', BLASTER_BASE, n, 1));
  item.initProperties();
  return item;
}

function partStack(n: number): ModuleItem {
  const item = new ModuleItem(new GFFObject(partBuffer));
  item.initProperties();
  item.setStackSize(n);
  return item;
}

const partCount = () => inventory.inventory
  .filter((i) => String(i.getTag()).toLowerCase() === PART_RESREF)
  .reduce((n, i) => n + i.getStackSize(), 0);

const weaponsOf = () => inventory.inventory.filter((i) => i.getTag() === 'w_blaste_01');

function sessionFor(engine: UpgradeEnginePorts, item: ModuleItem): UpgradeSession {
  return new UpgradeSession(engine.itemPort(item)!, engine.bag(), engine.table(), (row) => engine.partFor(row));
}

beforeEach(() => {
  (GameState as any).TwoDAManager.datatables = datatables;
  (GameState as any).Module.ModuleArea.ModuleItem = ModuleItem;
  (GameState as any).InventoryManager = inventory;
  (GameState as any).PartyManager.party = [];
  inventory.inventory = [];
  (GameState as any).ModuleObjectManager.ObjectList.clear();
  jest.restoreAllMocks();
  jest.spyOn(ResourceLoader, 'loadCachedResource').mockImplementation(((_type: number, resref: string) =>
    resref === PART_RESREF ? partBuffer : null) as any);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(ModuleItem.prototype, 'getName').mockImplementation(function (this: ModuleItem) { return this.getTag(); });
});

describe('upgrading a stack (ruling R8)', () => {
  test('Assemble on a stack of 2 upgrades one unit and consumes one part', () => {
    const engine = new UpgradeEnginePorts();
    const stack = blasters(2);
    inventory.inventory.push(stack, partStack(2));
    expect(partCount()).toBe(2);

    const session = sessionFor(engine, stack);
    const part = engine.partFor(PART_ROW)!;
    expect(session.stage(0, part)).toBe(true);
    expect(session.assemble()).toBe(true);

    const weapons = weaponsOf();
    expect(weapons).toHaveLength(2);
    expect(weapons.map((w) => w.getStackSize())).toEqual([1, 1]);
    const upgraded = weapons.filter((w) => w.getUpgradeSlot(0) === PART_ROW);
    const plain = weapons.filter((w) => w.getUpgradeSlot(0) === -1);
    expect(upgraded).toHaveLength(1);
    expect(plain).toHaveLength(1);
    // The item the screen holds is the upgraded unit.
    expect(upgraded[0]).toBe(stack);
    expect(partCount()).toBe(1);

    // Remove on the upgraded unit returns one part; the plain unit is untouched.
    const again = sessionFor(engine, stack);
    expect(again.stage(0, null)).toBe(true);
    expect(again.assemble()).toBe(true);
    expect(partCount()).toBe(2);
    expect(plain[0].getStackSize()).toBe(1);
    expect(plain[0].getUpgradeSlot(0)).toBe(-1);
    expect(weaponsOf()).toHaveLength(2);
    // The returned part merged into the held stack; its throwaway object is
    // not left in the module's registry (finding 4).
    const registered = [...(GameState as any).ModuleObjectManager.ObjectList.values()] as ModuleItem[];
    const strays = registered.filter((o) => o.getTag?.() === PART_RESREF && !inventory.inventory.includes(o));
    expect(strays).toEqual([]);
  });

  test('a plain unit added later merges with the plain copy, never the upgraded one', () => {
    const engine = new UpgradeEnginePorts();
    const stack = blasters(3);
    inventory.inventory.push(stack, partStack(1));
    const session = sessionFor(engine, stack);
    session.stage(0, engine.partFor(PART_ROW)!);
    expect(session.assemble()).toBe(true);
    const plain = weaponsOf().find((w) => w !== stack)!;
    expect(plain.getStackSize()).toBe(2);
    expect(stack.getStackSize()).toBe(1);
    expect(inventory.addItem(blasters(1))).toBe(plain);
    expect(plain.getStackSize()).toBe(3);
    expect(stack.getStackSize()).toBe(1);
  });

  test('an equipped stack keeps one upgraded unit in the hand and sends the rest to the bag', () => {
    const engine = new UpgradeEnginePorts();
    const stack = blasters(2);
    const wearer = { equipment: { RIGHTHAND: stack } } as any;
    (GameState as any).PartyManager.party = [wearer];
    inventory.inventory.push(partStack(1));
    const session = sessionFor(engine, stack);
    session.stage(0, engine.partFor(PART_ROW)!);
    expect(session.assemble()).toBe(true);
    expect(wearer.equipment.RIGHTHAND).toBe(stack);
    expect(stack.getStackSize()).toBe(1);
    expect(stack.getUpgradeSlot(0)).toBe(PART_ROW);
    const bagged = weaponsOf();
    expect(bagged).toHaveLength(1);
    expect(bagged[0].getStackSize()).toBe(1);
    expect(bagged[0].getUpgradeSlot(0)).toBe(-1);
  });

  test('a single item is upgraded in place with no split', () => {
    const engine = new UpgradeEnginePorts();
    const one = blasters(1);
    inventory.inventory.push(one, partStack(1));
    const session = sessionFor(engine, one);
    session.stage(0, engine.partFor(PART_ROW)!);
    expect(session.assemble()).toBe(true);
    expect(weaponsOf()).toEqual([one]);
    expect(one.getUpgradeSlot(0)).toBe(PART_ROW);
  });
});
