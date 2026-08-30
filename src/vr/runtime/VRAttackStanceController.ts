/**
 * Persistent attack-mode stance (ROADMAP 4.8).
 *
 * The flat game treats an attack-mode feat as a one-shot: picking Flurry from
 * the action menu queues exactly one Flurry attack. In VR the attack itself is
 * a gesture, so re-opening the wheel for every swing is not viable. Instead the
 * wheel's Attacks page *arms* a stance, and every rolling swing thereafter
 * attacks with it.
 *
 * A change applies to the **next** round, mirroring the 2D queue system rather
 * than retroactively altering a round already underway. Selecting while no
 * round is running applies at once, because there is no round to wait for and
 * making the player wait for one would read as the control being broken.
 *
 * This is deliberately engine-independent: it holds identity and timing only,
 * and never touches TalentFeat, CombatRound or GameState. The caller maps a
 * stance back to a feat and decides what to do with it.
 */

/** `null` is a meaningful value throughout: it is the plain, un-modified attack. */
export type VRAttackStanceSelection = VRAttackStance | null;

export interface VRAttackStance {
  /** `feat.2da` row id — the stable identity the engine attacks with. */
  readonly featId: number;
  readonly label: string;
  readonly icon?: string;
}

/**
 * The slice of `CombatRound` this needs, passed in rather than read, so the
 * controller stays testable and the engine coupling stays at the call site.
 */
export interface VRCombatRoundSnapshot {
  readonly roundStarted: boolean;
  /** Milliseconds elapsed in the current round. Monotonic within a round. */
  readonly timerMilliseconds: number;
}

export interface VRAttackStanceState {
  readonly active: VRAttackStanceSelection;
  /**
   * The stance waiting for the next round, or `undefined` when nothing is
   * waiting. `null` and `undefined` mean different things here: `null` is a
   * queued return to the plain attack, `undefined` is an empty queue.
   */
  readonly pending: VRAttackStanceSelection | undefined;
}

export class VRAttackStanceController {
  private active: VRAttackStanceSelection = null;
  private pending: VRAttackStanceSelection | undefined = undefined;
  private lastTimerMilliseconds: number | null = null;
  private roundWasRunning = false;

  getState(): VRAttackStanceState {
    return { active: this.active, pending: this.pending };
  }

  /** True while a stance change is waiting for the round to turn over. */
  hasPending(): boolean {
    return this.pending !== undefined;
  }

  /**
   * Arms a stance. Applies immediately when no round is running, otherwise
   * queues it for the next one.
   *
   * Re-selecting the stance that is already active while something else is
   * queued cancels the queued change rather than stacking a second one — the
   * player is asking to end up where they already are.
   */
  select(stance: VRAttackStanceSelection, round: VRCombatRoundSnapshot | null): void {
    const roundRunning = round?.roundStarted === true;
    if (!roundRunning) {
      this.active = stance;
      this.pending = undefined;
      return;
    }

    if (sameStance(stance, this.active)) {
      this.pending = undefined;
      return;
    }

    this.pending = stance;
  }

  /**
   * Advances the queue when the round turns over.
   *
   * The boundary is detected rather than subscribed to, so this needs no hook
   * inside `CombatRound.endCombatRound()` and cannot be left dangling by one.
   * `CombatRound.timer` accumulates within a round and is reset to 0 when the
   * round ends, so a timer that has gone *backwards* is a new round. Leaving
   * combat entirely also promotes, since there is no longer a round to wait for.
   */
  observeRound(round: VRCombatRoundSnapshot | null): void {
    const roundRunning = round?.roundStarted === true;

    if (!roundRunning) {
      if (this.roundWasRunning || this.pending !== undefined) this.promote();
      this.roundWasRunning = false;
      this.lastTimerMilliseconds = null;
      return;
    }

    // A frame whose timer is unreadable carries no information about round
    // boundaries, so it is ignored. Substituting 0 would be far worse: it looks
    // exactly like the reset at the end of a round, and would silently promote
    // a stance a round early.
    const rawTimer = round?.timerMilliseconds;
    const timer = Number.isFinite(rawTimer) ? (rawTimer as number) : null;

    // A round that has only just started is itself a boundary: the previous
    // round ended for the queued stance to be waiting on.
    const startedThisFrame = !this.roundWasRunning;
    const timerWentBackwards = timer !== null &&
      this.lastTimerMilliseconds !== null &&
      timer < this.lastTimerMilliseconds;

    if (startedThisFrame || timerWentBackwards) this.promote();

    this.roundWasRunning = true;
    if (timer !== null) this.lastTimerMilliseconds = timer;
  }

  /**
   * Drops the stance and anything queued. For leaving combat, a module change,
   * or a weapon swap — an attack mode is filtered by
   * `getEquippedWeaponType()`, so a melee stance must not survive into a
   * blaster.
   */
  reset(): void {
    this.active = null;
    this.pending = undefined;
    this.lastTimerMilliseconds = null;
    this.roundWasRunning = false;
  }

  private promote(): void {
    if (this.pending === undefined) return;
    this.active = this.pending;
    this.pending = undefined;
  }
}

/** Shown when nothing is armed — the engine's plain, un-modified attack. */
export const VR_PLAIN_ATTACK_LABEL = 'Attack';

/**
 * Formats the stance for the weapon-mounted readout.
 *
 * A queued change is shown alongside the active one rather than replacing it,
 * because the distinction is the whole point of the round-queued model: until
 * the round turns over you are still attacking as the *active* stance, and a
 * readout that switched immediately would misreport what the next swing does.
 */
export function formatVRAttackStanceReadout(state: VRAttackStanceState): string {
  const active = state.active?.label?.trim() || VR_PLAIN_ATTACK_LABEL;
  if (state.pending === undefined) return active;
  const pending = state.pending?.label?.trim() || VR_PLAIN_ATTACK_LABEL;
  return `${active} → ${pending}`;
}

function sameStance(a: VRAttackStanceSelection, b: VRAttackStanceSelection): boolean {
  if (a === null || b === null) return a === b;
  return a.featId === b.featId;
}
