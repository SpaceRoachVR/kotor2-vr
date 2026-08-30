import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { VRTeleportController } from '@/vr/runtime/VRTeleportController';

describe('VRTeleportController', () => {
  test('aims while deflected and commits once on release', () => {
    const controller = new VRTeleportController({ engageThreshold: 0.5 });

    expect(controller.process(new THREE.Vector2(0, 0))).toEqual({ phase: 'idle', direction: null });

    const aiming = controller.process(new THREE.Vector2(0, 1));
    expect(aiming.phase).toBe('aiming');
    expect(aiming.direction!.x).toBeCloseTo(0);
    expect(aiming.direction!.y).toBeCloseTo(1);

    const committed = controller.process(new THREE.Vector2(0, 0));
    expect(committed.phase).toBe('committed');
    expect(committed.direction!.y).toBeCloseTo(1);

    // A second release with nothing aimed must not re-commit.
    expect(controller.process(new THREE.Vector2(0, 0))).toEqual({ phase: 'idle', direction: null });
  });

  test('normalizes the committed direction regardless of stick magnitude', () => {
    const controller = new VRTeleportController({ engageThreshold: 0.5 });
    controller.process(new THREE.Vector2(3, 4));
    const committed = controller.process(new THREE.Vector2(0, 0));
    expect(committed.direction!.length()).toBeCloseTo(1);
  });

  test('reset() clears in-progress aim without committing', () => {
    const controller = new VRTeleportController({ engageThreshold: 0.5 });
    controller.process(new THREE.Vector2(1, 0));
    controller.reset();
    expect(controller.process(new THREE.Vector2(0, 0))).toEqual({ phase: 'idle', direction: null });
  });

  test('rejects non-finite stick input', () => {
    const controller = new VRTeleportController();
    expect(() => controller.process(new THREE.Vector2(Number.NaN, 0))).toThrow(TypeError);
  });

  test('rejects an invalid configuration', () => {
    expect(() => new VRTeleportController({ engageThreshold: 0 })).toThrow(RangeError);
    expect(() => new VRTeleportController({ maxDistanceMetres: -1 })).toThrow(RangeError);
  });
});
