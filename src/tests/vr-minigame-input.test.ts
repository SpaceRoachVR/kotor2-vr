import { describe, expect, test } from '@jest/globals';
import * as THREE from 'three';
import {
  aimDirectionToPitchYaw, DEFAULT_MINIGAME_INPUT_CONFIGURATION, MiniGameGripState,
  resolveLeanSteer, resolveSwoopIntent, resolveSwoopSteer, resolveTurretIntent, stickX,
  VRSwoopLeanFrame,
} from '@/vr/runtime/VRMiniGameInputPolicy';
import { XRHandInputFrame, XRInputFrame, XRWorldPose } from '@/vr/runtime/XRTypes';

/**
 * VR input for the swoop and turret, against the scheme locked on 2026-09-25
 * after four hand-steering models failed in the headset: the left stick and
 * head lean steer (a rate, stick wins), right trigger throttles, left trigger
 * jumps, squeeze only draws the hands on the bars. The turret keeps its
 * deliberate grip: squeeze to hold, the pair aims, the trigger fires.
 */

/**
 * Buttons are keyed by gamepad index as a string, exactly as
 * XRInputFrameBuilder.readButtons writes them and XRInputRouter reads them.
 * Named keys never exist on a real frame. Index order is the xr-standard
 * mapping: 0 trigger, 1 squeeze; the thumbstick is axes 2 and 3.
 */
const XR_TRIGGER = '0';
const XR_SQUEEZE = '1';
const button = (value: number) => ({ pressed: value >= 0.5, touched: value > 0, value });

function hand(options: {
  hand: 'left' | 'right'; x?: number; y?: number; z?: number;
  squeeze?: number; trigger?: number; orientation?: THREE.Quaternion;
  /** Thumbstick X on axis 2, -1 left .. +1 right. */
  stickX?: number;
  /** Touchpad-profile stick on axes 0/1 instead. */
  padX?: number;
}): XRHandInputFrame {
  const pose: XRWorldPose = {
    position: new THREE.Vector3(
      options.x ?? (options.hand === 'left' ? -0.25 : 0.25), options.y ?? 1.2, options.z ?? -0.3,
    ),
    orientation: options.orientation ?? new THREE.Quaternion(),
    linearVelocity: null, angularVelocity: null, trackingState: 'tracked',
  };
  return {
    hand: options.hand, pose, targetRayPose: pose,
    buttons: { [XR_TRIGGER]: button(options.trigger ?? 0), [XR_SQUEEZE]: button(options.squeeze ?? 0) },
    axes: [options.padX ?? 0, 0, options.stickX ?? 0, 0], interactionProfile: null,
  };
}

function frame(hands: XRHandInputFrame[], head?: Partial<{ x: number; y: number; z: number }>): XRInputFrame {
  const map: Record<string, XRHandInputFrame> = {};
  for (const h of hands) map[h.hand] = h;
  return {
    timestamp: 0,
    head: {
      position: new THREE.Vector3(head?.x ?? 0, head?.y ?? 1.6, head?.z ?? 0), orientation: new THREE.Quaternion(),
      linearVelocity: null, angularVelocity: null, trackingState: 'tracked',
    } as XRWorldPose,
    hands: map as never,
    activeInteractionProfiles: [],
  };
}

const config = DEFAULT_MINIGAME_INPUT_CONFIGURATION;

/** A seat at the origin with the bike's right along +X, rider sitting straight. */
const seat = (neutral = 0): VRSwoopLeanFrame => ({
  seatPosition: new THREE.Vector3(0, 0, 0), right: new THREE.Vector3(1, 0, 0), neutral,
});

describe('the left stick steers', () => {
  test('pushed right steers right, pushed left steers left', () => {
    expect(resolveSwoopSteer(frame([hand({ hand: 'left', stickX: 1 })]), null, config))
      .toEqual({ steer: 1, source: 'stick' });
    expect(resolveSwoopSteer(frame([hand({ hand: 'left', stickX: -1 })]), null, config))
      .toEqual({ steer: -1, source: 'stick' });
  });

  test('half a push is a gentler turn, past the dead zone', () => {
    const { steer } = resolveSwoopSteer(frame([hand({ hand: 'left', stickX: 0.6 })]), null, config);
    expect(steer).toBeGreaterThan(0.4);
    expect(steer).toBeLessThan(0.6);
  });

  test('a stick at rest, or wobbling inside the dead zone, does not steer', () => {
    expect(resolveSwoopSteer(frame([hand({ hand: 'left', stickX: 0 })]), null, config).source).toBe('none');
    expect(resolveSwoopSteer(frame([hand({ hand: 'left', stickX: 0.1 })]), null, config).steer).toBe(0);
  });

  test('the right stick does not steer', () => {
    expect(resolveSwoopSteer(frame([hand({ hand: 'right', stickX: 1 })]), null, config).steer).toBe(0);
  });

  test('a touchpad profile reports the stick on axes 0 and 1, and that still works', () => {
    expect(stickX(hand({ hand: 'left', padX: -0.8 }))).toBe(-0.8);
  });

  test('a missing left controller is no steer, not a crash', () => {
    expect(resolveSwoopSteer(frame([hand({ hand: 'right' })]), null, config).steer).toBe(0);
  });
});

