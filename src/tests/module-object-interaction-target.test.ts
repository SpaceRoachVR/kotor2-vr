import * as THREE from 'three';
import { describe, expect, jest, test } from '@jest/globals';
import { InteractionTargetRegistry } from '@/vr/runtime/InteractionTargetRegistry';
import {
  EngineInteractionActor,
  EngineInteractableObject,
  ModuleObjectInteractionTargetSet,
  createModuleObjectInteractionTarget,
  resolveVRInteractionAnchor,
} from '@/vr/runtime/ModuleObjectInteractionTarget';

describe('createModuleObjectInteractionTarget', () => {
  test('exports the shared interaction anchor without mutating the object position', () => {
    const object: EngineInteractableObject = {
      ...interactable(42, new THREE.Vector3(1, 2, 3)),
      box: new THREE.Box3(
        new THREE.Vector3(0.5, 1.5, 3),
        new THREE.Vector3(1.5, 2.5, 4),
      ),
    };
    const output = new THREE.Vector3();

    expect(resolveVRInteractionAnchor(object, output)).toBe(output);
    expect(output.toArray()).toEqual([1, 2, 3.5]);
    expect(object.position.toArray()).toEqual([1, 2, 3]);
  });

  test('uses a validated caller fallback when bounds are unusable', () => {
    const object: EngineInteractableObject = {
      ...interactable(42, new THREE.Vector3(1, 2, 3)),
      box: new THREE.Box3(),
    };

    expect(resolveVRInteractionAnchor(object, new THREE.Vector3(), 0.4).toArray())
      .toEqual([1, 2, 3.4]);
    expect(() => resolveVRInteractionAnchor(object, new THREE.Vector3(), Number.NaN))
      .toThrow('fallbackMetres must be finite');
  });

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

  test('sits the tag on the object rather than floating it overhead', () => {
    const actor: EngineInteractionActor = { id: 7, clearAllActions: jest.fn() };
    // A waist-high container standing on the floor at z = 0.
    const object: EngineInteractableObject = {
      id: 42,
      position: new THREE.Vector3(0, 0, 0),
      box: new THREE.Box3(new THREE.Vector3(-0.4, -0.4, 0), new THREE.Vector3(0.4, 0.4, 0.9)),
      isUseable: () => true,
      onClick: jest.fn(),
    };
    const target = createModuleObjectInteractionTarget(object, () => actor);

    // The vertical centre of the container's own bounds, not a fixed metre
    // above its origin — a floating second marker beside KOTOR's own reticle
    // is what "two separate tags" looked like in the headset.
    expect(target.getWorldPosition(new THREE.Vector3()).z).toBeCloseTo(0.45);
  });

  test('falls back to a low tag when the engine reports no usable bounds', () => {
    const actor: EngineInteractionActor = { id: 7, clearAllActions: jest.fn() };
    const object: EngineInteractableObject = {
      id: 43,
      position: new THREE.Vector3(0, 0, 0),
      box: new THREE.Box3(),
      isUseable: () => true,
      onClick: jest.fn(),
    };
    const target = createModuleObjectInteractionTarget(object, () => actor);

    expect(target.getWorldPosition(new THREE.Vector3()).z).toBeCloseTo(0.25);
  });

  test('synchronizes module transitions without retaining stale object targets', () => {
    const actor: EngineInteractionActor = { id: 7, clearAllActions: (): void => undefined };
    const first = interactable(42, new THREE.Vector3(0, 0, -3));
    const replacement = interactable(42, new THREE.Vector3(0, 0, -5));
    const registry = new InteractionTargetRegistry();
    const targetSet = new ModuleObjectInteractionTargetSet(registry, () => actor);

    // These objects expose no bounds, so their tag falls back to 0.25m above
    // their origin: 3 - 0.25 = 2.75 to the target centre, less the 0.5m radius.
    targetSet.synchronize([first]);
    expect(registry.resolveRay(
      new THREE.Vector3(),
      new THREE.Vector3(0, 0, -1),
      10
    )?.distanceMetres).toBeCloseTo(2.25);

    targetSet.synchronize([replacement]);
    expect(registry.resolveRay(
      new THREE.Vector3(),
      new THREE.Vector3(0, 0, -1),
      10
    )?.distanceMetres).toBeCloseTo(4.25);

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
