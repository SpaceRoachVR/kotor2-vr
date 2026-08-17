import { describe, expect, test } from '@jest/globals';
import { VRSnapTurnController } from '@/vr/runtime/VRSnapTurnController';

describe('VRSnapTurnController', () => {
  test('fires one fixed increment per deflection and re-arms only after returning to center', () => {
    const controller = new VRSnapTurnController({
      engageThreshold: 0.7,
      resetThreshold: 0.3,
    });

    expect(controller.process(0)).toBe(0);
    expect(controller.process(0.9)).toBeCloseTo(Math.PI / 4);
    // Held past engage but not yet reset — must not fire again.
    expect(controller.process(0.9)).toBe(0);
    expect(controller.process(0.85)).toBe(0);
    // Still above reset threshold — still must not re-arm.
    expect(controller.process(0.5)).toBe(0);
    // Falls under reset threshold — re-armed, but no fire until re-engaged.
    expect(controller.process(0.1)).toBe(0);
    expect(controller.process(-0.9)).toBeCloseTo(-Math.PI / 4);
  });

  test('does not fire below the engage threshold', () => {
    const controller = new VRSnapTurnController({ engageThreshold: 0.7, resetThreshold: 0.3 });
    expect(controller.process(0.5)).toBe(0);
  });

  test('reset() re-arms immediately regardless of prior state', () => {
    const controller = new VRSnapTurnController({ engageThreshold: 0.7, resetThreshold: 0.3 });
    controller.process(0.9);
    controller.reset();
    expect(controller.process(0.9)).not.toBe(0);
  });

  test('rejects a non-finite axis value', () => {
    const controller = new VRSnapTurnController();
    expect(() => controller.process(Number.NaN)).toThrow(TypeError);
  });

  test('rejects an invalid configuration', () => {
    expect(() => new VRSnapTurnController({ engageThreshold: 1.5 })).toThrow(RangeError);
    expect(() => new VRSnapTurnController({ resetThreshold: 0.9, engageThreshold: 0.7 })).toThrow(RangeError);
  });

  test('rejects a non-finite or non-positive increment', () => {
    const controller = new VRSnapTurnController({ engageThreshold: 0.7, resetThreshold: 0.3 });
    expect(() => controller.process(0.9, Number.NaN)).toThrow(RangeError);
    expect(() => controller.process(0.9, 0)).toThrow(RangeError);
  });
});
