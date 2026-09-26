import * as THREE from 'three';
import { XRHandRole, XRInputFrame, XRWorldPose } from '@/vr/runtime/XRTypes';
import {
  aimDirectionToPitchYaw,
  isGripping,
  DEFAULT_MINIGAME_INPUT_CONFIGURATION,
  MiniGameGripState,
  measureLean,
  resolveSwoopIntent,
  resolveTurretIntent,
  swoopJumpControlHeld,
  VRMiniGameInputConfiguration,
  VRSwoopLeanFrame,
  VRSwoopSteerSource,
} from '@/vr/runtime/VRMiniGameInputPolicy';

/** What the controller needs of a live minigame, so VR never imports engine state. */
export interface VRMiniGameTarget {
  /** MiniGameType: 1 swoop race, 2 turret. */
  readonly type: number;
  /**
   * Whether the race has started: the flag has dropped and the bike answers
   * the controls. Before it, the rider's posture is being sampled as their
   * straight-ahead, so nothing else steers.
   */
  readonly raceStarted: boolean;
  /** Steering, -1..+1, as the flatscreen arrow keys set it. */
  setSteer: (steer: number) => void;
  /** Where the rider sits and which way is right, in world space. */
  readonly seatPosition: THREE.Vector3 | null;
  readonly seatRight: THREE.Vector3 | null;
  /** World poses of the handlebar grips, so held hands can be drawn on them. */
  readonly gripPoses: Readonly<Record<'left' | 'right', XRWorldPose | null>> | null;
  /** Swoop hop. Routed through the module's brake script, which is where TSL keeps it. */
  jump: () => void;
  /** Swoop throttle: one shift up through the gears. */
  accelerate: () => void;
  /** Turret gun banks; they rate-limit themselves, so holding the trigger is safe. */
  fire: () => void;
  /** Current turret pitch and yaw, as the player's rotation carries them. */
  readonly pitch: number;
  readonly yaw: number;
  /** Incremental rotation, so the minigame's own tunnel clamps still apply. */
  rotateBy: (pitchDelta: number, yawDelta: number) => void;
}

export type VRMiniGameProvider = () => VRMiniGameTarget | null;

/** What a live capture wants to know about the controller, per frame. */
export interface VRMiniGameControllerDebugState {
  readonly steer: number;
  readonly steerSource: VRSwoopSteerSource;
  readonly lean: number | null;
  readonly leanNeutral: number | null;
  readonly neutralCaptured: boolean;
  readonly grip: MiniGameGripState;
  readonly pinned: Record<'left' | 'right', boolean>;
}

/**
 * Applies VR controller input to the swoop and turret minigames.
 *
 * Swoop: left stick or head lean steers (a rate; the stick wins), right
 * trigger throttles, left trigger jumps. Squeeze takes hold of a grip and the
 * hand is drawn on it. Nothing about the hands feeds the steering, so a
 * controller dropping out of the frame - which the left one does whenever its
 * grip pose is briefly untracked - cannot lurch the bike.
 *
 * The lean neutral is the head's offset across the seat, sampled every frame
 * until the race starts and frozen at the moment the flag drops. That is the
 * one moment the rider is certainly sitting the way they mean to ride.
 *
 * The live minigame arrives through a provider rather than an import, so the VR
 * layer keeps its independence from engine state.
 */
export class VRMiniGameInputController {
  private static previousJumpHeld = false;
  private static leanNeutral = 0;
  private static neutralCaptured = false;
  private static lastSteer = 0;
  private static lastSteerSource: VRSwoopSteerSource = 'none';
  private static lastLean: number | null = null;
  private static lastGrip: MiniGameGripState = MiniGameGripState.NONE;
  /** Which grip pose each hand is currently drawn at. */
  private static pinnedHands: Record<XRHandRole, XRWorldPose | null> = { left: null, right: null };
  /** Set by the host so the policy can pin a hand without importing VRSpike. */
  static pinHand: ((hand: XRHandRole, pose: XRWorldPose | null) => void) | null = null;
  private static configuration: VRMiniGameInputConfiguration = DEFAULT_MINIGAME_INPUT_CONFIGURATION;
  private static provider: VRMiniGameProvider | null = null;
  private static readonly leanFrame: { seatPosition: THREE.Vector3; right: THREE.Vector3; neutral: number } = {
    seatPosition: new THREE.Vector3(), right: new THREE.Vector3(1, 0, 0), neutral: 0,
  };

  static setProvider(provider: VRMiniGameProvider | null): void {
    VRMiniGameInputController.provider = provider;
  }

  static setConfiguration(configuration: VRMiniGameInputConfiguration): void {
    VRMiniGameInputController.configuration = configuration;
  }

