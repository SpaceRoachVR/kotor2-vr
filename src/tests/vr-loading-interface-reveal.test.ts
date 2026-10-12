import { describe, expect, test } from '@jest/globals';
import * as THREE from 'three';
import { revealVRInterfaceOverHiddenWorld } from '@/vr/runtime/VRTheaterWorldVisibility';

// Allen, 2026-10-02: players waited in black during loads. The engine hides the
// world scene, and the VR panel showing the loading screen is its child.
describe('the loading screen over a hidden world', () => {
  const build = () => {
    const scene = new THREE.Scene();
    const panel = new THREE.Object3D(); panel.name = 'Kotor2VR.VRPanelHost';
    const ray = new THREE.Object3D(); ray.name = 'Kotor2VR.VRPanelPointerRay';
    const room = new THREE.Object3D(); room.name = 'room';
    const off = new THREE.Object3D(); off.name = 'already-hidden'; off.visible = false;
    scene.add(panel, ray, room, off);
    return { scene, panel, ray, room, off };
  };

  test('shows only the panel and its pointer while the engine hides the world, then restores', () => {
    const { scene, panel, ray, room, off } = build();
    scene.visible = false;
    const restore = revealVRInterfaceOverHiddenWorld(scene);
    expect(scene.visible).toBe(true);
    expect([panel.visible, ray.visible, room.visible, off.visible]).toEqual([true, true, false, false]);
    restore();
    expect(scene.visible).toBe(false);
    expect([panel.visible, ray.visible, room.visible, off.visible]).toEqual([true, true, true, false]);
  });

  test('does nothing while the world is visible, or when no panel is up', () => {
    const a = build();
    revealVRInterfaceOverHiddenWorld(a.scene)();
    expect(a.room.visible).toBe(true);
    const b = build();
    b.scene.visible = false;
    b.panel.visible = false;
    revealVRInterfaceOverHiddenWorld(b.scene);
    expect(b.scene.visible).toBe(false);
  });
});
