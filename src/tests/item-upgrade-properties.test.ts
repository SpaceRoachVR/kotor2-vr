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

const datatables = new Map<string, any>([
  ['upgrade', { rows: {
    [PART_ROW]: { __index: PART_ROW, label: 'Targeting_Test', template: PART_RESREF, upgradetype: '4' },
    20: { __index: 20, label: 'No_Template', template: '****', upgradetype: '4' },
    21: { __index: 21, label: 'Missing_UTI', template: 'u_missing_99', upgradetype: '4' },
  } }],
  ['iprp_bonuscost', { rows: { 0: { value: '0' }, 1: { value: '1' }, 2: { value: '2' }, 3: { value: '3' } } }],
]);

jest.mock('@/GameState', () => ({ GameState: {
  ModuleObjectManager: { AddObjectById: () => {} },
  SWRuleSet: {
    itemPropsDef: {
      1: { hasSubType: () => false },
      38: { hasSubType: () => false },
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

function propertyStruct(name: number, costValue: number, upgradeType?: number): GFFStruct {
  const s = new GFFStruct(0);
  s.addField(new GFFField(GFFDataType.WORD, 'PropertyName')).setValue(name);
  s.addField(new GFFField(GFFDataType.WORD, 'Subtype')).setValue(0);
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

let item: ModuleItem;
let own: { propertyName: number };

beforeEach(() => {
  (GameState as any).TwoDAManager.datatables = datatables;
  jest.restoreAllMocks();
  jest.spyOn(ResourceLoader, 'loadCachedResource').mockImplementation(((type: number, resref: string) =>
    resref === PART_RESREF ? partBuffer : null) as any);
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
