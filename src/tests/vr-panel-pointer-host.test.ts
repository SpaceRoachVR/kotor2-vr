import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { VRPanelPointerHost } from '@/vr/runtime/VRPanelPointerHost';
import { XRWorldPose } from '@/vr/runtime/XRTypes';

describe('VRPanelPointerHost', () => {
  test('maps the dominant controller ray hit into centered legacy GUI coordinates', () => {
    const scene = new THREE.Scene();
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    );
    panel.position.set(0, 0, -1);
    panel.scale.set(2, 1, 1);
    scene.add(panel);
    scene.updateMatrixWorld(true);
    const pointer = new VRPanelPointerHost(scene);

    const hit = pointer.update(panel, pose(), 1600, 900);

    expect(hit).not.toBeNull();
    expect(hit!.guiPosition.toArray()).toEqual([0, 0]);
    expect(hit!.distanceMetres).toBeCloseTo(1);
    expect(pointer.rayObject.visible).toBe(true);
    expect(pointer.cursorObject.visible).toBe(true);
  });

  test('keeps the menu ray visible but hides its cursor when the panel is missed', () => {
    const scene = new THREE.Scene();
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    panel.position.set(0, 0, -1);
    scene.add(panel);
    scene.updateMatrixWorld(true);
    const pointer = new VRPanelPointerHost(scene);
    const away = pose(new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.PI / 2
    ));

    expect(pointer.update(panel, away, 1600, 900)).toBeNull();
    expect(pointer.rayObject.visible).toBe(true);
    expect(pointer.cursorObject.visible).toBe(false);

    pointer.clear();
    expect(pointer.rayObject.visible).toBe(false);
  });
});

function pose(orientation = new THREE.Quaternion()): XRWorldPose {
  return {
    position: new THREE.Vector3(),
    orientation,
    linearVelocity: null,
    angularVelocity: null,
    trackingState: 'tracked',
  };
}
