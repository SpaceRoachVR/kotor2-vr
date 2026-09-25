import * as THREE from 'three';
import { describe, expect, jest, test } from '@jest/globals';
import { ModuleObjectType } from '@/enums/module/ModuleObjectType';
import {
  describeDirectVRWorldUse,
  VRWorldUseActor,
  VRWorldUseTarget,
  tryDirectVRWorldUse,
  getVRInteractionRange,
} from '@/vr/runtime/VRWorldUseAdapter';
import { activateSelectedObject } from '@/engine/interaction/SelectedObjectActivation';

// Derived from the adapter's own ranges so tuning them does not require
// editing every distance literal in this file.
const PLACEABLE_RANGE = getVRInteractionRange(ModuleObjectType.ModulePlaceable);
const DOOR_RANGE = getVRInteractionRange(ModuleObjectType.ModuleDoor);
const JUST_OUTSIDE = 0.0001;

describe('describeDirectVRWorldUse', () => {
  test('describes an in-range console without activating it', () => {
    const target = placeable('Galaxy Map', PLACEABLE_RANGE);

    const descriptor = describeDirectVRWorldUse(actor(), target, quietLogger);

    expect(descriptor).toEqual(expect.objectContaining({
      id: 'direct-use:42',
      label: 'Use: Galaxy Map',
    }));
    expect(target.onClick).not.toHaveBeenCalled();
    expect(descriptor!.revalidate()).toBe(true);
    expect(descriptor!.activate()).toEqual({
      handled: true,
      feedbackLabel: 'Use: Galaxy Map',
    });
    expect(target.onClick).toHaveBeenCalledTimes(1);
  });

  test('returns null for unsupported or out-of-range direct-use targets', () => {
    expect(describeDirectVRWorldUse(actor(), creature(), quietLogger)).toBeNull();
    expect(describeDirectVRWorldUse(actor(), placeable('Far', PLACEABLE_RANGE + JUST_OUTSIDE), quietLogger)).toBeNull();
  });

  test('revalidates the live range without mutating either engine object', () => {
    const activeActor = actor();
    const target = placeable('Console', 1);
    const descriptor = describeDirectVRWorldUse(activeActor, target, quietLogger)!;

    target.position.set(PLACEABLE_RANGE + JUST_OUTSIDE, 0, 0);

    expect(descriptor.revalidate()).toBe(false);
    expect(target.onClick).not.toHaveBeenCalled();
    expect(activeActor.position.toArray()).toEqual([0, 0, 0]);
  });

  test('offers Use on a key-required door that names no key, so its OnFailToOpen can answer (Peragus airlocks)', () => {
    // 103PER AirlockInnerDoor_103PER: Locked=1, KeyRequired=1, KeyName empty,
    // OnFailToOpen=a_airlockin — the script is the only way through.
    const airlock = {
      id: 42,
      objectType: ModuleObjectType.ModuleDoor,
      position: new THREE.Vector3(1, 0, 0),
      keyRequired: 1,
      keyName: '',
      plot: 1,
      scripts: { onFailToOpen: { name: 'a_airlockin' } },
      isLocked: () => true,
      getName: () => 'Airlock Inner Door',
      onClick: jest.fn(),
    };
    expect(describeDirectVRWorldUse(actor(), airlock, quietLogger)).toEqual(expect.objectContaining({
      label: 'Use: Airlock Inner Door',
    }));

    // A real key lock without the key still refuses (the Ebon Hawk cargo locker).
    const keyed = { ...airlock, keyName: 'k_ebo_key', getName: () => 'Locker', onClick: jest.fn() };
    expect(describeDirectVRWorldUse(actor(), keyed, quietLogger)).toBeNull();

    // A plain lock with a hint script still refuses (the sealed emergency hatch).
    const hinted = { ...airlock, keyRequired: 0, getName: () => 'Emergency Hatch', onClick: jest.fn() };
    expect(describeDirectVRWorldUse(actor(), hinted, quietLogger)).toBeNull();

    // The Ebon Hawk's sealed doors share the lock shape but play a hint
    // conversation (a_compdlg); they stay prompt-less, as decided before.
    const sealed = { ...airlock, scripts: { onFailToOpen: { name: 'a_compdlg' } }, conversation: { resref: 'gar_door' }, getName: () => 'Sealed Door', onClick: jest.fn() };
    expect(describeDirectVRWorldUse(actor(), sealed, quietLogger)).toBeNull();

    // And a key lock with no failure script at all has nothing to try.
    const mute = { ...airlock, scripts: {}, getName: () => 'Blast Door', onClick: jest.fn() };
    expect(describeDirectVRWorldUse(actor(), mute, quietLogger)).toBeNull();
  });

  test('an unlocked key-required plot door whose isLocked answers 0 still offers Use (153HAR kreia_sion_door)', () => {
    const door = {
      id: 117,
      objectType: ModuleObjectType.ModuleDoor,
      position: new THREE.Vector3(1, 0, 0),
      keyRequired: 1,
      keyName: '',
      plot: 1,
      scripts: {},
      isLocked: () => 0 as unknown as boolean,
      getName: () => 'Door',
      onClick: jest.fn(),
    };
    expect(describeDirectVRWorldUse(actor(), door, quietLogger)).toEqual(expect.objectContaining({ label: 'Use: Door' }));
    // A door that reports itself locked with the same flags is still refused.
    const shut = { ...door, isLocked: () => 1 as unknown as boolean, onClick: jest.fn() };
    expect(describeDirectVRWorldUse(actor(), shut, quietLogger)).toBeNull();
  });

  test('blocks a descriptor that moves out of range before activation', () => {
    const target = placeable('Console', 1);
    const logger = { info: jest.fn(), error: jest.fn() };
    const descriptor = describeDirectVRWorldUse(actor(), target, logger)!;

    target.position.set(PLACEABLE_RANGE + JUST_OUTSIDE, 0, 0);
    const outcome = descriptor.activate();

    expect(outcome).toEqual({ handled: true, feedbackLabel: 'Console: Move closer' });
    expect(target.onClick).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      `[VR interaction] target=42 type=placeable distance=${(PLACEABLE_RANGE + JUST_OUTSIDE).toFixed(2)} route=blocked-range`,
    );
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('tryDirectVRWorldUse', () => {
  test('flatscreen activation and VR preserve the same ordinary object-open queue', () => {
    const desktopActor = queueingActor();
    const vrActor = queueingActor();
    const target = ordinaryOpenablePlaceable();

    expect(activateSelectedObject(desktopActor, target)).toEqual({ status: 'activated' });
    expect(tryDirectVRWorldUse(vrActor, target, quietLogger))
      .toEqual({ handled: true, feedbackLabel: 'Use: Ordinary Container' });

    expect(desktopActor.queuedActions).toEqual(['open:42']);
    expect(vrActor.queuedActions).toEqual(['open:42']);
    expect(target.onClick).toHaveBeenCalledWith(desktopActor);
    expect(target.onClick).toHaveBeenCalledWith(vrActor);
  });

  test('uses the native selected-target click semantics instead of invoking target use directly', () => {
    const activeActor = actor();
    const target = placeable('Console', 1);

    const result = tryDirectVRWorldUse(activeActor, target, quietLogger);

    expect(result).toEqual({ handled: true, feedbackLabel: 'Use: Console' });
    expect(activeActor.clearAllActions).toHaveBeenCalledTimes(1);
    expect(target.onClick).toHaveBeenCalledWith(activeActor);
    expect(target.use).not.toHaveBeenCalled();
  });

  test.each([
    ['door', ModuleObjectType.ModuleDoor, DOOR_RANGE],
    ['terminal', ModuleObjectType.ModulePlaceable, PLACEABLE_RANGE],
    ['container', ModuleObjectType.ModulePlaceable, PLACEABLE_RANGE],
    ['galaxy map', ModuleObjectType.ModulePlaceable, PLACEABLE_RANGE],
  ])('routes an in-range %s through its native selected-target click', (_name, objectType, range) => {
    const activeActor = actor();
    const target = {
      id: 42,
      objectType,
      position: new THREE.Vector3(range, 0, 0),
      getName: () => 'Target',
      use: jest.fn(),
      onClick: jest.fn(),
    };

    const result = tryDirectVRWorldUse(activeActor, target, quietLogger);

    expect(result).toEqual({ handled: true, feedbackLabel: 'Use: Target' });
    expect(activeActor.clearAllActions).toHaveBeenCalledTimes(1);
    expect(target.onClick).toHaveBeenCalledTimes(1);
    expect(target.onClick).toHaveBeenCalledWith(activeActor);
    expect(target.use).not.toHaveBeenCalled();
  });

  test('blocks out-of-range direct use without moving the player', () => {
    const activeActor = actor();
    const target = {
      id: 42,
      objectType: ModuleObjectType.ModulePlaceable,
      position: new THREE.Vector3(PLACEABLE_RANGE + JUST_OUTSIDE, 0, 0),
      getName: () => 'Galaxy Map',
      use: jest.fn(),
      onClick: jest.fn(),
    };

    const result = tryDirectVRWorldUse(activeActor, target, quietLogger);

    expect(result).toEqual({ handled: true, feedbackLabel: 'Galaxy Map: Move closer' });
    expect(target.onClick).not.toHaveBeenCalled();
    expect(activeActor.position.toArray()).toEqual([0, 0, 0]);
  });

  test('leaves unsupported targets for the authored contextual action panel', () => {
    const target = {
      id: 42,
      objectType: ModuleObjectType.ModuleCreature,
      position: new THREE.Vector3(),
      use: jest.fn(),
      onClick: jest.fn(),
    };

    expect(tryDirectVRWorldUse(actor(), target, quietLogger))
      .toEqual({ handled: false });
    expect(target.onClick).not.toHaveBeenCalled();
  });

  test('reports a native selected-target activation error with handled feedback', () => {
    const target = placeable('Console', 1);
    const activationError = new Error('engine onClick failed');
    target.onClick.mockImplementation(() => {
      throw activationError;
    });
    const logger = { info: jest.fn(), error: jest.fn() };

    const outcome = tryDirectVRWorldUse(actor(), target, logger);

    expect(outcome).toEqual({ handled: true, feedbackLabel: 'Console: Unavailable' });
    expect(target.onClick).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[VR interaction] target=42 type=placeable route=native-selected-activation result=error',
      activationError,
    );
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

const quietLogger = { info: (): void => undefined, error: (): void => undefined };

function actor(): VRWorldUseActor & { clearAllActions: jest.Mock } {
  return { id: 7, position: new THREE.Vector3(), clearAllActions: jest.fn() };
}

function placeable(name: string, distance: number): VRWorldUseTarget & { use: jest.Mock; onClick: jest.Mock } {
  return {
    id: 42,
    objectType: ModuleObjectType.ModulePlaceable,
    position: new THREE.Vector3(distance, 0, 0),
    keyRequired: 0,
    plot: 0,
    scripts: {},
    getName: () => name,
    use: jest.fn(),
    onClick: jest.fn(),
  };
}

function creature(): VRWorldUseTarget & { use: jest.Mock; onClick: jest.Mock } {
  return {
    id: 43,
    objectType: ModuleObjectType.ModuleCreature,
    position: new THREE.Vector3(),
    getName: () => 'Creature',
    use: jest.fn(),
    onClick: jest.fn(),
  };
}

function queueingActor(): VRWorldUseActor & { queuedActions: string[] } {
  const actor = {
    id: 7,
    position: new THREE.Vector3(),
    queuedActions: ['stale-action'],
    clearAllActions(): void {
      this.queuedActions.length = 0;
    },
  };
  return actor;
}

function ordinaryOpenablePlaceable(): VRWorldUseTarget & { use: jest.Mock; onClick: jest.Mock } {
  return {
    id: 42,
    objectType: ModuleObjectType.ModulePlaceable,
    position: new THREE.Vector3(1, 0, 0),
    keyRequired: 0,
    plot: 0,
    scripts: {},
    getName: () => 'Ordinary Container',
    use: jest.fn(),
    onClick: jest.fn((activeActor: VRWorldUseActor & { queuedActions?: string[] }) => {
      activeActor.queuedActions?.push('open:42');
    }),
  };
}
