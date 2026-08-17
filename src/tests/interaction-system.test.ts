import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { InteractionSystem } from '@/vr/runtime/InteractionSystem';
import {
  InteractionActivationContext,
  InteractionTargetRegistry,
} from '@/vr/runtime/InteractionTargetRegistry';
import { RoutedXRAction } from '@/vr/runtime/XRInputRouter';
import {
  SemanticXRAction,
  XRHandInputFrame,
  XRInputFrame,
  XRWorldPose,
} from '@/vr/runtime/XRTypes';

describe('InteractionSystem', () => {
  test('authorizes one near-touch interaction on the use-button press edge', () => {
    const activations: InteractionActivationContext[] = [];
    const registry = new InteractionTargetRegistry();
    registry.register({
      id: 'module-object:42',
      radiusMetres: 0.05,
      interactionModes: ['near-touch', 'ray'],
      getWorldPosition: (output) => output.set(0, 0, -0.1),
      isAvailable: () => true,
      activate: (context) => activations.push(context),
    });
    const system = new InteractionSystem(registry, {
      nearReachMetres: 0.1,
      rayDistanceMetres: 10,
    });

    expect(system.process(frame(), [useAction(false)], '7', 1999)).toBeNull();
    const intent = system.process(frame(), [useAction(true)], '7', 2000);

    expect(intent?.actorId).toBe('7');
    expect(intent?.hand).toBe('right');
    expect(intent?.targetId).toBe('module-object:42');
    expect(intent?.interactionMode).toBe('near-touch');
    expect(intent?.distanceMetres).toBeCloseTo(0.05);
    expect(activations).toEqual([{
      actorId: '7',
      hand: 'right',
      interactionMode: 'near-touch',
      engineTimestamp: 2000,
    }]);
    expect(system.process(frame(), [useAction(true)], '7', 2014)).toBeNull();
  });

  test('requires a physical release after transient state is cancelled', () => {
    let activationCount = 0;
    const registry = new InteractionTargetRegistry();
    registry.register({
      id: 'module-object:42',
      radiusMetres: 0.25,
      interactionModes: ['ray'],
      getWorldPosition: (output) => output.set(0, 0, -2),
      isAvailable: () => true,
      activate: () => { activationCount += 1; },
    });
    const system = new InteractionSystem(registry);

    system.process(frame(), [useAction(false)], '7', 1000);
    expect(system.process(frame(), [useAction(true)], '7', 1014)).not.toBeNull();
    system.cancelTransientState();

    expect(system.process(frame(), [useAction(true)], '7', 1028)).toBeNull();
    expect(system.process(frame(), [useAction(false)], '7', 1042)).toBeNull();
    expect(system.process(frame(), [useAction(true)], '7', 1056)).not.toBeNull();
    expect(activationCount).toBe(2);
  });

  test('authorizes a world interaction from the primary trigger select action', () => {
    let activationCount = 0;
    const registry = new InteractionTargetRegistry();
    registry.register({
      id: 'module-object:lift',
      radiusMetres: 0.25,
      interactionModes: ['ray'],
      getWorldPosition: (output) => output.set(0, 0, -2),
      isAvailable: () => true,
      activate: () => { activationCount += 1; },
    });
    const system = new InteractionSystem(registry);

    expect(system.process(frame(), [selectAction(false)], '7', 1000)).toBeNull();
    expect(system.process(frame(), [selectAction(true)], '7', 1014)?.targetId)
      .toBe('module-object:lift');
    expect(activationCount).toBe(1);
  });

  test('uses a controller grip for a nearby authored interaction without moving the engine object', () => {
    const activations: InteractionActivationContext[] = [];
    const registry = new InteractionTargetRegistry();
    registry.register({
      id: 'module-object:console',
      radiusMetres: 0.25,
      interactionModes: ['near-touch'],
      getWorldPosition: (output) => output.set(0, 0, -0.1),
      isAvailable: () => true,
      activate: (context) => activations.push(context),
    });
    const system = new InteractionSystem(registry);

    expect(system.process(frame(), [grabAction(false)], '7', 1000)).toBeNull();
    const intent = system.process(frame(), [grabAction(true)], '7', 1014);

    expect(intent).toMatchObject({ targetId: 'module-object:console', interactionMode: 'near-touch' });
    expect(activations).toEqual([expect.objectContaining({ interactionMode: 'near-touch' })]);
  });

  test('previews the right-hand pointer target without activating it', () => {
    let activationCount = 0;
    const registry = new InteractionTargetRegistry();
    registry.register({
      id: 'module-object:door',
      label: 'Use: Blast Door',
      radiusMetres: 0.25,
      interactionModes: ['ray'],
      getWorldPosition: (output) => output.set(0, 0, -2),
      isAvailable: () => true,
      activate: () => { activationCount += 1; },
    });
    const system = new InteractionSystem(registry);

    expect(system.preview(frame(), 'right')).toEqual(expect.objectContaining({
      id: 'module-object:door',
      label: 'Use: Blast Door',
      interactionMode: 'ray',
      position: expect.objectContaining({ x: 0, y: 0, z: -2 }),
    }));
    expect(activationCount).toBe(0);
  });
});

function frame(): XRInputFrame {
  const handPose = pose(new THREE.Vector3(), new THREE.Quaternion());
  const hand: XRHandInputFrame = {
    hand: 'right',
    pose: handPose,
    targetRayPose: handPose,
    buttons: {},
    axes: [],
    interactionProfile: 'oculus-touch-v3',
  };
  return {
    timestamp: 2000,
    head: pose(new THREE.Vector3(0, 0, 1.7), new THREE.Quaternion()),
    hands: { right: hand },
    activeInteractionProfiles: ['oculus-touch-v3'],
  };
}

function pose(position: THREE.Vector3, orientation: THREE.Quaternion): XRWorldPose {
  return {
    position,
    orientation,
    linearVelocity: null,
    angularVelocity: null,
    trackingState: 'tracked',
  };
}

function useAction(pressed: boolean): RoutedXRAction {
  return {
    action: SemanticXRAction.Use,
    hand: 'right',
    pressed,
    touched: pressed,
    value: pressed ? 1 : 0,
    axes: null,
  };
}

function selectAction(pressed: boolean): RoutedXRAction {
  return {
    action: SemanticXRAction.Select,
    hand: 'right',
    pressed,
    touched: pressed,
    value: pressed ? 1 : 0,
    axes: null,
  };
}

function grabAction(pressed: boolean): RoutedXRAction {
  return {
    action: SemanticXRAction.Grab,
    hand: 'right',
    pressed,
    touched: pressed,
    value: pressed ? 1 : 0,
    axes: null,
  };
}
