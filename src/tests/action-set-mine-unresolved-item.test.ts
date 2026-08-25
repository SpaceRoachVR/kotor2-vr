import * as THREE from 'three';
import { expect, jest, test } from '@jest/globals';

/**
 * ActionSetMine's item arrives as a DWORD id and is resolved back through
 * ModuleObjectManager. Two things can come back: the wrong object, or nothing.
 *
 * The wrong object was already guarded -- it has no `properties` array, which
 * is reported and fails. Nothing at all was not: `if(this.oItem && ...)` simply
 * skipped the whole block and fell through to `return ActionStatus.COMPLETE`,
 * so the action claimed success having placed no trap, fired no trigger event
 * and consumed no charge. The mine stayed in the inventory and the door stayed
 * shut, with nothing logged anywhere.
 *
 * A full playthrough does resolve the item correctly and mines the Engine Room
 * Door open, so this guards the failure path rather than the happy one.
 */
jest.mock('@/GameState', () => ({
  GameState: {
    ActionFactory: {},
    module: {},
  },
}));

jest.mock('@/actions/Action', () => ({
  Action: class {
    owner: unknown;
    target: unknown;

    constructor(_actionId = -1, _groupId = -1) {}

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

jest.mock('@/engine/interaction/ObjectLockRules', () => ({
  canExecuteMinePlacement: jest.fn(() => true),
}));

jest.mock('@/engine/interaction/ActionApproachPolicy', () => ({
  ActionApproachPolicy: { isApproachSuppressedFor: jest.fn(() => true) },
}));

jest.mock('@/utility/BitWise', () => ({
  BitWise: { InstanceOfObject: jest.fn(() => true) },
}));

import { ActionSetMine } from '@/actions/ActionSetMine';
import { ActionStatus } from '@/enums/actions/ActionStatus';

function armedAction(item: unknown) {
  const action = new ActionSetMine();
  const target = { position: new THREE.Vector3(0, 0, 0), addTrap: jest.fn() };
  action.owner = { position: new THREE.Vector3(0, 0, 0) } as never;
  // The animation is queued on an earlier pass; this exercises the pass after.
  action.bAnimQueued = true;
  jest.spyOn(action, 'getParameter').mockImplementation(((index: number) =>
    index === 0 ? item : target) as never);
  return { action, target };
}

test('an item id that resolves to nothing fails instead of reporting success', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const { action, target } = armedAction(undefined);

  expect(action.update()).toBe(ActionStatus.FAILED);
  expect(target.addTrap).not.toHaveBeenCalled();

  warn.mockRestore();
});

test('an id that resolves to a non-item still fails on the properties guard', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const { action, target } = armedAction({ id: 7, properties: undefined });

  expect(action.update()).toBe(ActionStatus.FAILED);
  expect(target.addTrap).not.toHaveBeenCalled();

  warn.mockRestore();
});
