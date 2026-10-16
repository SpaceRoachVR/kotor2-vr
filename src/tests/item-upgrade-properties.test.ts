import { beforeEach, describe, expect, jest, test } from '@jest/globals';

/**
 * TSL upgrade parts installed in an item (UpgradeSlot0..5, rows into
 * upgrade.2da) contribute their UTI's properties while installed, without
 * touching the item's own PropertiesList. See
 * docs/superpowers/specs/2026-10-15-upgrade-screen-design.md.
 */

const PART_RESREF = 'g_i_upgrade001';
const PART_ROW = 16;
const PART_ATTACK = 2;
const WEAK_PART_RESREF = 'u_r_targ_weak';
const WEAK_PART_ROW = 17;
const DAMAGE_PART_RESREF = 'u_r_firi_dmg';
const DAMAGE_PART_ROW = 18;

const datatables = new Map<string, any>([
  ['upgrade', { rows: {
    [PART_ROW]: { __index: PART_ROW, label: 'Targeting_Test', template: PART_RESREF, upgradetype: '4' },
    20: { __index: 20, label: 'No_Template', template: '****', upgradetype: '4' },
    21: { __index: 21, label: 'Missing_UTI', template: 'u_missing_99', upgradetype: '4' },
    [WEAK_PART_ROW]: { __index: WEAK_PART_ROW, label: 'Targeting_Weak', template: WEAK_PART_RESREF, upgradetype: '4' },
    [DAMAGE_PART_ROW]: { __index: DAMAGE_PART_ROW, label: 'Chamber_Damage', template: DAMAGE_PART_RESREF, upgradetype: '6' },
  } }],
  ['iprp_damagetype', { rows: {
    0: { __index: 0, name: '-1', label: 'Bludgeoning' },
    1: { __index: 1, name: '-1', label: 'Piercing' },
    2: { __index: 2, name: '-1', label: 'Slashing' },
    5: { __index: 5, name: '-1', label: 'Energy' },
  } }],
  ['iprp_bonuscost', { rows: { 0: { value: '0' }, 1: { value: '1' }, 2: { value: '2' }, 3: { value: '3' } } }],
]);

jest.mock('@/GameState', () => ({ GameState: {
  ModuleObjectManager: { AddObjectById: () => {} },
  SWRuleSet: {
    itemPropsDef: {
      1: { hasSubType: () => false },
      38: { hasSubType: () => false },
      11: { hasSubType: () => true, subtyperesref: 'iprp_damagetype' },
    },
    costTables: { 1: { name: 'iprp_bonuscost' } },
    weaponSounds: [] as unknown[],
  },
  TwoDAManager: { datatables: undefined as any },
} }));

import { GameState } from '@/GameState';
import { ResourceLoader } from '@/loaders';
import { ModuleItem } from '@/module/ModuleItem';
import { GFFObject } from '@/resource/GFFObject';
import { GFFStruct } from '@/resource/GFFStruct';
import { GFFField } from '@/resource/GFFField';
import { GFFDataType } from '@/enums/resource/GFFDataType';
import { CombatAttackData } from '@/combat/CombatAttackData';

function propertyStruct(name: number, costValue: number, upgradeType?: number, subType = 0): GFFStruct {
  const s = new GFFStruct(0);
  s.addField(new GFFField(GFFDataType.WORD, 'PropertyName')).setValue(name);
  s.addField(new GFFField(GFFDataType.WORD, 'Subtype')).setValue(subType);
  s.addField(new GFFField(GFFDataType.BYTE, 'CostTable')).setValue(1);
  s.addField(new GFFField(GFFDataType.WORD, 'CostValue')).setValue(costValue);
  s.addField(new GFFField(GFFDataType.BYTE, 'Param1')).setValue(255);
  s.addField(new GFFField(GFFDataType.BYTE, 'ChanceAppear')).setValue(100);
  if (upgradeType !== undefined) s.addField(new GFFField(GFFDataType.BYTE, 'UpgradeType')).setValue(upgradeType);
  return s;
}

function template(props: GFFStruct[], extra: (g: GFFObject) => void = () => {}): GFFObject {
  const gff = new GFFObject();
  gff.RootNode.addField(new GFFField(GFFDataType.CEXOSTRING, 'Tag')).setValue('test_item');
  gff.RootNode.addField(new GFFField(GFFDataType.BYTE, 'UpgradeLevel')).setValue(3);
  const list = gff.RootNode.addField(new GFFField(GFFDataType.LIST, 'PropertiesList'));
  for (const p of props) list.addChildStruct(p);
  extra(gff);
  return gff;
}

