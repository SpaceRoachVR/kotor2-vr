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
  /**
   * One-handed only: thumbstick push away from the player, past which that
   * hand's stick counts as a jump. Two-handed, jump is the left trigger.
   */
  readonly throttleThreshold: number;
}

export const DEFAULT_MINIGAME_INPUT_CONFIGURATION: VRMiniGameInputConfiguration = {
  gripThreshold: 0.5,
  triggerThreshold: 0.5,
  steeringFullLockHeightMetres: 0.18,
  oneHandedFullLockOffsetMetres: 0.25,
  steeringDeadzone: 0.08,
  throttleThreshold: 0.6,
};

export interface VRSwoopIntent {
  readonly grip: MiniGameGripState;
  /** -1 hard left to +1 hard right, already deadzoned and clamped. */
  readonly steer: number;
  /** Jump this frame (edge), so holding the control cannot pogo. */
  readonly jump: boolean;
  /** Throttle held: the swoop shifts up through its gears. */
  readonly throttle: boolean;
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

/**
 * Button indices, not names. XRInputFrameBuilder keys `buttons` by the
 * gamepad's own index as a string ("0", "1", ...) and XRInputRouter binds by
 * index too, so the whole VR layer speaks indices. This file used to look up
 * 'squeeze' and 'trigger', which are keys that never exist: every read returned
 * 0, so the grip never closed, the swoop never steered and the throttle never
 * opened - while the unit tests passed, because their fixtures were written to
 * the same wrong shape. The order is the xr-standard mapping every profile in
 * XRInputRouter uses.
 */
const XR_STANDARD_TRIGGER = '0';
const XR_STANDARD_SQUEEZE = '1';
/** A/X on the Touch profiles. The swoop's second jump control. */
const XR_STANDARD_FACE_PRIMARY = '4';

function buttonValue(hand: XRHandInputFrame | undefined, indices: readonly string[]): number {
  if (!hand) return 0;
  for (const index of indices) {
    const button = hand.buttons[index];
    if (!button) continue;
    if (typeof button.value === 'number' && Number.isFinite(button.value)) return button.value;
    if (button.pressed) return 1;
  }
  return 0;
}

/**
 * Thumbstick push away from the player, as a positive number, from whichever
 * hand is pushing hardest.
 *
 * The stick sits on axes 2 and 3 on the profiles that have one and on axes 0
 * and 1 on the touchpad profiles, matching XRInputRouter's per-profile binding;
 * reading whichever pair the controller reports keeps this working on both
 * without the policy needing to know the profile. WebXR reports forward as
 * negative Y.
 */
function stickPush(hand: XRHandInputFrame | undefined): number {
  if (!hand) return 0;
  const axes = hand.axes || [];
  const y = Number.isFinite(axes[3]) && axes[3] !== 0 ? axes[3] : axes[1];
  if (!Number.isFinite(y)) return 0;
  return -(y as number);
}

const SQUEEZE_BUTTONS = [XR_STANDARD_SQUEEZE] as const;
const TRIGGER_BUTTONS = [XR_STANDARD_TRIGGER] as const;
const FACE_BUTTONS = [XR_STANDARD_FACE_PRIMARY] as const;

export function isFaceButtonPressed(
  hand: XRHandInputFrame | undefined, config: VRMiniGameInputConfiguration,
): boolean {
  if (!hand) return false;
  return buttonValue(hand, FACE_BUTTONS) >= config.triggerThreshold;
}

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

/**
 * The swoop asks nothing of the hands but that they be tracked.
 *
 * A rider is strapped to a vehicle, not holding an object they might drop:
 * there is nothing to let go of, so requiring a squeeze only creates a state
 * where the controls silently do nothing. The turret keeps its squeeze, which
 * is a deliberate grip on a mounted weapon.
 */
export function resolveRidingState(
  frame: XRInputFrame,
): { state: MiniGameGripState; hands: XRHandInputFrame[] } {
  const hands = HAND_ROLES
    .map((role) => frame.hands[role])
    .filter((hand): hand is XRHandInputFrame => !!hand);
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
/**
 * The rider's own straight-ahead, captured while riding rather than assumed.
 *
 * Steering used to measure against dead level, which silently assumed the
 * player holds both hands at exactly the same height and their one hand exactly
 * in line with their head. Neither is true: a hand rests where it rests, and in
 * the headset that bias read as a permanent pull to one side that had to be
 * fought to turn the other way.
 */
export interface VRSwoopNeutral {
  /** Two-handed: the hand-height difference that means straight ahead. */
  readonly heightDifference: number;
  /** One-handed: the hand's sideways offset from the head that means straight. */
  readonly lateralOffset: number;
}

export const LEVEL_NEUTRAL: VRSwoopNeutral = { heightDifference: 0, lateralOffset: 0 };

/** The neutral a frame would define if the player were holding straight ahead now. */
export function sampleSwoopNeutral(frame: XRInputFrame): VRSwoopNeutral | null {
  const { state, hands } = resolveRidingState(frame);
  if (state === MiniGameGripState.NONE) return null;
  if (state === MiniGameGripState.TWO_HANDED) {
    const left = frame.hands['left'];
    const right = frame.hands['right'];
    if (!left || !right) return null;
    return {
      heightDifference: right.pose.position.y - left.pose.position.y,
      lateralOffset: 0,
    };
  }
  return {
    heightDifference: 0,
    lateralOffset: hands[0].pose.position.x - frame.head.position.x,
  };
}

export function resolveSteering(
  frame: XRInputFrame,
  config: VRMiniGameInputConfiguration,
  neutral: VRSwoopNeutral = LEVEL_NEUTRAL,
): { grip: MiniGameGripState; steer: number } {
  const { state, hands } = resolveRidingState(frame);
  if (state === MiniGameGripState.NONE) return { grip: state, steer: 0 };

  if (state === MiniGameGripState.TWO_HANDED) {
    const left = frame.hands['left'];
    const right = frame.hands['right'];
    if (!left || !right) return { grip: state, steer: 0 };
    // Positive when the right hand is higher, i.e. the bars rolled left.
    const heightDifference =
      (right.pose.position.y - left.pose.position.y) - neutral.heightDifference;
    const normalised = heightDifference / Math.max(1e-4, config.steeringFullLockHeightMetres);
    return { grip: state, steer: applyDeadzone(clamp(normalised, -1, 1), config.steeringDeadzone) };
  }

  // One hand: how far it sits to either side of its own resting place.
  const hand = hands[0];
  const offset = (hand.pose.position.x - frame.head.position.x) - neutral.lateralOffset;
  const normalised = offset / Math.max(1e-4, config.oneHandedFullLockOffsetMetres);
  return { grip: state, steer: applyDeadzone(clamp(normalised, -1, 1), config.steeringDeadzone) };
}

/**
 * Whatever the player is currently holding to mean "jump", so the controller can
 * take the edge off it. Two-handed that is the left trigger; one-handed there is
 * no spare trigger, so it is a forward push of that hand's thumbstick.
 */
export function swoopJumpControlHeld(
  frame: XRInputFrame, config: VRMiniGameInputConfiguration,
): boolean {
  const { state, hands } = resolveRidingState(frame);
  if (state === MiniGameGripState.NONE) return false;
  // A face button on either hand always jumps. The left trigger is the natural
  // pairing with a right-trigger throttle, but the left controller drops out of
  // the input frame whenever its grip pose is briefly untracked - and a rider
  // with no jump cannot clear an obstacle. The one-handed stick push stays as a
  // third route for whichever hand is left.
  if (hands.some((hand) => isFaceButtonPressed(hand, config))) return true;
  if (state === MiniGameGripState.ONE_HANDED) {
    return stickPush(hands[0]) >= config.throttleThreshold;
  }
  return isTriggerPressed(frame.hands['left'], config);
}

/**
 * Swoop controls: the bars steer, the right trigger is the throttle and the left
 * trigger jumps.
 *
 * The throttle is held rather than tapped because it is a gear shift the script
 * guards by speed - holding it is how the bike climbs through the gears, exactly
 * as holding the accelerate key does on flatscreen.
 *
 * One-handed, that hand's trigger becomes the throttle, since a rider with no
 * throttle is stranded; the jump moves to a forward push of its thumbstick.
 */
export function resolveSwoopIntent(
  frame: XRInputFrame,
  previousJumpHeld: boolean,
  config: VRMiniGameInputConfiguration = DEFAULT_MINIGAME_INPUT_CONFIGURATION,
  neutral: VRSwoopNeutral = LEVEL_NEUTRAL,
): VRSwoopIntent {
  const { grip, steer } = resolveSteering(frame, config, neutral);
  const { state, hands } = resolveRidingState(frame);

  // No tracked hand is not riding, so nothing the triggers do counts.
  const throttle = state === MiniGameGripState.NONE
    ? false
    : state === MiniGameGripState.ONE_HANDED
      ? isTriggerPressed(hands[0], config)
      : isTriggerPressed(frame.hands['right'], config);

  // A jump is the press, not the hold: holding the control must not pogo.
  const jumpHeld = swoopJumpControlHeld(frame, config);
  return { grip, steer, jump: jumpHeld && !previousJumpHeld, throttle };
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
