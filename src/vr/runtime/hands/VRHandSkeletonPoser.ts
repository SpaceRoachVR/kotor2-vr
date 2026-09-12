import * as THREE from 'three';
import type { XRHandRole } from '../XRTypes';
import type { VRHandFingerCurl } from './VRHandFingerCurl';

/** A joint transform expressed in the hand model's armature space. */
export interface VRHandJointTransform {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
}

export type VRHandRestPose = ReadonlyMap<string, VRHandJointTransform>;

type Digit = keyof VRHandFingerCurl;

interface DigitChain {
  readonly digit: Digit;
  /** Joint names from the palm outward, ending at the tip. */
  readonly joints: readonly string[];
  /**
   * Flexion at each joint (radians) when the digit is fully curled. The tip
   * has no entry: it only carries the rotation of the joints before it.
   */
  readonly fullCurlRadians: readonly number[];
}

const fingerJoints = (finger: string) => [
  `${finger}-metacarpal`,
  `${finger}-phalanx-proximal`,
  `${finger}-phalanx-intermediate`,
  `${finger}-phalanx-distal`,
  `${finger}-tip`,
];

/**
 * Knuckle limits roughly matching a real closed fist. Ring and pinky
 * metacarpals flex a little too, which is what lets a fist cup around a hilt
 * instead of closing flat.
 */