// The part's UTI: one Attack Bonus +2 property. Its UpgradeType 3 names a K1
// upgrade bit the blaster's `Upgrades` bitmask does not have; installed TSL
// parts' properties must count anyway.
const partBuffer = template([propertyStruct(38, PART_ATTACK, 3)]).getExportBuffer();
// Attack Bonus +1, and Damage +3 Energy (subtype 5).
const weakPartBuffer = template([propertyStruct(38, 1)]).getExportBuffer();
const damagePartBuffer = template([propertyStruct(11, 3, undefined, 5)]).getExportBuffer();
const PART_BUFFERS: Record<string, Uint8Array> = {
  [PART_RESREF]: partBuffer,
  [WEAK_PART_RESREF]: weakPartBuffer,
  [DAMAGE_PART_RESREF]: damagePartBuffer,
};

let item: ModuleItem;
let own: { propertyName: number };

beforeEach(() => {
  (GameState as any).TwoDAManager.datatables = datatables;
  jest.restoreAllMocks();
  jest.spyOn(ResourceLoader, 'loadCachedResource').mockImplementation(((type: number, resref: string) =>
    PART_BUFFERS[resref] ?? null) as any);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  item = new ModuleItem(template([propertyStruct(1, 1)]));
  item.initProperties();
  own = item.properties[0];
});

describe('installed upgrade parts', () => {
  test('an installed part adds its properties', () => {
    item.setUpgradeSlot(0, PART_ROW);
    expect(item.getUpgradeSlot(0)).toBe(PART_ROW);
    expect(item.getEffectiveProperties().map(p => p.propertyName)).toEqual([own.propertyName, 38]);
    expect(item.getUpgradeProperties().every(p => p.isUseable())).toBe(true);
    // The item's own list is never modified by upgrading.
    expect(item.properties.map(p => p.propertyName)).toEqual([own.propertyName]);
  });

  test('removing the part drops its properties', () => {
    item.setUpgradeSlot(0, PART_ROW);
    item.setUpgradeSlot(0, -1);
    expect(item.getUpgradeProperties()).toEqual([]);
    expect(item.getEffectiveProperties().map(p => p.propertyName)).toEqual([own.propertyName]);
  });

  test('save writes the slot', () => {
    item.setUpgradeSlot(1, PART_ROW);
    expect(item.save().getFieldByLabel('UpgradeSlot1').getValue()).toBe(PART_ROW);
  });

  test('save writes an updated slot on an item whose template already had the field', () => {
    const preset = new ModuleItem(template([], g => {
      g.RootNode.addField(new GFFField(GFFDataType.INT, 'UpgradeSlot0')).setValue(-1);
    }));
    preset.initProperties();
    preset.setUpgradeSlot(0, PART_ROW);
    expect(preset.save().getFieldByLabel('UpgradeSlot0').getValue()).toBe(PART_ROW);
  });

  test('a slot loaded from the template contributes its part', () => {
    const loaded = new ModuleItem(template([], g => {
      g.RootNode.addField(new GFFField(GFFDataType.INT, 'UpgradeSlot0')).setValue(PART_ROW);
    }));
    loaded.initProperties();
    expect(loaded.getUpgradeProperties().map(p => p.propertyName)).toEqual([38]);
  });

  test('a row with no template contributes nothing', () => {
    item.setUpgradeSlot(0, 999);
    expect(item.getUpgradeProperties()).toEqual([]);
    item.setUpgradeSlot(0, 20);
    expect(item.getUpgradeProperties()).toEqual([]);
  });

  test('a row whose UTI does not load contributes nothing and logs once', () => {
    const warn = console.warn as unknown as jest.Mock;
    warn.mockClear();
    item.setUpgradeSlot(0, 21);
    expect(item.getUpgradeProperties()).toEqual([]);
    item.setUpgradeSlot(1, 21);
    expect(item.getUpgradeProperties()).toEqual([]);
    expect(warn.mock.calls.filter(c => String(c[0]).includes('u_missing_99'))).toHaveLength(1);
  });

  test('upgrade properties are cached per slot state', () => {
    item.setUpgradeSlot(0, PART_ROW);
    const first = item.getUpgradeProperties();
    expect(item.getUpgradeProperties()).toBe(first);
    item.setUpgradeSlot(1, PART_ROW);
    expect(item.getUpgradeProperties()).not.toBe(first);
    expect(item.getUpgradeProperties()).toHaveLength(2);
  });

  test('getUpgradeLevel reads UpgradeLevel', () => {
    expect(item.getUpgradeLevel()).toBe(3);
    const plain = new ModuleItem(new GFFObject());
    plain.initProperties();
    expect(plain.getUpgradeLevel()).toBe(0);
  });

  test('a stat getter counts the part: getAttackBonus rises by the part\'s +2', () => {
    // getAttackBonus is what ModuleCreature's attack roll reads for the weapon.
    const before = item.getAttackBonus();
    item.setUpgradeSlot(0, PART_ROW);
    expect(item.getAttackBonus()).toBe(before + PART_ATTACK);
  });
});

