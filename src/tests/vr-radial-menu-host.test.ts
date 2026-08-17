import * as THREE from 'three';
import { describe, expect, jest, test } from '@jest/globals';
import { VRRadialMenuHost } from '@/vr/runtime/VRRadialMenuHost';
import { XRWorldPose } from '@/vr/runtime/XRTypes';

describe('VRRadialMenuHost', () => {
  test('anchors the held radial at the off-hand while facing the player', () => {
    const previousDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: (): HTMLCanvasElement => ({ width: 0, height: 0, getContext: (): Partial<CanvasRenderingContext2D> => canvasContext() } as unknown as HTMLCanvasElement),
    };
    const host = new VRRadialMenuHost(new THREE.Scene());

    host.present(
      pose(new THREE.Vector3(1, 2, 1.2), new THREE.Quaternion()),
      pose(new THREE.Vector3(1, 0, 1.7), new THREE.Quaternion()),
      [{ id: 'attack', label: 'Attack', icon: 'i_attack', activate: (): void => {} }],
      0
    );

    expect(host.object.visible).toBe(true);
    expect(host.object.position.x).toBeCloseTo(1);
    expect(host.object.position.y).toBeGreaterThan(2);
    expect(host.object.scale.x).toBeCloseTo(0.38);
    (globalThis as { document?: unknown }).document = previousDocument;
  });
});

function pose(position: THREE.Vector3, orientation: THREE.Quaternion): XRWorldPose {
  return { position, orientation, linearVelocity: null, angularVelocity: null, trackingState: 'tracked' };
}

function canvasContext(): Partial<CanvasRenderingContext2D> {
  return {
    clearRect: jest.fn(), fillStyle: '', beginPath: jest.fn(), moveTo: jest.fn(), arc: jest.fn(), closePath: jest.fn(), fill: jest.fn(),
    strokeStyle: '', lineWidth: 0, stroke: jest.fn(), font: '', textAlign: 'center', textBaseline: 'middle', fillText: jest.fn(),
  };
}
