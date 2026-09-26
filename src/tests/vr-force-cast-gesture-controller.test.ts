import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { VRForceCastGestureController } from '@/vr/runtime/VRForceCastGestureController';
import { XRInputFrame, XRWorldPose } from '@/vr/runtime/XRTypes';

// ROADMAP 3.19 — the generic Force cast: an open-palm off-hand thrust toward
// the locked target. Frames are in world space, target to the hand's -Z.

describe('VRForceCastGestureController', () => {
  const target = new THREE.Vector3(0, 0, -3);

  test('an open-palm off-hand thrust toward the target is a cast', () => {
    const controller = new VRForceCastGestureController();

    const gesture = controller.process(frame(new THREE.Vector3(0, 0, -2), 'left'), {
      hand: 'left', palmOpen: true, targetPoint: target, timestamp: 1_000,
    });

    expect(gesture).toMatchObject({ kind: 'cast', hand: 'left', towardTarget: true });
    expect(gesture?.speedMetresPerSecond).toBeCloseTo(2);
    expect(gesture?.alignment).toBeCloseTo(1);
  });

  test('a closed hand — grip or trigger held — never casts', () => {
    const controller = new VRForceCastGestureController();

    expect(controller.process(frame(new THREE.Vector3(0, 0, -2), 'left'), {
      hand: 'left', palmOpen: false, targetPoint: target, timestamp: 1_000,
    })).toBeNull();
  });

  test('a thrust away from the target, or across it, is not a cast', () => {
    const controller = new VRForceCastGestureController();

    expect(controller.process(frame(new THREE.Vector3(0, 0, 2), 'left'), {
      hand: 'left', palmOpen: true, targetPoint: target, timestamp: 1_000,
    })).toBeNull();
    expect(controller.process(frame(new THREE.Vector3(2, 0, -0.2), 'left'), {
      hand: 'left', palmOpen: true, targetPoint: target, timestamp: 1_000,
    })).toBeNull();
  });

  test('a slow reach toward the target is not a cast', () => {
    const controller = new VRForceCastGestureController();

    expect(controller.process(frame(new THREE.Vector3(0, 0, -0.6), 'left'), {
      hand: 'left', palmOpen: true, targetPoint: target, timestamp: 1_000,
    })).toBeNull();
  });

  test('a thrust within 60 degrees of the target still counts', () => {
    const controller = new VRForceCastGestureController();
    // 45 degrees off the line to the target, fast enough along it.
    const gesture = controller.process(frame(new THREE.Vector3(2, 0, -2), 'left'), {
      hand: 'left', palmOpen: true, targetPoint: target, timestamp: 1_000,
    });

    expect(gesture).not.toBeNull();
    // Roughly 45 degrees off: the hand sits a little left of the head, so the
    // line to the target is not exactly -Z.
    expect(gesture?.alignment).toBeGreaterThan(0.6);
    expect(gesture?.alignment).toBeLessThan(0.85);
  });

  test('without a target point the head forward decides the direction', () => {
    const controller = new VRForceCastGestureController();

    const gesture = controller.process(frame(new THREE.Vector3(0, 0, -2), 'left'), {
      hand: 'left', palmOpen: true, targetPoint: null, timestamp: 1_000,
    });

    expect(gesture).toMatchObject({ kind: 'cast', towardTarget: false });
  });

  test('a cooldown separates two casts, and reset clears it', () => {
    const controller = new VRForceCastGestureController({ cooldownMilliseconds: 500 });
    const input = { hand: 'left' as const, palmOpen: true, targetPoint: target };

    expect(controller.process(frame(new THREE.Vector3(0, 0, -2), 'left'), { ...input, timestamp: 1_000 })).not.toBeNull();
    expect(controller.process(frame(new THREE.Vector3(0, 0, -2), 'left'), { ...input, timestamp: 1_200 })).toBeNull();
    expect(controller.process(frame(new THREE.Vector3(0, 0, -2), 'left'), { ...input, timestamp: 1_600 })).not.toBeNull();
    controller.reset();
    expect(controller.process(frame(new THREE.Vector3(0, 0, -2), 'left'), { ...input, timestamp: 1_700 })).not.toBeNull();
  });

  test('the other hand moving does not cast for this one', () => {
    const controller = new VRForceCastGestureController();

    expect(controller.process(frame(new THREE.Vector3(0, 0, -2), 'right'), {
      hand: 'left', palmOpen: true, targetPoint: target, timestamp: 1_000,
    })).toBeNull();
  });

  test('rejects impossible configuration', () => {
    expect(() => new VRForceCastGestureController({ minimumThrustSpeedMetresPerSecond: 0 })).toThrow(RangeError);
    expect(() => new VRForceCastGestureController({ minimumAlignmentCosine: 1.5 })).toThrow(RangeError);
    expect(() => new VRForceCastGestureController({ cooldownMilliseconds: -1 })).toThrow(RangeError);
  });
});

function frame(velocity: THREE.Vector3, hand: 'left' | 'right'): XRInputFrame {
  const pose = (position: THREE.Vector3, linearVelocity: THREE.Vector3 | null = null): XRWorldPose => ({
    position, orientation: new THREE.Quaternion(), linearVelocity, angularVelocity: null, trackingState: 'tracked',
  });
  return {
    timestamp: 1_000,
    head: pose(new THREE.Vector3(0, 0, 0.3)),
    hands: {
      [hand]: {
        hand, pose: pose(new THREE.Vector3(hand === 'left' ? -0.2 : 0.2, 0, 0), velocity),
        targetRayPose: pose(new THREE.Vector3()),
        buttons: {}, axes: [], interactionProfile: 'oculus-touch-v3',
      },
    },
    activeInteractionProfiles: ['oculus-touch-v3'],
  };
}
