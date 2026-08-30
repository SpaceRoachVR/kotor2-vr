import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { VRForceGestureController } from '@/vr/runtime/VRForceGestureController';
import { XRInputFrame, XRWorldPose } from '@/vr/runtime/XRTypes';

describe('VRForceGestureController', () => {
  test('recognizes a grip-modified forward flick as Force push', () => {
    const controller = new VRForceGestureController({ minimumFlickSpeedMetresPerSecond: 1 });

    const gesture = controller.process(frame(new THREE.Vector3(0, 0, -2)), true, 1_000);

    expect(gesture).toMatchObject({ kind: 'push', hand: 'right' });
  });

  test('recognizes a grip-modified backward flick as Force pull', () => {
    const controller = new VRForceGestureController({ minimumFlickSpeedMetresPerSecond: 1 });

    const gesture = controller.process(frame(new THREE.Vector3(0, 0, 2)), true, 1_000);

    expect(gesture).toMatchObject({ kind: 'pull', hand: 'right' });
  });

  test('does not cast from ordinary controller motion without the grip modifier', () => {
    const controller = new VRForceGestureController({ minimumFlickSpeedMetresPerSecond: 1 });

    expect(controller.process(frame(new THREE.Vector3(0, 0, -2)), false, 1_000)).toBeNull();
  });
});

function frame(velocity: THREE.Vector3): XRInputFrame {
  const pose = (position: THREE.Vector3, linearVelocity: THREE.Vector3 | null = null): XRWorldPose => ({
    position, orientation: new THREE.Quaternion(), linearVelocity, angularVelocity: null, trackingState: 'tracked',
  });
  return {
    timestamp: 1_000,
    head: pose(new THREE.Vector3(0, 0, 1.7)),
    hands: {
      right: {
        hand: 'right', pose: pose(new THREE.Vector3(), velocity), targetRayPose: pose(new THREE.Vector3()),
        buttons: {}, axes: [], interactionProfile: 'oculus-touch-v3',
      },
    },
    activeInteractionProfiles: ['oculus-touch-v3'],
  };
}
