import { describe, expect, test } from '@jest/globals';
import { resolveVRKeyboardKeyAtUV } from '@/vr/runtime/VRKeyboardLayout';

describe('resolveVRKeyboardKeyAtUV', () => {
  test('maps the staggered letter rows and the single special keys', () => {
    expect(resolveVRKeyboardKeyAtUV(0.05, 0.875)).toBe('Q');
    expect(resolveVRKeyboardKeyAtUV(0.01, 0.625)).toBeNull();
    expect(resolveVRKeyboardKeyAtUV(0.1, 0.375)).toBeNull();
    expect(resolveVRKeyboardKeyAtUV(0.25, 0.125)).toBe('SPACE');
    expect(resolveVRKeyboardKeyAtUV(0.8, 0.125)).toBe('BACKSPACE');
  });

  test('rejects gutters and invalid ray UV coordinates', () => {
    expect(resolveVRKeyboardKeyAtUV(0.01, 0.125)).toBeNull();
    expect(resolveVRKeyboardKeyAtUV(0.95, 0.125)).toBeNull();
    expect(resolveVRKeyboardKeyAtUV(-0.1, 0.5)).toBeNull();
    expect(resolveVRKeyboardKeyAtUV(Number.NaN, 0.5)).toBeNull();
  });
});
