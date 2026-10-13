/**
 * Player-paced rounds (Allen, 2026-10-13, headset round 18), on top of T-B
 * (locked decision 2 of 2026-10-12: each attack of a retail round needs a
 * stroke of its own).
 *
 * The player's 3 s round starts at the player's stroke. An idle player's
 * swing or trigger pull attacks at once: there is no ring to wait for. The
 * round's other retail attacks - Flurry or Rapid Shot's extra, the off-hand
 * weapon, a double-bladed weapon's second blade - are held by the engine
 * round (CombatRound.holdsLaterAttacks), and each further stroke inside it
 * spends one. A stroke the round has nothing left for only whooshes: it is
 * not carried across the round and nothing says it was lost. The next round
 * is available 3 s after the last one began, so the player never attacks
 * more often than retail allows.
 *
 * The one exception is the silent hold. A stroke made just before the next
 * round is ready is kept, invisibly, and lands the moment it is. A fighter
 * swinging once a second strikes again about 3 s after the stroke that
 * opened the round, but the engine begins that round a frame or two after
 * the stroke, and the detector reports a stroke anywhere from about 110 to
 * 440 ms into the motion (emulator, pose velocity withheld as on Virtual
 * Desktop). So the stroke on the third beat arrives a little before the
 * round is ready: 48-280 ms before it in 11 of 11 samples (round-18 probes,
 * R15 droid, steady and +-150 ms jittered 1 Hz). Without the hold each of
 * those whooshed and the cadence fell to 4 s. 300 ms covers them; it is
 * kept that short so a held stroke still lands with the swing it came from
 * (stroke to roll at most ~0.4 s, against 1.5 s for the old held swing).
 */

/** A stroke this close to the next round being ready is held for it, silently. */
export const VR_SILENT_HOLD_MILLISECONDS = 300;
/** A held stroke that has waited this long without its round opening is dropped, silently. */
export const VR_SILENT_HOLD_MAX_MILLISECONDS = 600;
/** The retail round, CombatRound.ROUND_LENGTH. */
export const VR_ROUND_LENGTH_MILLISECONDS = 3000;

export type VRStrokeHand = 'main' | 'off';

export interface VRRoundStrokeInput {
  readonly hand: VRStrokeHand;
  /** Attacks the player's round still holds for this hand, at this stroke's target. */
  readonly heldAttacks: number;
  /** How long until the player's next round may begin (resolveVRPlayerRoundUntilReadyMs); 0 or less is now. */
  readonly untilReadyMs: number;
  /**
   * An action of the player's own is committed for the coming round but the
   * engine has not begun it yet: the opening stroke a frame or two ago, or a
   * Force power, grenade or medpac scheduled into the round.
   */
  readonly openingPending: boolean;
}

/**
 * - `open`: begin the player's round now with this stroke.
 * - `spend`: roll one of the running round's held attacks now.
 * - `hold`: the next round is a moment away; keep the stroke for it, silently.
 * - `whoosh`: the round has nothing for this stroke. It does nothing.
 */
export type VRRoundStrokeDecision = 'open' | 'spend' | 'hold' | 'whoosh';

export function resolveVRRoundStroke(input: Readonly<VRRoundStrokeInput>): VRRoundStrokeDecision {
  if (!input || typeof input !== 'object') throw new TypeError('A round stroke input is required.');
  const held = Number.isFinite(input.heldAttacks) && input.heldAttacks > 0;
  // The off hand only ever spends the off-hand attack: it never opens a
  // round, and nothing it does waits for the next one.
  if (input.hand === 'off') return held ? 'spend' : 'whoosh';
  if (input.openingPending === true) return 'whoosh';
  const until = Number.isFinite(input.untilReadyMs) ? input.untilReadyMs : 0;
  if (until <= 0) return 'open';
  if (held) return 'spend';
  if (until <= VR_SILENT_HOLD_MILLISECONDS) return 'hold';
  return 'whoosh';
}

export interface VRPlayerRoundClockInput {
  /** What is left of the round the player began, while the engine still runs it on the player's own pause; null otherwise. */
  readonly ownPauseRemainingMs: number | null;
  /** Game time since the player's last own round began; null if none has. */
  readonly sinceOwnRoundBeganMs: number | null;
}

/**
 * How long until the player may begin the next round: the player's own
 * round runs out on the engine's clock, and a round that was cut short (a
 * duel partner's attack re-begins it with half a round) still counts its
 * 3 s from when the player began it.
 */
export function resolveVRPlayerRoundUntilReadyMs(input: Readonly<VRPlayerRoundClockInput>): number {
  const own = input.ownPauseRemainingMs;
  const ownLeft = own !== null && Number.isFinite(own) ? Math.max(0, own) : 0;
  const since = input.sinceOwnRoundBeganMs;
  const floorLeft = since !== null && Number.isFinite(since) ? Math.max(0, VR_ROUND_LENGTH_MILLISECONDS - since) : 0;
  return Math.max(ownLeft, floorLeft);
}

/**
 * A duel partner's attack begins the player's round too and holds it for
 * half a round (ActionPhysicalAttacks, the dueling branch). Once the player's
 * own 3 s are up, the player's stroke ends that borrowed round and begins
 * the player's own, instead of waiting out the partner's pause.
 */
export function shouldTakeOverVRPlayerRound(input: {
  readonly roundStarted: boolean;
  readonly pausedBySelf: boolean;
  readonly untilReadyMs: number;
}): boolean {
  return input.roundStarted === true && input.pausedBySelf !== true && !(input.untilReadyMs > 0);
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
