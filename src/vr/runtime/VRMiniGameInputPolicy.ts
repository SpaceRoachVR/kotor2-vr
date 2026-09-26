import * as THREE from 'three';
import { XRHandRole, XRInputFrame, XRHandInputFrame, XRWorldPose } from '@/vr/runtime/XRTypes';

const HAND_ROLES: readonly XRHandRole[] = ['left', 'right'];

/**
 * Turns controller poses into swoop and turret input.
 *
 * The swoop (decided 2026-09-25, after four hand-steering models failed in the
 * headset): the left thumbstick and leaning the head both steer, as a rate.
 * The stick wins whenever it is deflected. The hands do not steer at all; they
 * take hold of the bars with squeeze and are drawn there, which is purely how
 * the rider sees themselves on the bike. The right trigger is the throttle,
 * the left trigger jumps.
 *
 * The turret is unchanged: grips are held with squeeze, the pair aims, the
 * trigger fires.
 *
 * This file is deliberately free of engine state: it takes an input frame and
 * returns intent. VRMiniGameInputController applies it to the live minigame.
 */

export enum MiniGameGripState {
  /** Neither hand is holding on. */
  NONE = 'none',
  /** One hand. */
  ONE_HANDED = 'one-handed',
  /** Both hands. */
  TWO_HANDED = 'two-handed',
}

export interface VRMiniGameInputConfiguration {
  /** Squeeze value at or above which a hand counts as holding on. */
  readonly gripThreshold: number;
  /** Trigger value at or above which fire/jump/throttle is pressed. */
  readonly triggerThreshold: number;
  /** Below this stick deflection the stick is centred. */
  readonly stickDeadzone: number;
  /**
   * Head offset from the seat, in metres, that reads as full lock. Measured
   * sideways across the bike. A seated rider leaning as far as is comfortable
   * moves their head about this far.
   */
  readonly leanFullLockMetres: number;
  /** Head offset below which the rider is sitting straight. */
  readonly leanDeadzoneMetres: number;
}

export const DEFAULT_MINIGAME_INPUT_CONFIGURATION: VRMiniGameInputConfiguration = {
  gripThreshold: 0.5,
  triggerThreshold: 0.5,
  stickDeadzone: 0.15,
  leanFullLockMetres: 0.18,
  leanDeadzoneMetres: 0.03,
};

export type VRSwoopSteerSource = 'stick' | 'lean' | 'none';

