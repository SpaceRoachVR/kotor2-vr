import { expect, jest, test } from '@jest/globals';
import { transferPlaceableInventory } from '@/module/PlaceableInventoryTransfer';

test('transfers each placeable stack exactly once', () => {
  const stackedParts = { tag: 'parts', stackSize: 3 };
  const minorMine = { tag: 'minor_frag_mine', stackSize: 1 };
  const inventory = [stackedParts, minorMine];
  const addItem = jest.fn();

  transferPlaceableInventory(inventory, addItem);

  expect(addItem).toHaveBeenCalledTimes(2);
  expect(addItem).toHaveBeenNthCalledWith(1, minorMine);
  expect(addItem).toHaveBeenNthCalledWith(2, stackedParts);
  expect(inventory).toEqual([]);
});

test('does not discard an item when the destination rejects it', () => {
  const stackedParts = { tag: 'parts', stackSize: 3 };
  const inventory = [stackedParts];
  const addItem = jest.fn(() => { throw new Error('inventory full'); });

  expect(() => transferPlaceableInventory(inventory, addItem)).toThrow('inventory full');
  expect(inventory).toEqual([stackedParts]);
});

test('validates transfer inputs', () => {
  expect(() => transferPlaceableInventory(null as unknown as [], jest.fn())).toThrow('must be an array');
  expect(() => transferPlaceableInventory([], null as unknown as (item: never) => void)).toThrow('must be a function');
});