describe('leaning steers', () => {
  test('sitting straight is straight', () => {
    expect(resolveLeanSteer(frame([]).head, seat(), config)).toBe(0);
  });

  test('leaning right steers right, and further is more', () => {
    const little = resolveLeanSteer(frame([], { x: 0.08 }).head, seat(), config);
    const lot = resolveLeanSteer(frame([], { x: 0.16 }).head, seat(), config);
    expect(little).toBeGreaterThan(0);
    expect(lot).toBeGreaterThan(little);
  });

  test('leaning the other way steers the other way, symmetrically', () => {
    const right = resolveLeanSteer(frame([], { x: 0.1 }).head, seat(), config);
    const left = resolveLeanSteer(frame([], { x: -0.1 }).head, seat(), config);
    expect(left).toBeCloseTo(-right, 10);
  });

  test('full lock is reached at the configured lean and clamps beyond it', () => {
    expect(resolveLeanSteer(frame([], { x: config.leanFullLockMetres }).head, seat(), config)).toBe(1);
    expect(resolveLeanSteer(frame([], { x: 1 }).head, seat(), config)).toBe(1);
  });

  test('a small sway inside the dead zone is ignored', () => {
    expect(resolveLeanSteer(frame([], { x: config.leanDeadzoneMetres * 0.9 }).head, seat(), config)).toBe(0);
  });

  test('the neutral is wherever the rider was sitting when the race started', () => {
    // Sat 5cm right of the seat centre at the flag: that is straight.
    expect(resolveLeanSteer(frame([], { x: 0.05 }).head, seat(0.05), config)).toBe(0);
    expect(resolveLeanSteer(frame([], { x: 0.05 - 0.1 }).head, seat(0.05), config)).toBeLessThan(0);
  });

  test('lean is measured across the bike, whichever way the course has turned it', () => {
    // Bike turned to face +X: its right is -Y. A head at +Y is a lean left.
    const turned: VRSwoopLeanFrame = {
      seatPosition: new THREE.Vector3(10, 10, 0), right: new THREE.Vector3(0, -1, 0), neutral: 0,
    };
    expect(resolveLeanSteer(frame([], { x: 10, y: 10.15, z: 0 }).head, turned, config)).toBeLessThan(0);
    // And forward/back movement across the seat is not a lean at all.
    expect(resolveLeanSteer(frame([], { x: 10.5, y: 10, z: 0 }).head, turned, config)).toBe(0);
  });

  test('with no seat known, lean cannot steer', () => {
    expect(resolveLeanSteer(frame([], { x: 1 }).head, null, config)).toBe(0);
  });
});

describe('the stick overrides the lean', () => {
  test('a deflected stick wins even against a full lean the other way', () => {
    const result = resolveSwoopSteer(frame([hand({ hand: 'left', stickX: 1 })], { x: -1 }), seat(), config);
    expect(result).toEqual({ steer: 1, source: 'stick' });
  });

  test('a centred stick lets the lean steer', () => {
    const result = resolveSwoopSteer(frame([hand({ hand: 'left', stickX: 0 })], { x: 0.1 }), seat(), config);
    expect(result.source).toBe('lean');
    expect(result.steer).toBeGreaterThan(0);
  });
});

