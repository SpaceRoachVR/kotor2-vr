import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { VRConsumableUseGestureController } from '@/vr/runtime/VRConsumableUseGestureController';
import { XRInputFrame, XRWorldPose } from '@/vr/runtime/XRTypes';

// ROADMAP 3.20 — a medpac or stim held to the neck. World space is Z-up; the
// head sits at z = 1.6, so the neck zone is centred at z = 1.45.

describe('VRConsumableUseGestureController', () => {
  const head = new THREE.Vector3(0, 0, 1.6);
  const neck = new THREE.Vector3(0.05, 0.05, 1.45);
  const hip = new THREE.Vector3(0.2, 0, 0.9);

  test('the armed off hand held at the neck for the dwell uses the item', () => {
    const controller = new VRConsumableUseGestureController({ dwellMilliseconds: 150 });

    expect(controller.process(frame(head, neck), { hand: 'left', armed: true, timestamp: 1_000 })).toBeNull();
    expect(controller.isDwelling).toBe(true);
    expect(controller.process(frame(head, neck), { hand: 'left', armed: true, timestamp: 1_100 })).toBeNull();
    const gesture = controller.process(frame(head, neck), { hand: 'left', armed: true, timestamp: 1_160 });

    expect(gesture).toMatchObject({ hand: 'left' });
    expect(gesture?.distanceMetres).toBeLessThan(0.1);
    expect(controller.isDwelling).toBe(false);
  });

  test('a hand that leaves the zone restarts the dwell', () => {
    const controller = new VRConsumableUseGestureController({ dwellMilliseconds: 150 });

    controller.process(frame(head, neck), { hand: 'left', armed: true, timestamp: 1_000 });
    controller.process(frame(head, hip), { hand: 'left', armed: true, timestamp: 1_100 });
    expect(controller.isDwelling).toBe(false);
    expect(controller.process(frame(head, neck), { hand: 'left', armed: true, timestamp: 1_200 })).toBeNull();
    expect(controller.process(frame(head, neck), { hand: 'left', armed: true, timestamp: 1_300 })).toBeNull();
    expect(controller.process(frame(head, neck), { hand: 'left', armed: true, timestamp: 1_360 })).not.toBeNull();
  });

  test('nothing armed: the hand at the face does nothing and keeps no dwell', () => {
    const controller = new VRConsumableUseGestureController({ dwellMilliseconds: 0 });

    expect(controller.process(frame(head, neck), { hand: 'left', armed: false, timestamp: 1_000 })).toBeNull();
    expect(controller.isDwelling).toBe(false);
  });

  test('the hand at the hip, or above the head, is outside the zone', () => {
    const controller = new VRConsumableUseGestureController({ dwellMilliseconds: 0 });

    expect(controller.process(frame(head, hip), { hand: 'left', armed: true, timestamp: 1_000 })).toBeNull();
    expect(controller.process(frame(head, new THREE.Vector3(0, 0, 1.9)), { hand: 'left', armed: true, timestamp: 1_100 })).toBeNull();
  });

  test('the dominant hand at the neck does not use the off-hand item', () => {
    const controller = new VRConsumableUseGestureController({ dwellMilliseconds: 0 });

    expect(controller.process(frame(head, neck, 'right'), { hand: 'left', armed: true, timestamp: 1_000 })).toBeNull();
  });

  test('a cooldown follows a use, and reset clears it', () => {
    const controller = new VRConsumableUseGestureController({ dwellMilliseconds: 0, cooldownMilliseconds: 800 });

    expect(controller.process(frame(head, neck), { hand: 'left', armed: true, timestamp: 1_000 })).not.toBeNull();
    expect(controller.process(frame(head, neck), { hand: 'left', armed: true, timestamp: 1_400 })).toBeNull();
    expect(controller.process(frame(head, neck), { hand: 'left', armed: true, timestamp: 1_900 })).not.toBeNull();
    controller.reset();
    expect(controller.process(frame(head, neck), { hand: 'left', armed: true, timestamp: 2_000 })).not.toBeNull();
  });

  test('rejects impossible configuration', () => {
    expect(() => new VRConsumableUseGestureController({ zoneRadiusMetres: 0 })).toThrow(RangeError);
    expect(() => new VRConsumableUseGestureController({ dwellMilliseconds: -1 })).toThrow(RangeError);
  });
});

function frame(headPosition: THREE.Vector3, handPosition: THREE.Vector3, hand: 'left' | 'right' = 'left'): XRInputFrame {
  const pose = (position: THREE.Vector3): XRWorldPose => ({
    position: position.clone(), orientation: new THREE.Quaternion(), linearVelocity: null, angularVelocity: null, trackingState: 'tracked',
  });
  return {
    timestamp: 1_000,
    head: pose(headPosition),
    hands: {
      [hand]: {
        hand, pose: pose(handPosition), targetRayPose: pose(handPosition),
        buttons: {}, axes: [], interactionProfile: 'oculus-touch-v3',
      },
    },
    activeInteractionProfiles: ['oculus-touch-v3'],
  };
}
