import * as THREE from 'three';

export enum SemanticXRAction {
  Move = 'move',
  Turn = 'turn',
  Select = 'select',
  Cancel = 'cancel',
  Use = 'use',
  Grab = 'grab',
  Menu = 'menu',
  Recenter = 'recenter',
  Pause = 'pause',
  WeaponAction = 'weapon-action',
  PartyCommand = 'party-command',
  ToggleWalkRun = 'toggle-walk-run',
  ToggleLocomotionMode = 'toggle-locomotion-mode',
}

export type XRHandRole = 'left' | 'right';
export type XRTrackingState = 'tracked' | 'emulated' | 'unavailable';
export type LocomotionMode = 'smooth' | 'blink';
export type LocomotionReferenceFrame = 'head' | 'controller';
export type VRTurnMode = 'smooth' | 'snap';

/**
 * Comfort settings (ROADMAP 2.5/2.6). Smooth movement and smooth turn are
 * the written default; teleport (`locomotionMode: 'blink'`), snap turn, and
 * the comfort vignette are opt-in alternatives, not the other way around.
 */
export interface VRComfortSettings {
  readonly locomotionMode: LocomotionMode;
  readonly turnMode: VRTurnMode;
  readonly snapTurnDegrees: number;
  readonly vignetteEnabled: boolean;
  /**
   * ROADMAP 3.14 — the red edge flash when the player is hit. On unless the
   * player turns it off; absent reads as on.
   */
  readonly damageFlashEnabled?: boolean;
  /**
   * ROADMAP 3.18 — closing the action wheel while paused resumes the game.
   * Off unless the player turns it on; absent reads as off.
   */
  readonly unpauseOnWheelClose?: boolean;
  /**
   * Hit, miss and critical knocks you can hear (2026-09-29), so combat never
   * depends on haptics alone. On unless turned off; absent reads as on.
   */
  readonly combatSoundsEnabled?: boolean;
  /** HP/FP plate on the off-hand wrist (2026-09-29). Absent reads as on. */
  readonly healthPlateEnabled?: boolean;
  /**
   * How large the in-world dialogue (subtitles and replies) is drawn: 1,
   * 1.3 or 1.6. Absent reads as 1. Asked for in six reviews (critic run 6).
   */
  readonly dialogueTextScale?: number;
}
export type InteractionMode = 'near-touch' | 'ray' | 'grab';
export type CombatWeaponMode =
  | 'unarmed'
  | 'melee-one-handed'
  | 'melee-two-handed'
  | 'melee-double-bladed'
  | 'melee-dual-wield'
  | 'blaster'
  | 'grenade'
  | 'force';

export interface XRWorldPose {
  readonly position: THREE.Vector3;
  readonly orientation: THREE.Quaternion;
  readonly linearVelocity: THREE.Vector3 | null;
  readonly angularVelocity: THREE.Vector3 | null;
  readonly trackingState: XRTrackingState;
  /**
   * The rig's world matrix this frame (play space to world). Lets hand motion
   * be measured without the rig's own movement; see XRPoseMotion.
   */
  readonly trackingToWorld?: THREE.Matrix4;
}

export interface XRButtonState {
  readonly pressed: boolean;
  readonly touched: boolean;
  readonly value: number;
}

export interface XRHandInputFrame {
  readonly hand: XRHandRole;
  readonly pose: XRWorldPose;
  readonly targetRayPose: XRWorldPose;
  readonly buttons: Readonly<Record<string, XRButtonState>>;
  readonly axes: readonly number[];
  readonly interactionProfile: string | null;
}

export interface XRInputFrame {
  readonly timestamp: number;
  readonly head: XRWorldPose;
  readonly hands: Readonly<Partial<Record<XRHandRole, XRHandInputFrame>>>;
  readonly activeInteractionProfiles: readonly string[];
}

export interface LocomotionIntent {
  readonly direction: THREE.Vector2;
  readonly magnitude: number;
  readonly turn: number;
  readonly mode: LocomotionMode;
  readonly referenceFrame: LocomotionReferenceFrame;
}

export interface InteractionIntent {
  readonly actorId: string;
  readonly hand: XRHandRole;
  readonly targetId: string;
  readonly interactionMode: InteractionMode;
  readonly pose: XRWorldPose;
  readonly distanceMetres: number;
  readonly engineTimestamp: number;
}

export interface CombatIntent {
  readonly actorId: string;
  readonly hand: XRHandRole;
  readonly weaponMode: CombatWeaponMode;
  readonly nominatedTargetId: string | null;
  readonly sweptPoses: readonly XRWorldPose[];
  readonly sampleStartedAt: number;
  readonly sampleEndedAt: number;
  readonly engineTimestamp: number;
}

export interface AreaVRPatchTransform {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  readonly scale: readonly [number, number, number];
}

export interface AreaVRPatch {
  readonly schemaVersion: number;
  readonly moduleId: string;
  readonly patchId: string;
  readonly transforms: Readonly<Record<string, AreaVRPatchTransform>>;
  readonly collisionProxyIds: readonly string[];
  readonly hiddenObjectIds: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
}

/**
 * A pose good enough to aim with. A Quest reports a controller as emulated
 * (position estimated) for moments when it loses sight of it - at the neck,
 * behind the head - and the emulator always does; requiring 'tracked' killed
 * aim mid-gesture and made the emulator unable to aim at all (critic run 11).
 */
export function isUsableXRPose(pose: { readonly trackingState?: XRTrackingState } | null | undefined): boolean {
  return !!pose && pose.trackingState !== 'unavailable';
}
