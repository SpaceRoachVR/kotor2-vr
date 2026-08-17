import * as THREE from 'three';
import { describe, expect, jest, test } from '@jest/globals';
import { InteractionTargetRegistry } from '@/vr/runtime/InteractionTargetRegistry';
import {
  EngineInteractionActor,
  EngineInteractableObject,
  ModuleObjectInteractionTargetSet,
  createModuleObjectInteractionTarget,
} from '@/vr/runtime/ModuleObjectInteractionTarget';

describe('createModuleObjectInteractionTarget', () => {
  test('resolves live object position without queuing the desktop walk-to action', () => {
    const actor: EngineInteractionActor = {
      id: 7,
      clearAllActions: jest.fn(),
    };
    const object: EngineInteractableObject = {
      id: 42,
      position: new THREE.Vector3(0, 0, -2),
      isUseable: () => true,
      onClick: jest.fn(),
    };
    const registry = new InteractionTargetRegistry();
    registry.register(createModuleObjectInteractionTarget(
      object,
      () => actor,
      { radiusMetres: 0.25, verticalOffsetMetres: 1 }
    ));

    object.position.set(0, 0, -3);
    const resolved = registry.resolveRay(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
      10
    );
    resolved!.target.activate({
      actorId: '7',
      hand: 'right',
      interactionMode: 'ray',
      engineTimestamp: 2000,
    });

    expect(resolved?.target.id).toBe('module-object:42');
    expect(resolved?.distanceMetres).toBeCloseTo(1.75);
    expect(actor.clearAllActions).not.toHaveBeenCalled();
    expect(object.onClick).not.toHaveBeenCalled();
  });

  test('rejects a stale interaction intent after the active actor changes', () => {
    const actor: EngineInteractionActor = {
      id: 8,
      clearAllActions: jest.fn(),
    };
    const object: EngineInteractableObject = {
      id: 42,
      position: new THREE.Vector3(),
      isUseable: () => true,
      onClick: jest.fn(),
    };
    const target = createModuleObjectInteractionTarget(object, () => actor);

    expect(() => target.activate({
      actorId: '7',
      hand: 'left',
      interactionMode: 'near-touch',
      engineTimestamp: 2000,
    })).toThrow('active actor changed');
    expect(actor.clearAllActions).not.toHaveBeenCalled();
    expect(object.onClick).not.toHaveBeenCalled();
  });

  test('synchronizes module transitions without retaining stale object targets', () => {
    const actor: EngineInteractionActor = { id: 7, clearAllActions: (): void => undefined };
    const first = interactable(42, new THREE.Vector3(0, 0, -3));
    const replacement = interactable(42, new THREE.Vector3(0, 0, -5));
    const registry = new InteractionTargetRegistry();
    const targetSet = new ModuleObjectInteractionTargetSet(registry, () => actor);

    targetSet.synchronize([first]);
    expect(registry.resolveRay(
      new THREE.Vector3(),
      new THREE.Vector3(0, 0, -1),
      10
    )?.distanceMetres).toBeCloseTo(1.5);

    targetSet.synchronize([replacement]);
    expect(registry.resolveRay(
      new THREE.Vector3(),
      new THREE.Vector3(0, 0, -1),
      10
    )?.distanceMetres).toBeCloseTo(3.5);

    targetSet.synchronize([]);
    expect(registry.resolveRay(
      new THREE.Vector3(),
      new THREE.Vector3(0, 0, -1),
      10
    )).toBeNull();
  });

  test('does not target an object beyond the actor interaction range', () => {
    // Selecting a distant object in the original engine queues a walk-to
    // action that drags the player across the level. VR refuses to nominate
    // the target at all, so it produces no label, reticle, or selection.
    const actor: EngineInteractionActor = {
      id: 7,
      position: new THREE.Vector3(0, 0, 0),
      clearAllActions: (): void => undefined,
    };
    const object = interactable(42, new THREE.Vector3(0, 8, 0));
    const registry = new InteractionTargetRegistry();
    registry.register(createModuleObjectInteractionTarget(object, () => actor, {
      getInteractionRangeMetres: () => 2,
      verticalOffsetMetres: 0,
    }));

    const rayFromActor = (): unknown => registry.resolveRay(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1, 0),
      20
    );

    expect(rayFromActor()).toBeNull();

    // Walking into range makes the very same object targetable again.
    object.position.set(0, 1.5, 0);
    expect(rayFromActor()).not.toBeNull();
  });

  test('ignores range entirely when the actor exposes no position', () => {
    const actor: EngineInteractionActor = { id: 7, clearAllActions: (): void => undefined };
    const object = interactable(42, new THREE.Vector3(0, 40, 0));
    const registry = new InteractionTargetRegistry();
    registry.register(createModuleObjectInteractionTarget(object, () => actor, {
      getInteractionRangeMetres: () => 2,
      verticalOffsetMetres: 0,
    }));

    expect(registry.resolveRay(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1, 0),
      100
    )).not.toBeNull();
  });
});

function interactable(id: number, position: THREE.Vector3): EngineInteractableObject {
  return {
    id,
    position,
    isUseable: () => true,
    onClick: (): void => undefined,
  };
}