function weapon(props: GFFStruct[]): ModuleItem {
  const w = new ModuleItem(template(props));
  w.initProperties();
  return w;
}

describe('same-kind bonuses: the highest applies (ruling R5)', () => {
  test('own Attack +1 and a +2 part give +2', () => {
    const w = weapon([propertyStruct(38, 1)]);
    expect(w.getAttackBonus()).toBe(1);
    w.setUpgradeSlot(0, PART_ROW);
    expect(w.getAttackBonus()).toBe(2);
  });

  test('own Attack +2 and a +1 part give +2', () => {
    const w = weapon([propertyStruct(38, 2)]);
    w.setUpgradeSlot(0, WEAK_PART_ROW);
    expect(w.getAttackBonus()).toBe(2);
  });

  test('a part adding a second damage type: both types apply', () => {
    const w = weapon([propertyStruct(11, 2, undefined, 1)]);
    expect(w.getDamageBonuses()).toEqual([{ type: 1, value: 2 }]);
    w.setUpgradeSlot(1, DAMAGE_PART_ROW);
    expect(w.getDamageBonuses()).toEqual([{ type: 1, value: 2 }, { type: 5, value: 3 }]);

    // And combat adds each type to its own damage bucket.
    const attack = Object.create(CombatAttackData.prototype) as any;
    const buckets: Record<number, number> = {};
    attack.attackWeapon = w;
    attack.damageList = new Proxy({}, { get: (_t, key) => ({
      addDamage: (n: number) => { buckets[Number(key)] = (buckets[Number(key)] ?? 0) + n; },
    }) });
    attack.applyWeaponDamageBonuses(1);
    expect(buckets).toEqual({ 1: 2, 5: 3 });
  });

  test('within one damage type the highest value applies', () => {
    const w = weapon([propertyStruct(11, 1, undefined, 5)]);
    w.setUpgradeSlot(1, DAMAGE_PART_ROW);
    expect(w.getDamageBonuses()).toEqual([{ type: 5, value: 3 }]);
  });

  test('an item with no upgrades keeps its values', () => {
    const w = weapon([propertyStruct(38, 1), propertyStruct(11, 2, undefined, 1)]);
    expect(w.getAttackBonus()).toBe(1);
    expect(w.getDamageBonus()).toBe(2);
    expect(w.getDamageBonusType()).toBe(1);
    expect(w.getDamageBonuses()).toEqual([{ type: 1, value: 2 }]);
    expect(w.getSTRBonus()).toBe(0);
    const bare = weapon([]);
    expect(bare.getAttackBonus()).toBe(0);
    expect(bare.getDamageBonuses()).toEqual([]);
  });
});

describe('hot path and slot field type', () => {
  test('the effective list is reused between calls', () => {
    expect(item.getEffectiveProperties()).toBe(item.properties);
    item.setUpgradeSlot(0, PART_ROW);
    const merged = item.getEffectiveProperties();
    expect(item.getEffectiveProperties()).toBe(merged);
    item.setUpgradeSlot(0, -1);
    expect(item.getEffectiveProperties()).toBe(item.properties);
  });

  test('a slot assigned directly still invalidates the cache', () => {
    item.getUpgradeProperties();
    item.upgradeSlot2 = PART_ROW;
    expect(item.getUpgradeProperties().map(p => p.propertyName)).toEqual([38]);
  });

  test('a non-INT UpgradeSlot field is replaced by an INT so -1 does not wrap', () => {
    const byteSlot = new ModuleItem(template([], g => {
      g.RootNode.addField(new GFFField(GFFDataType.BYTE, 'UpgradeSlot0')).setValue(PART_ROW);
    }));
    byteSlot.initProperties();
    byteSlot.setUpgradeSlot(0, -1);
    const field = byteSlot.save().getFieldByLabel('UpgradeSlot0');
    expect(field.getType()).toBe(GFFDataType.INT);
    expect(field.getValue()).toBe(-1);
    expect(byteSlot.template.RootNode.fields.filter((f: any) => f.label === 'UpgradeSlot0')).toHaveLength(1);
  });
});
