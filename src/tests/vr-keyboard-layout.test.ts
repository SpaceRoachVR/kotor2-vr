import { describe, expect, test } from '@jest/globals';
import { resolveVRKeyboardKeyAtUV } from '@/vr/runtime/VRKeyboardLayout';

describe('resolveVRKeyboardKeyAtUV', () => {
  test('maps the staggered letter rows and the single special keys', () => {
    expect(resolveVRKeyboardKeyAtUV(0.05, 0.875)).toBe('Q');
    expect(resolveVRKeyboardKeyAtUV(0.01, 0.625)).toBeNull();
    expect(resolveVRKeyboardKeyAtUV(0.1, 0.375)).toBeNull();
    expect(resolveVRKeyboardKeyAtUV(0.08, 0.125)).toBe('SHIFT');
    expect(resolveVRKeyboardKeyAtUV(0.28, 0.125)).toBe('CAPS');
    expect(resolveVRKeyboardKeyAtUV(0.5, 0.125)).toBe('SPACE');
    expect(resolveVRKeyboardKeyAtUV(0.7, 0.125)).toBe('BACKSPACE');
    expect(resolveVRKeyboardKeyAtUV(0.9, 0.125)).toBe('DONE');
  });

  test('rejects gutters and invalid ray UV coordinates', () => {
    expect(resolveVRKeyboardKeyAtUV(0.005, 0.125)).toBeNull();
    // The gutter between CAPS (ends 3.5) and SPACE (starts 3.7).
    expect(resolveVRKeyboardKeyAtUV(0.36, 0.125)).toBeNull();
    expect(resolveVRKeyboardKeyAtUV(0.995, 0.125)).toBeNull();
    expect(resolveVRKeyboardKeyAtUV(-0.1, 0.5)).toBeNull();
    expect(resolveVRKeyboardKeyAtUV(Number.NaN, 0.5)).toBeNull();
  });
});
