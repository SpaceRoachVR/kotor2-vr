/**
 * Keeps the wearer still while a conversation or cutscene moves the character
 * they control.
 *
 * The rig follows the controlled creature, so a scripted walk during a
 * conversation dragged the player's view across the level and left the reply
 * panel behind (headset round P1, the Fuel Depot HK-50 conversation). Allen's
 * rule, 2026-09-26: the movement plays on the floating theater like a movie,
 * then the view jumps from the first spot to the second, and the dialogue
 * comes with it.
 *
 * While a cutscene is active this remembers where the character stood. Once
 * the character is more than `startMetres` from there it is "moving": the rig
 * is held at the old spot and the shot goes to the theater. When the
 * character has stayed within `settleMetres` for `settleMs` it has "arrived":
 * the new spot becomes the anchor, and the caller teleports the view and
 * re-places the dialogue. A cutscene that ends mid-walk arrives wherever the
 * character is.
 */
export interface VRCutsceneMoveHoldOptions {
  readonly startMetres: number;
  readonly settleMetres: number;
  readonly settleMs: number;
}

export const DEFAULT_VR_CUTSCENE_MOVE_HOLD: VRCutsceneMoveHoldOptions = {
  startMetres: 0.5,
  settleMetres: 0.05,
  settleMs: 600,
};

export interface VRCutsceneMovePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface VRCutsceneMoveHoldState {
  /** Where the rig should stand instead of the character, while moving. */
  readonly heldPosition: VRCutsceneMovePoint | null;
  /** The character is being moved by the cutscene right now. */
  readonly moving: boolean;
  /** True on the one update where the move finished: teleport and re-place. */
  readonly arrived: boolean;
}

const IDLE: VRCutsceneMoveHoldState = { heldPosition: null, moving: false, arrived: false };

function distance2D(a: VRCutsceneMovePoint, b: VRCutsceneMovePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function copy(point: VRCutsceneMovePoint): VRCutsceneMovePoint {
  return { x: point.x, y: point.y, z: point.z };
}

export class VRCutsceneMoveHold {
  private anchor: VRCutsceneMovePoint | null = null;
  private moving = false;
  private settleFrom: VRCutsceneMovePoint | null = null;
  private settleSinceMs = 0;

  constructor(private readonly options: VRCutsceneMoveHoldOptions = DEFAULT_VR_CUTSCENE_MOVE_HOLD) {}

  get isMoving(): boolean {
    return this.moving;
  }

  get heldPosition(): VRCutsceneMovePoint | null {
    return this.moving ? this.anchor : null;
  }

  reset(): void {
    this.anchor = null;
    this.moving = false;
    this.settleFrom = null;
    this.settleSinceMs = 0;
  }

  update(cutsceneActive: boolean, position: VRCutsceneMovePoint | null, nowMs: number): VRCutsceneMoveHoldState {
    if (!cutsceneActive || !position || ![position.x, position.y, position.z].every(Number.isFinite)) {
      const wasMoving = this.moving;
      this.reset();
      return wasMoving ? { heldPosition: null, moving: false, arrived: true } : IDLE;
    }

    if (this.anchor === null) {
      this.anchor = copy(position);
      return IDLE;
    }

    if (!this.moving) {
      if (distance2D(position, this.anchor) <= this.options.startMetres) return IDLE;
      this.moving = true;
      this.settleFrom = copy(position);
      this.settleSinceMs = nowMs;
      return { heldPosition: this.anchor, moving: true, arrived: false };
    }

    if (this.settleFrom === null || distance2D(position, this.settleFrom) > this.options.settleMetres) {
      this.settleFrom = copy(position);
      this.settleSinceMs = nowMs;
      return { heldPosition: this.anchor, moving: true, arrived: false };
    }
    if (nowMs - this.settleSinceMs < this.options.settleMs) {
      return { heldPosition: this.anchor, moving: true, arrived: false };
    }

    this.anchor = copy(position);
    this.moving = false;
    this.settleFrom = null;
    return { heldPosition: null, moving: false, arrived: true };
  }
}
