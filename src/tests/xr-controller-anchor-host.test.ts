import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { XRControllerAnchorHost } from '@/vr/runtime/XRControllerAnchorHost';
import { XRInputFrame, XRWorldPose } from '@/vr/runtime/XRTypes';

describe('XRControllerAnchorHost', () => {
  test('places tracked hands relative to the rig and clears stale tracking', () => {
    const rig = new THREE.Group();
    rig.position.set(10, 20, 2);
    rig.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    rig.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    rig.updateMatrixWorld(true);
    const host = new XRControllerAnchorHost(rig, false);
    const worldOrientation = rig.getWorldQuaternion(new THREE.Quaternion());

    host.update(inputFrame({
      position: new THREE.Vector3(9.5, 20.25, 3.2),
      orientation: worldOrientation,
      linearVelocity: null,
      angularVelocity: null,
      trackingState: 'tracked',
    }));

    const rightAnchor = host.getAnchor('right');
    expect(rightAnchor.visible).toBe(true);
    expect(rightAnchor.position.x).toBeCloseTo(0.25);
    expect(rightAnchor.position.y).toBeCloseTo(1.2);
    expect(rightAnchor.position.z).toBeCloseTo(-0.5);
    expect(rightAnchor.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0);

    host.clear();

    expect(rightAnchor.visible).toBe(false);
  });

  test('aims the interaction ray from the target-ray pose instead of the grip pose', () => {
    const rig = new THREE.Group();
    const host = new XRControllerAnchorHost(rig, true);
    const gripPose = worldPose(new THREE.Vector3(0.2, 1.2, -0.4));
    const rayPose = worldPose(
      new THREE.Vector3(0.25, 1.25, -0.5),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
    );

    host.update(inputFrame(gripPose, rayPose));

    const rayAnchor = host.getRayAnchor('right');
    expect(rayAnchor.position.toArray()).toEqual([0.25, 1.25, -0.5]);
    expect(rayAnchor.quaternion.angleTo(rayPose.orientation)).toBeCloseTo(0);
  });

  test('uses controller rays without an equipped item and accepts an engine-owned item visual', () => {
    const rig = new THREE.Group();
    const host = new XRControllerAnchorHost(rig);

    host.update(inputFrame(worldPose(new THREE.Vector3(0.2, 1.2, -0.4))));

    expect(host.getAnchor('right').getObjectByName('Kotor2VR.rightHandVisual')).toBeUndefined();
    expect(host.getRayAnchor('right').visible).toBe(true);
    const source = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1));
    host.setHeldVisual('right', source);
    host.update(inputFrame(worldPose(new THREE.Vector3(0.2, 1.2, -0.4))));
    expect(host.getAnchor('right').getObjectByName('Kotor2VR.rightHeldItem')).toBeDefined();
    expect(host.getRayAnchor('right').visible).toBe(false);

    host.setHeldVisual('right', null);
    host.update(inputFrame(worldPose(new THREE.Vector3(0.2, 1.2, -0.4))));
    expect(host.getRayAnchor('right').visible).toBe(true);
  });
});

function inputFrame(rightPose: XRWorldPose, targetRayPose = rightPose): XRInputFrame {
  return {
    timestamp: 1000,
    head: {
      position: new THREE.Vector3(),
      orientation: new THREE.Quaternion(),
      linearVelocity: null,
      angularVelocity: null,
      trackingState: 'tracked',
    },
    hands: {
      right: {
        hand: 'right',
        pose: rightPose,
        targetRayPose,
        buttons: {},
        axes: [],
        interactionProfile: 'oculus-touch-v3',
      },
    },
    activeInteractionProfiles: ['oculus-touch-v3'],
  };
}

function worldPose(
  position: THREE.Vector3,
  orientation = new THREE.Quaternion()
): XRWorldPose {
  return {
    position,
    orientation,
    linearVelocity: null,
    angularVelocity: null,
    trackingState: 'tracked',
  };
}
