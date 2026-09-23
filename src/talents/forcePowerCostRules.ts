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
export function getAlignmentCostAdjustment(
  powerAlignment: string | undefined,
  casterAlignment: number,
): ForcePointCostAdjustment {
  const normAlign = String(powerAlignment ?? '-').trim().toUpperCase();
  const align = Math.max(0, Math.min(100, Math.floor(casterAlignment)));

  if (normAlign === 'G') {
    // Light Side Power
    if (align >= 100) return { penaltyPercent: 0, discountPercent: 50 };
    if (align >= 90) return { penaltyPercent: 0, discountPercent: 30 };
    if (align >= 80) return { penaltyPercent: 0, discountPercent: 20 };
    if (align >= 70) return { penaltyPercent: 0, discountPercent: 15 };
    if (align >= 60) return { penaltyPercent: 0, discountPercent: 10 };
    if (align >= 50) return { penaltyPercent: 0, discountPercent: 0 };
    if (align >= 30) return { penaltyPercent: 25, discountPercent: 0 };
    if (align >= 10) return { penaltyPercent: 50, discountPercent: 0 };
    return { penaltyPercent: 75, discountPercent: 0 };
  }

  if (normAlign === 'E') {
    // Dark Side Power
    if (align <= 9) return { penaltyPercent: 0, discountPercent: 50 };
    if (align <= 19) return { penaltyPercent: 0, discountPercent: 30 };
    if (align <= 29) return { penaltyPercent: 0, discountPercent: 20 };
    if (align <= 39) return { penaltyPercent: 0, discountPercent: 15 };
    if (align <= 49) return { penaltyPercent: 0, discountPercent: 10 };
    if (align <= 59) return { penaltyPercent: 0, discountPercent: 0 };
    if (align <= 79) return { penaltyPercent: 25, discountPercent: 0 };
    if (align <= 99) return { penaltyPercent: 50, discountPercent: 0 };
    return { penaltyPercent: 75, discountPercent: 0 };
  }

  // Universal Power ('-')
  return { penaltyPercent: 0, discountPercent: 0 };
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
