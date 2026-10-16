import { describe, expect, test } from '@jest/globals';
import { COLOUR_SLOT } from '@/game/tsl/crafting/UpgradeRules';
import { fittedListHeight, hiddenInLayout, offersRemove, slotControlNames, slotNameText } from '@/game/tsl/menu/UpgradeLayout';

describe('UpgradeLayout', () => {
  test('slot control order', () => {
    expect(slotControlNames('standard')).toEqual(['31', '32', '33']);
    expect(slotControlNames('lightsaber')).toEqual(['31_LS', '32_LS', '33_LS', '34_LS', '35_LS', '36_LS']);
  });

  test('hidden controls per layout', () => {
    expect(hiddenInLayout('_3D_MODEL', 'standard')).toBe(true);
    expect(hiddenInLayout('_3D_MODEL', 'lightsaber')).toBe(true);
    expect(hiddenInLayout('_3D_MODEL_LS', 'standard')).toBe(true);
    expect(hiddenInLayout('_3D_MODEL_LS', 'lightsaber')).toBe(false);
    expect(hiddenInLayout('BTN_UPGRADE31_LS', 'standard')).toBe(true);
    expect(hiddenInLayout('LBL_UPGRADE36_LS', 'lightsaber')).toBe(false);
    expect(hiddenInLayout('BTN_UPGRADE31', 'lightsaber')).toBe(true);
    expect(hiddenInLayout('LBL_UPGRADE33', 'standard')).toBe(false);
    expect(hiddenInLayout('BTN_ASSEMBLE', 'lightsaber')).toBe(false);
  });

  test('list height ends above the topmost overlapped button', () => {
    const list = { left: 10, top: 100, width: 200, height: 300 };
    const a = { left: 100, top: 127, width: 64, height: 64 };
    const b = { left: 100, top: 275, width: 64, height: 64 };
    expect(fittedListHeight(list, [b, a], 6)).toBe(21);
    expect(fittedListHeight(list, [{ ...a, left: 300 }], 6)).toBe(300);
    expect(fittedListHeight(list, [{ ...a, top: 500 }], 6)).toBe(300);
    expect(fittedListHeight(list, [{ ...a, top: 80, height: 10 }], 6)).toBe(300);
  });

  test('standard layout cuts at the reference button without an overlap test', () => {
    const list = { left: 10, top: 100, width: 50, height: 300 };
    expect(fittedListHeight(list, [{ left: 115, top: 275, width: 64, height: 64 }], 6, true)).toBe(169);
  });

  test('colour slot has no Remove row and an Unknown name', () => {
    expect(offersRemove(COLOUR_SLOT, true)).toBe(false);
    expect(offersRemove(0, true)).toBe(true);
    expect(offersRemove(0, false)).toBe(false);
    expect(slotNameText(COLOUR_SLOT, undefined, 'Empty')).toBe('Colour Crystal: Unknown');
    expect(slotNameText(COLOUR_SLOT, 'Blue Crystal', 'Empty')).toBe('Colour Crystal: Blue Crystal');
    expect(slotNameText(0, undefined, 'Empty')).toBe('Crystal: Empty');
  });
});
