import * as THREE from 'three';
import { XRHandRole, XRWorldPose } from '../XRTypes';

export type GestureStatePhase = 'idle' | 'tracking' | 'recognized' | 'cooldown';

export type GestureDirection = 'forward' | 'backward' | 'left' | 'right' | 'up' | 'down' | 'any';

export type GestureHandRequirement = 'dominant' | 'offhand' | 'either' | 'both';

export type GestureModifierButton = 'none' | 'grip' | 'trigger' | 'primary_button';

export interface GestureTrajectorySample {
  readonly position: THREE.Vector3;
  readonly orientation: THREE.Quaternion;
  readonly velocity: THREE.Vector3;
  readonly timestamp: number;
}

export interface GestureRecognitionResult<T = unknown> {
  readonly gestureId: string;
  readonly hand: XRHandRole;
  readonly phase: GestureStatePhase;
  readonly confidence: number;
  readonly speedMetresPerSecond: number;
  readonly peakSpeedMetresPerSecond: number;
  readonly directionVector: THREE.Vector3;
  readonly pose: XRWorldPose;
  readonly timestamp: number;
  readonly payload?: T;
}

export interface GestureDefinition<T = unknown> {
  readonly id: string;
  readonly name?: string;
  readonly handRequirement: GestureHandRequirement;
  readonly requiredModifier?: GestureModifierButton;
  readonly minimumSpeedMetresPerSecond: number;
  readonly cooldownMilliseconds: number;
  readonly maxTrackingDurationMs?: number;
  readonly directionConstraint?: GestureDirection;
  /** Direction alignment cosine threshold (e.g. 0.6 = ~53 degrees cone). */
  readonly directionConeCosine?: number;
  /** Custom extra evaluator for specialized multi-sample trajectories. */
  readonly customEvaluator?: (
    samples: readonly GestureTrajectorySample[],
    headPose: XRWorldPose
  ) => { valid: boolean; confidence?: number; payload?: T };
}
