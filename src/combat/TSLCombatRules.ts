/**
 * The Sith Lords' combat arithmetic, from the in-game Combat log breakdowns as
 * documented on StrategyWiki ("Star Wars Knights of the Old Republic II: The
 * Sith Lords/Combat" and ".../Autobalance"). Kept free of engine imports so the
 * rules can be tested against those published tables.
 */

/** What a creature's autobalance set (UTC `MultiplierSet`, autobalance.2da) adds at a main character level. */
export interface AutoBalanceBonuses {
  /** Added to class level; drives the Constitution/Toughness vitality term and feat/power DCs. */
  readonly levelBonus: number;
  /** Multiplies the creature's base vitality. */
  readonly vitalityMultiplier: number;
  /** Multiplies base (weapon) damage rolls; flat bonuses are added afterwards. */
  readonly damageMultiplier: number;
  /** Added to base attack bonus. */
  readonly attackBonus: number;
  /** Added to the class defense bonus. */
  readonly defenseBonus: number;
  /** Added to every saving throw. */
  readonly saveBonus: number;
}

export const NO_AUTO_BALANCE: AutoBalanceBonuses = Object.freeze({
  levelBonus: 0,
  vitalityMultiplier: 1,
  damageMultiplier: 1,
  attackBonus: 0,
  defenseBonus: 0,
  saveBonus: 0,
});

/** autobalance.2da damagemult, Set_1..Set_5. */
const DAMAGE_MULTIPLIERS = [0.065, 0.09, 0.11, 0.135, 0.175];

// Products such as 20 * 0.7 land a hair either side of the integer in binary
// floating point; the published tables are exact.
const EPSILON = 1e-9;
const roundUp = (value: number) => Math.ceil(value - EPSILON);
const roundDown = (value: number) => Math.floor(value + EPSILON);
const roundNearest = (value: number) => Math.floor(value + 0.5 + EPSILON);

export function isAutoBalanceSet(set: unknown): set is 1 | 2 | 3 | 4 | 5 {
  return Number.isInteger(set) && (set as number) >= 1 && (set as number) <= 5;
}

/**
 * The autobalance bonuses for a set at a main character level. Set 0 (and any
 * unknown set) is "No_Auto_Balance". Every formula below is the page's own,
 * per set, and the tests hold them to its tables.
 */
export function resolveAutoBalanceBonuses(set: number, mainLevel: number): AutoBalanceBonuses {
  if (!isAutoBalanceSet(set)) return NO_AUTO_BALANCE;
  const main = Math.max(1, Math.floor(Number.isFinite(mainLevel) ? mainLevel : 1));

  const levelBonus = roundDown(main * 0.75) - 1;

  let vitalityMultiplier: number;
  if (set <= 3) vitalityMultiplier = roundDown((main + 1) * 0.65) - 1;
  else if (set === 4) vitalityMultiplier = roundNearest(main * 0.7) - 1;
  else vitalityMultiplier = roundNearest(main * 0.8) - 1;
  vitalityMultiplier = Math.max(vitalityMultiplier, 1);

  const damageMultiplier = Math.max(roundUp((main - 1) * DAMAGE_MULTIPLIERS[set - 1]), 1);

  let attackBonus: number;
  if (set <= 2) attackBonus = roundUp(main * 0.9) - 1;
  else if (set === 3) attackBonus = roundUp(main * 0.95) - 1;
  else if (set === 4) attackBonus = main;
  else attackBonus = roundDown(main * 1.1);

  let defenseBonus: number;
  if (set === 1) defenseBonus = roundDown(main * 0.6);
  else if (set === 2) defenseBonus = roundUp(main * 0.7) - 1;
  else if (set === 3) defenseBonus = roundDown(main * 0.8);
  else if (set === 4) defenseBonus = roundUp(main * 0.9) - 1;
  else defenseBonus = main;

  let saveBonus: number;
  if (set === 1) saveBonus = roundDown(main * 0.8);
  else if (set === 2) saveBonus = roundUp(main * 0.9) - 1;
  else if (set <= 4) saveBonus = main;
  else saveBonus = roundUp(main * 1.05) - 1;

  return { levelBonus, vitalityMultiplier, damageMultiplier, attackBonus, defenseBonus, saveBonus };
}