const DIGIT_CHAINS: readonly DigitChain[] = [
  { digit: 'thumb', joints: ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'], fullCurlRadians: [0.45, 0.7, 0.9] },
  { digit: 'index', joints: fingerJoints('index-finger'), fullCurlRadians: [0, 1.4, 1.75, 1.1] },
  { digit: 'middle', joints: fingerJoints('middle-finger'), fullCurlRadians: [0, 1.45, 1.8, 1.1] },
  { digit: 'ring', joints: fingerJoints('ring-finger'), fullCurlRadians: [0.1, 1.45, 1.8, 1.1] },
  { digit: 'pinky', joints: fingerJoints('pinky-finger'), fullCurlRadians: [0.2, 1.45, 1.75, 1.1] },
];

/** Every joint the WebXR hand convention names. */
export const VR_HAND_JOINT_NAMES: readonly string[] = ['wrist', ...DIGIT_CHAINS.flatMap((chain) => chain.joints)];

const LOCAL_X = new THREE.Vector3(1, 0, 0);
const LOCAL_Y = new THREE.Vector3(0, 1, 0);

/**
 * Where the rod axis sits relative to the finger-joint centroid, in grip space
 * (metres), authored for a right hand and mirrored in X for the left.
 *
 * Joint positions are bone centres, and the curled fingertips pull their
 * centroid out toward the fingertip side of the fist. Measured on the held
 * pose: palm skin sits ~3 cm toward +X (the back-of-hand side) from the
 * fingertips' inner surface, and the proximal phalanges ~1 cm below. The hole
 * centre is ~5 mm further toward the palm and ~4 mm toward the wrist than the
 * raw centroid, which is what this moves.
 */
const GRIP_ORIGIN_CORRECTION_METRES = new THREE.Vector3(0.005, 0.004, 0);

/** The curl the grip frame is measured in — a fist around a controller. */
const GRIP_REFERENCE_CURL: VRHandFingerCurl = { thumb: 0.7, index: 0.8, middle: 0.8, ring: 0.8, pinky: 0.8 };

/**
 * Poses a flat WebXR-convention hand skeleton from per-digit curl.
 *
 * The generic-hand models have no bone hierarchy — every joint is a direct
 * child of the armature and is placed absolutely, the way hand-tracking
 * drives them. So this is plain forward kinematics over each finger chain:
 * a joint rotates about its own rest +X axis (the WebXR flexion axis, where
 * a negative angle closes toward the palm) and carries every joint after it.
 */
export class VRHandSkeletonPoser {
  private readonly rest: VRHandRestPose;
  private readonly gripFromArmature: THREE.Matrix4;

  constructor(rest: VRHandRestPose, readonly hand: XRHandRole) {
    const missing = VR_HAND_JOINT_NAMES.filter((name) => !rest.has(name));
    if (missing.length > 0) {
      throw new Error(`hand skeleton is missing WebXR joints: ${missing.join(', ')}`);
    }
    this.rest = rest;
    this.gripFromArmature = this.measureGripFrame();
  }

  /** Armature-space joint transforms for a curl. Unlisted joints keep rest. */
  pose(curl: VRHandFingerCurl): Map<string, VRHandJointTransform> {
    const posed = new Map<string, VRHandJointTransform>();
    const wrist = this.rest.get('wrist')!;
    posed.set('wrist', { position: wrist.position.clone(), quaternion: wrist.quaternion.clone() });

    const rotation = new THREE.Quaternion();
    const flex = new THREE.Quaternion();
    for (const chain of DIGIT_CHAINS) {
      const amount = clamp01(curl[chain.digit]);
      rotation.identity();
      let previousRest: VRHandJointTransform | null = null;
      let previousPosition: THREE.Vector3 | null = null;
      for (let index = 0; index < chain.joints.length; index += 1) {
        const restJoint = this.rest.get(chain.joints[index])!;
        const position = previousRest && previousPosition
          ? restJoint.position.clone().sub(previousRest.position).applyQuaternion(rotation).add(previousPosition)
          : restJoint.position.clone();

        const angle = (chain.fullCurlRadians[index] ?? 0) * amount;
        if (angle !== 0) {
          // Composing on the right rotates about the joint's rest axis as it
          // has already been carried by the joints before it.
          const axis = LOCAL_X.clone().applyQuaternion(restJoint.quaternion);
          rotation.multiply(flex.setFromAxisAngle(axis, -angle));
        }

        posed.set(chain.joints[index], {
          position,
          quaternion: rotation.clone().multiply(restJoint.quaternion),
        });
        previousRest = restJoint;
        previousPosition = position;
      }
    }
    return posed;
  }

  /**
   * Maps armature space into WebXR grip space: origin at the centre of the
   * closed fist, −Z along the held rod toward the thumb, +X out of the back of
   * a right hand (out of the palm of a left one) — so that a model placed on
   * the grip-pose anchor wraps whatever the anchor holds.
   */
  getGripFromArmatureMatrix(): THREE.Matrix4 {
    return this.gripFromArmature.clone();
  }

  private measureGripFrame(): THREE.Matrix4 {
    const fist = this.pose(GRIP_REFERENCE_CURL);
    const at = (name: string) => fist.get(name)!.position;

    // The knuckle line of a closed fist runs along the rod; toward the index
    // finger is toward the thumb, which is grip −Z.
    const towardThumb = at('index-finger-phalanx-proximal').clone().sub(at('pinky-finger-phalanx-proximal')).normalize();
    const zAxis = towardThumb.negate();
    const backOfHand = LOCAL_Y.clone().applyQuaternion(this.rest.get('middle-finger-metacarpal')!.quaternion);
    const xAxis = (this.hand === 'right' ? backOfHand : backOfHand.negate());
    xAxis.addScaledVector(zAxis, -xAxis.dot(zAxis)).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

    const origin = new THREE.Vector3();
    const loopJoints = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger']
      .flatMap((finger) => [`${finger}-phalanx-proximal`, `${finger}-phalanx-intermediate`, `${finger}-phalanx-distal`]);
    for (const name of loopJoints) origin.add(at(name));
    origin.divideScalar(loopJoints.length);

    const correction = GRIP_ORIGIN_CORRECTION_METRES.clone();
    // Correction is authored for a right hand, where +X is the back of the
    // hand; the left hand's +X is its palm, so the X nudge flips.
    if (this.hand === 'left') correction.x = -correction.x;
    const armatureFromGrip = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).setPosition(origin);
    armatureFromGrip.multiply(new THREE.Matrix4().makeTranslation(correction.x, correction.y, correction.z));
    return armatureFromGrip.invert();
  }
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
