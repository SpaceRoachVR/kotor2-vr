import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const queuedFront: unknown[] = [];

jest.mock('@/GameState', () => ({
  GameState: {
    ActionFactory: {
      ActionMoveToPoint: class {
        setParameter(): void { /* parameters are irrelevant to this test */ }
      },
    },
    module: { area: { id: 7 } },
    PartyManager: { Player: { id: 'player' }, party: [{ id: 'leader' }] },
  },
}));
jest.mock('@/actions/Action', () => ({
  Action: class {
    owner: any;
    target: any;
    type: unknown;
    groupId: number;
    constructor(_actionId = -1, groupId = -1) { this.groupId = groupId; }
    getParameter<T>(): T | undefined { return this.target as T; }
  },
}));

import { ActionUseObject } from '@/actions/ActionUseObject';
import { ActionStatus } from '@/enums/actions/ActionStatus';
import { ModuleObjectType } from '@/enums/module/ModuleObjectType';
import { ActionApproachPolicy } from '@/engine/interaction/ActionApproachPolicy';

/**
 * `ActionUseObject` walks the actor to its target beyond 1.5 m. That is right
 * for a mouse and wrong in VR, where the rig is anchored to the avatar and the
 * walk drags the player through the world with no input from them.
 */
function useObjectAt(distanceMetres: number): { action: any; used: string[] } {
  const used: string[] = [];
  const action: any = new ActionUseObject();
  action.owner = {
    objectType: ModuleObjectType.ModuleObject,
    position: new THREE.Vector3(0, 0, 0),
    force: 1,
    speed: 1,
    actionQueue: { addFront: (queued: unknown) => queuedFront.push(queued) },
    setAnimationState: (): void => undefined,
    setFacingObject: (): void => undefined,
  };
  action.target = {
    objectType: ModuleObjectType.ModuleObject,
    id: 'target',
    position: new THREE.Vector3(distanceMetres, 0, 0),
    use: (): void => { used.push('used'); },
  };
  return { action, used };
}

describe('ActionUseObject approach suppression', () => {
  beforeEach(() => {
    queuedFront.length = 0;
    ActionApproachPolicy.reset();
  });

  afterEach(() => {
    ActionApproachPolicy.reset();
  });

  test('walks the actor to a distant target on desktop', () => {
    const { action, used } = useObjectAt(4);

    const status = action.update(0);

    expect(status).toBe(ActionStatus.IN_PROGRESS);
    expect(queuedFront).toHaveLength(1);
    expect(used).toEqual([]);
  });

  test('acts from where the actor stands when approach is suppressed', () => {
    // The exact case reported from the headset: prompts offer use at 2.5-3 m,
    // well beyond the 1.5 m the engine would otherwise walk.
    ActionApproachPolicy.setControlledActorProbe(() => true);
    ActionApproachPolicy.setApproachSuppressed(true);
    const { action, used } = useObjectAt(2.25);

    const status = action.update(0);

    expect(status).toBe(ActionStatus.COMPLETE);
    expect(queuedFront).toEqual([]);
    expect(used).toEqual(['used']);
  });

  test('a target already within reach never walks, suppressed or not', () => {
    for (const suppressed of [false, true]) {
      queuedFront.length = 0;
      ActionApproachPolicy.setApproachSuppressed(suppressed);
      const { action, used } = useObjectAt(1.0);

      expect(action.update(0)).toBe(ActionStatus.COMPLETE);
      expect(queuedFront).toEqual([]);
      expect(used).toEqual(['used']);
    }
  });

  test('desktop walking returns once suppression is cleared', () => {
    // Leaving VR must restore click-to-walk; a leaked flag would quietly break
    // flatscreen play.
    ActionApproachPolicy.setControlledActorProbe(() => true);
    ActionApproachPolicy.setApproachSuppressed(true);
    useObjectAt(4).action.update(0);
    expect(queuedFront).toEqual([]);

    ActionApproachPolicy.setApproachSuppressed(false);
    const { action } = useObjectAt(4);

    expect(action.update(0)).toBe(ActionStatus.IN_PROGRESS);
    expect(queuedFront).toHaveLength(1);
  });
});
