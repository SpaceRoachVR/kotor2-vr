import { CombatFeatType } from "@/enums/combat/CombatFeatType";

/**
 * What the combat stance feats do on an attack, from the feat descriptions in
 * TSL's dialog.tlk (read from the retail feat.2da/dialog.tlk in the engine,
 * critic runs 4-5):
 *
 * - Critical Strike (melee) / Sniper Shot (ranged): "doubles / triples /
 *   quadruples the critical threat range"; "if the attack hits, the target is
 *   also stunned for 6 seconds unless they make a Fortitude save at a DC of
 *   the attacking character's level + Strength (Sniper: Intelligence)
 *   modifier". (The -5 Defense is TalentFeat's.)
 * - Power Attack (melee) / Power Blast (ranged): "+3 / +7 / +12" damage, "the
 *   critical multiplier is increased by 1", and "on a critical hit, the
 *   target is knocked back unless they make a Fortitude save at a DC of the
 *   attacking character's level + twice the Strength (Blast: Dexterity)
 *   modifier". (The -3 attack is TalentFeat's.)
 */

/** How many times wider the threat range is for this feat on this attack. */
export function resolveThreatRangeMultiplier(featId: number | undefined, ranged: boolean): number {
  switch (featId) {
    case CombatFeatType.CRITICAL_STRIKE: return ranged ? 1 : 2;
    case CombatFeatType.IMPROVED_CRITICAL_STRIKE: return ranged ? 1 : 3;
    case CombatFeatType.MASTER_CRITICAL_STRIKE: return ranged ? 1 : 4;
    case CombatFeatType.SNIPER_SHOT: return ranged ? 2 : 1;
    case CombatFeatType.IMPROVED_SNIPER_SHOT: return ranged ? 3 : 1;
    case CombatFeatType.MASTER_SNIPER_SHOT: return ranged ? 4 : 1;
    default: return 1;
  }
}

/**
 * The lowest natural roll that threatens. A weapon threatening on 19-20 (a
 * range two wide) doubled threatens on 17-20.
 */
export function resolveThreatRangeMin(weaponThreatMin: number, multiplier: number): number {
  const min = Math.min(20, Math.max(1, Math.floor(Number(weaponThreatMin) || 20)));
  const width = 21 - min;
  return Math.max(2, 21 - width * Math.max(1, Math.floor(multiplier)));
}

export function resolvePowerAttackDamage(featId: number | undefined, ranged: boolean): number {
  switch (featId) {
    case CombatFeatType.POWER_ATTACK: return ranged ? 0 : 3;
    case CombatFeatType.IMPROVED_POWER_ATTACK: return ranged ? 0 : 7;
    case CombatFeatType.MASTER_POWER_ATTACK: return ranged ? 0 : 12;
    case CombatFeatType.POWER_BLAST: return ranged ? 3 : 0;
    case CombatFeatType.IMPROVED_POWER_BLAST: return ranged ? 7 : 0;
    case CombatFeatType.MASTER_POWER_BLAST: return ranged ? 12 : 0;
    default: return 0;
  }
}

/** +1 to the critical multiplier for any Power Attack/Blast rank used on its kind of attack. */
export function resolveCriticalMultiplierBonus(featId: number | undefined, ranged: boolean): number {
  return resolvePowerAttackDamage(featId, ranged) > 0 ? 1 : 0;
}

export interface FeatOnHitSave {
  readonly effect: 'stun' | 'knockdown';
  /** Applies on any hit, or only on a critical hit. */
  readonly on: 'hit' | 'critical';
  readonly seconds: number;
  /** DC = level + abilityMultiplier x the named ability's modifier. */
  readonly ability: 'STR' | 'DEX' | 'INT';
  readonly abilityMultiplier: number;
}

export function resolveFeatOnHitSave(featId: number | undefined, ranged: boolean): FeatOnHitSave | null {
  if (resolveThreatRangeMultiplier(featId, ranged) > 1) {
    return { effect: 'stun', on: 'hit', seconds: 6, ability: ranged ? 'INT' : 'STR', abilityMultiplier: 1 };
  }
  if (resolvePowerAttackDamage(featId, ranged) > 0) {
    return { effect: 'knockdown', on: 'critical', seconds: 3, ability: ranged ? 'DEX' : 'STR', abilityMultiplier: 2 };
  }
  return null;
}

export function resolveFeatSaveDC(save: FeatOnHitSave, level: number, abilityModifier: number): number {
  return Math.max(0, Math.floor(level)) + save.abilityMultiplier * Math.floor(abilityModifier);
}
