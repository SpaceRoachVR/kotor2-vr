export interface BlasterDeflectionInput {
  /** The already-computed attack roll the defender is trying to beat. */
  readonly attackRoll: number;
  /** True if the defender has EffectAssuredDeflection — skips the opposed roll entirely. */
  readonly assuredDeflection: boolean;
  /** EffectAssuredDeflection's stored reflect flag; ignored unless `assuredDeflection` is true. */
  readonly assuredDeflectionReflects: boolean;
  /**
   * The defender's deflection bonus (Jedi Defense tier + Deflect feat +
   * Increase/Decrease effects), or null if the defender cannot attempt
   * deflection at all (no feat, or no lightsaber in the main hand).
   * Ignored when `assuredDeflection` is true.
   */
  readonly deflectionBonus: number | null;
  /** A d20 roll function, injected so the opposed roll is deterministic in tests. */
  readonly rollD20: () => number;
}

export interface BlasterDeflectionResult {
  readonly deflected: boolean;
  /** Only meaningful when `deflected` is true. */
  readonly reflect: boolean;
}

const NOT_DEFLECTED: BlasterDeflectionResult = { deflected: false, reflect: false };

/**
 * Pure decision logic for the Jedi Defense feat line's opposed-roll blaster
 * deflection (KOTOR 2 feat text: "an opposed roll is made against the
 * attack — if the result is greater than the attack roll, the blaster
 * bolt is deflected. If the attack is beaten by 10 or more, the bolt is
 * deflected back at the enemy."). Kept free of any engine/creature
 * dependency so it can be unit tested directly; `CombatRound.tryBlasterDeflection`
 * gathers the creature-state inputs and applies the resulting side effects.
 */
export function resolveBlasterDeflection(input: BlasterDeflectionInput): BlasterDeflectionResult {
  if (!Number.isFinite(input.attackRoll)) {
    throw new TypeError('attackRoll must be finite');
  }
  if (typeof input.rollD20 !== 'function') {
    throw new TypeError('rollD20 must be a function');
  }

  if (input.assuredDeflection) {
    return { deflected: true, reflect: input.assuredDeflectionReflects };
  }

  if (input.deflectionBonus === null) return NOT_DEFLECTED;

  const deflectionRoll = input.rollD20() + input.deflectionBonus;
  if (deflectionRoll <= input.attackRoll) return NOT_DEFLECTED;

  return { deflected: true, reflect: deflectionRoll - input.attackRoll >= 10 };
}
