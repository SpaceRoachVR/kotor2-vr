import * as THREE from 'three';
import { describe, expect, jest, test } from '@jest/globals';
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
    host.setHeldVisual('right', {
      model: source,
      baseItemClass: 'blaster-pistol',
      classFallback: { scale: 0.01 },
    });
    host.update(inputFrame(worldPose(new THREE.Vector3(0.2, 1.2, -0.4))));
    expect(host.getAnchor('right').getObjectByName('Kotor2VR.rightHeldItem')).toBeDefined();
    expect(host.getRayAnchor('right').visible).toBe(false);

    host.setHeldVisual('right', null);
    host.update(inputFrame(worldPose(new THREE.Vector3(0.2, 1.2, -0.4))));
    expect(host.getRayAnchor('right').visible).toBe(true);
  });

  test('[runtime=emulated] aligns a flattened presentation model at an authored grip node', () => {
    const rig = new THREE.Group();
    const host = new XRControllerAnchorHost(rig);
    const source = new THREE.Group();
    const grip = new THREE.Group();
    grip.name = 'grip';
    grip.position.set(2, 0, 0);
    const modelMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    modelMesh.position.set(3, 0, 0);
    source.add(grip, modelMesh);

    host.setHeldVisual('right', {
      model: source,
      baseItemClass: 'lightsaber',
      authoredGripNode: grip,
      classFallback: { position: new THREE.Vector3(9, 0, 0), scale: 0.01 },
    });

    const visual = host.getAnchor('right').getObjectByName('Kotor2VR.rightHeldItem')!;
    const mesh = visual.children[0] as THREE.Mesh;
    expect(visual.position.toArray()).toEqual([0, 0, 0]);
    expect(visual.scale.toArray()).toEqual([1, 1, 1]);
    expect(mesh.matrix.elements[12]).toBeCloseTo(1);
  });

  test('[runtime=emulated] uses the descriptor class fallback when no authored grip exists without disposing shared resources', () => {
    const rig = new THREE.Group();
    const host = new XRControllerAnchorHost(rig);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    const source = new THREE.Mesh(geometry, material);
    const disposeGeometry = jest.spyOn(geometry, 'dispose');
    const disposeMaterial = jest.spyOn(material, 'dispose');

    host.setHeldVisual('right', {
      model: source,
      baseItemClass: 't3-integrated-blaster',
      classFallback: {
        position: new THREE.Vector3(0.04, -0.02, -0.11),
        rotation: new THREE.Euler(0, Math.PI / 4, 0),
        scale: 0.015,
      },
    });

    const visual = host.getAnchor('right').getObjectByName('Kotor2VR.rightHeldItem')!;
    expect(visual.visible).toBe(true);
    expect(visual.position.toArray()).toEqual([0.04, -0.02, -0.11]);
    expect(visual.scale.toArray()).toEqual([0.015, 0.015, 0.015]);
    expect(visual.rotation.y).toBeCloseTo(Math.PI / 4);

    host.dispose();
    expect(disposeGeometry).not.toHaveBeenCalled();
    expect(disposeMaterial).not.toHaveBeenCalled();
  });

  test('does not rebuild a held presentation when an equivalent descriptor snapshot is refreshed', () => {
    const rig = new THREE.Group();
    const host = new XRControllerAnchorHost(rig);
    const source = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const descriptor = () => ({
      model: source,
      baseItemClass: 'blaster-pistol',
      classFallback: { position: new THREE.Vector3(0, 0, -0.1), scale: 0.01 },
    });

    host.setHeldVisual('right', descriptor());
    const firstVisual = host.getAnchor('right').getObjectByName('Kotor2VR.rightHeldItem');
    host.setHeldVisual('right', descriptor());

    expect(host.getAnchor('right').getObjectByName('Kotor2VR.rightHeldItem')).toBe(firstVisual);
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