export interface VRSwoopIntent {
  readonly grip: MiniGameGripState;
  /** -1 hard left to +1 hard right, already deadzoned and clamped. A rate. */
  readonly steer: number;
  /** Which control the steer came from this frame. */
  readonly steerSource: VRSwoopSteerSource;
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

/**
 * Where the rider's head is against the seat, for lean steering.
 *
 * `right` is the bike's own sideways axis in world space, so the offset is
 * measured across the bike whichever way the course has turned it. `neutral`
 * is the head's offset along that axis captured when the race started; the
 * rider steers by leaning away from wherever they were sitting then.
 */
export interface VRSwoopLeanFrame {
  readonly seatPosition: THREE.Vector3;
  readonly right: THREE.Vector3;
  readonly neutral: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Button indices, not names. XRInputFrameBuilder keys `buttons` by the
 * gamepad's own index as a string ("0", "1", ...) and XRInputRouter binds by
 * index too. The order is the xr-standard mapping every profile uses: 0
 * trigger, 1 squeeze. Named keys never exist on a real frame.
 */
const XR_STANDARD_TRIGGER = '0';
const XR_STANDARD_SQUEEZE = '1';

function buttonValue(hand: XRHandInputFrame | undefined, index: string): number {
  if (!hand) return 0;
  const button = hand.buttons[index];
  if (!button) return 0;
  if (typeof button.value === 'number' && Number.isFinite(button.value)) return button.value;
  return button.pressed ? 1 : 0;
}

/**
 * Thumbstick X, -1 left to +1 right.
 *
 * The stick sits on axes 2 and 3 on the profiles that have one (Touch, Index,
 * xr-standard) and on axes 0 and 1 on the touchpad profiles, matching
 * XRInputRouter's per-profile binding. Read whichever pair the controller
 * reports, preferring the thumbstick pair, so this works on both without the
 * policy knowing the profile.
 */
export function stickX(hand: XRHandInputFrame | undefined): number {
  if (!hand) return 0;
  const axes = hand.axes || [];
  const x = Number.isFinite(axes[2]) && axes[2] !== 0 ? axes[2] : axes[0];
  return Number.isFinite(x) ? clamp(x as number, -1, 1) : 0;
}

export function isGripping(
  hand: XRHandInputFrame | undefined, config: VRMiniGameInputConfiguration,
): boolean {
  if (!hand) return false;
  return buttonValue(hand, XR_STANDARD_SQUEEZE) >= config.gripThreshold;
}

export function isTriggerPressed(
  hand: XRHandInputFrame | undefined, config: VRMiniGameInputConfiguration,
): boolean {
  if (!hand) return false;
  return buttonValue(hand, XR_STANDARD_TRIGGER) >= config.triggerThreshold;
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
  const scaled = (magnitude - deadzone) / Math.max(1e-6, 1 - deadzone);
  return clamp(scaled, 0, 1) * Math.sign(value);
}

/**
 * The head's sideways offset from the seat, along the bike's right axis, in
 * metres. Positive is to the rider's right.
 */
export function measureLean(head: XRWorldPose, lean: VRSwoopLeanFrame): number {
  const offset = head.position.clone().sub(lean.seatPosition);
  return offset.dot(lean.right);
}

/**
 * Lean as a steer value: the head's offset from its captured neutral, past a
 * dead zone, scaled to full lock. Positive is a lean to the right.
 */
export function resolveLeanSteer(
  head: XRWorldPose, lean: VRSwoopLeanFrame | null, config: VRMiniGameInputConfiguration,
): number {
  if (!lean) return 0;
  const offset = measureLean(head, lean) - lean.neutral;
  const full = Math.max(1e-6, config.leanFullLockMetres);
  const deadzone = clamp(config.leanDeadzoneMetres / full, 0, 0.99);
  return applyDeadzone(clamp(offset / full, -1, 1), deadzone);
}

/**
 * Swoop steering: the left stick if it is deflected, the lean otherwise.
 *
 * The left stick only. Steering off the right stick was considered and
 * rejected: the right hand holds the throttle, and a stick under a thumb that
 * is also squeezing a trigger drifts. The stick overrides the lean rather than
 * adding to it, so a rider who leans by habit can always straighten up with
 * the stick, and a stick input never fights a posture.
 */
export function resolveSwoopSteer(
  frame: XRInputFrame, lean: VRSwoopLeanFrame | null, config: VRMiniGameInputConfiguration,
): { steer: number; source: VRSwoopSteerSource } {
  const stick = applyDeadzone(stickX(frame.hands['left']), config.stickDeadzone);
  if (stick !== 0) return { steer: stick, source: 'stick' };
  const leanSteer = resolveLeanSteer(frame.head, lean, config);
  if (leanSteer !== 0) return { steer: leanSteer, source: 'lean' };
  return { steer: 0, source: 'none' };
}

/** The left trigger, and only the left trigger, is the jump. */
export function swoopJumpControlHeld(
  frame: XRInputFrame, config: VRMiniGameInputConfiguration,
): boolean {
  return isTriggerPressed(frame.hands['left'], config);
}

/** The right trigger, and only the right trigger, is the throttle. */
export function swoopThrottleHeld(
  frame: XRInputFrame, config: VRMiniGameInputConfiguration,
): boolean {
  return isTriggerPressed(frame.hands['right'], config);
}

/**
 * Swoop controls, all of them, for one frame.
 *
 * Nothing here asks the hands to be on the bars: a rider is strapped to a
 * vehicle, not holding an object they might drop, so the controls work whether
 * or not the hands are drawn on the grips. `grip` is reported so the
 * controller can draw the held hands.
 */
export function resolveSwoopIntent(
  frame: XRInputFrame,
  previousJumpHeld: boolean,
  config: VRMiniGameInputConfiguration = DEFAULT_MINIGAME_INPUT_CONFIGURATION,
  lean: VRSwoopLeanFrame | null = null,
): VRSwoopIntent {
  const { state } = resolveGripState(frame, config);
  const { steer, source } = resolveSwoopSteer(frame, lean, config);
  const jumpHeld = swoopJumpControlHeld(frame, config);
  return {
    grip: state,
    steer,
    steerSource: source,
    // A jump is the press, not the hold: holding the trigger must not pogo.
    jump: jumpHeld && !previousJumpHeld,
    throttle: swoopThrottleHeld(frame, config),
  };
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
