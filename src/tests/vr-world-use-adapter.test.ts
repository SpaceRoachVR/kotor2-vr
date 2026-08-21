import * as THREE from 'three';
import { describe, expect, jest, test } from '@jest/globals';
import { ModuleObjectType } from '@/enums/module/ModuleObjectType';
import {
  describeDirectVRWorldUse,
  VRWorldUseActor,
  VRWorldUseTarget,
  tryDirectVRWorldUse,
} from '@/vr/runtime/VRWorldUseAdapter';

describe('describeDirectVRWorldUse', () => {
  test('describes an in-range console without using it', () => {
    const target = placeable('Galaxy Map', 1.5);

    const descriptor = describeDirectVRWorldUse(actor(), target, quietLogger);

    expect(descriptor).toEqual(expect.objectContaining({
      id: 'direct-use:42',
      label: 'Use: Galaxy Map',
    }));
    expect(target.use).not.toHaveBeenCalled();
    expect(descriptor!.revalidate()).toBe(true);
    expect(descriptor!.activate()).toEqual({
      handled: true,
      feedbackLabel: 'Use: Galaxy Map',
    });
    expect(target.use).toHaveBeenCalledTimes(1);
  });

  test('returns null for unsupported or out-of-range direct-use targets', () => {
    expect(describeDirectVRWorldUse(actor(), creature(), quietLogger)).toBeNull();
    expect(describeDirectVRWorldUse(actor(), placeable('Far', 1.5001), quietLogger)).toBeNull();
  });

  test('revalidates the live range without mutating either engine object', () => {
    const activeActor = actor();
    const target = placeable('Console', 1);
    const descriptor = describeDirectVRWorldUse(activeActor, target, quietLogger)!;

    target.position.set(1.5001, 0, 0);

    expect(descriptor.revalidate()).toBe(false);
    expect(target.use).not.toHaveBeenCalled();
    expect(activeActor.position.toArray()).toEqual([0, 0, 0]);
  });
});

describe('tryDirectVRWorldUse', () => {
  test.each([
    ['door', ModuleObjectType.ModuleDoor, 2],
    ['terminal', ModuleObjectType.ModulePlaceable, 1.5],
    ['container', ModuleObjectType.ModulePlaceable, 1.5],
    ['galaxy map', ModuleObjectType.ModulePlaceable, 1.5],
  ])('uses an in-range %s directly without a walk action', (_name, objectType, range) => {
    const actor = { id: 7, position: new THREE.Vector3() };
    const target = {
      id: 42,
      objectType,
      position: new THREE.Vector3(range, 0, 0),
      getName: () => 'Target',
      use: jest.fn(),
    };

    const result = tryDirectVRWorldUse(actor, target, quietLogger);

    expect(result).toEqual({ handled: true, feedbackLabel: 'Use: Target' });
    expect(target.use).toHaveBeenCalledTimes(1);
    expect(target.use).toHaveBeenCalledWith(actor);
  });

  test('blocks out-of-range direct use without moving the player', () => {
    const actor = { id: 7, position: new THREE.Vector3() };
    const target = {
      id: 42,
      objectType: ModuleObjectType.ModulePlaceable,
      position: new THREE.Vector3(1.5001, 0, 0),
      getName: () => 'Galaxy Map',
      use: jest.fn(),
    };

    const result = tryDirectVRWorldUse(actor, target, quietLogger);

    expect(result).toEqual({ handled: true, feedbackLabel: 'Galaxy Map: Move closer' });
    expect(target.use).not.toHaveBeenCalled();
    expect(actor.position.toArray()).toEqual([0, 0, 0]);
  });

  test('leaves unsupported targets for the authored contextual action panel', () => {
    const target = {
      id: 42,
      objectType: ModuleObjectType.ModuleCreature,
      position: new THREE.Vector3(),
      use: jest.fn(),
    };

    expect(tryDirectVRWorldUse({ id: 7, position: new THREE.Vector3() }, target, quietLogger))
      .toEqual({ handled: false });
    expect(target.use).not.toHaveBeenCalled();
  });
});

const quietLogger = { info: (): void => undefined, error: (): void => undefined };

function actor(): VRWorldUseActor {
  return { id: 7, position: new THREE.Vector3() };
}

function placeable(name: string, distance: number): VRWorldUseTarget & { use: jest.Mock } {
  return {
    id: 42,
    objectType: ModuleObjectType.ModulePlaceable,
    position: new THREE.Vector3(distance, 0, 0),
    getName: () => name,
    use: jest.fn(),
  };
}

function creature(): VRWorldUseTarget & { use: jest.Mock } {
  return {
    id: 43,
    objectType: ModuleObjectType.ModuleCreature,
    position: new THREE.Vector3(),
    getName: () => 'Creature',
    use: jest.fn(),
  };
}
