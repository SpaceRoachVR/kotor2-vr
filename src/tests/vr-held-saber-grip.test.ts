import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import {
  measureVRSaberGripCentre,
  resolveVRSaberGripCentre,
  VR_FIST_EMITTER_SIDE_METRES,
  VR_FIST_POMMEL_SIDE_METRES,
  VR_SABER_POMMEL_SHOWN_METRES,
} from '@/vr/runtime/VRHeldSaberGrip';

/** Retail hilt and emitter measurements (model space, metres). */
const SINGLE = { min: -0.204, max: 0.132, emitters: [{ z: 0.121, direction: 1 as const }] };
const SHORT = { min: -0.156, max: 0.176, emitters: [{ z: 0.104, direction: 1 as const }] };
const DOUBLE = {
  min: -0.119,
  max: 0.475,
  emitters: [{ z: 0.406, direction: 1 as const }, { z: -0.05, direction: -1 as const }],
};

/** Hilt shown below the fist once the fist sits on `centre` (model +Z is up the blade). */
function pommelShown(hiltMin: number, centre: number): number {
  return (centre - VR_FIST_POMMEL_SIDE_METRES) - hiltMin;
}

describe('resolveVRSaberGripCentre', () => {
  test('single saber: only a short pommel below the fist, the emitter clear above it', () => {
    const centre = resolveVRSaberGripCentre(SINGLE.min, SINGLE.max, SINGLE.emitters)!;
    expect(pommelShown(SINGLE.min, centre)).toBeCloseTo(VR_SABER_POMMEL_SHOWN_METRES, 5);
    expect(centre + VR_FIST_EMITTER_SIDE_METRES).toBeLessThan(0.121);
    // Before: the fist closed on the model origin, leaving 16 cm below it.
    expect(pommelShown(SINGLE.min, 0)).toBeGreaterThan(0.16);
  });

  test('short saber gets the same short pommel', () => {
    const centre = resolveVRSaberGripCentre(SHORT.min, SHORT.max, SHORT.emitters)!;
    expect(pommelShown(SHORT.min, centre)).toBeCloseTo(VR_SABER_POMMEL_SHOWN_METRES, 5);
    expect(centre + VR_FIST_EMITTER_SIDE_METRES).toBeLessThan(0.104);
  });

  test('double-bladed saber is held between its emitters', () => {
    expect(resolveVRSaberGripCentre(DOUBLE.min, DOUBLE.max, DOUBLE.emitters)).toBeCloseTo(0.178, 5);
  });

  test('a short hilt never closes the fist over the emitter', () => {
    const centre = resolveVRSaberGripCentre(-0.05, 0.1, [{ z: 0.09, direction: 1 }])!;
    expect(centre + VR_FIST_EMITTER_SIDE_METRES).toBeLessThanOrEqual(0.09);
  });

  test('a blade along -Z mirrors the result', () => {
    const centre = resolveVRSaberGripCentre(-SINGLE.max, -SINGLE.min, [{ z: -0.121, direction: -1 }])!;
    expect(centre).toBeCloseTo(-resolveVRSaberGripCentre(SINGLE.min, SINGLE.max, SINGLE.emitters)!, 5);
  });

  test('no blade or no hilt: no saber grip', () => {
    expect(resolveVRSaberGripCentre(SINGLE.min, SINGLE.max, [])).toBeNull();
    expect(resolveVRSaberGripCentre(Infinity, -Infinity, SINGLE.emitters)).toBeNull();
  });
});

function saberModel(bladeScale: number): THREE.Object3D {
  const root = new THREE.Group();
  root.position.set(4, 5, 6);
  root.rotation.set(0.3, -0.2, 1.1);
  const hiltGeometry = new THREE.BufferGeometry();
  hiltGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, -0.204, 0.02, 0, 0.132, -0.02, 0.01, 0,
  ], 3));
  const hilt = new THREE.Mesh(hiltGeometry, new THREE.MeshBasicMaterial());
  root.add(hilt);
  const bladeGeometry = new THREE.BufferGeometry();
  bladeGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1, 0.01, 0, 1], 3));
  const blade = new THREE.Mesh(bladeGeometry, new THREE.MeshBasicMaterial());
  (blade as unknown as { odysseyNode: { nodeType: number } }).odysseyNode = { nodeType: 0x0821 };
  blade.position.set(0, 0, 0.121);
  blade.scale.setScalar(bladeScale);
  root.add(blade);
  return root;
}

describe('measureVRSaberGripCentre', () => {
  test('reads the hilt and emitter from the model, lit or off', () => {
    const expected = resolveVRSaberGripCentre(SINGLE.min, SINGLE.max, SINGLE.emitters)!;
    expect(measureVRSaberGripCentre(saberModel(1))).toBeCloseTo(expected, 4);
    // An unlit blade is scaled to nothing; its side of the hilt still says which way it points.
    expect(measureVRSaberGripCentre(saberModel(0))).toBeCloseTo(expected, 4);
  });

  test('a weapon without saber blades is left alone', () => {
    const root = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.1, 0, 0, 0.9, 0, 0.01, 0], 3));
    root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
    expect(measureVRSaberGripCentre(root)).toBeNull();
  });
});
