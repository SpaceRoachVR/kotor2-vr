import * as THREE from 'three';
import { XRHandRole, XRInputFrame, XRHandInputFrame } from '@/vr/runtime/XRTypes';

const HAND_ROLES: readonly XRHandRole[] = ['left', 'right'];

/**
 * Turns controller poses into swoop and turret input.
 *
 * Both minigames are driven two-handed, as decided for the VR layer: the swoop
 * has handlebars and the turret has grips. A hand counts as holding on while
 * its squeeze button is held (the same gesture that takes a lightsaber hilt in
 * the off hand), and either hand alone still steers or aims, so a seated player
 * who cannot hold both is never stranded mid-sequence.
 *
 * This file is deliberately free of engine state: it takes an input frame and
 * returns intent. VRMiniGameInputController applies it to the live minigame.
 */

export enum MiniGameGripState {
  /** Neither hand is holding on; the player is not driving. */
  NONE = 'none',
  /** One hand: it steers or aims on its own. */
  ONE_HANDED = 'one-handed',
  /** Both hands: the pair drives steering and aim. */
  TWO_HANDED = 'two-handed',
}

export interface VRMiniGameInputConfiguration {
  /** Squeeze value at or above which a hand counts as holding on. */
  readonly gripThreshold: number;
  /** Trigger value at or above which fire/jump is pressed. */
  readonly triggerThreshold: number;
  /**
   * Hand-height difference, in metres, that reads as full lock. Tilting the
   * handlebars this far either way gives full steering; less is proportional.
   */
  readonly steeringFullLockHeightMetres: number;
  /**
   * One-handed steering instead reads sideways offset from the head, in
   * metres, since there is no second hand to tilt against.
   */
  readonly oneHandedFullLockOffsetMetres: number;
  /** Below this, steering is treated as centred, so a still hand does not creep. */
  readonly steeringDeadzone: number;
}

export const DEFAULT_MINIGAME_INPUT_CONFIGURATION: VRMiniGameInputConfiguration = {
  gripThreshold: 0.5,
  triggerThreshold: 0.5,
  steeringFullLockHeightMetres: 0.18,
  oneHandedFullLockOffsetMetres: 0.25,
  steeringDeadzone: 0.08,
};

export interface VRSwoopIntent {
  readonly grip: MiniGameGripState;
  /** -1 hard left to +1 hard right, already deadzoned and clamped. */
  readonly steer: number;
  /** Trigger pressed this frame (edge), which the swoop reads as a jump. */
  readonly jump: boolean;
}

