export interface VRCombatTempoRoundSnapshot {
  readonly roundStarted: boolean;
  readonly roundPaused: boolean;
  readonly scheduledActionCount: number;
  readonly playerActionCommitted: boolean;
  readonly additionalActionWindowOpen: boolean;
}

export interface VRCombatTempoGateInput {
  readonly actorCanAct: boolean;
  readonly hasLiveTarget: boolean;
  readonly combatRound?: Readonly<VRCombatTempoRoundSnapshot>;
}

export type VRCombatTempoGateReason =
  | "ready"
  | "engine-extra-attack-window"
  | "actor-unavailable"
  | "target-unavailable"
  | "combat-round-unavailable"
  | "round-paused"
  | "player-action-committed"
  | "scheduled-action-pending"
  | "round-active";

export interface VRCombatTempoGateResult {
  readonly eligible: boolean;
  readonly reason: VRCombatTempoGateReason;
}

/**
 * Read-only translation of CombatRound state into a controller-facing action
 * window. It stores no timestamps and never decides a d20 cadence itself.
 */
export class VRCombatTempoGate {
  evaluate(input: Readonly<VRCombatTempoGateInput>): VRCombatTempoGateResult {
    validateGateInput(input);
    if (!input.actorCanAct) {
      return result(false, "actor-unavailable");
    }
    if (!input.hasLiveTarget) {
      return result(false, "target-unavailable");
    }
    if (!input.combatRound) {
      return result(false, "combat-round-unavailable");
    }

    const round = input.combatRound;
    if (round.roundPaused) {
      return result(false, "round-paused");
    }
    if (round.playerActionCommitted) {
      return result(false, "player-action-committed");
    }
    if (round.scheduledActionCount > 0) {
      return result(false, "scheduled-action-pending");
    }
    if (round.additionalActionWindowOpen) {
      return result(true, "engine-extra-attack-window");
    }
    if (round.roundStarted) {
      return result(false, "round-active");
    }
    return result(true, "ready");
  }
}

function result(eligible: boolean, reason: VRCombatTempoGateReason): VRCombatTempoGateResult {
  return Object.freeze({ eligible, reason });
}

function validateGateInput(input: Readonly<VRCombatTempoGateInput>): void {
  if (!input || typeof input !== "object") {
    throw new TypeError("A combat tempo input is required.");
  }
  if (typeof input.actorCanAct !== "boolean" || typeof input.hasLiveTarget !== "boolean") {
    throw new TypeError("actorCanAct and hasLiveTarget must be boolean values.");
  }
  if (!input.combatRound) {
    return;
  }
  const round = input.combatRound;
  if (
    typeof round.roundStarted !== "boolean" ||
    typeof round.roundPaused !== "boolean" ||
    typeof round.playerActionCommitted !== "boolean" ||
    typeof round.additionalActionWindowOpen !== "boolean" ||
    !Number.isSafeInteger(round.scheduledActionCount) ||
    round.scheduledActionCount < 0
  ) {
    throw new TypeError("combatRound is not a valid read-only CombatRound snapshot.");
  }
}

export interface VRRoundOpenInput {
  readonly roundStarted: boolean;
  readonly roundPaused: boolean;
  readonly playerActionCommitted: boolean;
  readonly scheduledActionCount: number;
}

/**
 * Whether the player's own round is open for a new attack. Unlike the gate
 * above, this ignores the target: the round-open tick used to follow
 * `eligible`, which flips with aim and reach, so sweeping the weapon across
 * a hostile and away ticked "ready" with no round boundary at all (critic
 * run 4).
 */
export function resolveVRRoundOpen(round: Readonly<VRRoundOpenInput> | null | undefined): boolean {
  if (!round) return false;
  return !round.roundStarted && !round.roundPaused && !round.playerActionCommitted &&
    !(round.scheduledActionCount > 0);
}

export interface VRRoundReadinessInput {
  readonly eligible: boolean;
  readonly hasTarget: boolean;
  readonly inCombat: boolean;
  /** resolveVRRoundOpen for the actor's round; aim-independent. */
  readonly roundOpen?: boolean;
  readonly round: {
    readonly roundStarted: boolean;
    readonly roundPaused: boolean;
    readonly pauseTimer: number;
    /** What pauseRound was given; the pause counts down from this. */
    readonly pauseLength?: number;
    readonly timer: number;
    readonly roundLength: number;
  } | null;
}

/**
 * How far the next attack round has come, 0..1, for the hilt ring (3.5).
 *
 * The ring was fed `eligible ? 1 : 0`, so it never filled: it was either
 * hidden or an empty grey circle, and with a weapon out and nobody to fight
 * the empty circle stayed up for good (critic run 3). 1 hides the ring:
 * ready to attack, or out of combat with nobody targeted.
 */
export function resolveVRRoundReadiness(input: VRRoundReadinessInput): number {
  // Out of combat there is no round to count down: the ring stays hidden
  // even with a hostile aimed at (critic run 4: an empty ring outside fights).
  if (!input.inCombat) return 1;
  if (input.eligible || input.roundOpen === true) return 1;
  const round = input.round;
  if (!round || !(round.roundLength > 0)) return 0;
  if (round.roundPaused) {
    // The pause counts down from its own length: a full round for the
    // player's own attack, half a round when a duel partner's attack holds
    // it. Measuring it against the round length made the ring jump back on
    // that half pause (critic run 4).
    const length = round.pauseLength && round.pauseLength > 0 ? round.pauseLength : round.roundLength;
    return Math.min(0.99, Math.max(0, 1 - Math.max(0, round.pauseTimer) / length));
  }
  if (!round.roundStarted) return 0;
  return Math.min(0.99, Math.max(0, round.timer / round.roundLength));
}

/**
 * Keeps the ring from running backwards inside one wait: a round that is
 * paused part-way through switches clocks, and either clock alone can step
 * back. The ring only grows until the round opens or combat ends.
 */
export class VRRoundReadinessLatch {
  private high = 0;
  private actor: unknown = undefined;
  private roundAction: unknown = undefined;

  /**
   * `actor` and `roundAction` identify the wait: a new party leader, or a new
   * action taking the round (an attack, then a medpac scheduled into the busy
   * round), starts the ring again. Without them the ring froze near full for
   * the whole of a chained round, and carried one leader's mark onto the next
   * (critic run 5).
   */
  apply(readiness: number, roundOpen: boolean, inCombat: boolean, actor?: unknown, roundAction?: unknown): number {
    if (actor !== this.actor || roundAction !== this.roundAction) {
      this.actor = actor;
      this.roundAction = roundAction;
      this.high = 0;
    }
    if (!inCombat || roundOpen || readiness >= 1) {
      this.high = 0;
      return readiness;
    }
    this.high = Math.max(this.high, readiness);
    return this.high;
  }

  reset(): void {
    this.high = 0;
  }
}
