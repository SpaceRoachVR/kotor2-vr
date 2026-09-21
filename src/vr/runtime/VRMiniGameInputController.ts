import { XRInputFrame } from '@/vr/runtime/XRTypes';
import {
  aimDirectionToPitchYaw,
  DEFAULT_MINIGAME_INPUT_CONFIGURATION,
  MiniGameGripState,
  resolveSwoopIntent,
  resolveTurretIntent,
  swoopJumpControlHeld,
  VRMiniGameInputConfiguration,
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
      const intent = resolveSwoopIntent(inputFrame, VRMiniGameInputController.previousJumpHeld, config);
      VRMiniGameInputController.previousJumpHeld = swoopJumpControlHeld(inputFrame, config);
      if (intent.grip === MiniGameGripState.NONE) return;

      const lateral = Number.isFinite(target.lateralAcceleration) ? target.lateralAcceleration : 0;
      target.setLateralForce(intent.steer * lateral);
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
  }
}
