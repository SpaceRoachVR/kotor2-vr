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

  test('uses the selected left dominant controller for a directional Force gesture', () => {
    const controller = new VRForceGestureController({ minimumFlickSpeedMetresPerSecond: 1 });

    const gesture = controller.process(
      frame(new THREE.Vector3(0, 0, -2), 'left'),
      true,
      1_000,
      'left',
    );

    expect(gesture).toMatchObject({ kind: 'push', hand: 'left' });
  });
  test('without pose velocity (Virtual Desktop) a flick is measured from successive positions', () => {
    // Round 15: VDXR reports no linearVelocity, so Push and Pull never fired.
    const controller = new VRForceGestureController({ minimumFlickSpeedMetresPerSecond: 1 });
    const at = (z: number): XRInputFrame => {
      const f = frame(new THREE.Vector3());
      const hand = f.hands.right!;
      return { ...f, hands: { right: { ...hand, pose: { ...hand.pose, position: new THREE.Vector3(0, 0, z), linearVelocity: null as THREE.Vector3 | null } } } };
    };

    // The hand is tracked before the grip goes down, so the first gripped
    // frame already has a speed.
    expect(controller.process(at(0), false, 1_000)).toBeNull();
    expect(controller.process(at(-0.04), true, 1_020)).toMatchObject({ kind: 'push', hand: 'right' });
    controller.reset();
    controller.process(at(0), false, 2_000);
    expect(controller.process(at(0.04), true, 2_020)).toMatchObject({ kind: 'pull' });
    controller.process(at(0), false, 3_000);
    expect(controller.process(at(0.002), true, 3_020)).toBeNull();
  });

});

function frame(velocity: THREE.Vector3, hand: 'left' | 'right' = 'right'): XRInputFrame {
  const pose = (position: THREE.Vector3, linearVelocity: THREE.Vector3 | null = null): XRWorldPose => ({
    position, orientation: new THREE.Quaternion(), linearVelocity, angularVelocity: null, trackingState: 'tracked',
  });
  return {
    timestamp: 1_000,
    head: pose(new THREE.Vector3(0, 0, 1.7)),
    hands: {
      [hand]: {
        hand, pose: pose(new THREE.Vector3(), velocity), targetRayPose: pose(new THREE.Vector3()),
        buttons: {}, axes: [], interactionProfile: 'oculus-touch-v3',
      },
    },
    activeInteractionProfiles: ['oculus-touch-v3'],
  };
}