describe('triggers', () => {
  test('the right trigger is the throttle, and holding it keeps it on', () => {
    const intent = resolveSwoopIntent(frame([hand({ hand: 'right', trigger: 1 })]), false, config);
    expect(intent.throttle).toBe(true);
    expect(resolveSwoopIntent(frame([hand({ hand: 'right', trigger: 1 })]), true, config).throttle).toBe(true);
  });

  test('the left trigger is not the throttle', () => {
    expect(resolveSwoopIntent(frame([hand({ hand: 'left', trigger: 1 })]), false, config).throttle).toBe(false);
  });

  test('the left trigger jumps on the press, not while it is held', () => {
    const pressed = resolveSwoopIntent(frame([hand({ hand: 'left', trigger: 1 })]), false, config);
    expect(pressed.jump).toBe(true);
    const held = resolveSwoopIntent(frame([hand({ hand: 'left', trigger: 1 })]), true, config);
    expect(held.jump).toBe(false);
  });

  test('the right trigger, and the face buttons, do not jump', () => {
    expect(resolveSwoopIntent(frame([hand({ hand: 'right', trigger: 1 })]), false, config).jump).toBe(false);
    const face = hand({ hand: 'right' });
    (face.buttons as Record<string, unknown>)['4'] = button(1);
    expect(resolveSwoopIntent(frame([face]), false, config).jump).toBe(false);
  });

  test('both at once: throttle held while jumping', () => {
    const intent = resolveSwoopIntent(
      frame([hand({ hand: 'left', trigger: 1 }), hand({ hand: 'right', trigger: 1 })]), false, config,
    );
    expect(intent.throttle).toBe(true);
    expect(intent.jump).toBe(true);
  });
});

describe('the hands only hold on; they do not steer', () => {
  test('squeezing reports the grip so the hands can be drawn on the bars', () => {
    expect(resolveSwoopIntent(frame([hand({ hand: 'left', squeeze: 1 }), hand({ hand: 'right', squeeze: 1 })]), false, config).grip)
      .toBe(MiniGameGripState.TWO_HANDED);
    expect(resolveSwoopIntent(frame([hand({ hand: 'right', squeeze: 1 })]), false, config).grip)
      .toBe(MiniGameGripState.ONE_HANDED);
    expect(resolveSwoopIntent(frame([hand({ hand: 'right' })]), false, config).grip)
      .toBe(MiniGameGripState.NONE);
  });

  test('the controls work with no hand on the bars: a rider is strapped in', () => {
    const intent = resolveSwoopIntent(frame([hand({ hand: 'left', stickX: 1, trigger: 1 }), hand({ hand: 'right', trigger: 1 })]), false, config);
    expect(intent.grip).toBe(MiniGameGripState.NONE);
    expect(intent.steer).toBe(1);
    expect(intent.throttle).toBe(true);
    expect(intent.jump).toBe(true);
  });

  test('hands at wildly different heights do not steer', () => {
    const intent = resolveSwoopIntent(frame([hand({ hand: 'left', y: 0.8, squeeze: 1 }), hand({ hand: 'right', y: 1.6, squeeze: 1 })]), false, config, seat());
    expect(intent.steer).toBe(0);
  });

  test('a hand dropping out of the frame does not steer either', () => {
    const before = resolveSwoopIntent(frame([hand({ hand: 'left', squeeze: 1 }), hand({ hand: 'right', squeeze: 1 })]), false, config, seat());
    const after = resolveSwoopIntent(frame([hand({ hand: 'right', squeeze: 1 })]), false, config, seat());
    expect(before.steer).toBe(0);
    expect(after.steer).toBe(0);
  });
});

describe('turret aim', () => {
  test('not holding on means no aim and no fire', () => {
    const intent = resolveTurretIntent(frame([hand({ hand: 'right', trigger: 1 })]), config);
    expect(intent.grip).toBe(MiniGameGripState.NONE);
    expect(intent.aimDirection).toBeNull();
    expect(intent.fire).toBe(false);
  });

  test('both grips aim between the hands', () => {
    const left = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.2);
    const right = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.2);
    const intent = resolveTurretIntent(frame([
      hand({ hand: 'left', squeeze: 1, orientation: left }), hand({ hand: 'right', squeeze: 1, orientation: right }),
    ]), config);
    expect(intent.grip).toBe(MiniGameGripState.TWO_HANDED);
    expect(intent.aimDirection!.x).toBeCloseTo(0, 5);
    expect(intent.aimDirection!.z).toBeCloseTo(-1, 5);
  });

  test('one grip aims along that hand', () => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const intent = resolveTurretIntent(frame([hand({ hand: 'right', squeeze: 1, orientation: q })]), config);
    expect(intent.aimDirection!.x).toBeCloseTo(-1, 5);
  });

  test('the trigger fires while held, since the gun bank rate-limits itself', () => {
    expect(resolveTurretIntent(frame([hand({ hand: 'right', squeeze: 1, trigger: 1 })]), config).fire).toBe(true);
  });

  test('aim direction converts to the pitch and yaw the turret rotates on', () => {
    const { pitch, yaw } = aimDirectionToPitchYaw(new THREE.Vector3(1, 0, -1));
    expect(yaw).toBeCloseTo(Math.PI / 4, 5);
    expect(pitch).toBeCloseTo(0, 5);
    expect(aimDirectionToPitchYaw(new THREE.Vector3(0, 1, -1)).pitch).toBeCloseTo(Math.PI / 4, 5);
  });
});
