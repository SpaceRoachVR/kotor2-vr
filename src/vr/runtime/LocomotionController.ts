import * as THREE from 'three';
import { LocomotionIntent } from './XRTypes';

export interface LocomotionControllerConfiguration {
  readonly inputDeadZone: number;
  readonly bodyYawDeadZoneRadians: number;
  readonly maximumBodyFollowRadiansPerSecond: number;
  readonly maximumSmoothTurnRadiansPerSecond?: number;
}

export interface ResolvedLocomotion {
  readonly worldDirection: THREE.Vector2;
  readonly magnitude: number;
  readonly bodyFacing: number;
  readonly headFacing: number;
  readonly turn: number;
  readonly turnDeltaRadians: number;
  readonly mode: LocomotionIntent['mode'];
}

export const DEFAULT_LOCOMOTION_CONFIGURATION: LocomotionControllerConfiguration = {
  inputDeadZone: 0.15,
  bodyYawDeadZoneRadians: THREE.MathUtils.degToRad(18),
  maximumBodyFollowRadiansPerSecond: THREE.MathUtils.degToRad(150),
  maximumSmoothTurnRadiansPerSecond: THREE.MathUtils.degToRad(120),
};

/** Resolves head-relative input and comfortable head-authoritative body yaw. */
export class LocomotionController {
  private readonly maximumSmoothTurnRadiansPerSecond: number;

  constructor(
    private readonly configuration: LocomotionControllerConfiguration =
      DEFAULT_LOCOMOTION_CONFIGURATION
  ) {
    LocomotionController.validateConfiguration(configuration);
    this.maximumSmoothTurnRadiansPerSecond =
      configuration.maximumSmoothTurnRadiansPerSecond ??
      DEFAULT_LOCOMOTION_CONFIGURATION.maximumSmoothTurnRadiansPerSecond!;
  }

  resolve(
    intent: LocomotionIntent,
    headWorldOrientation: THREE.Quaternion,
    currentBodyFacing: number,
    deltaSeconds: number,
    controllerWorldOrientation?: THREE.Quaternion
  ): ResolvedLocomotion {
    if (!Number.isFinite(currentBodyFacing)) {
      throw new Error('Current body facing must be finite');
    }
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new Error('Locomotion delta time must be finite and non-negative');
    }
    if (!Number.isFinite(intent.magnitude) || !Number.isFinite(intent.turn)) {
      throw new Error('Locomotion intent magnitude and turn must be finite');
    }
    if (!Number.isFinite(intent.direction.x) || !Number.isFinite(intent.direction.y)) {
      throw new Error('Locomotion intent direction must be finite');
    }

    const headFacing = LocomotionController.worldOrientationToCreatureFacing(
      headWorldOrientation
    );
    const referenceFacing = intent.referenceFrame === 'controller'
      ? LocomotionController.worldOrientationToCreatureFacing(
        controllerWorldOrientation ?? headWorldOrientation
      )
      : headFacing;
    const magnitude = Math.min(1, Math.max(0, intent.magnitude));
    const inputLength = intent.direction.length();
    const effectiveMagnitude = inputLength < this.configuration.inputDeadZone
      ? 0
      : magnitude;
    const normalizedInput = inputLength > 1
      ? intent.direction.clone().divideScalar(inputLength)
      : intent.direction.clone();
    const turn = Math.min(1, Math.max(-1, intent.turn));
    const turnDelta = turn * this.maximumSmoothTurnRadiansPerSecond * deltaSeconds;
    const worldDirection = normalizedInput
      .rotateAround(new THREE.Vector2(0, 0), referenceFacing + turnDelta)
      .multiplyScalar(effectiveMagnitude);
    const followedBodyFacing = this.followHeadYaw(
      currentBodyFacing,
      headFacing,
      deltaSeconds
    );

    return {
      worldDirection,
      magnitude: effectiveMagnitude,
      bodyFacing: LocomotionController.normalizeRadians(followedBodyFacing + turnDelta),
      headFacing,
      turn,
      turnDeltaRadians: turnDelta,
      mode: intent.mode,
    };
  }

  static worldOrientationToCreatureFacing(orientation: THREE.Quaternion): number {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(orientation);
    forward.z = 0;
    if (forward.lengthSq() < 1e-10) {
      throw new Error('Head orientation has no usable horizontal forward direction');
    }
    forward.normalize();
    return LocomotionController.normalizeRadians(
      Math.atan2(forward.y, forward.x) - Math.PI / 2
    );
  }

  private followHeadYaw(
    currentBodyFacing: number,
    headFacing: number,
    deltaSeconds: number
  ): number {
    const difference = LocomotionController.normalizeRadians(headFacing - currentBodyFacing);
    const excess = Math.abs(difference) - this.configuration.bodyYawDeadZoneRadians;
    if (excess <= 0 || deltaSeconds === 0) {
      return LocomotionController.normalizeRadians(currentBodyFacing);
    }
    const maximumStep = this.configuration.maximumBodyFollowRadiansPerSecond * deltaSeconds;
    const step = Math.sign(difference) * Math.min(excess, maximumStep);
    return LocomotionController.normalizeRadians(currentBodyFacing + step);
  }

  private static normalizeRadians(angle: number): number {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  private static validateConfiguration(configuration: LocomotionControllerConfiguration): void {
    if (
      !Number.isFinite(configuration.inputDeadZone) ||
      configuration.inputDeadZone < 0 ||
      configuration.inputDeadZone >= 1
    ) {
      throw new Error('Input dead zone must be finite and in the range [0, 1)');
    }
    if (
      !Number.isFinite(configuration.bodyYawDeadZoneRadians) ||
      configuration.bodyYawDeadZoneRadians < 0 ||
      configuration.bodyYawDeadZoneRadians >= Math.PI
    ) {
      throw new Error('Body yaw dead zone must be finite and in the range [0, pi)');
    }
    if (
      !Number.isFinite(configuration.maximumBodyFollowRadiansPerSecond) ||
      configuration.maximumBodyFollowRadiansPerSecond <= 0
    ) {
      throw new Error('Maximum body follow rate must be finite and positive');
    }
    const smoothTurnRate = configuration.maximumSmoothTurnRadiansPerSecond ??
      DEFAULT_LOCOMOTION_CONFIGURATION.maximumSmoothTurnRadiansPerSecond!;
    if (!Number.isFinite(smoothTurnRate) || smoothTurnRate <= 0) {
      throw new Error('Maximum smooth turn rate must be finite and positive');
    }
  }
}
