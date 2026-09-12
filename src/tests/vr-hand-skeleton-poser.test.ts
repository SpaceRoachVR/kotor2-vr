import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { VRHandSkeletonPoser, type VRHandJointTransform } from '@/vr/runtime/hands/VRHandSkeletonPoser';
import { VR_HAND_OPEN_CURL, type VRHandFingerCurl } from '@/vr/runtime/hands/VRHandFingerCurl';
import { VRHandModel } from '@/vr/runtime/hands/VRHandModel';
import type { XRHandRole } from '@/vr/runtime/XRTypes';

/**
 * Reads joint rest transforms straight out of the vendored GLB's JSON chunk.
 * No GLTF loader: these tests exercise the real skeleton the game ships
 * without needing three's ESM loaders inside Jest.
 */
function readRestPose(hand: XRHandRole): Map<string, VRHandJointTransform> {
  const file = path.resolve(__dirname, '../../tools/vr-hands/generic-hand', `${hand}.glb`);
  const bytes = fs.readFileSync(file);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
    nodes: { name: string; translation?: number[]; rotation?: number[] }[];
  };
  const rest = new Map<string, VRHandJointTransform>();
  for (const node of json.nodes) {
    if (!node.translation || !node.rotation || node.name.startsWith('xr_standard')) continue;
    rest.set(node.name, {
      position: new THREE.Vector3().fromArray(node.translation),
      quaternion: new THREE.Quaternion().fromArray(node.rotation),
    });
  }
  return rest;
}

const curl = (overrides: Partial<VRHandFingerCurl>): VRHandFingerCurl => ({ ...VR_HAND_OPEN_CURL, ...overrides });

describe('VRHandSkeletonPoser', () => {
  test.each(['left', 'right'] as const)('an open %s hand is the authored rest pose', (hand) => {
    const rest = readRestPose(hand);
    const posed = new VRHandSkeletonPoser(rest, hand).pose(VR_HAND_OPEN_CURL);

    for (const [name, joint] of rest) {
      expect(posed.get(name)!.position.distanceTo(joint.position)).toBeLessThan(1e-9);
      // The authored quaternions are only normalised to ~1e-7, which angleTo
      // amplifies; a milliradian is still an identical pose.
      expect(posed.get(name)!.quaternion.angleTo(joint.quaternion)).toBeLessThan(1e-3);
    }
  });

  test.each(['left', 'right'] as const)('curling the %s index closes it toward the palm without stretching it', (hand) => {
    const rest = readRestPose(hand);
    const poser = new VRHandSkeletonPoser(rest, hand);
    const open = poser.pose(VR_HAND_OPEN_CURL);
    const closed = poser.pose(curl({ index: 1 }));
    const backOfHand = new THREE.Vector3(0, 1, 0).applyQuaternion(rest.get('index-finger-metacarpal')!.quaternion);
    const knuckle = rest.get('index-finger-phalanx-proximal')!.position;

    const openTip = open.get('index-finger-tip')!.position;
    const closedTip = closed.get('index-finger-tip')!.position;
    // Toward the palm is away from the back of the hand.
    expect(closedTip.clone().sub(knuckle).dot(backOfHand)).toBeLessThan(openTip.clone().sub(knuckle).dot(backOfHand) - 0.02);
    // A closed finger folds back toward the wrist.
    const wrist = rest.get('wrist')!.position;
    expect(closedTip.distanceTo(wrist)).toBeLessThan(openTip.distanceTo(wrist) - 0.04);

    const chain = ['index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'];
    for (let i = 1; i < chain.length; i += 1) {
      const restLength = rest.get(chain[i])!.position.distanceTo(rest.get(chain[i - 1])!.position);
      expect(closed.get(chain[i])!.position.distanceTo(closed.get(chain[i - 1])!.position)).toBeCloseTo(restLength, 6);
    }
    // Other digits are untouched.
    expect(closed.get('middle-finger-tip')!.position.distanceTo(open.get('middle-finger-tip')!.position)).toBeLessThan(1e-9);
  });

  test.each(['left', 'right'] as const)('the %s grip frame follows the WebXR grip-space convention', (hand) => {
    const rest = readRestPose(hand);
    const matrix = new VRHandSkeletonPoser(rest, hand).getGripFromArmatureMatrix();
    const rotation = new THREE.Quaternion();
    matrix.decompose(new THREE.Vector3(), rotation, new THREE.Vector3());
    const toGrip = (direction: THREE.Vector3) => direction.clone().applyQuaternion(rotation);

    expect(matrix.determinant()).toBeCloseTo(1, 6);

    // Knuckle line toward the index finger is toward the thumb: grip −Z.
    const towardThumb = rest.get('index-finger-phalanx-proximal')!.position.clone()
      .sub(rest.get('pinky-finger-phalanx-proximal')!.position).normalize();
    expect(toGrip(towardThumb).z).toBeLessThan(-0.8);

    // +X is out of the back of a right hand and out of the palm of a left one.
    const backOfHand = new THREE.Vector3(0, 1, 0).applyQuaternion(rest.get('middle-finger-metacarpal')!.quaternion);
    expect(toGrip(backOfHand).x * (hand === 'right' ? 1 : -1)).toBeGreaterThan(0.9);

    // The grip origin (the held rod) is inside the fist, a few centimetres
    // from the middle knuckle — not at the wrist and not beyond the fingers.
    const knuckleInGrip = rest.get('middle-finger-phalanx-proximal')!.position.clone().applyMatrix4(matrix);
    expect(knuckleInGrip.length()).toBeGreaterThan(0.01);
    expect(knuckleInGrip.length()).toBeLessThan(0.07);
  });

  test('refuses a skeleton that lacks WebXR joints', () => {
    const rest = readRestPose('right');
    rest.delete('thumb-tip');
    expect(() => new VRHandSkeletonPoser(rest, 'right')).toThrow(/thumb-tip/);
  });
});

describe('VRHandModel', () => {
  test('drives the named joint objects and aligns the model to the grip', () => {
    const rest = readRestPose('right');
    const armature = new THREE.Group();
    for (const [name, joint] of rest) {
      const bone = new THREE.Bone();
      bone.name = name;
      bone.position.copy(joint.position);
      bone.quaternion.copy(joint.quaternion);
      armature.add(bone);
    }
    const material = new THREE.MeshBasicMaterial();
    const model = new VRHandModel(armature, 'right', material);

    const tip = armature.getObjectByName('index-finger-tip')!;
    const openTip = tip.position.clone();
    model.applyCurl(curl({ index: 1 }));

    expect(tip.position.distanceTo(openTip)).toBeGreaterThan(0.03);
    expect(model.root.getObjectByName('Kotor2VR.rightHandModelAlignment')!.matrix.determinant()).toBeCloseTo(1, 6);

    model.dispose();
  });
});
