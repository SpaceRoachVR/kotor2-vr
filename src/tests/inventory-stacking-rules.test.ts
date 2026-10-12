import { describe, expect, test, jest } from '@jest/globals';

jest.mock('@/GameState', () => ({ GameState: {} }));
import { findItemStackTarget, hasItemUpgrades } from '@/managers/InventoryManager';

// Critic run 3: unequip and repeated GiveItem merged an item into itself, and
// an upgraded copy lost its upgrades into a plain stack.
const item = (tag: string, stacking: number, extra: any = {}) => ({
  getTag: () => tag,
  getBaseItem: () => ({ stacking }),
  upgradeItems: {}, upgrades: 0,
  upgradeSlot0: -1, upgradeSlot1: -1, upgradeSlot2: -1, upgradeSlot3: -1, upgradeSlot4: -1, upgradeSlot5: -1,
  ...extra,
});

describe('which held item a new one stacks onto', () => {
  test('identical stackable items stack, as retail does', () => {
    const held = [item('g_i_medeqpmnt01', 99)];
    expect(findItemStackTarget(held, item('G_I_MEDEQPMNT01', 99))).toBe(held[0]);
  });
  test('an item never stacks onto itself', () => {
    const a = item('blade', 99);
    expect(findItemStackTarget([a], a)).toBeUndefined();
  });
  test('an upgraded item stays its own entry, either way round', () => {
    const plain = item('blade', 99);
    const upgraded = item('blade', 99, { upgradeSlot1: 3 });
    expect(hasItemUpgrades(upgraded)).toBe(true);
    expect(findItemStackTarget([plain], upgraded)).toBeUndefined();
    expect(findItemStackTarget([upgraded], item('blade', 99))).toBeUndefined();
  });
  test('a base item that does not stack never merges', () => {
    expect(findItemStackTarget([item('armor', 1)], item('armor', 1))).toBeUndefined();
  });
});
