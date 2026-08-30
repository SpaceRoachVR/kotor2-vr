import * as THREE from 'three';
import {
  InteractionTargetRegistry,
  ResolvedInteractionTarget,
} from './InteractionTargetRegistry';
import { RoutedXRAction } from './XRInputRouter';
import {
  InteractionIntent,
  SemanticXRAction,
  XRHandRole,
  XRInputFrame,
  XRWorldPose,
} from './XRTypes';

export interface InteractionSystemConfiguration {
  readonly nearReachMetres: number;
  readonly rayDistanceMetres: number;
}

interface InteractionButtonState {
  wasPressed: boolean;
  requiresRelease: boolean;
}

const DEFAULT_CONFIGURATION: InteractionSystemConfiguration = {
  nearReachMetres: 0.15,
  rayDistanceMetres: 20,
};

export interface InteractionTargetPreview {
  readonly id: string;
  readonly label: string;
  readonly interactionMode: 'near-touch' | 'ray';
  readonly position: THREE.Vector3;
}

/** Resolves semantic use presses into validated engine interaction intents. */
export class InteractionSystem {
  private readonly configuration: InteractionSystemConfiguration;
  private readonly buttonState: Record<XRHandRole, InteractionButtonState> = {
    left: { wasPressed: false, requiresRelease: true },
    right: { wasPressed: false, requiresRelease: true },
  };

  constructor(
    private readonly registry: InteractionTargetRegistry,
    configuration: Partial<InteractionSystemConfiguration> = {}
  ) {
    this.configuration = {
      ...DEFAULT_CONFIGURATION,
      ...configuration,
    };
    InteractionSystem.validateConfiguration(this.configuration);
  }

  process(
    inputFrame: XRInputFrame,
    actions: readonly RoutedXRAction[],
    actorId: string,
    engineTimestamp: number
  ): InteractionIntent | null {
    if (typeof actorId !== 'string' || actorId.trim().length === 0) {
      throw new TypeError('actorId must be a non-empty string');
    }
    if (!Number.isFinite(engineTimestamp) || engineTimestamp < 0) {
      throw new RangeError('engineTimestamp must be a finite non-negative number');
    }

    for (const hand of ['left', 'right'] as const) {
      const activationActions = actions.filter((action) =>
        action.hand === hand &&
        (
          action.action === SemanticXRAction.Use ||
          action.action === SemanticXRAction.Select ||
          action.action === SemanticXRAction.Grab
        )
      );
      if (activationActions.length === 0) continue;

      const state = this.buttonState[hand];
      const activationPressed = activationActions.some((action) => action.pressed);
      if (!activationPressed) {
        state.wasPressed = false;
        state.requiresRelease = false;
        continue;
      }
      if (state.requiresRelease || state.wasPressed) continue;
      state.wasPressed = true;

      const handFrame = inputFrame.hands[hand];
      if (!handFrame || handFrame.pose.trackingState === 'unavailable') continue;
      const isGripOnly = activationActions.every((action) => action.action === SemanticXRAction.Grab);
      const resolved = isGripOnly
        ? this.registry.resolveNear(handFrame.pose.position, this.configuration.nearReachMetres)
        : this.resolveTarget(handFrame.pose, handFrame.targetRayPose);
      if (!resolved) continue;

      const pose = resolved.interactionMode === 'near-touch'
        ? handFrame.pose
        : handFrame.targetRayPose;
      const intent: InteractionIntent = {
        actorId,
        hand,
        targetId: resolved.target.id,
        interactionMode: resolved.interactionMode,
        pose: InteractionSystem.clonePose(pose),
        distanceMetres: resolved.distanceMetres,
        engineTimestamp,
      };
      resolved.target.activate({
        actorId,
        hand,
        interactionMode: resolved.interactionMode,
        engineTimestamp,
      });
      return intent;
    }
    return null;
  }

  cancelTransientState(): void {
    for (const hand of ['left', 'right'] as const) {
      this.buttonState[hand].wasPressed = false;
      this.buttonState[hand].requiresRelease = true;
    }
  }

  /**
   * Resolves the object under a tracked controller without creating an engine
   * action.  The result is only an affordance for the world-space pointer.
   */
  preview(inputFrame: XRInputFrame, hand: XRHandRole): InteractionTargetPreview | null {
    const handFrame = inputFrame.hands[hand];
    if (!handFrame || handFrame.pose.trackingState === 'unavailable') return null;
    const resolved = this.resolveTarget(handFrame.pose, handFrame.targetRayPose);
    if (!resolved) return null;
    const label = resolved.target.label?.trim() || 'Use';
    return {
      id: resolved.target.id,
      label,
      interactionMode: resolved.interactionMode,
      // The controller ray's hit point may be near the player at the edge of
      // a generous interaction sphere. Labels belong above the real object.
      position: resolved.target.getWorldPosition(new THREE.Vector3()).clone(),
    };
  }

  private resolveTarget(
    gripPose: XRWorldPose,
    targetRayPose: XRWorldPose
  ): ResolvedInteractionTarget | null {
    const nearTarget = this.registry.resolveNear(
      gripPose.position,
      this.configuration.nearReachMetres
    );
    if (nearTarget) return nearTarget;

    const rayDirection = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(targetRayPose.orientation)
      .normalize();
    return this.registry.resolveRay(
      targetRayPose.position,
      rayDirection,
      this.configuration.rayDistanceMetres
    );
  }

  private static clonePose(pose: XRWorldPose): XRWorldPose {
    return {
      position: pose.position.clone(),
      orientation: pose.orientation.clone(),
      linearVelocity: pose.linearVelocity?.clone() ?? null,
      angularVelocity: pose.angularVelocity?.clone() ?? null,
      trackingState: pose.trackingState,
    };
  }

  private static validateConfiguration(configuration: InteractionSystemConfiguration): void {
    if (!Number.isFinite(configuration.nearReachMetres) || configuration.nearReachMetres < 0) {
      throw new RangeError('nearReachMetres must be a finite non-negative number');
    }
    if (!Number.isFinite(configuration.rayDistanceMetres) || configuration.rayDistanceMetres <= 0) {
      throw new RangeError('rayDistanceMetres must be a finite positive number');
    }
  }
}
