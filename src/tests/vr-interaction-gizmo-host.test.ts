import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { InteractionTargetRegistry } from '@/vr/runtime/InteractionTargetRegistry';
import { VRInteractionGizmoHost } from '@/vr/runtime/debug/VRInteractionGizmoHost';
import { XRInputFrame } from '@/vr/runtime/XRTypes';

function createMockFrame(linVelX = 0): XRInputFrame {
  return {
    timestamp: 1000,
    head: {
      position: new THREE.Vector3(0, 1.7, 0),
      orientation: new THREE.Quaternion(0, 0, 0, 1),
      linearVelocity: null,
      angularVelocity: null,
      trackingState: 'tracked',
    },
    hands: {
      right: {
        hand: 'right',
        pose: {
          position: new THREE.Vector3(0.3, 1.2, -0.4),
          orientation: new THREE.Quaternion(0, 0, 0, 1),
          linearVelocity: new THREE.Vector3(linVelX, 0, 0),
          angularVelocity: null,
          trackingState: 'tracked',
        },
        targetRayPose: {
          position: new THREE.Vector3(0.3, 1.2, -0.4),
          orientation: new THREE.Quaternion(0, 0, 0, 1), // Points along -Z
          linearVelocity: null,
          angularVelocity: null,
          trackingState: 'tracked',
        },
        buttons: {},
        axes: [0, 0],
        interactionProfile: 'meta-quest-touch-plus',
      },
    },
    activeInteractionProfiles: ['meta-quest-touch-plus'],
  };
}

describe('VRInteractionGizmoHost', () => {
  test('creates root group and attaches to world scene', () => {
    const scene = new THREE.Scene();
    const host = new VRInteractionGizmoHost(scene);

    expect(host.isEnabled()).toBe(false);
    expect(host.root.visible).toBe(false);
    expect(scene.children).toContain(host.root);
  });

  test('toggles visibility and enabled state', () => {
    const scene = new THREE.Scene();
    const host = new VRInteractionGizmoHost(scene);

    host.setEnabled(true);
    expect(host.isEnabled()).toBe(true);
    expect(host.root.visible).toBe(true);

    host.toggle();
    expect(host.isEnabled()).toBe(false);
    expect(host.root.visible).toBe(false);
  });

  test('updates target wireframes and controller rays', () => {
    const scene = new THREE.Scene();
    const host = new VRInteractionGizmoHost(scene, { enabled: true });
    const registry = new InteractionTargetRegistry();

    // Register a mock interactive target at (0.3, 1.2, -2.0) directly in line with right ray
    registry.register({
      id: 'mock_console',
      label: 'Security Terminal',
      radiusMetres: 0.5,
      interactionModes: ['ray', 'near-touch'],
      getWorldPosition: (out) => out.set(0.3, 1.2, -2.0),
      isAvailable: () => true,
      activate: () => {},
    });

    const frame = createMockFrame(1.5);
    host.update(frame, registry);

    // Right ray should be visible
    expect(host.root.visible).toBe(true);

    // Dispose
    host.dispose();
    expect(scene.children).not.toContain(host.root);
  });
});
