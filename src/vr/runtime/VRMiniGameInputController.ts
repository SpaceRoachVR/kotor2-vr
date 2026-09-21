import { XRInputFrame } from '@/vr/runtime/XRTypes';
import {
  aimDirectionToPitchYaw,
  DEFAULT_MINIGAME_INPUT_CONFIGURATION,
  LEVEL_NEUTRAL,
  MiniGameGripState,
  resolveSwoopIntent,
  resolveTurretIntent,
  sampleSwoopNeutral,
  swoopJumpControlHeld,
  VRMiniGameInputConfiguration,
  VRSwoopNeutral,
} from '@/vr/runtime/VRMiniGameInputPolicy';

/** What the controller needs of a live minigame, so VR never imports engine state. */
export interface VRMiniGameTarget {
  /** MiniGameType: 1 swoop race, 2 turret. */
  readonly type: number;
  /** Lateral acceleration the race-start script granted; 0 before the flag drops. */
  lateralAcceleration: number;
  /** Steering, in the same units the flatscreen arrow keys set. */
  setLateralForce: (force: number) => void;
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

/**
 * Applies VR controller input to the swoop and turret minigames.
 *
 * Two-handed by design: handlebars on the swoop, grips on the turret, held with
 * squeeze. One hand alone still steers or aims, so a seated player who cannot
 * hold both is never stranded mid-sequence.
 *
 * On the swoop the right trigger is the throttle and the left trigger jumps.
 * One-handed, the single trigger becomes the throttle - a rider who cannot
 * accelerate cannot race at all - and the jump moves to that hand's thumbstick.
 *
 * The flatscreen KeyMapper paths stay live; this writes the same fields they do
 * (lateral force, rotation, jump, fire), so whichever input moved last wins
 * rather than the two fighting. Comfort is untouched: the player's existing
 * vignette and turn settings apply to a minigame as they do to ordinary play.
 *
 * The live minigame arrives through a provider rather than an import, so the VR
 * layer keeps its independence from engine state.
 */
export class VRMiniGameInputController {
  private static previousJumpHeld = false;
  /**
   * The rider's straight-ahead.
   *
   * Captured the first frame they hold the throttle, not the first frame a hand
   * is tracked. Hands are tracked long before anyone is in position - reaching
   * for the grips, or resting between races - and a neutral taken then is a
   * posture the rider never returns to, which reads as a permanent pull to
   * whichever side that sample leaned. Opening the throttle is the one moment
   * they are certainly holding on and pointed down the track.
   *
   * The two modes are captured separately: a one-handed sample says nothing
   * about the height difference between two hands, so letting it stand as the
   * two-handed neutral would leave that mode uncentred.
   */
  private static neutral: VRSwoopNeutral = LEVEL_NEUTRAL;
  private static twoHandedNeutralCaptured = false;
  private static oneHandedNeutralCaptured = false;
  /** Steering held across a brief hand dropout, and when it was last two-handed. */
  private static lastTwoHandedSteer = 0;
  private static lastTwoHandedAt = 0;
  /**
   * How long a lost hand is treated as still there. The left controller drops
   * out of the input frame whenever its grip pose goes briefly untracked, and
   * falling straight to one-handed steering reads the remaining hand's offset
   * from the head - which for a right hand at rest is a standing pull to the
   * right that the rider has to fight. Holding the last two-handed steer across
   * the gap keeps the bike going where it was pointed.
   */
  private static readonly HAND_DROPOUT_GRACE_MS = 500;
  private static configuration: VRMiniGameInputConfiguration = DEFAULT_MINIGAME_INPUT_CONFIGURATION;
  private static provider: VRMiniGameProvider | null = null;

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
      return;
    }

    const config = VRMiniGameInputController.configuration;
    if (target.type === 1) {
      VRMiniGameInputController.captureNeutral(inputFrame, config);

      const intent = resolveSwoopIntent(
        inputFrame, VRMiniGameInputController.previousJumpHeld, config,
        VRMiniGameInputController.neutral,
      );
      VRMiniGameInputController.previousJumpHeld = swoopJumpControlHeld(inputFrame, config);
      if (intent.grip === MiniGameGripState.NONE) return;

      const now = inputFrame.timestamp;
      let steer = intent.steer;
      if (intent.grip === MiniGameGripState.TWO_HANDED) {
        VRMiniGameInputController.lastTwoHandedSteer = steer;
        VRMiniGameInputController.lastTwoHandedAt = now;
      } else if (
        VRMiniGameInputController.lastTwoHandedAt > 0 &&
        now - VRMiniGameInputController.lastTwoHandedAt < VRMiniGameInputController.HAND_DROPOUT_GRACE_MS
      ) {
        // A hand just vanished; hold the line rather than lurching.
        steer = VRMiniGameInputController.lastTwoHandedSteer;
      }

      const lateral = Number.isFinite(target.lateralAcceleration) ? target.lateralAcceleration : 0;
      target.setLateralForce(steer * lateral);
      // The throttle is a gear shift the script guards by speed, so holding the
      // stick forward is how the bike climbs through the gears - the same thing
      // holding the accelerate key does on flatscreen.
      if (intent.throttle) target.accelerate();
      if (intent.jump) target.jump();
      return;
    }

    if (target.type === 2) {
      const intent = resolveTurretIntent(inputFrame, config);
      VRMiniGameInputController.previousJumpHeld = false;
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
    VRMiniGameInputController.previousJumpHeld = false;
    VRMiniGameInputController.neutral = LEVEL_NEUTRAL;
    VRMiniGameInputController.twoHandedNeutralCaptured = false;
    VRMiniGameInputController.oneHandedNeutralCaptured = false;
    VRMiniGameInputController.lastTwoHandedSteer = 0;
    VRMiniGameInputController.lastTwoHandedAt = 0;
  }

  /**
   * Take the rider's current hand pose as straight-ahead again. Bound to the
   * same intent as a recenter: whatever they are holding now means straight.
   */
  static recentreSteering(): void {
    VRMiniGameInputController.twoHandedNeutralCaptured = false;
    VRMiniGameInputController.oneHandedNeutralCaptured = false;
  }

  /**
   * Records straight-ahead the first time the rider opens the throttle in each
   * hand mode. Until then steering stays uncentred, which costs nothing: the
   * bike does not move until the throttle is opened either.
   */
  private static captureNeutral(
    inputFrame: XRInputFrame, config: VRMiniGameInputConfiguration,
  ): void {
    const twoHanded = !!(inputFrame.hands['left'] && inputFrame.hands['right']);
    if (twoHanded
      ? VRMiniGameInputController.twoHandedNeutralCaptured
      : VRMiniGameInputController.oneHandedNeutralCaptured) {
      return;
    }
    // Only while the throttle is open, which is when they are certainly holding
    // on. resolveSwoopIntent is not consulted here because its steer value is
    // the thing being calibrated.
    const throttling = resolveSwoopIntent(inputFrame, true, config, LEVEL_NEUTRAL).throttle;
    if (!throttling) return;

    const sampled = sampleSwoopNeutral(inputFrame);
    if (!sampled) return;
    if (twoHanded) {
      VRMiniGameInputController.neutral = {
        heightDifference: sampled.heightDifference,
        lateralOffset: VRMiniGameInputController.neutral.lateralOffset,
      };
      VRMiniGameInputController.twoHandedNeutralCaptured = true;
      return;
    }
    VRMiniGameInputController.neutral = {
      heightDifference: VRMiniGameInputController.neutral.heightDifference,
      lateralOffset: sampled.lateralOffset,
    };
    VRMiniGameInputController.oneHandedNeutralCaptured = true;
  }
}
