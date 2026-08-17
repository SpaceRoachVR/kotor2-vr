import * as THREE from 'three';
import { describe, expect, jest, test } from '@jest/globals';
import {
  CreatureLocomotionAdapter,
  CreatureLocomotionTarget,
} from '@/vr/runtime/CreatureLocomotionAdapter';
import { ResolvedLocomotion } from '@/vr/runtime/LocomotionController';

function locomotion(overrides: Partial<ResolvedLocomotion> = {}): ResolvedLocomotion {
  return {
    worldDirection: new THREE.Vector2(0, 1),
    magnitude: 1,
    bodyFacing: 0,
    headFacing: 0,
    turn: 0,
    turnDeltaRadians: 0,
    mode: 'smooth',
    ...overrides,
  };
}

function target(canMove = true): CreatureLocomotionTarget {
  return {
    force: 0,
    controlled: false,
    canMove: jest.fn(() => canMove),
    clearAllActions: jest.fn(),
    setFacing: jest.fn(),
  };
}

describe('CreatureLocomotionAdapter', () => {
  test('uses the same full movement force as keyboard W after stick dead-zone acceptance', () => {
    const adapter = new CreatureLocomotionAdapter(Math.PI * 3);
    const creature = target();

    expect(adapter.apply(creature, locomotion({ magnitude: 0.7 }))).toBe(true);
    expect(creature.clearAllActions).toHaveBeenCalledWith(true);
    expect(creature.force).toBe(1);
    expect(creature.setFacing).toHaveBeenCalledWith(0, false, Math.PI * 3);
    expect(creature.controlled).toBe(true);
  });

  test('applies rate-limited head yaw directly while stationary', () => {
    const adapter = new CreatureLocomotionAdapter(Math.PI * 3);
    const creature = target();

    adapter.apply(creature, locomotion({ magnitude: 0, bodyFacing: 0.4 }));

    expect(creature.clearAllActions).not.toHaveBeenCalled();
    expect(creature.setFacing).toHaveBeenCalledWith(0.4, true);
  });

  test('does not override an immobilized creature', () => {
    const adapter = new CreatureLocomotionAdapter(Math.PI * 3);
    const creature = target(false);

    expect(adapter.apply(creature, locomotion())).toBe(false);
    expect(creature.setFacing).not.toHaveBeenCalled();
  });

  test('rejects a zero movement vector', () => {
    expect(() => CreatureLocomotionAdapter.directionToCreatureFacing(0, 0)).toThrow(
      'finite and non-zero'
    );
  });
});
