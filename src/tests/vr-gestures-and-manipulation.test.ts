import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { ForcePullGesture, ForcePushGesture, MeleeSwingHorizontal } from '@/vr/runtime/gestures/StandardGestures';
import { VRGestureStateMachine } from '@/vr/runtime/gestures/VRGestureStateMachine';
import { VRGrabHandle } from '@/vr/runtime/manipulation/VRGrabHandle';
import { VRPhysicalSocket } from '@/vr/runtime/manipulation/VRPhysicalSocket';
import { XRInputFrame } from '@/vr/runtime/XRTypes';

function makeFrame(options: {
  timestamp: number;
  rightPos?: THREE.Vector3;
  rightVel?: THREE.Vector3;
  gripPressed?: boolean;
}): XRInputFrame {
  return {
    timestamp: options.timestamp,
    head: {
      position: new THREE.Vector3(0, 1.7, 0),
      orientation: new THREE.Quaternion(0, 0, 0, 1), // Looking down -Z
      linearVelocity: null,
      angularVelocity: null,
      trackingState: 'tracked',
    },
    hands: {
      right: {
        hand: 'right',
        pose: {
          position: options.rightPos ?? new THREE.Vector3(0.2, 1.2, -0.4),
          orientation: new THREE.Quaternion(0, 0, 0, 1),
          linearVelocity: options.rightVel ?? null,
          angularVelocity: null,
          trackingState: 'tracked',
        },
        targetRayPose: {
          position: options.rightPos ?? new THREE.Vector3(0.2, 1.2, -0.4),
          orientation: new THREE.Quaternion(0, 0, 0, 1),
          linearVelocity: null,
          angularVelocity: null,
          trackingState: 'tracked',
        },
        buttons: {
          squeeze: { pressed: options.gripPressed === true, touched: options.gripPressed === true, value: options.gripPressed ? 1 : 0 },
        },
        axes: [0, 0],
        interactionProfile: 'meta-quest-touch-plus',
      },
    },
    activeInteractionProfiles: ['meta-quest-touch-plus'],
  };
}

describe('VRGestureStateMachine', () => {
  test('recognizes Force Push when grip held and flicked forward along -Z', () => {
    const sm = new VRGestureStateMachine();
    sm.registerGesture(ForcePushGesture);
    sm.registerGesture(ForcePullGesture);

    // Initial frame at timestamp 0
    sm.process(makeFrame({ timestamp: 0, gripPressed: true }));

    // Fast forward flick: velocity along -Z at 1.8 m/s (above 1.2 threshold)
    const forwardVel = new THREE.Vector3(0, 0, -1.8);
    const results = sm.process(makeFrame({
      timestamp: 50,
      gripPressed: true,
      rightVel: forwardVel,
    }));

    expect(results.length).toBe(1);
    expect(results[0].gestureId).toBe('force-push');
    expect(results[0].speedMetresPerSecond).toBeCloseTo(1.8, 1);
  });

  test('refuses Force Push if grip modifier is not pressed', () => {
    const sm = new VRGestureStateMachine();
    sm.registerGesture(ForcePushGesture);

    sm.process(makeFrame({ timestamp: 0, gripPressed: false }));

    const forwardVel = new THREE.Vector3(0, 0, -1.8);
    const results = sm.process(makeFrame({
      timestamp: 50,
      gripPressed: false,
      rightVel: forwardVel,
    }));

    expect(results.length).toBe(0);
  });

  test('recognizes Melee Swing on rapid horizontal sweep', () => {
    const sm = new VRGestureStateMachine();
    sm.registerGesture(MeleeSwingHorizontal);

    sm.process(makeFrame({ timestamp: 0, rightPos: new THREE.Vector3(-0.3, 1.2, -0.4) }));

    const results = sm.process(makeFrame({
      timestamp: 40,
      rightPos: new THREE.Vector3(0.4, 1.22, -0.4),
      rightVel: new THREE.Vector3(1.5, 0.1, 0), // Speed 1.5 m/s > 0.8
    }));

    expect(results.length).toBe(1);
    expect(results[0].gestureId).toBe('melee-swing-horizontal');
  });
});

describe('VRPhysicalSocket', () => {
  test('attaches and detaches items based on location and reach', () => {
    const hip = new VRPhysicalSocket({ location: 'hip-right', snapRadiusMetres: 0.2 });
    const headPos = new THREE.Vector3(0, 1.7, 0);
    const headRot = new THREE.Quaternion(0, 0, 0, 1);

    const worldPos = hip.getWorldPosition(headPos, headRot, new THREE.Vector3());
    expect(worldPos.x).toBeCloseTo(0.25, 2);
    expect(worldPos.y).toBeCloseTo(1.05, 2);

    expect(hip.isOccupied()).toBe(false);
    expect(hip.attachItem({ id: 'saber_01', tag: 'lightsaber' })).toBe(true);
    expect(hip.isOccupied()).toBe(true);

    const detached = hip.detachItem();
    expect(detached?.id).toBe('saber_01');
    expect(hip.isOccupied()).toBe(false);
  });
});

describe('VRGrabHandle', () => {
  test('tracks linear pull progress and commits when passing threshold', () => {
    const handle = new VRGrabHandle({
      id: 'door_latch',
      constraint: 'linear',
      axis: new THREE.Vector3(1, 0, 0),
      minLimit: 0,
      maxLimit: 0.5,
      commitThreshold: 0.8,
    });

    let committed = false;
    handle.onCommitted = () => { committed = true; };

    const startPos = new THREE.Vector3(0, 1, 0);
    handle.startGrab('right', startPos, startPos);

    // Pull 0.2m along X (0.2 / 0.5 = 40%)
    handle.updateGrab(new THREE.Vector3(0.2, 1, 0));
    expect(handle.getValue()).toBeCloseTo(0.4, 2);
    expect(committed).toBe(false);

    // Pull 0.45m along X (0.45 / 0.5 = 90% > 80% threshold)
    handle.updateGrab(new THREE.Vector3(0.45, 1, 0));
    expect(handle.getValue()).toBeCloseTo(0.9, 2);
    expect(committed).toBe(true);

    handle.releaseGrab();
    expect(handle.isGrabbed()).toBe(false);
  });
});
