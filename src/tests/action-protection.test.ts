import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('@/GameState', () => ({ GameState: {} }));
jest.mock('@/combat/CombatRound', () => ({ CombatRound: { ROUND_LENGTH: 3 } }));
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

    getTarget(): unknown {
      return this.target;
    }
  },
}));

import { ActionPhysicalAttacks } from '@/actions/ActionPhysicalAttacks';
import { ActionSetMine } from '@/actions/ActionSetMine';
import { ActionUnlockObject } from '@/actions/ActionUnlockObject';
import { ActionStatus } from '@/enums/actions/ActionStatus';
import { SignalEventType } from '@/enums/events/SignalEventType';
import { ModuleObjectType } from '@/enums/module/ModuleObjectType';
import { EventSignalEvent } from '@/events/EventSignalEvent';
import { GameState } from '@/GameState';

describe('protected object action execution', () => {
  const queuedEvents: EventSignalEvent[] = [];

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    queuedEvents.length = 0;
    Object.assign(GameState, {
      module: {
        area: { id: 1 },
        timeManager: { pauseDay: 2, pauseTime: 3 },
        addEvent: (event: unknown): void => { queuedEvents.push(event as EventSignalEvent); },
      },
      ActionFactory: {
        ActionPlayAnimation: class {
          setParameter(): void {
            // The protected-target regression must return before this queue path.
          }
        },
      },
      GameEventFactory: {
        EventSignalEvent,
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('rejects a forged physical attack on a plot-owned door before combat bookkeeping', () => {
    const action = new ActionPhysicalAttacks();
    const owner = creature();
    const target = protectedDoor({ plot: true });
    action.owner = owner as any;
    jest.spyOn(action, 'getParameter').mockImplementation((index: number) => index === 1 ? target as any : undefined);

    expect(action.update()).toBe(ActionStatus.FAILED);
    expect(owner.resetExcitedDuration).not.toHaveBeenCalled();
  });

  test('rejects a forged mine action on a NotBlastable placeable before it queues an animation', () => {
    const action = new ActionSetMine();
    const owner = creature();
    const target = protectedPlaceable({ notBlastable: true });
    const mine = { properties: [] as unknown[], charges: 1 };
    action.owner = owner as any;
    jest.spyOn(action, 'getParameter').mockImplementation((index: number) => {
      if (index === 0) return mine as any;
      if (index === 1) return target as any;
      return undefined;
    });

    expect(action.update()).toBe(ActionStatus.FAILED);
    expect(owner.actionQueue.addFront).not.toHaveBeenCalled();
  });

  test('queues OnFailToOpen once when a stale Security action is rejected for a required key', () => {
    const action = new ActionUnlockObject();
    const owner = creature();
    const target = protectedDoor({ keyRequired: true });
    action.owner = owner as any;
    jest.spyOn(action, 'getParameter').mockImplementation((index: number) => index === 0 ? target as any : undefined);

    expect(action.update()).toBe(ActionStatus.FAILED);
    expect(action.update()).toBe(ActionStatus.FAILED);
    expect(queuedEvents).toHaveLength(1);
    expect(queuedEvents[0]).toEqual(expect.objectContaining({
      caller: owner,
      object: target,
      day: 2,
      time: 3,
      eventType: SignalEventType.OnFailToOpen,
    }));
  });

  test.each([
    ['door', ModuleObjectType.ModuleDoor],
    ['placeable', ModuleObjectType.ModulePlaceable],
  ])('executes the authored OnFailToOpen script exactly once for an invalid queued Security action on a %s', (_name, objectType) => {
    const action = new ActionUnlockObject();
    const owner = creature();
    const failureScript = { run: jest.fn() };
    const target = {
      objectType: ModuleObjectType.ModuleObject | objectType,
      position: new THREE.Vector3(),
      keyRequired: true,
      lockable: true,
      isLocked: (): boolean => true,
      getScriptInstance: (requestedScriptKey: string) => requestedScriptKey === 'OnFailToOpen' ? failureScript : undefined,
    };
    action.owner = owner as any;
    jest.spyOn(action, 'getParameter').mockImplementation((index: number) => index === 0 ? target as any : undefined);

    expect(action.update()).toBe(ActionStatus.FAILED);
    expect(action.update()).toBe(ActionStatus.FAILED);
    expect(queuedEvents).toHaveLength(1);

    queuedEvents[0].execute();

    expect(failureScript.run).toHaveBeenCalledTimes(1);
    expect(failureScript.run).toHaveBeenCalledWith(target);
  });
});

function creature(): {
  objectType: number;
  position: THREE.Vector3;
  actionQueue: { addFront: jest.Mock };
  resetExcitedDuration: jest.Mock;
  isRangedEquipped: jest.Mock;
} {
  return {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    position: new THREE.Vector3(),
    actionQueue: { addFront: jest.fn() },
    resetExcitedDuration: jest.fn(),
    isRangedEquipped: jest.fn(() => false),
  };
}

function protectedDoor(overrides: Partial<{ plot: boolean; min1HP: boolean; notBlastable: boolean; keyRequired: boolean }>) {
  return {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleDoor,
    position: new THREE.Vector3(),
    plot: false,
    min1HP: false,
    notBlastable: false,
    keyRequired: false,
    lockable: true,
    isLocked: (): boolean => true,
    isDead: (): boolean => false,
    ...overrides,
  };
}

function protectedPlaceable(overrides: Partial<{ plot: boolean; min1HP: boolean; notBlastable: boolean }>) {
  return {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModulePlaceable,
    position: new THREE.Vector3(),
    box: new THREE.Box3(),
    plot: false,
    min1HP: false,
    notBlastable: false,
    ...overrides,
  };
}
