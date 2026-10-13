/**
 * T-B (locked decision 2 of 2026-10-12): each attack of a retail round needs a
 * stroke of its own.
 *
 * The round's first attack is rolled by the stroke that opens it. Its other
 * retail attacks - Flurry or Rapid Shot's extra, the off-hand weapon, a
 * double-bladed weapon's second blade - are held by the engine round
 * (CombatRound.holdsLaterAttacks) and each further stroke inside that 3 s
 * round spends one. A separate off-hand weapon's attack is spent only by the
 * off hand. Unspent attacks are lost when the round ends.
 *
 * A stroke the round has nothing left for is absorbed, with its whoosh, while
 * the round is young. It used to be held for the next opening, so a brisk
 * return to guard 400-450 ms after a slash bought an attack every round from
 * one deliberate stroke (Hilt and Tempo run 2: 6 of 6). Decision 3 of
 * 2026-10-13: the round budget solves that, not a stricter detector. Only a
 * stroke made in the round's last stretch, reaching for the next opening,
 * is still held for it (the held-swing rule, round 17).
 */

/** A stroke this late in a round (or later) is held for the next opening. */
export const VR_HELD_SWING_WINDOW_MILLISECONDS = 1500;
/** The retail round, CombatRound.ROUND_LENGTH. */
export const VR_ROUND_LENGTH_MILLISECONDS = 3000;

export type VRStrokeHand = 'main' | 'off';

export interface VRRoundStrokeInput {
  readonly hand: VRStrokeHand;
  /** Attacks the player's round still holds for this hand, at this stroke's target. */
  readonly heldAttacks: number;
  /**
   * Time left in the player's own round, which has begun and has an action;
   * null when no such round is running.
   */
  readonly ownRoundRemainingMs: number | null;
  /**
   * How long ago a stroke dispatched the attack that is about to open the
   * round (the engine has it but has not begun the round); null otherwise.
   */
  readonly openingAgeMs: number | null;
}

/**
 * - `spend`: roll one of the round's held attacks now.
 * - `absorb`: the round has nothing for this stroke; it does nothing.
 * - `pass`: not this rule's business - the stroke opens a round or is held
 *   for the next opening, as before.
 */
export type VRRoundStrokeDecision = 'spend' | 'absorb' | 'pass';

export function resolveVRRoundStroke(input: Readonly<VRRoundStrokeInput>): VRRoundStrokeDecision {
  if (Number.isFinite(input.heldAttacks) && input.heldAttacks > 0) return 'spend';
  // The off hand only ever spends the off-hand attack: it never opens a
  // round, and nothing it does waits for the next one.
  if (input.hand === 'off') return 'absorb';
  if (isYoungRound(input)) return 'absorb';
  return 'pass';
}

function isYoungRound(input: Readonly<VRRoundStrokeInput>): boolean {
  const remaining = input.ownRoundRemainingMs;
  if (remaining !== null && Number.isFinite(remaining)) return remaining > VR_HELD_SWING_WINDOW_MILLISECONDS;
  const age = input.openingAgeMs;
  if (age !== null && Number.isFinite(age) && age >= 0) {
    return age < VR_ROUND_LENGTH_MILLISECONDS - VR_HELD_SWING_WINDOW_MILLISECONDS;
  }
  return false;
}

export interface VRRoundAttackPips {
  /** Held attacks the weapon hand can still spend this round. */
  readonly main: number;
  /** Held attacks only the off hand can spend this round. */
  readonly off: number;
}

export const NO_VR_ROUND_ATTACK_PIPS: VRRoundAttackPips = Object.freeze({ main: 0, off: 0 });

/** Whole, non-negative pip counts, at most four of each (the hilt has room for that). */
export function normalizeVRRoundAttackPips(pips: Partial<VRRoundAttackPips> | null | undefined): VRRoundAttackPips {
  const clean = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.min(4, Math.floor(n)) : 0);
  const main = clean(pips?.main);
  const off = clean(pips?.off);
  return main === 0 && off === 0 ? NO_VR_ROUND_ATTACK_PIPS : Object.freeze({ main, off });
}