  static update(inputFrame: XRInputFrame | null): void {
    const target = VRMiniGameInputController.provider?.() ?? null;
    if (!target || !inputFrame) {
      VRMiniGameInputController.previousJumpHeld = false;
      VRMiniGameInputController.releaseHands();
      return;
    }

    const config = VRMiniGameInputController.configuration;
    if (target.type === 1) {
      const lean = VRMiniGameInputController.resolveLeanFrame(inputFrame, target);
      const intent = resolveSwoopIntent(
        inputFrame, VRMiniGameInputController.previousJumpHeld, config, lean,
      );
      VRMiniGameInputController.previousJumpHeld = swoopJumpControlHeld(inputFrame, config);
      VRMiniGameInputController.lastSteer = intent.steer;
      VRMiniGameInputController.lastSteerSource = intent.steerSource;
      VRMiniGameInputController.lastGrip = intent.grip;

      // Until the flag drops the bike is not steerable anyway; keep the input
      // at zero so a lean during the countdown cannot pre-load a drift.
      target.setSteer(target.raceStarted ? intent.steer : 0);
      VRMiniGameInputController.pinHeldHands(inputFrame, target, config);
      // The throttle is a gear shift the script guards by speed, so holding the
      // trigger is how the bike climbs through the gears - the same thing
      // holding the accelerate key does on flatscreen.
      if (intent.throttle) target.accelerate();
      if (intent.jump) target.jump();
      return;
    }

    if (target.type === 2) {
      const intent = resolveTurretIntent(inputFrame, config);
      VRMiniGameInputController.previousJumpHeld = false;
      VRMiniGameInputController.lastGrip = intent.grip;
      if (intent.grip === MiniGameGripState.NONE || !intent.aimDirection) return;

      // Steer towards the aim rather than assigning it, so the minigame's own
      // tunnel clamp stays the single place the arc is enforced.
      const { pitch, yaw } = aimDirectionToPitchYaw(intent.aimDirection);
      target.rotateBy(pitch - target.pitch, yaw - target.yaw);
      if (intent.fire) target.fire();
    }
  }

  /** Clears edge state when a session ends, so a stale press cannot carry over. */
  static reset(): void {
    VRMiniGameInputController.releaseHands();
    VRMiniGameInputController.previousJumpHeld = false;
    VRMiniGameInputController.leanNeutral = 0;
    VRMiniGameInputController.neutralCaptured = false;
    VRMiniGameInputController.lastSteer = 0;
    VRMiniGameInputController.lastSteerSource = 'none';
    VRMiniGameInputController.lastLean = null;
    VRMiniGameInputController.lastGrip = MiniGameGripState.NONE;
  }

  /**
   * Take the rider's current posture as straight-ahead again. Bound to the
   * same intent as a recenter: however they are sitting now means straight.
   */
  static recentreSteering(): void {
    VRMiniGameInputController.neutralCaptured = false;
  }

  /** For the live ride capture; never read by gameplay. */
  static debugState(): VRMiniGameControllerDebugState {
    return {
      steer: VRMiniGameInputController.lastSteer,
      steerSource: VRMiniGameInputController.lastSteerSource,
      lean: VRMiniGameInputController.lastLean,
      leanNeutral: VRMiniGameInputController.neutralCaptured ? VRMiniGameInputController.leanNeutral : null,
      neutralCaptured: VRMiniGameInputController.neutralCaptured,
      grip: VRMiniGameInputController.lastGrip,
      pinned: {
        left: !!VRMiniGameInputController.pinnedHands.left,
        right: !!VRMiniGameInputController.pinnedHands.right,
      },
    };
  }

  /**
   * The seat, the bike's right axis and the neutral, or null when the target
   * cannot say where the seat is (then only the stick steers).
   *
   * The neutral follows the head until the race starts, and is frozen at the
   * first frame it has. A race that ends and restarts (the module reloads)
   * resets the controller, so the next race captures afresh.
   */
  private static resolveLeanFrame(
    inputFrame: XRInputFrame, target: VRMiniGameTarget,
  ): VRSwoopLeanFrame | null {
    const seat = target.seatPosition;
    const right = target.seatRight;
    if (!seat || !right || right.lengthSq() < 1e-6) {
      VRMiniGameInputController.lastLean = null;
      return null;
    }
    const frame = VRMiniGameInputController.leanFrame;
    frame.seatPosition.copy(seat);
    frame.right.copy(right).normalize();
    frame.neutral = 0;
    const lean = measureLean(inputFrame.head, frame);
    VRMiniGameInputController.lastLean = lean;
    if (!target.raceStarted) {
      VRMiniGameInputController.leanNeutral = lean;
      VRMiniGameInputController.neutralCaptured = false;
    } else if (!VRMiniGameInputController.neutralCaptured) {
      VRMiniGameInputController.leanNeutral = lean;
      VRMiniGameInputController.neutralCaptured = true;
    }
    frame.neutral = VRMiniGameInputController.leanNeutral;
    return frame;
  }

  /**
   * Draws each holding hand on the bar it has taken, and releases it otherwise.
   * Only the visual is pinned; the hands have no say in the steering.
   */
  private static pinHeldHands(
    inputFrame: XRInputFrame, target: VRMiniGameTarget, config: VRMiniGameInputConfiguration,
  ): void {
    const poses = target.gripPoses;
    for (const role of ['left', 'right'] as XRHandRole[]) {
      const hand = inputFrame.hands[role];
      const holding = !!hand && isGripping(hand, config);
      const pinned = holding ? (poses?.[role] ?? null) : null;
      if (VRMiniGameInputController.pinnedHands[role] === pinned) continue;
      VRMiniGameInputController.pinnedHands[role] = pinned;
      VRMiniGameInputController.pinHand?.(role, pinned);
    }
  }

  /** Releases both hands, so leaving a minigame never leaves one stuck to a bar. */
  private static releaseHands(): void {
    for (const role of ['left', 'right'] as XRHandRole[]) {
      if (!VRMiniGameInputController.pinnedHands[role]) continue;
      VRMiniGameInputController.pinnedHands[role] = null;
      VRMiniGameInputController.pinHand?.(role, null);
    }
  }
}
