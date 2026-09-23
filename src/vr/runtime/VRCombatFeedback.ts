import type { VRHapticPattern } from './VRHapticFeedback';

/**
 * What the player feels and sees when an attack roll lands (ROADMAP 3.13).
 *
 * In first person the player's avatar is hidden, so the attack and parry
 * animations the engine plays for them are on a body they cannot see. Before
 * this, a hit, a miss, a critical and a parry all felt the same: nothing. The
 * roll is untouched — this only reads `CombatRoundAction.attackResult` after
 * the engine has decided it.
 *
 * The patterns are chosen to be told apart with eyes closed: a miss is a
 * barely-there tap, a hit a firm knock, a critical two hard knocks, a parry a
 * longer jolt. All stay clear of the 25 ms round-ready tick (3.12), which comes
 * at the round opening, not when a roll lands.
 */

/** Engine `AttackResult` values, duplicated so this module stays engine-free. */
const HIT_SUCCESSFUL = 1;
const CRITICAL_HIT = 2;
const AUTOMATIC_HIT = 3;
const MISS = 4;
const ATTACK_RESISTED = 5;
const PARRIED = 8;
const DEFLECTED = 9;

export type VRCombatFeedbackOutcome = 'hit' | 'critical' | 'miss' | 'parried' | 'deflected';

export type VRCombatFeedbackEffect =
  /** Sparks where the blades meet. */
  | 'clash'
  /** The incoming bolt is drawn to the player's blade and bounces off it. */
  | 'deflect'
  | 'none';

export interface VRCombatFeedback {
  /** Whether the player made the attack or received it. */
  readonly role: 'attacker' | 'defender';
  readonly outcome: VRCombatFeedbackOutcome;
  /** Played in order on the weapon hand, `gapMs` apart. */
  readonly pulses: readonly VRHapticPattern[];
  readonly gapMs: number;
  readonly effect: VRCombatFeedbackEffect;
}

export interface VRCombatFeedbackInput {
  readonly attackerId: number;
  readonly targetId: number | null;
  readonly attackResult: number;
  readonly localActorId: number | null;
}

export const VR_COMBAT_HAPTICS = Object.freeze({
  miss: Object.freeze({ durationMs: 12, amplitude: 0.1 }),
  hit: Object.freeze({ durationMs: 50, amplitude: 0.55 }),
  criticalFirst: Object.freeze({ durationMs: 60, amplitude: 0.9 }),
  criticalSecond: Object.freeze({ durationMs: 90, amplitude: 1 }),
  clash: Object.freeze({ durationMs: 75, amplitude: 0.75 }),
  deflect: Object.freeze({ durationMs: 45, amplitude: 0.6 }),
});

const CRITICAL_GAP_MS = 70;

export function resolveVRCombatFeedback(input: Readonly<VRCombatFeedbackInput>): VRCombatFeedback | null {
  const { attackerId, targetId, attackResult, localActorId } = input;
  if (localActorId === null || !Number.isInteger(localActorId)) return null;

  if (attackerId === localActorId) {
    switch (attackResult) {
      case HIT_SUCCESSFUL:
      case AUTOMATIC_HIT:
        return feedback('attacker', 'hit', [VR_COMBAT_HAPTICS.hit]);
      case CRITICAL_HIT:
        return feedback('attacker', 'critical',
          [VR_COMBAT_HAPTICS.criticalFirst, VR_COMBAT_HAPTICS.criticalSecond], CRITICAL_GAP_MS);
      case PARRIED:
        return feedback('attacker', 'parried', [VR_COMBAT_HAPTICS.clash], 0, 'clash');
      // A Jedi batting the player's bolt away is a miss from the shooter's
      // side; the engine already draws that bolt green.
      case MISS:
      case ATTACK_RESISTED:
      case DEFLECTED:
        return feedback('attacker', attackResult === DEFLECTED ? 'deflected' : 'miss', [VR_COMBAT_HAPTICS.miss]);
      default:
        return null;
    }
  }

  // Someone else's roll against the player. Only the player's own defence
  // belongs here; being hit is ROADMAP 3.14's.
  if (targetId !== null && targetId === localActorId) {
    if (attackResult === PARRIED) {
      return feedback('defender', 'parried', [VR_COMBAT_HAPTICS.clash], 0, 'clash');
    }
    if (attackResult === DEFLECTED) {
      return feedback('defender', 'deflected', [VR_COMBAT_HAPTICS.deflect], 0, 'deflect');
    }
  }
  return null;
}

function feedback(
  role: VRCombatFeedback['role'],
  outcome: VRCombatFeedbackOutcome,
  pulses: readonly VRHapticPattern[],
  gapMs = 0,
  effect: VRCombatFeedbackEffect = 'none',
): VRCombatFeedback {
  return Object.freeze({ role, outcome, pulses: Object.freeze([...pulses]), gapMs, effect });
}
