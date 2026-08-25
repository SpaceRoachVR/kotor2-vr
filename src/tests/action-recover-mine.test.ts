import * as THREE from 'three';
import { expect, jest, test } from '@jest/globals';

jest.mock('@/GameState', () => ({
  GameState: {
    PartyManager: { party: [] as unknown[] },
    InventoryManager: { addItem: jest.fn() },
    Module: {
      ModuleArea: {
        ModuleItem: class {
          template: unknown;

          constructor(template: unknown) {
            this.template = template;
          }
        },
      },
    },
  },
}));

jest.mock('@/actions/Action', () => ({
  Action: class {
    owner: unknown;

    constructor(_actionId = -1, _groupId = -1) {}

    getParameter<T>(): T | undefined {
      return undefined;
    }
  },
}));

jest.mock('@/resource/GFFObject', () => ({
  GFFObject: class {
    source: Uint8Array;

    constructor(source: Uint8Array) {
      this.source = source;
    }
  },
}));

jest.mock('@/loaders/ResourceLoader', () => ({
  ResourceLoader: {
    loadCachedResource: jest.fn((resourceType: number) => resourceType === 2025 ? new Uint8Array([1, 2, 3]) : null),
  },
}));

import { ActionRecoverMine } from '@/actions/ActionRecoverMine';
import { ActionStatus } from '@/enums/actions/ActionStatus';
import { ModuleTriggerType } from '@/enums/module/ModuleTriggerType';
import { ModuleObjectType } from '@/enums/module/ModuleObjectType';
import { GameState } from '@/GameState';

test('recovering a trap gives its UTI mine item to the owner', () => {
  const action = new ActionRecoverMine();
  const owner = {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    position: new THREE.Vector3(1, 1, 0),
    addItem: jest.fn(),
  };
  const trap = {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleTrigger,
    position: new THREE.Vector3(1, 1, 0),
    type: ModuleTriggerType.TRAP,
    trapResRef: 'g_i_mine001',
    destroy: jest.fn(),
  };
  action.owner = owner as never;
  GameState.PartyManager.party = [];
  const addToInventory = GameState.InventoryManager.addItem as unknown as jest.Mock;
  addToInventory.mockClear();
  jest.spyOn(action, 'getParameter').mockReturnValue(trap as never);

  expect(action.update()).toBe(ActionStatus.COMPLETE);
  expect(trap.destroy).toHaveBeenCalledTimes(1);
  expect(owner.addItem).toHaveBeenCalledTimes(1);
});

test('recovering a trap gives a party member mine to the shared inventory', () => {
  const action = new ActionRecoverMine();
  const owner = {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature,
    position: new THREE.Vector3(1, 1, 0),
    addItem: jest.fn(),
  };
  const trap = {
    objectType: ModuleObjectType.ModuleObject | ModuleObjectType.ModuleTrigger,
    position: new THREE.Vector3(1, 1, 0),
    type: ModuleTriggerType.TRAP,
    trapResRef: 'g_i_trapkit004',
    destroy: jest.fn(),
  };
  action.owner = owner as never;
  GameState.PartyManager.party = [owner as never];
  const addToInventory = GameState.InventoryManager.addItem as unknown as jest.Mock;
  addToInventory.mockClear();
  jest.spyOn(action, 'getParameter').mockReturnValue(trap as never);

  expect(action.update()).toBe(ActionStatus.COMPLETE);
  expect(trap.destroy).toHaveBeenCalledTimes(1);
  expect(addToInventory).toHaveBeenCalledTimes(1);
  expect(owner.addItem).not.toHaveBeenCalled();
});
