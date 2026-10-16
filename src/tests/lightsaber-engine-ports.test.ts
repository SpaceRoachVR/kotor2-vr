import { beforeEach, describe, expect, jest, test } from '@jest/globals';

/**
 * Task 4: a lightsaber's blade colour is its ModuleItem.modelVariation. The
 * engine ports read upcrystals.2da and the saber templates' ModelVariation,
 * and a colour change on an equipped saber reloads the blade in the hand.
 */

const LONG_SABER = 8;
const PIKE = 4;
const BLASTER = 5;
const CRYSTAL_BASE = 90;

const datatables = new Map<string, any>([
  ['upgrade', { rows: {} }],
  ['upcrystals', { rows: {
    0: { __index: 0, template: 'u_l_colo_01', shortmdlvar: 'g_w_shrtsbr01', longmdlvar: 'g_w_lghtsbr01', doublemdlvar: 'g_w_dblsbr001' },
    1: { __index: 1, template: 'u_l_crys_01', shortmdlvar: '****', longmdlvar: '****', doublemdlvar: '****' },
    3: { __index: 3, template: 'u_l_colo_04', shortmdlvar: 'g_w_shrtsbr04', longmdlvar: 'g_w_lghtsbr04', doublemdlvar: 'g_w_dblsbr004' },
  } }],
  ['baseitems', {
    getRowByIndex: (i: number) => i === LONG_SABER
      ? { __index: String(i), storepanelsort: '30', stacking: '99', itemclass: 'w_lghtsbr', defaultmodel: 'w_lghtsbr_001' }
      : i === PIKE
        ? { __index: String(i), storepanelsort: '30', stacking: '99', itemclass: 'w_vbrdblswd', defaultmodel: 'w_vbrdblswd_001' }
        : i === BLASTER
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
import { COLOUR_SLOT } from '@/game/tsl/crafting/UpgradeRules';
import { OdysseyModel3D } from '@/three/odyssey';
import { KEYManager } from '@/managers/KEYManager';

function itemTemplate(tag: string, baseItem: number, stack: number, upgradeLevel: number, variation?: number): GFFObject {
  const gff = new GFFObject();
  gff.RootNode.addField(new GFFField(GFFDataType.CEXOSTRING, 'Tag')).setValue(tag);
  gff.RootNode.addField(new GFFField(GFFDataType.RESREF, 'TemplateResRef')).setValue(tag);
  gff.RootNode.addField(new GFFField(GFFDataType.INT, 'BaseItem')).setValue(baseItem);
  gff.RootNode.addField(new GFFField(GFFDataType.WORD, 'StackSize')).setValue(stack);
  gff.RootNode.addField(new GFFField(GFFDataType.BYTE, 'UpgradeLevel')).setValue(upgradeLevel);
  if (variation !== undefined) gff.RootNode.addField(new GFFField(GFFDataType.BYTE, 'ModelVariation')).setValue(variation);
  gff.RootNode.addField(new GFFField(GFFDataType.LIST, 'PropertiesList'));
  return gff;
}

/** The UTI cache: colour crystals and the saber templates whose variation they name. */
const utis = new Map<string, Uint8Array>([
  ['u_l_colo_01', itemTemplate('u_l_colo_01', CRYSTAL_BASE, 1, 0).getExportBuffer()],
  ['u_l_colo_04', itemTemplate('u_l_colo_04', CRYSTAL_BASE, 1, 0).getExportBuffer()],
  ['g_w_lghtsbr01', itemTemplate('g_w_lghtsbr01', LONG_SABER, 1, 1, 1).getExportBuffer()],
  ['g_w_lghtsbr04', itemTemplate('g_w_lghtsbr04', LONG_SABER, 1, 1, 2).getExportBuffer()],
]);

/** A party-inventory stand-in that merges stacks with the engine's own rule. */
const inventory = {
  inventory: [] as ModuleItem[],
  getNonQuestInventory(): ModuleItem[] { return inventory.inventory; },
  removeItem: jest.fn((item: ModuleItem, n: number = 1): void => {
    const i = inventory.inventory.indexOf(item);
    if (i < 0) return;
    if (n >= item.getStackSize()) inventory.inventory.splice(i, 1);
    else item.setStackSize(item.getStackSize() - n);
  }),
  addItem: jest.fn((template: GFFObject | ModuleItem): ModuleItem => {
    const item = template instanceof ModuleItem ? template : new ModuleItem(template);
    if (!(template instanceof ModuleItem)) item.initProperties();
    const target = findItemStackTarget(inventory.inventory, item);
    if (target) { target.setStackSize(target.getStackSize() + item.getStackSize()); return target; }
    inventory.inventory.push(item);
    return item;
  }),
};

function saber(stack = 1, variation = 2, base = LONG_SABER): ModuleItem {
  const item = new ModuleItem(itemTemplate('g_w_lghtsbr01', base, stack, 1, variation));
  item.initProperties();
  return item;
}

function crystal(resref: string, n: number): ModuleItem {
  const item = new ModuleItem(new GFFObject(utis.get(resref)!));
  item.initProperties();
  item.setStackSize(n);
  return item;
}

/** A party member holding `item` in the right hand. */
function wearerHolding(item: ModuleItem) {
  return {
    equipment: { RIGHTHAND: item } as Record<string, ModuleItem | undefined>,
    model: { rhand: { add: jest.fn() }, lhand: { add: jest.fn() } },
    unequipSlot: jest.fn(),
    equipItem: jest.fn(async () => {}),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  (GameState as any).TwoDAManager.datatables = datatables;
  (GameState as any).Module.ModuleArea.ModuleItem = ModuleItem;
  (GameState as any).InventoryManager = inventory;
  (GameState as any).PartyManager.party = [];
  inventory.inventory = [];
  (GameState as any).ModuleObjectManager.ObjectList.clear();
  jest.restoreAllMocks();
  inventory.addItem.mockClear();
  inventory.removeItem.mockClear();
  jest.spyOn(ResourceLoader, 'loadCachedResource').mockImplementation(((_type: number, resref: string) =>
    utis.get(String(resref).toLowerCase()) ?? null) as any);
  jest.spyOn(ResourceLoader, 'hasModelPair').mockReturnValue(true);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(ModuleItem.prototype, 'getName').mockImplementation(function (this: ModuleItem) { return 'name:' + this.getTag(); });
});

describe('lightsaber category', () => {
  test('categoryOf a long saber is lightsaber', () => {
    expect(UpgradeEnginePorts.categoryOf(saber())).toBe('lightsaber');
  });

  test('a pike (storepanelsort 30, base 4) is not upgradeable', () => {
    const pike = saber(1, 1, PIKE);
    expect(UpgradeEnginePorts.categoryOf(pike)).toBeUndefined();
    expect(UpgradeEnginePorts.isUpgradeable(pike)).toBe(false);
    expect(new UpgradeEnginePorts().itemPort(pike)).toBeUndefined();
  });
});

describe('colour tables', () => {
  test('colourTable keeps only u_l_colo_ rows and is parsed once per table object', () => {
    const engine = new UpgradeEnginePorts();
    const table = engine.colourTable();
    expect(table.map((r) => r.crystal)).toEqual(['u_l_colo_01', 'u_l_colo_04']);
    expect(engine.colourTable()).toBe(table);
  });

  test('variationOf reads the cached template and caches misses', () => {
    const engine = new UpgradeEnginePorts();
    expect(engine.variationOf('g_w_lghtsbr04')).toBe(2);
    expect(engine.variationOf('g_w_missing')).toBeUndefined();
    const calls = (ResourceLoader.loadCachedResource as jest.Mock).mock.calls.length;
    expect(engine.variationOf('G_W_LGHTSBR04')).toBe(2);
    expect(engine.variationOf('g_w_missing')).toBeUndefined();
    expect((ResourceLoader.loadCachedResource as jest.Mock).mock.calls.length).toBe(calls);
  });
});

describe('colour port', () => {
  test('a non-lightsaber port has no colour', () => {
    const blaster = new ModuleItem(itemTemplate('w_blaste_01', BLASTER, 1, 1));
    blaster.initProperties();
    const port = new UpgradeEnginePorts().itemPort(blaster)!;
    expect(port.category).toBe('ranged');
    expect(port.colour).toBeUndefined();
  });

  test('current colour of a variation-2 long saber is u_l_colo_04', () => {
    const port = new UpgradeEnginePorts().itemPort(saber(1, 2))!;
    expect(port.colour!.current()).toEqual({
      resref: 'u_l_colo_04', row: -1, type: COLOUR_SLOT, level: 0, name: 'name:u_l_colo_04',
    });
  });

  test('a variation no colour row gives has no current crystal (Unknown)', () => {
    expect(new UpgradeEnginePorts().itemPort(saber(1, 9))!.colour!.current()).toBeUndefined();
  });

  test('accepts a colour crystal with a template for the kind, nothing else', () => {
    const colour = new UpgradeEnginePorts().itemPort(saber())!.colour!;
    expect(colour.accepts('u_l_colo_01')).toBe(true);
    expect(colour.accepts('U_L_COLO_04')).toBe(true);
    expect(colour.accepts('u_l_crys_01')).toBe(false);
    expect(colour.accepts('u_l_colo_99')).toBe(false);
  });

  test('set changes the variation of one unit of a stacked saber', () => {
    const item = saber(2, 2);
    inventory.inventory = [item];
    const colour = new UpgradeEnginePorts().itemPort(item)!.colour!;
    expect(colour.set('u_l_colo_01')).toBe(true);
    expect(item.getModelVariation()).toBe(1);
    expect(item.getStackSize()).toBe(1);
    expect(inventory.inventory).toHaveLength(2);
    const rest = inventory.inventory.find((i) => i !== item)!;
    expect(rest.getStackSize()).toBe(1);
    expect(rest.getModelVariation()).toBe(2);
  });

  test('set refuses a crystal it does not accept and changes nothing', () => {
    const item = saber(1, 2);
    const colour = new UpgradeEnginePorts().itemPort(item)!.colour!;
    expect(colour.set('u_l_crys_01')).toBe(false);
    expect(item.getModelVariation()).toBe(2);
  });

  test('set on an equipped saber reloads its blade once in the same hand and leaves no copy in the bag', async () => {
    const item = saber(1, 2);
    const wearer = wearerHolding(item);
    (GameState as any).PartyManager.party = [wearer];
    inventory.inventory = [crystal('u_l_colo_01', 1)];
    const newModel = new OdysseyModel3D();
    const loadModel = jest.spyOn(ModuleItem.prototype, 'loadModel').mockImplementation(async function (this: any) {
      this.model = newModel;
      return newModel as any;
    });

    expect(new UpgradeEnginePorts().itemPort(item)!.colour!.set('u_l_colo_01')).toBe(true);
    await flush();

    expect(loadModel).toHaveBeenCalledTimes(1);
    expect(wearer.model.rhand.add).toHaveBeenCalledTimes(1);
    expect(wearer.model.rhand.add).toHaveBeenCalledWith(newModel);
    expect(wearer.equipment.RIGHTHAND).toBe(item);
    expect(item.getModelVariation()).toBe(1);
    expect(wearer.unequipSlot).not.toHaveBeenCalled();
    expect(wearer.equipItem).not.toHaveBeenCalled();
    expect(inventory.inventory).toHaveLength(1);
    expect(inventory.inventory).not.toContain(item);
    expect(inventory.addItem).not.toHaveBeenCalled();
    expect(inventory.removeItem).not.toHaveBeenCalled();
  });

  test('a template write that throws restores the old variation, reloads nothing and returns false', () => {
    const item = saber(1, 2);
    (GameState as any).PartyManager.party = [wearerHolding(item)];
    const loadModel = jest.spyOn(ModuleItem.prototype, 'loadModel').mockImplementation(async () => ({}) as any);
    jest.spyOn(item.template, 'getFieldByLabel').mockImplementation(() => { throw new Error('broken template'); });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(new UpgradeEnginePorts().itemPort(item)!.colour!.set('u_l_colo_01')).toBe(false);
    expect(item.getModelVariation()).toBe(2);
    expect(loadModel).not.toHaveBeenCalled();
  });

  test('a stack split that throws makes set return false with the variation unchanged', () => {
    const item = saber(2, 2);
    inventory.inventory = [item];
    jest.spyOn(UpgradeEnginePorts, 'splitOffRest').mockImplementation(() => { throw new Error('clone failed'); });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(new UpgradeEnginePorts().itemPort(item)!.colour!.set('u_l_colo_01')).toBe(false);
    expect(item.getModelVariation()).toBe(2);
    expect(error).toHaveBeenCalledTimes(1);
  });

  test('an equipped stack whose rest cannot reach the bag stays whole, and set returns false', () => {
    const item = saber(2, 2);
    (GameState as any).PartyManager.party = [wearerHolding(item)];
    inventory.addItem.mockImplementationOnce(() => { throw new Error('bag full'); });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(new UpgradeEnginePorts().itemPort(item)!.colour!.set('u_l_colo_01')).toBe(false);
    expect(item.getModelVariation()).toBe(2);
    expect(item.getStackSize()).toBe(2);
  });

  test('a crystal whose blade model is missing is not accepted, and set changes nothing', () => {
    const lookup = (ResourceLoader.hasModelPair as jest.Mock).mockImplementation((ref: unknown) => ref !== 'w_lghtsbr_001');
    const item = saber(2, 2);
    inventory.inventory = [item];
    (GameState as any).PartyManager.party = [];
    const loadModel = jest.spyOn(ModuleItem.prototype, 'loadModel').mockImplementation(async () => ({}) as any);
    const colour = new UpgradeEnginePorts().itemPort(item)!.colour!;

    expect(colour.accepts('u_l_colo_01')).toBe(false);
    expect(colour.accepts('u_l_colo_04')).toBe(true);
    expect(lookup).toHaveBeenCalledWith('w_lghtsbr_001');
    expect(colour.set('u_l_colo_01')).toBe(false);
    expect(item.getModelVariation()).toBe(2);
    expect(item.getStackSize()).toBe(2);
    expect(inventory.inventory).toEqual([item]);
    expect(loadModel).not.toHaveBeenCalled();
  });

  test.each([
    ['in order', [0, 1]],
    ['out of order', [1, 0]],
  ])('two back-to-back sets on a worn saber attach exactly one blade, the last (%s)', async (_label, order) => {
    const item = saber(1, 2);
    const wearer = wearerHolding(item);
    (GameState as any).PartyManager.party = [wearer];
    const models = [new OdysseyModel3D(), new OdysseyModel3D()];
    const dispose = models.map((m) => jest.spyOn(m, 'dispose').mockImplementation(() => {}));
    const pending: (() => void)[] = [];
    let calls = 0;
    jest.spyOn(ModuleItem.prototype, 'loadModel').mockImplementation(function (this: any) {
      const model = models[calls++];
      this.model = undefined;
      return new Promise((resolve) => pending.push(() => { this.model = model; resolve(model as any); }));
    });
    const colour = new UpgradeEnginePorts().itemPort(item)!.colour!;

    expect(colour.set('u_l_colo_01')).toBe(true);
    expect(colour.set('u_l_colo_04')).toBe(true);
    for (const i of order) { pending[i](); await flush(); }

    expect(wearer.model.rhand.add).toHaveBeenCalledTimes(1);
    expect(wearer.model.rhand.add).toHaveBeenCalledWith(models[1]);
    expect(item.model).toBe(models[1]);
    expect(dispose[0]).toHaveBeenCalled();
    expect(dispose[1]).not.toHaveBeenCalled();
    expect(item.getModelVariation()).toBe(2);
  });
});

describe('ResourceLoader.hasModelPair', () => {
  const MDL = 2002;
  const MDX = 3008;

  beforeEach(() => {
    (ResourceLoader.hasModelPair as jest.Mock).mockRestore();
    jest.spyOn(ResourceLoader, 'getCache').mockReturnValue(null);
    jest.spyOn(ResourceLoader, 'selectOverrideLayer').mockReturnValue(undefined);
    ResourceLoader.ModuleArchives = [];
  });

  test('an Override layer holding both halves counts (retail w_lghtsbr_011 is Override-only)', () => {
    (ResourceLoader.selectOverrideLayer as jest.Mock).mockReturnValue({ primary: {}, companions: new Map() });
    expect(ResourceLoader.hasModelPair('w_lghtsbr_011')).toBe(true);
    expect(ResourceLoader.selectOverrideLayer).toHaveBeenCalledWith('w_lghtsbr_011', [MDL], [MDX]);
  });

  test('chitin.key needs both halves', () => {
    const keys = new Set([`w_lghtsbr_002:${MDL}`, `w_lghtsbr_002:${MDX}`, `w_lghtsbr_003:${MDL}`]);
    jest.spyOn(KEYManager.Key, 'getFileKey').mockImplementation(((ref: string, type: number) =>
      keys.has(`${ref}:${type}`) ? ({} as any) : null) as any);
    expect(ResourceLoader.hasModelPair('W_LGHTSBR_002')).toBe(true);
    expect(ResourceLoader.hasModelPair('w_lghtsbr_003')).toBe(false);
    expect(ResourceLoader.hasModelPair('w_lghtsbr_099')).toBe(false);
  });

  test('a loaded module archive counts', () => {
    jest.spyOn(KEYManager.Key, 'getFileKey').mockReturnValue(null);
    ResourceLoader.ModuleArchives = [{ hasResource: () => true } as any];
    expect(ResourceLoader.hasModelPair('w_lghtsbr_004')).toBe(true);
  });

  test('both halves cached counts', () => {
    jest.spyOn(KEYManager.Key, 'getFileKey').mockReturnValue(null);
    (ResourceLoader.getCache as jest.Mock).mockReturnValue(new Uint8Array(1));
    expect(ResourceLoader.hasModelPair('w_lghtsbr_005')).toBe(true);
  });
});

describe('bag colour crystals', () => {
  test('counts party-inventory colour crystals like parts', () => {
    inventory.inventory = [crystal('u_l_colo_01', 2), saber(), crystal('u_l_colo_01', 1), crystal('u_l_colo_04', 1)];
    const found = new UpgradeEnginePorts().bag().colourCrystals!();
    expect(found).toEqual([
      { part: { resref: 'u_l_colo_01', row: -1, type: COLOUR_SLOT, level: 0, name: 'name:u_l_colo_01' }, count: 3 },
      { part: { resref: 'u_l_colo_04', row: -1, type: COLOUR_SLOT, level: 0, name: 'name:u_l_colo_04' }, count: 1 },
    ]);
  });
});

describe('ModuleItem model variation', () => {
  test('save writes the new ModelVariation', () => {
    const item = saber(1, 2);
    item.setModelVariation(4);
    expect(item.getModelVariation()).toBe(4);
    expect(item.save().getFieldByLabel('ModelVariation').getValue()).toBe(4);
  });

  test('the new variation survives a template re-read (inventory addItem calls load)', () => {
    const item = saber(1, 2);
    item.setModelVariation(4);
    item.initProperties();
    expect(item.getModelVariation()).toBe(4);
    expect(item.clone().getModelVariation()).toBe(4);
  });

  test('modelResRefFor(2) on a base-8 item is w_lghtsbr_002', () => {
    expect(saber().modelResRefFor(2)).toBe('w_lghtsbr_002');
  });

  test('a recoloured saber does not stack onto a plain copy', () => {
    const plain = saber(1, 2);
    const red = saber(1, 2);
    red.setModelVariation(1);
    expect(findItemStackTarget([plain], red)).toBeUndefined();
    expect(findItemStackTarget([plain], saber(1, 2))).toBe(plain);
  });
});
