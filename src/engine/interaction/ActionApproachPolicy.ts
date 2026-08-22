/**
 * Whether queued actions may walk the actor to their target.
 *
 * Desktop KOTOR lets you click something across the room, and the engine walks
 * you there before acting: `ActionUseObject` enqueues an approach beyond 1.5 m,
 * `ActionOpenDoor` beyond 2 m. That is the right affordance for a mouse.
 *
 * It is the wrong one in VR. The player has already put themselves where they
 * want to be, the rig is anchored to the avatar, and an engine-driven walk
 * therefore drags the player through the world with no input from them —
 * reported from the first headset session as the character glitching into
 * different positions uncontrollably. VR prompts also offer use at 2.5-3 m,
 * deliberately wider than the engine's own thresholds, so an approach was
 * queued on nearly every interaction.
 *
 * Suppression is a session-scoped statement of intent — "the player positions
 * themselves" — rather than a per-action flag, because that is the actual rule
 * and it cannot be forgotten at an individual call site.
 */
export class ActionApproachPolicy {
  private static suppressed = false;

  /**
   * Suppresses approach for every subsequent action until cleared. Owned by the
   * VR runtime: set on immersive session start, cleared on session end.
   */
  static setApproachSuppressed(suppressed: boolean): void {
    ActionApproachPolicy.suppressed = suppressed === true;
  }

  /**
   * True when an action should act from where the actor already stands instead
   * of enqueuing a walk.
   */
  static isApproachSuppressed(): boolean {
    return ActionApproachPolicy.suppressed;
  }

  /** Restores desktop behaviour. */
  static reset(): void {
    ActionApproachPolicy.suppressed = false;
  }
}
