import { ResolvedLocomotion } from './LocomotionController';

export interface CreatureLocomotionTarget {
  force: number;
  controlled: boolean;
  canMove(): boolean;
  clearAllActions(includeCombatActions?: boolean): void;
  setFacing(facing: number, instant?: boolean, speed?: number): void;
}

/** Applies VR intent through the original creature movement/collision entity. */
export class CreatureLocomotionAdapter {
  constructor(private readonly movementTurnSpeed: number) {
    if (!Number.isFinite(movementTurnSpeed) || movementTurnSpeed <= 0) {
      throw new Error('Creature movement turn speed must be finite and positive');
    }
  }

  apply(target: CreatureLocomotionTarget, locomotion: ResolvedLocomotion): boolean {
    if (!target.canMove()) return false;
    if (locomotion.magnitude > 0 && locomotion.worldDirection.lengthSq() > 1e-10) {
      target.clearAllActions(true);
      // KOTOR decelerates on every frame where force is below one. Its W key
      // and legacy gamepad therefore use full force after accepting movement.
      target.force = 1;
      target.setFacing(
        CreatureLocomotionAdapter.directionToCreatureFacing(locomotion.worldDirection.x, locomotion.worldDirection.y),
        false,
        this.movementTurnSpeed
      );
      target.controlled = true;
      return true;
    }

    // Body yaw has already been dead-zoned and rate-limited by the controller.
    target.setFacing(locomotion.bodyFacing, true);
    return true;
  }

  static directionToCreatureFacing(x: number, y: number): number {
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < 1e-10) {
      throw new Error('Creature movement direction must be finite and non-zero');
    }
    return Math.atan2(Math.sin(Math.atan2(y, x) - Math.PI / 2), Math.cos(Math.atan2(y, x) - Math.PI / 2));
  }
}