/**
 * Maximum vitality for an autobalanced creature, fixed when it spawns:
 * base vitality × multiplier + level × (Constitution modifier + Toughness),
 * where level is class level plus the set's level bonus. Null when the set
 * does not autobalance.
 */
export function resolveAutoBalancedMaxVitality(input: {
  readonly baseVitality: number;
  readonly set: number;
  readonly mainLevel: number;
  readonly classLevel: number;
  readonly constitutionModifier: number;
  readonly toughness: number;
}): number | null {
  if (!isAutoBalanceSet(input.set)) return null;
  const bonuses = resolveAutoBalanceBonuses(input.set, input.mainLevel);
  const base = Number.isFinite(input.baseVitality) ? input.baseVitality : 0;
  const level = Math.max(0, (Number.isFinite(input.classLevel) ? input.classLevel : 0) + bonuses.levelBonus);
  const perLevel = (Number.isFinite(input.constitutionModifier) ? input.constitutionModifier : 0) +
    (Number.isFinite(input.toughness) ? input.toughness : 0);
  return Math.max(1, base * bonuses.vitalityMultiplier + level * perLevel);
}

export interface AttackRollInput {
  /** The attack's d20. */
  readonly natural: number;
  /** Every attack bonus and penalty, summed. */
  readonly attackBonus: number;
  readonly defense: number;
  /** The lowest natural roll in the weapon's critical threat range (20 for 20-20). */
  readonly threatRangeMin: number;
  /** A second d20, read only when the attack threatens. */
  readonly threatNatural: number;
}

export interface AttackRollResult {
  readonly total: number;
  readonly hit: boolean;
  readonly threat: boolean;
  readonly critical: boolean;
}

/**
 * An attack hits when its total meets or beats defense. A natural 1 always
 * misses and a natural 20 always hits and threatens. A threat — a hit whose
 * natural roll is in the threat range — becomes a critical hit only if a
 * second roll with the same bonuses also meets defense, and that threat roll
 * has no automatic hit or miss.
 */
export function resolveAttackRoll(input: AttackRollInput): AttackRollResult {
  const total = input.natural + input.attackBonus;
  const hit = input.natural !== 1 && (input.natural >= 20 || total >= input.defense);
  const threat = hit && input.natural >= Math.min(20, input.threatRangeMin);
  const critical = threat && input.threatNatural + input.attackBonus >= input.defense;
  return { total, hit, threat, critical };
}

export function abilityModifier(score: number): number {
  return Math.floor(((Number.isFinite(score) ? score : 10) - 10) / 2);
}

/**
 * Strength for melee weapons and lightsabers, Dexterity for ranged weapons.
 * Finesse: Melee Weapons lets a higher Dexterity stand in for melee weapons
 * and lightsabers; Finesse: Lightsaber for lightsabers only.
 */
export function resolveAttackAbilityModifier(input: {
  readonly ranged: boolean;
  readonly lightsaber: boolean;
  readonly strengthModifier: number;
  readonly dexterityModifier: number;
  readonly finesseMelee: boolean;
  readonly finesseLightsaber: boolean;
}): number {
  if (input.ranged) return input.dexterityModifier;
  const finesse = input.finesseMelee || (input.lightsaber && input.finesseLightsaber);
  return finesse && input.dexterityModifier > input.strengthModifier
    ? input.dexterityModifier
    : input.strengthModifier;
}

/** Strength is added to damage for melee weapons, lightsabers and an off-hand blaster pistol only. */
export function strengthAddsToDamage(input: { readonly ranged: boolean; readonly offHandBlasterPistol: boolean }): boolean {
  return !input.ranged || input.offHandBlasterPistol;
}
