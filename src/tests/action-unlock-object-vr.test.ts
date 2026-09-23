import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('@/GameState', () => ({ GameState: {} }));
jest.mock('@/actions/Action', () => ({
  Action: class {
    owner: unknown;
    target: unknown;
    type: unknown;
    groupId: number;

    constructor(_actionId = -1, groupId = -1) {
      this.groupId = groupId;
    }

    getParameter<T>(): T | undefined {
      return undefined;
    }

    getOwner(): unknown {
      return this.owner;
    }
  },
}));

import { ActionUnlockObject } from '@/actions/ActionUnlockObject';
import { ActionStatus } from '@/enums/actions/ActionStatus';
import { GameEffectDurationType } from '@/enums/effects/GameEffectDurationType';
import { ModuleObjectType } from '@/enums/module/ModuleObjectType';
import { ActionApproachPolicy } from '@/engine/interaction/ActionApproachPolicy';
import { GameState } from '@/GameState';

describe('ActionUnlockObject', () => {
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    Object.assign(GameState, {
      module: {
        area: { id: 1 },
        timeManager: { pauseDay: 0, pauseTime: 0, getFutureTimeFromSeconds: (seconds: number) => ({ pauseDay: 1, pauseTime: 1000 + seconds * 1000 }) },
        addEvent: jest.fn(),
      },
      GameEffectFactory: {
        EffectSkillIncrease: class {
          durationType = 0;
          duration = 0;
          expireDay = 0;
          expireTime = 0;
          setCreator(): void { /* inert */ }
          setSpellId(): void { /* inert */ }
          setInt(): void { /* inert */ }
          setDurationType(value: number): void { this.durationType = value; }
          setDuration(value: number): void { this.duration = value; }
          setExpireDay(value: number): void { this.expireDay = value; }
          setExpireTime(value: number): void { this.expireTime = value; }
          initialize(): this { return this; }
        },
      },
      SWRuleSet: { racialTypeCount: 7 },
      GameEventFactory: { EventSignalEvent: class { setCaller(): void {} setObject(): void {} setDay(): void {} setTime(): void {} } },
    });
  });

  afterEach(() => {
    ActionApproachPolicy.reset();
    jest.restoreAllMocks();
  });

  test('a security tunneler spends one charge per attempt, not one per frame of the pick', () => {
    const owner = picker();
    const door = lockedDoor();
    const tunneler = { charges: 3, properties: [] as unknown[] };
    const action = queued(owner, door, tunneler);

    let status = ActionStatus.IN_PROGRESS;
    let frames = 0;
    while (status === ActionStatus.IN_PROGRESS && frames < 200) {
      status = action.update(1 / 60);
      frames++;
    }

    expect(status).toBe(ActionStatus.COMPLETE);
    expect(frames).toBeGreaterThan(80);
    expect(tunneler.charges).toBe(2);
    expect(owner.removeItem).not.toHaveBeenCalled();
    expect(door.attemptUnlock).toHaveBeenCalledTimes(1);
  });

  // addEffect turns these arguments into a duration and an expiry; that half is
  // covered in game-effect-duration.test.ts.
  test('the Security bonus a tunneler grants is applied as a 3 second temporary effect', () => {
    const owner = picker();
    const tunneler = {
      charges: 2,
      properties: [{ isUseable: () => true, is: () => true, getValue: () => 6 }],
    };
    const action = queued(owner, lockedDoor(), tunneler);

    action.update(0.1);

    expect(owner.addEffect).toHaveBeenCalledTimes(1);
    const [, type, duration] = (owner.addEffect as jest.Mock).mock.calls[0];
    expect(type).toBe(GameEffectDurationType.TEMPORARY);
    expect(duration).toBe(3);
  });

  test('the last charge of a tunneler is removed once the attempt resolves', () => {
    const owner = picker();
    const door = lockedDoor();
    const tunneler = { charges: 1, properties: [] as unknown[] };
    const action = queued(owner, door, tunneler);

    action.update(0.5);
    expect(owner.removeItem).not.toHaveBeenCalled();

    action.update(1.1);
    expect(owner.removeItem).toHaveBeenCalledTimes(1);
    expect(owner.removeItem).toHaveBeenCalledWith(tunneler, 1);
  });

  test('does not pin a VR player in place while the lock is picked', () => {
    ActionApproachPolicy.setControlledActorProbe((actor) => actor === owner);
    ActionApproachPolicy.setApproachSuppressed(true);
    const owner = picker();
    owner.force = 1;
    owner.speed = 2;
    const action = queued(owner, lockedDoor(), null);

    action.update(0.1);

    expect(owner.force).toBe(1);
    expect(owner.speed).toBe(2);
  });

  test('still holds a desktop or party picker still, as retail does', () => {
    const owner = picker();
    owner.force = 1;
    owner.speed = 2;
    const action = queued(owner, lockedDoor(), null);

    action.update(0.1);

    expect(owner.force).toBe(0);
    expect(owner.speed).toBe(0);
  });
});

function queued(owner: ReturnType<typeof picker>, door: ReturnType<typeof lockedDoor>, item: unknown): ActionUnlockObject {
  const action = new ActionUnlockObject();
  action.owner = owner as any;
  jest.spyOn(action, 'getParameter').mockImplementation((index: number) => {
    if (index === 0) return door as any;
    if (index === 1) return item as any;
    return undefined;
  });
  return action;
}

function picker() {
  return {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    position: new THREE.Vector3(0, 0, 0),
    force: 0,
    speed: 0,
    combatData: { combatState: false },
    playSoundSet: jest.fn(),
    setAnimationState: jest.fn(),
    setFacingObject: jest.fn(),
    isSimpleCreature: () => true,
    addEffect: jest.fn(),
    removeItem: jest.fn(),
    getSkillLevel: () => 6,
    getINT: () => 16,
  };
}

function lockedDoor() {
  return {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleDoor,
    position: new THREE.Vector3(1, 0, 0),
    keyRequired: false,
    lockable: false,
    openLockDC: 21,
    isLocked: (): boolean => true,
    getName: () => 'Low Security Door',
    audioEmitter: { playSound: jest.fn() },
    attemptUnlock: jest.fn(() => true),
  };
}
