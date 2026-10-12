import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { handVelocity, playSpaceDelta } from '@/vr/runtime/XRPoseMotion';
import { VRForceCastGestureController } from '@/vr/runtime/VRForceCastGestureController';
import { XRInputFrame, XRWorldPose } from '@/vr/runtime/XRTypes';

// Critic run 11: with no runtime pose velocity, walking, strafing or a snap
// turn moved the hand fast enough to swing or cast. Hand motion is measured
// in play space.
describe('playSpaceDelta', () => {
  const rig = (x: number, y: number, yaw: number) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw), new THREE.Vector3(1, 1, 1));
  const handIn = (local: THREE.Vector3, m: THREE.Matrix4) => local.clone().applyMatrix4(m);

  test('a hand held still while the rig walks and snap-turns has not moved', () => {
    const local = new THREE.Vector3(0.3, 0.4, 1.2);
    const before = rig(0, 0, 0);
    const after = rig(0.2, -0.1, Math.PI / 4);
    const delta = playSpaceDelta(handIn(local, before), { trackingToWorld: before }, handIn(local, after), { trackingToWorld: after });
    expect(delta.length()).toBeCloseTo(0);
  });

  test('the hand\'s own motion is kept, in this frame\'s world directions', () => {
    const before = rig(0, 0, 0);
    const after = rig(1, 0, Math.PI / 2);
    const delta = playSpaceDelta(
      handIn(new THREE.Vector3(0, 0.3, 1.2), before), { trackingToWorld: before },
      handIn(new THREE.Vector3(0, 0.35, 1.2), after), { trackingToWorld: after },
    );
    expect(delta.length()).toBeCloseTo(0.05);
    // Play-space +Y is world -X after a 90 degree turn.
    expect(delta.x).toBeCloseTo(-0.05);
  });

  test('without rig transforms it is the world difference', () => {
    expect(playSpaceDelta(new THREE.Vector3(0, 0, 0), null, new THREE.Vector3(0, 1, 0), null).y).toBeCloseTo(1);
  });

  test('walking toward the target with an open hand does not cast a queued power', () => {
    const controller = new VRForceCastGestureController();
    const frameAt = (rigX: number, t: number): XRInputFrame => {
      const m = rig(rigX, 0, 0);
      const position = new THREE.Vector3(-0.2, -0.3, 1.2).applyMatrix4(m);
      const pose: XRWorldPose = { position, orientation: new THREE.Quaternion(), linearVelocity: null, angularVelocity: null, trackingState: 'tracked', trackingToWorld: m };
      return {
        timestamp: t, head: { ...pose, position: new THREE.Vector3(rigX, 0, 1.6) },
        hands: { left: { hand: 'left', pose, targetRayPose: pose, buttons: {}, axes: [], interactionProfile: 'oculus-touch-v3' } },
        activeInteractionProfiles: ['oculus-touch-v3'],
      };
    };
    const input = { hand: 'left' as const, palmOpen: true, targetPoint: new THREE.Vector3(10, 0, 1.2) };
    // Running at 5 m/s toward the target, the hand still in play space.
    expect(controller.process(frameAt(0, 1_000), { ...input, timestamp: 1_000 })).toBeNull();
    expect(controller.process(frameAt(0.1, 1_020), { ...input, timestamp: 1_020 })).toBeNull();
  });
});

describe('handVelocity (critic run 12: a tracking jump swung and killed a droid)', () => {
  test('a 0.25 m jump in one frame is a tracking jump, not motion', () => {
    const v = handVelocity(new THREE.Vector3(0, 0, 0), null, new THREE.Vector3(0.25, 0, 0), null, 0.016);
    expect(v.length()).toBe(0);
  });
  test('a hard real swing (6 m/s) is kept', () => {
    const v = handVelocity(new THREE.Vector3(0, 0, 0), null, new THREE.Vector3(0.1, 0, 0), null, 1 / 60);
    expect(v.length()).toBeCloseTo(6);
  });
});
