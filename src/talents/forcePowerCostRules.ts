/**
 * Force power Force Point (FP) cost scaling and prerequisite rules for KotOR II.
 *
 * Implements authoritative Odyssey / KotOR II mechanics:
 * 1. Base cost from `spells.2da` `forcepoints`.
 * 2. Alignment adjustments:
 *    - Universal powers ('-'): 0% adjustment.
 *    - Matching alignment ('G' on Light, 'E' on Dark): percentage discount up to -50%.
 *    - Opposing alignment ('G' on Dark, 'E' on Light): percentage penalty up to +75%.
 * 3. Charisma mitigation (KotOR II):
 *    - Each point of positive Charisma modifier reduces the opposing-alignment penalty by 5%.
 * 4. Force Forms (KotOR II):
 *    - Force Potency (spell ID 266) and Force Mastery (spell ID 268) add +20% to cost.
 *
 * Pure data-in, data-out with no engine/Three.js dependencies.
 */

export const FORCE_FORM_POTENCY_ID = 266;
export const FORCE_FORM_MASTERY_ID = 268;

export interface ForcePointCostAdjustment {
  /** Percentage penalty (0 to 75) */
  readonly penaltyPercent: number;
  /** Percentage discount (0 to 50) */
  readonly discountPercent: number;
}

/**
 * Resolves the raw alignment penalty and discount percentages from character alignment.
 *
 * @param powerAlignment 'G' (Light), 'E' (Dark), or '-' (Universal)
 * @param casterAlignment 0 (pure Dark) to 100 (pure Light)
 */
/** Discount for a power of the caster's side, by distance band from neutral. */
const SAME_SIDE_DISCOUNT = [0, 10, 15, 20, 30, 50] as const;
/** Penalty for a power of the other side, by the same bands. */
const OTHER_SIDE_PENALTY = [0, 25, 25, 50, 50, 75] as const;

/**
 * How far from neutral an alignment sits, in the TSL chart's bands: 41-60 is
 * neutral (0); 61-70 / 31-40 is 1, 71-80 / 21-30 is 2, 81-90 / 11-20 is 3,
 * 91-99 / 1-10 is 4, and 100 / 0 is 5. The engine used decade bands with a
 * 50-59 neutral, off by one at every edge (critic run 12: Stun Droid cost 18
 * at alignment 45, where retail charges 15).
 */
export function alignmentCostBand(casterAlignment: number): { readonly band: number; readonly light: boolean } {
  const a = Math.max(0, Math.min(100, Math.floor(casterAlignment)));
  if (a >= 41 && a <= 60) return { band: 0, light: true };
  if (a > 60) return { band: a === 100 ? 5 : a >= 91 ? 4 : a >= 81 ? 3 : a >= 71 ? 2 : 1, light: true };
  return { band: a === 0 ? 5 : a <= 10 ? 4 : a <= 20 ? 3 : a <= 30 ? 2 : 1, light: false };
}

export function getAlignmentCostAdjustment(
  powerAlignment: string | undefined,
  casterAlignment: number,
): ForcePointCostAdjustment {
  const normAlign = String(powerAlignment ?? '-').trim().toUpperCase();
  if (normAlign !== 'G' && normAlign !== 'E') {
    // Universal Power ('-')
    return { penaltyPercent: 0, discountPercent: 0 };
  }
  const { band, light } = alignmentCostBand(casterAlignment);
  if (band === 0) return { penaltyPercent: 0, discountPercent: 0 };
  const sameSide = (normAlign === 'G') === light;
  return sameSide
    ? { penaltyPercent: 0, discountPercent: SAME_SIDE_DISCOUNT[band] }
    : { penaltyPercent: OTHER_SIDE_PENALTY[band], discountPercent: 0 };
}

export interface ForcePointCostInput {
  readonly baseForcePoints: number;
  readonly powerAlignment?: string; // 'G', 'E', '-'
  readonly casterAlignment: number; // 0 to 100
  readonly charismaModifier?: number; // CHA modifier reduces opposing penalty by 5% per point
  readonly activeForms?: ReadonlyArray<number>; // active spell IDs (e.g. 266, 268)
}

/**
 * Calculates the final Force Point cost to cast a power.
 */
export function calculateForcePointCost(input: ForcePointCostInput): number {
  const base = Number(input.baseForcePoints);
  if (!Number.isFinite(base) || base <= 0) return 0;

  const { penaltyPercent, discountPercent } = getAlignmentCostAdjustment(
    input.powerAlignment,
    input.casterAlignment,
  );

  let adjustedCost = base;

  if (penaltyPercent > 0) {
    // In KotOR II, positive CHA modifier reduces penalty by 5% per point
    const chaMod = Math.max(0, Number(input.charismaModifier) || 0);
    const mitigatedPenalty = Math.max(0, penaltyPercent - chaMod * 5);
    const penaltyAmount = Math.floor(base * (mitigatedPenalty / 100));
    adjustedCost = base + penaltyAmount;
  } else if (discountPercent > 0) {
    const discountAmount = Math.floor(base * (discountPercent / 100));
    adjustedCost = Math.max(1, base - discountAmount);
  }

  // Check if Force Potency (266) or Force Mastery (268) is active (+20% cost)
  if (Array.isArray(input.activeForms)) {
    const hasCostIncreasingForm = input.activeForms.some(
      (formId) => formId === FORCE_FORM_POTENCY_ID || formId === FORCE_FORM_MASTERY_ID,
    );
    if (hasCostIncreasingForm) {
      adjustedCost = adjustedCost + Math.floor(adjustedCost * 0.2);
    }
  }

  return Math.max(1, adjustedCost);
}

/**
 * Checks alignment restrictions on specific Force powers in TSL:
 * - Inspire Followers (spells 167..172): Light side >= 60
 * - Crush Opposition (spells 144..149): Dark side <= 40
 * - Force Enlightenment (spell 180): Neutral or Light >= 40
 * - Force Crush (spell 177): Dark side <= 40
 */
export function isForcePowerAlignmentAllowed(
  spellId: number,
  alignment: number | undefined,
): boolean {
  if (alignment === undefined || !Number.isFinite(alignment)) return true;

  // Inspire Followers I..VI
  if (spellId >= 167 && spellId <= 172) {
    return alignment >= 60;
  }

  // Crush Opposition I..VI
  if (spellId >= 144 && spellId <= 149) {
    return alignment <= 40;
  }

  // Force Enlightenment
  if (spellId === 180) {
    return alignment >= 40;
  }

  // Force Crush
  if (spellId === 177) {
    return alignment <= 40;
  }

  return true;
}
