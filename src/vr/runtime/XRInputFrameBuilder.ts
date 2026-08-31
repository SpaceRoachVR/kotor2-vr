import * as THREE from 'three';
import {
  XRButtonState,
  XRHandInputFrame,
  XRHandRole,
  XRInputFrame,
  XRTrackingState,
  XRWorldPose,
} from './XRTypes';

/** Builds immutable, KOTOR-world-space input snapshots from transient WebXR data. */
export class XRInputFrameBuilder {
  static build(
    timestamp: number,
    frame: XRFrame,
    referenceSpace: XRReferenceSpace,
    rig: THREE.Object3D,
    inputSources: readonly XRInputSource[]
  ): XRInputFrame | null {
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new RangeError('timestamp must be a finite non-negative number');
    }
    const viewerPose = frame.getViewerPose(referenceSpace);
    if (!viewerPose) return null;

    rig.updateWorldMatrix(true, false);
    const head = XRInputFrameBuilder.toWorldPose(viewerPose, rig);
    const hands: Partial<Record<XRHandRole, XRHandInputFrame>> = {};
    const activeInteractionProfiles = new Set<string>();

    for (const source of inputSources) {
      if (source.handedness !== 'left' && source.handedness !== 'right') continue;
      const gripSpace = source.gripSpace ?? source.targetRaySpace;
      const pose = frame.getPose(gripSpace, referenceSpace);
      if (!pose) continue;
      const targetRayPose = frame.getPose(source.targetRaySpace, referenceSpace) ?? pose;

      const interactionProfile = source.profiles[0] ?? null;
      for (const profile of source.profiles) activeInteractionProfiles.add(profile);
      hands[source.handedness] = {
        hand: source.handedness,
        pose: XRInputFrameBuilder.toWorldPose(pose, rig),
        targetRayPose: XRInputFrameBuilder.toWorldPose(targetRayPose, rig),
        buttons: XRInputFrameBuilder.readButtons(source.gamepad),
        axes: XRInputFrameBuilder.readAxes(source.gamepad),
        interactionProfile,
      };
    }

    return {
      timestamp,
      head,
      hands,
      activeInteractionProfiles: [...activeInteractionProfiles],
    };
  }

  private static toWorldPose(pose: XRPose, rig: THREE.Object3D): XRWorldPose {
    const transform = pose.transform;
    const localPosition = new THREE.Vector3(
      transform.position.x,
      transform.position.y,
      transform.position.z
    );
    const localOrientation = new THREE.Quaternion(
      transform.orientation.x,
      transform.orientation.y,
      transform.orientation.z,
      transform.orientation.w
    ).normalize();
    const rigWorldOrientation = rig.getWorldQuaternion(new THREE.Quaternion());

    return {
      position: rig.localToWorld(localPosition),
      orientation: rigWorldOrientation.clone().multiply(localOrientation).normalize(),
      linearVelocity: XRInputFrameBuilder.toWorldVelocity(pose.linearVelocity, rigWorldOrientation),
      angularVelocity: XRInputFrameBuilder.toWorldVelocity(pose.angularVelocity, rigWorldOrientation),
      trackingState: XRInputFrameBuilder.getTrackingState(pose),
    };
  }

  private static toWorldVelocity(
    // A WebXR pose reports these as absent, not null, when the runtime does
    // not supply them — accept both rather than assuming which.
    velocity: DOMPointReadOnly | null | undefined,
    rigWorldOrientation: THREE.Quaternion
  ): THREE.Vector3 | null {
    if (!velocity) return null;
    return new THREE.Vector3(velocity.x, velocity.y, velocity.z)
      .applyQuaternion(rigWorldOrientation);
  }

  private static getTrackingState(pose: XRPose): XRTrackingState {
    return pose.emulatedPosition ? 'emulated' : 'tracked';
  }

  private static readButtons(gamepad: Gamepad | undefined): Readonly<Record<string, XRButtonState>> {
    if (!gamepad) return {};
    const buttons: Record<string, XRButtonState> = {};
    for (let index = 0; index < gamepad.buttons.length; index += 1) {
      const button = gamepad.buttons[index];
      buttons[String(index)] = {
        pressed: !!button.pressed,
        touched: !!button.touched,
        value: Number.isFinite(button.value)
          ? THREE.MathUtils.clamp(button.value, 0, 1)
          : 0,
      };
    }
    return buttons;
  }

  private static readAxes(gamepad: Gamepad | undefined): readonly number[] {
    if (!gamepad) return [];
    return Array.from(gamepad.axes, (axis) =>
      Number.isFinite(axis) ? THREE.MathUtils.clamp(axis, -1, 1) : 0
    );
  }
}
