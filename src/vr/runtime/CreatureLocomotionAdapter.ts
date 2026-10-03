import { ResolvedLocomotion } from './LocomotionController';

export interface CreatureLocomotionTarget {
  force: number;
  forceVector: { x: number; y: number };
  controlled: boolean;
  /** Current speed (m/s); zeroed when the stick is released. Optional for test doubles. */
  speed?: number;
  /** Fraction of full movement speed the stick asks for (1 = run). */
  locomotionScale?: number;
  canMove(): boolean;
  clearAllActions(includeCombatActions?: boolean): void;
  setFacing(facing: number, instant?: boolean, speed?: number): void;
}

/**
 * Decides whether stick movement may leave the target's queued actions alone.
 * Called only on frames that actually move the target.
 */
export type LocomotionActionRetention<TTarget extends CreatureLocomotionTarget = CreatureLocomotionTarget> =
  (target: TTarget) => boolean;

/** Applies VR intent through the original creature movement/collision entity. */
export class CreatureLocomotionAdapter<TTarget extends CreatureLocomotionTarget = CreatureLocomotionTarget> {
  constructor(
    private readonly movementTurnSpeed: number,
    /**
     * Desktop KOTOR cancels everything the moment you walk, and without this
     * so does VR. That is right for a walk-to or an attack, and wrong for a
     * short in-place job like picking a lock: a thumbstick nudge during its
     * 1.5 s silently threw it away and left the door locked, which is what
     * "low security doors would not open at all" was (round 7).
     */
    private readonly retainActionsWhileMoving: LocomotionActionRetention<TTarget> | null = null,
  ) {
    if (!Number.isFinite(movementTurnSpeed) || movementTurnSpeed <= 0) {
      throw new Error('Creature movement turn speed must be finite and positive');
    }
  }

  apply(target: TTarget, locomotion: ResolvedLocomotion): boolean {
    if (!target.canMove()) return false;
    if (locomotion.magnitude > 0 && locomotion.worldDirection.lengthSq() > 1e-10) {
      if (!this.shouldRetainActions(target)) target.clearAllActions(true);
      // KOTOR decelerates on every frame where force is below one. Its W key
      // and legacy gamepad therefore use full force after accepting movement.
      target.force = 1;
      // Speed follows the stick: a light push walks, full deflection runs. It
      // ran at full speed from a 0.2 push (critic run 14).
      target.locomotionScale = Math.min(1, Math.max(0.35, locomotion.magnitude));
      this.wasMoving = true;
      // The native collision and avoidance code advances creatures through
      // forceVector, not merely their visual facing. ActionMoveToPoint writes
      // this vector every frame; omitting it from VR caused locomotion to stall
      // at narrow walkmesh turns despite a valid controller direction.
      target.forceVector.x = locomotion.worldDirection.x;
      target.forceVector.y = locomotion.worldDirection.y;
      target.setFacing(
        CreatureLocomotionAdapter.directionToCreatureFacing(locomotion.worldDirection.x, locomotion.worldDirection.y),
        false,
        this.movementTurnSpeed
      );
      target.controlled = true;
      return true;
    }

    // Stop on release: the engine's deceleration coasted the player about a
    // metre after the stick returned to centre (critic run 14). Only on the
    // release frame, so scripted walks keep their own speed.
    if (this.wasMoving) {
      this.wasMoving = false;
      target.speed = 0;
      target.force = 0;
      target.forceVector.x = 0;
      target.forceVector.y = 0;
      target.locomotionScale = 1;
    }
    // Body yaw has already been dead-zoned and rate-limited by the controller.
    target.setFacing(locomotion.bodyFacing, true);
    return true;
  }

  private wasMoving = false;

  private shouldRetainActions(target: TTarget): boolean {
    if (!this.retainActionsWhileMoving) return false;
    try {
      return this.retainActionsWhileMoving(target) === true;
    } catch {
      // A throwing policy falls back to the desktop rule rather than stranding
      // an action the player is trying to walk away from.
      return false;
    }
  }

  static directionToCreatureFacing(x: number, y: number): number {
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < 1e-10) {
      throw new Error('Creature movement direction must be finite and non-zero');
    }
    return Math.atan2(Math.sin(Math.atan2(y, x) - Math.PI / 2), Math.cos(Math.atan2(y, x) - Math.PI / 2));
  }
}
