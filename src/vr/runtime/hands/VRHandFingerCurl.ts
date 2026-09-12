import type { XRHandInputFrame } from '../XRTypes';

/** How closed each digit is: 0 = straight, 1 = fully curled. */
export interface VRHandFingerCurl {
  readonly thumb: number;
  readonly index: number;
  readonly middle: number;
  readonly ring: number;
  readonly pinky: number;
}

export const VR_HAND_OPEN_CURL: VRHandFingerCurl = Object.freeze({
  thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0,
});

/**
 * xr-standard gamepad mapping, which every controller profile this mod
 * targets (Touch, Touch Plus, Index, Vive, WMR) follows.
 */
const TRIGGER = '0';
const SQUEEZE = '1';
const THUMBSTICK = '3';
const FACE_BUTTONS = ['4', '5'] as const;
const THUMBREST = '6';

/** A resting finger on a capacitive trigger reads as a light curl. */
const INDEX_TOUCH_CURL = 0.28;
/** A thumb on a stick, face button, or thumbrest lies across the controller. */
const THUMB_TOUCH_CURL = 0.55;
/** A relaxed hand is never ruler-straight. */
const RELAXED_CURL = 0.12;
/**
 * Closed around a held hilt or blaster grip. Not 1: a fully curled finger
 * would pass through the handle the engine model draws in the palm.
 */
const HELD_ITEM_CURL: VRHandFingerCurl = Object.freeze({
  thumb: 0.7, index: 0.78, middle: 0.82, ring: 0.84, pinky: 0.86,
});

export interface VRHandCurlInput {
  readonly hand: XRHandInputFrame | null | undefined;
  /** An engine item is drawn in this hand, so the fist wraps it. */
  readonly holdingItem: boolean;
}

/**
 * Derives a finger pose from controller buttons.
 *
 * Controllers report no joint data, so this is the standard VR-game
 * approximation: trigger drives the index finger, squeeze drives the other
 * three, and a touched thumb control lowers the thumb. The index finger still
 * follows the trigger while an item is held, so a blaster's trigger pull is
 * visible on the hand.
 */
export function resolveVRHandFingerCurl(input: Readonly<VRHandCurlInput>): VRHandFingerCurl {
  const buttons = input.hand?.buttons ?? {};
  const trigger = buttons[TRIGGER];
  const squeeze = buttons[SQUEEZE];

  const triggerValue = clamp01(trigger?.value ?? (trigger?.pressed ? 1 : 0));
  const squeezeValue = clamp01(squeeze?.value ?? (squeeze?.pressed ? 1 : 0));
  const thumbTouched = [THUMBSTICK, ...FACE_BUTTONS, THUMBREST]
    .some((key) => buttons[key]?.touched === true || buttons[key]?.pressed === true);

  const index = Math.max(RELAXED_CURL, trigger?.touched ? INDEX_TOUCH_CURL : 0, triggerValue);
  const grip = Math.max(RELAXED_CURL, squeezeValue);
  const thumb = Math.max(RELAXED_CURL, thumbTouched ? THUMB_TOUCH_CURL : 0, squeezeValue * 0.6);

  if (input.holdingItem) {
    return {
      thumb: Math.max(HELD_ITEM_CURL.thumb, thumb),
      // The held pose leaves the index on the trigger guard; pulling the
      // trigger still closes it the rest of the way.
      index: HELD_ITEM_CURL.index * 0.75 + triggerValue * (1 - HELD_ITEM_CURL.index * 0.75),
      middle: Math.max(HELD_ITEM_CURL.middle, grip),
      ring: Math.max(HELD_ITEM_CURL.ring, grip),
      pinky: Math.max(HELD_ITEM_CURL.pinky, grip),
    };
  }

  return { thumb, index, middle: grip, ring: grip, pinky: grip };
}

/**
 * Frame-rate independent exponential approach toward a target pose. Buttons
 * are digital on some controllers; without this a finger snaps shut in one
 * frame, which reads as a glitch rather than a grab.
 */
export function smoothVRHandFingerCurl(
  current: VRHandFingerCurl,
  target: VRHandFingerCurl,
  deltaSeconds: number,
  responsePerSecond = 18,
): VRHandFingerCurl {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return current;
  // Clamp so a long hitch (a module load) lands on the target instead of
  // overshooting maths or crawling from a stale pose.
  const blend = 1 - Math.exp(-responsePerSecond * Math.min(deltaSeconds, 0.25));
  const step = (from: number, to: number) => from + (to - from) * blend;
  return {
    thumb: step(current.thumb, target.thumb),
    index: step(current.index, target.index),
    middle: step(current.middle, target.middle),
    ring: step(current.ring, target.ring),
    pinky: step(current.pinky, target.pinky),
  };
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
