import { beforeEach, expect, jest, test } from '@jest/globals';

jest.mock('@/GameState', () => ({ GameState: {
  Module: { ModuleArea: {} },
  PartyManager: { AddGold: jest.fn() },
  PazaakManager: { AddCard: jest.fn() },
  UINotificationManager: { EnableUINotificationIconType: jest.fn() },
} }));
jest.mock('@/engine/CurrentGame', () => ({ CurrentGame: {} }));

import { GameState } from '@/GameState';
import { InventoryManager } from '@/managers/InventoryManager';
import { BaseItemType } from '@/enums/combat/BaseItemType';
import type { ModuleItem } from '@/module';

class TransferredItem {
  constructor(public stackSize: number, public baseItemId = -1) {}
  initProperties() { this.stackSize = 1; }
  load() { this.stackSize = 1; return true; }
  getStackSize() { return this.stackSize; }
  setStackSize(value: number) { this.stackSize = value; }
  getBaseItemId() { return this.baseItemId; }
  getTag() { return 'parts'; }
  getModelVariation() { return 0; }
  // Parts stack (baseitems.2da stacking 99); findItemStackTarget checks it.
  getBaseItem() { return { stacking: 99 }; }
}

beforeEach(() => {
  GameState.Module.ModuleArea.ModuleItem = TransferredItem as unknown as typeof GameState.Module.ModuleArea.ModuleItem;
  InventoryManager.inventory = [];
  jest.clearAllMocks();
});

test('container stacks retain their live quantity through template initialization and load', () => {
  const item = new TransferredItem(3) as unknown as ModuleItem;
  expect(InventoryManager.addItem(item)).toBe(item);
  expect(item.getStackSize()).toBe(3);
  expect(InventoryManager.inventory).toEqual([item]);
  const another = new TransferredItem(4) as unknown as ModuleItem;
  expect(InventoryManager.addItem(another)).toBe(item);
  expect(item.getStackSize()).toBe(7);
  expect(InventoryManager.inventory).toHaveLength(1);
});

test('limitOne still transfers exactly one unit', () => {
  const item = new TransferredItem(3) as unknown as ModuleItem;
  InventoryManager.addItem(item, true);
  expect(item.getStackSize()).toBe(1);
  InventoryManager.addItem(new TransferredItem(4) as unknown as ModuleItem, true);
  expect(item.getStackSize()).toBe(2);
});

test('credits preserve the existing stack before currency conversion', () => {
  InventoryManager.addItem(new TransferredItem(50, BaseItemType.CREDITS) as unknown as ModuleItem);
  expect(GameState.PartyManager.AddGold).toHaveBeenCalledWith(50);
  expect(InventoryManager.inventory).toEqual([]);
});

test.each([0, -1, NaN, Infinity, 1.5])('invalid transferred quantity %s fails before mutation', (quantity) => {
  const item = new TransferredItem(quantity) as unknown as ModuleItem;
  expect(() => InventoryManager.addItem(item)).toThrow('positive integer stack size');
  expect(InventoryManager.inventory).toEqual([]);
  expect(item.getStackSize()).toBe(quantity);
});
