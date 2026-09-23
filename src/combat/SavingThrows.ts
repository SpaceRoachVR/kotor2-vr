/**
 * TSL saving throws.
 *
 * A retail save stores each creature's FortSaveThrow/RefSaveThrow/WillSaveThrow
 * as a derived total, and the totals decompose as:
 *
 *   class base save (sum over classes, the class's savingthrowtable row for
 *   its level) + template bonus (fortbonus/refbonus/willbonus) + ability
 *   modifier (CON / DEX / WIS) + autobalance save bonus + effects and gear
 *
 * Checked against a retail SAVEGAME.sav with PyKotor: Kreia (Consular 3,
 * CON/DEX/WIS mods +3) stores 6/5/6 = class 3/2/3 + 3; T3-M4 (class 7, level 3,
 * CON/DEX +2, WIS 0) stores 3/5/1 = class 1/3/1 + 2/2/0.
 *
 * The engine previously returned the stored field as the base save: 0 for any
 * creature spawned from a template (no class save at all), and for a creature
 * loaded from a save a total that already held the ability modifier, which the
 * save roll then added again.
 */

export enum SavingThrow {
  ALL = 0,
  FORTITUDE = 1,
  REFLEX = 2,
  WILL = 3,
}

/** SAVING_THROW_TYPE_ALL / NONE in nwscript: the effect applies to every save type. */
export const SAVING_THROW_TYPE_ALL = 0;

export interface SavingThrowEffect {
  /** +amount for EffectSavingThrowIncrease, -amount for EffectSavingThrowDecrease. */
  readonly amount: number;
  /** SAVING_THROW_* the effect targets (ALL covers all three). */
  readonly save: number;
  /** SAVING_THROW_TYPE_* it is limited to (ALL = unconditional). */
  readonly saveType: number;
}

/**
 * Net effect modifier on one save. A type-limited effect (e.g. vs poison) only
 * counts when the roll is of that type.
 */
export function savingThrowEffectBonus(
  effects: readonly SavingThrowEffect[], save: SavingThrow, rollType: number = SAVING_THROW_TYPE_ALL,
): number {
  let total = 0;
  for (const effect of effects) {
    if (!effect || !Number.isFinite(effect.amount)) continue;
    if (effect.save !== SavingThrow.ALL && effect.save !== save) continue;
    if (effect.saveType !== SAVING_THROW_TYPE_ALL && effect.saveType !== rollType) continue;
    total += effect.amount;
  }
  return total;
}

/**
 * The creature's save before the ability modifier and autobalance bonus, which
 * ModuleObject's fortitudeSave/reflexSave/willSave add at roll time.
 */
export function resolveBaseSavingThrow(input: {
  readonly classSaves: readonly number[];
  readonly templateBonus: number;
  readonly effectBonus: number;
}): number {
  let total = 0;
  for (const value of input.classSaves) total += Number.isFinite(value) ? value : 0;
  total += Number.isFinite(input.templateBonus) ? input.templateBonus : 0;
  total += Number.isFinite(input.effectBonus) ? input.effectBonus : 0;
  return total;
}