export interface VRTurretIntent {
  readonly grip: MiniGameGripState;
  /** Where the guns should point, in world space, or null when not gripped. */
  readonly aimDirection: THREE.Vector3 | null;
  /** Trigger held: the turret fires continuously at its own rate. */
  readonly fire: boolean;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

function buttonValue(hand: XRHandInputFrame | undefined, names: readonly string[]): number {
  if (!hand) return 0;
  for (const name of names) {
    const button = hand.buttons[name];
    if (!button) continue;
    if (typeof button.value === 'number' && Number.isFinite(button.value)) return button.value;
    if (button.pressed) return 1;
  }
  return 0;
}

const SQUEEZE_BUTTONS = ['squeeze', 'grip', 'xr-standard-squeeze'] as const;
const TRIGGER_BUTTONS = ['trigger', 'xr-standard-trigger', 'select'] as const;

export function isGripping(
  hand: XRHandInputFrame | undefined, config: VRMiniGameInputConfiguration,
): boolean {
  if (!hand) return false;
  return buttonValue(hand, SQUEEZE_BUTTONS) >= config.gripThreshold;
}

export function isTriggerPressed(
  hand: XRHandInputFrame | undefined, config: VRMiniGameInputConfiguration,
): boolean {
  if (!hand) return false;
  return buttonValue(hand, TRIGGER_BUTTONS) >= config.triggerThreshold;
}

export function resolveGripState(
  frame: XRInputFrame, config: VRMiniGameInputConfiguration,
): { state: MiniGameGripState; hands: XRHandInputFrame[] } {
  const hands = HAND_ROLES
    .map((role) => frame.hands[role])
    .filter((hand): hand is XRHandInputFrame => isGripping(hand, config));
  if (hands.length >= 2) return { state: MiniGameGripState.TWO_HANDED, hands };
  if (hands.length === 1) return { state: MiniGameGripState.ONE_HANDED, hands };
  return { state: MiniGameGripState.NONE, hands };
}

function applyDeadzone(value: number, deadzone: number): number {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  // Rescale so the first movement past the deadzone starts from zero rather
  // than jumping to the deadzone value.
  const scaled = (magnitude - deadzone) / (1 - deadzone);
  return clamp(scaled, 0, 1) * Math.sign(value);
}

/**
 * Handlebar steering: the roll of the line between the hands. Dropping the
 * left hand below the right steers left, which is how leaning a bike reads.
 */
export function resolveSteering(
  frame: XRInputFrame, config: VRMiniGameInputConfiguration,
): { grip: MiniGameGripState; steer: number } {
  const { state, hands } = resolveGripState(frame, config);
  if (state === MiniGameGripState.NONE) return { grip: state, steer: 0 };

  if (state === MiniGameGripState.TWO_HANDED) {
    const left = frame.hands['left'];
    const right = frame.hands['right'];
    if (!left || !right) return { grip: state, steer: 0 };
    // Positive when the right hand is higher, i.e. the bars rolled left.
    const heightDifference = right.pose.position.y - left.pose.position.y;
    const normalised = heightDifference / Math.max(1e-4, config.steeringFullLockHeightMetres);
    return { grip: state, steer: applyDeadzone(clamp(normalised, -1, 1), config.steeringDeadzone) };
  }

  // One hand: how far it sits to either side of the head.
  const hand = hands[0];
  const offset = hand.pose.position.x - frame.head.position.x;
  const normalised = offset / Math.max(1e-4, config.oneHandedFullLockOffsetMetres);
  return { grip: state, steer: applyDeadzone(clamp(normalised, -1, 1), config.steeringDeadzone) };
}

export function resolveSwoopIntent(
  frame: XRInputFrame,
  previousTriggerHeld: boolean,
  config: VRMiniGameInputConfiguration = DEFAULT_MINIGAME_INPUT_CONFIGURATION,
): VRSwoopIntent {
  const { grip, steer } = resolveSteering(frame, config);
  const triggerHeld = HAND_ROLES
    .some((role) => isTriggerPressed(frame.hands[role], config));
  // A jump is the press, not the hold: holding the trigger must not pogo.
  return { grip, steer, jump: triggerHeld && !previousTriggerHeld };
}

/**
 * Turret aim: the direction the grips point. With both hands it is the forward
 * axis of the midpoint between them, so the pair aims like one object; with one
 * hand it is simply that hand's forward axis.
 */
export function resolveTurretIntent(
  frame: XRInputFrame,
  config: VRMiniGameInputConfiguration = DEFAULT_MINIGAME_INPUT_CONFIGURATION,
): VRTurretIntent {
  const { state, hands } = resolveGripState(frame, config);
  if (state === MiniGameGripState.NONE) {
    return { grip: state, aimDirection: null, fire: false };
  }

  const fire = hands.some((hand) => isTriggerPressed(hand, config));

  if (state === MiniGameGripState.ONE_HANDED) {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(hands[0].pose.orientation);
    return { grip: state, aimDirection: forward.normalize(), fire };
  }

  const left = frame.hands['left'];
  const right = frame.hands['right'];
  if (!left || !right) return { grip: state, aimDirection: null, fire };

  const midpoint = new THREE.Quaternion().slerpQuaternions(
    left.pose.orientation, right.pose.orientation, 0.5,
  );
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(midpoint);
  return { grip: state, aimDirection: forward.normalize(), fire };
}

/**
 * Pitch and yaw for an aim direction, in radians, relative to the turret's
 * resting forward axis. The minigame player rotates on these two axes.
 */
export function aimDirectionToPitchYaw(direction: THREE.Vector3): { pitch: number; yaw: number } {
  const normalised = direction.clone().normalize();
  const yaw = Math.atan2(normalised.x, -normalised.z);
  const horizontal = Math.hypot(normalised.x, normalised.z);
  const pitch = Math.atan2(normalised.y, horizontal);
  return { pitch, yaw };
}
