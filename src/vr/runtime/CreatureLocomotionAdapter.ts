import { ResolvedLocomotion } from './LocomotionController';

export interface CreatureLocomotionTarget {
  force: number;
  forceVector: { x: number; y: number };
  controlled: boolean;
  /** Current speed (m/s); zeroed when the stick is released. Optional for test doubles. */
  speed?: number;
  /** Fraction of full movement speed the stick asks for (1 = run). */
  locomotionScale?: number;
  /** The engine's collision state, for sliding along walls. Optional for test doubles. */
  collisionManager?: { recentWallNormals?: { x: number; y: number; at: number }[] };
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
      // Floor of a tenth (about 0.5 m/s): a 0.35 floor made every light push a
      // 1.9 m/s walk (critic run 15).
      target.locomotionScale = Math.min(1, Math.max(0.1, locomotion.magnitude));
      this.wasMoving = true;
      // The native collision and avoidance code advances creatures through
      // forceVector, not merely their visual facing. ActionMoveToPoint writes
      // this vector every frame; omitting it from VR caused locomotion to stall
      // at narrow walkmesh turns despite a valid controller direction.
      let dirX = locomotion.worldDirection.x;
      let dirY = locomotion.worldDirection.y;
      // The wall tests work on the unit direction: the direction carries the
      // stick's magnitude, so a light push looked "too short" and froze the
      // player at railings (critic run 16).
      const stickLength = Math.hypot(dirX, dirY) || 1;
      const stickX = dirX / stickLength;
      const stickY = dirY / stickLength;
      dirX = stickX;
      dirY = stickY;
      // Every wall touched in the last 250 ms: in a corner the two walls take
      // turns, and sliding along one pushed into the other (critic run 15).
      const now = performance.now();
      const walls = (target.collisionManager?.recentWallNormals ?? []).filter((n) => now - n.at < 250);
      if (walls.length) {
        let blocked = false;
        for (let pass = 0; pass < 3; pass++) {
          for (const n of walls) {
            const into = dirX * n.x + dirY * n.y;
            if (into < 0) { dirX -= into * n.x; dirY -= into * n.y; }
          }
        }
        const length = Math.hypot(dirX, dirY);
        // What remains must still go roughly where the stick points.
        const along = length > 1e-6 ? (dirX * stickX + dirY * stickY) / length : 0;
        if (length < 0.15 || along < 0.2) blocked = true;
        // A V-shaped corner: no direction slides along one wall without going
        // into the other, so what is left still points into a wall.
        if (!blocked) {
          const ux = dirX / length, uy = dirY / length;
          for (const n of walls) if (ux * n.x + uy * n.y < -0.05) blocked = true;
        }
        if (blocked) {
          // Into a wall or a corner: stand still rather than shake. Standing
          // still collides with nothing, so keep these walls remembered while
          // the stick still points into them, or every 250 ms the player
          // bumped in again.
          // Only the walls the stick points into, so turning away frees it.
          for (const n of walls) if (stickX * n.x + stickY * n.y < 0) (n as { at: number }).at = now;
          // Speed too: with no force vector the engine keeps walking along the
          // facing while any speed is left, straight into the corner.
          target.speed = 0;
          target.force = 0;
          target.forceVector.x = 0;
          target.forceVector.y = 0;
          target.controlled = true;
          return true;
        }
        dirX /= length;
        dirY /= length;
      }
      target.forceVector.x = dirX;
      target.forceVector.y = dirY;
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
