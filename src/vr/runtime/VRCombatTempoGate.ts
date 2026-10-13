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
