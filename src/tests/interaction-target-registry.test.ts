import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import {
  InteractionTarget,
  InteractionTargetRegistry,
} from '@/vr/runtime/InteractionTargetRegistry';

describe('InteractionTargetRegistry', () => {
  test('resolves the nearest available target intersected by a controller ray', () => {
    const registry = new InteractionTargetRegistry();
    registry.register(target('far', [0, 0, -4], 0.25));
    registry.register(target('near', [0, 0, -2], 0.25));
    registry.register(target('off-axis', [1, 0, -1], 0.1));
    registry.register(target('disabled', [0, 0, -1], 0.25, false));

    const result = registry.resolveRay(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
      10
    );

    expect(result?.target.id).toBe('near');
    expect(result?.distanceMetres).toBeCloseTo(1.75);
    expect(result?.hitPoint.toArray()).toEqual([0, 0, -1.75]);
    expect(result?.interactionMode).toBe('ray');
  });

  test('resolves near-touch by surface distance rather than target-center distance', () => {
    const registry = new InteractionTargetRegistry();
    registry.register(target('large', [0.7, 0, 0], 0.4));
    registry.register(target('small', [0.4, 0, 0], 0.05));

    const result = registry.resolveNear(new THREE.Vector3(0, 0, 0), 0.32);

    expect(result?.target.id).toBe('large');
    expect(result?.distanceMetres).toBeCloseTo(0.3);
    expect(result?.hitPoint.x).toBeCloseTo(0.3);
    expect(result?.hitPoint.y).toBe(0);
    expect(result?.hitPoint.z).toBe(0);
    expect(result?.interactionMode).toBe('near-touch');
  });

  test('rejects invalid or duplicate registrations and removes unregistered targets', () => {
    const registry = new InteractionTargetRegistry();
    const registeredTarget = target('door', [0, 0, -2], 0.25);
    registry.register(registeredTarget);

    expect(() => registry.register(registeredTarget)).toThrow('already registered');
    expect(() => registry.register(target('', [0, 0, -1], 0.25))).toThrow(
      'target id must be a non-empty string'
    );
    expect(() => registry.resolveRay(
      new THREE.Vector3(),
      new THREE.Vector3(),
      10
    )).toThrow('ray direction must be finite and non-zero');

    expect(registry.unregister('door')).toBe(true);
    expect(registry.resolveRay(
      new THREE.Vector3(),
      new THREE.Vector3(0, 0, -1),
      10
    )).toBeNull();
  });
});

function target(
  id: string,
  position: readonly [number, number, number],
  radiusMetres: number,
  available = true
): InteractionTarget {
  return {
    id,
    radiusMetres,
    interactionModes: ['near-touch', 'ray'],
    getWorldPosition: (output: THREE.Vector3): THREE.Vector3 =>
      output.set(position[0], position[1], position[2]),
    isAvailable: () => available,
    activate: (): void => undefined,
  };
}
