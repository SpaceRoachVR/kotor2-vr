import * as THREE from 'three';
import { XRHandRole, XRInputFrame, XRWorldPose } from './XRTypes';

interface PointerSample {
  timestamp: number;
  position: THREE.Vector3;
  orientation: THREE.Quaternion;
  rawPosition: THREE.Vector3;
  rawOrientation: THREE.Quaternion;
}

/** Filters pointer tremor in tracking space, without filtering grip or avatar motion. */
export class VRPointerPoseSmoother {
  private readonly samples = new Map<XRHandRole, PointerSample>();
  private static readonly STEADY_TIME_CONSTANT_MS = 20;
  private static readonly FAST_TIME_CONSTANT_MS = 4;
  private static readonly RESET_GAP_MS = 100;

  reset(): void { this.samples.clear(); }

  smoothFrame(frame: XRInputFrame, rig: THREE.Object3D): XRInputFrame {
    if (!Number.isFinite(frame.timestamp) || frame.timestamp < 0) {
      this.reset();
      throw new RangeError('Pointer frame timestamp must be finite and non-negative');
    }
    rig.updateWorldMatrix(true, false);
    const rigOrientation = rig.getWorldQuaternion(new THREE.Quaternion());
    const inverseOrientation = rigOrientation.clone().invert();
    const hands = { ...frame.hands };
    for (const hand of ['left', 'right'] as const) {
      const handFrame = frame.hands[hand];
      const pose = handFrame?.targetRayPose;
      if (!pose || pose.trackingState === 'unavailable' || !VRPointerPoseSmoother.isFinitePose(pose)) {
        this.samples.delete(hand);
        continue;
      }
      const rawPosition = rig.worldToLocal(pose.position.clone());
      const rawOrientation = inverseOrientation.clone().multiply(pose.orientation).normalize();
      let sample = this.samples.get(hand);
      const elapsed = sample ? frame.timestamp - sample.timestamp : 0;
      if (!sample || elapsed < 0 || elapsed > VRPointerPoseSmoother.RESET_GAP_MS
        || rawPosition.distanceTo(sample.rawPosition) > 0.2
        || rawOrientation.angleTo(sample.rawOrientation) > Math.PI / 6) {
        sample = { timestamp: frame.timestamp, position: rawPosition.clone(), orientation: rawOrientation.clone(),
          rawPosition: rawPosition.clone(), rawOrientation: rawOrientation.clone() };
        this.samples.set(hand, sample);
      } else if (elapsed > 0) {
        const seconds = elapsed / 1000;
        const movementSpeed = Math.max(
          rawPosition.distanceTo(sample.rawPosition) / seconds / 0.25,
          rawOrientation.angleTo(sample.rawOrientation) / seconds / 0.75,
        );
        const timeConstant = Math.max(VRPointerPoseSmoother.FAST_TIME_CONSTANT_MS,
          VRPointerPoseSmoother.STEADY_TIME_CONSTANT_MS / (1 + 3 * Math.max(0, movementSpeed - 1)));
        const alpha = 1 - Math.exp(-elapsed / timeConstant);
        sample.position.lerp(rawPosition, alpha);
        sample.orientation.slerp(rawOrientation, alpha).normalize();
        sample.timestamp = frame.timestamp;
        sample.rawPosition.copy(rawPosition);
        sample.rawOrientation.copy(rawOrientation);
      }
      // Input is sampled again after the rig sync in the same XR frame. Reuse
      // the local filter result, but transform it through the current rig.
      hands[hand] = { ...handFrame!, targetRayPose: {
        ...pose, position: rig.localToWorld(sample.position.clone()),
        orientation: rigOrientation.clone().multiply(sample.orientation).normalize(),
      } };
    }
    return { ...frame, hands };
  }

  private static isFinitePose(pose: XRWorldPose): boolean {
    return [pose.position.x, pose.position.y, pose.position.z,
      pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w].every(Number.isFinite)
      && pose.orientation.lengthSq() > 0;
  }
}
