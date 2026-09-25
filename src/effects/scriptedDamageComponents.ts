import { DamageType } from "@/enums/combat/DamageType";

/**
 * The per-slot damage a scripted `EffectDamage(nAmount, nDamageType)` should
 * carry, as `[slot, amount]` pairs for `EffectDamage.intList`.
 *
 * `calculateDamageAmount` sums every slot 0..14, so an amount may live in
 * exactly one of them. The routine used to write it into the typed slot AND
 * into slot 14 (PHYSICAL), which doubled every scripted hit: 102PER's steam
 * vents (`tr_steamdam`, d3+1 fire) took 4 and 8 a step instead of 2 to 4, and
 * a cluster of them killed a level-3 Exile between two 100 ms samples.
 *
 * NWScript damage types are bit flags (BLUDGEONING=1, PIERCING=2, ... FIRE=256),
 * so a single flag maps to slot log2(flag). Anything else - zero, a
 * combination, or a flag past the last slot - has no typed home and falls
 * back to the PHYSICAL slot alone.
 */
export function scriptedDamageComponents(amount: number, damageType: number): Array<[number, number]> {
  if (!Number.isFinite(amount)) throw new TypeError('damage amount must be finite');
  if (!Number.isFinite(damageType)) throw new TypeError('damage type must be finite');
  const slot = Math.log2(damageType);
  const typed = Number.isInteger(slot) && slot >= 0 && slot < DamageType.PHYSICAL;
  return [[typed ? slot : DamageType.PHYSICAL, amount]];
}
