/**
 * Whether queued actions may walk an actor to their target.
 *
 * Desktop KOTOR lets you click something across the room, and the engine walks
 * you there before acting: `ActionUseObject` approaches beyond 1.5 m,
 * `ActionOpenDoor` and friends beyond 2 m, `ActionDialogObject` beyond 4.5 m.
 * That is the right affordance for a mouse.
 *
 * It is the wrong one in VR. The player has already put themselves where they
 * want to be, the rig is anchored to the avatar, and an engine-driven walk
 * therefore drags the player through the world with no input from them.
 *
 * Suppression is session-scoped — "the player positions themselves" — rather
 * than a per-action flag, because that is the actual rule and cannot be
 * forgotten at an individual call site.
 *
 * It is also **actor-scoped**. Party members and NPCs must keep walking to
 * their targets: they have no headset and no rig, and a global suppression
 * would silently break follow, combat approach, and scripted movement for every
 * creature in the module.
 */
export type ControlledActorProbe = (actor: unknown) => boolean;

export class ActionApproachPolicy {
  private static suppressed = false;
  private static isControlledActor: ControlledActorProbe = () => false;

  /**
   * Suppresses approach for the controlled actor until cleared. Owned by the VR
   * runtime: set on immersive session start, cleared on session end.
   */
  static setApproachSuppressed(suppressed: boolean): void {
    ActionApproachPolicy.suppressed = suppressed === true;
  }

  /**
   * Teaches the policy which actor the player is driving. Injected rather than
   * imported so this module stays free of engine dependencies, and re-evaluated
   * per call so party leader swaps are picked up.
   */
  static setControlledActorProbe(probe: ControlledActorProbe): void {
    if (typeof probe !== 'function') {
      throw new TypeError('controlled actor probe must be a function');
    }
    ActionApproachPolicy.isControlledActor = probe;
  }

  /**
   * True when `actor` should act from where it already stands instead of
   * enqueuing a walk. False for every actor the player is not driving.
   */
  static isApproachSuppressedFor(actor: unknown): boolean {
    if (!ActionApproachPolicy.suppressed) return false;
    try {
      return ActionApproachPolicy.isControlledActor(actor) === true;
    } catch {
      // A probe that throws must not strand the actor mid-action.
      return false;
    }
  }

  /** Restores desktop behaviour. */
  static reset(): void {
    ActionApproachPolicy.suppressed = false;
    ActionApproachPolicy.isControlledActor = () => false;
  }
}
