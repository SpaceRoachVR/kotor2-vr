/**
 * The Force pool a party member's template gets when it joins.
 *
 * Retail grants Force points only through classes with a Force die. Bao-Dur's
 * template (p_baodur.utc, Tech Specialist 6) stores ForcePoints 48 and
 * CurrentForce 48, yet the retail character sheet shows Force 0 / 0 for him
 * (StrategyWiki, KotOR II Party: "Force 0 0"), as for every companion without
 * Jedi levels. Some Jedi companion templates store no pool at all (p_kreia:
 * Jedi Consular 3, 0 / 0) and get the retail per-level pool instead.
 *
 * Deliberately free of engine imports so it can be tested without the world.
 */

export interface ForcePoolInput {
  /** Stored pool maximum (MaxForcePoints, or the base when the template has none). */
  maxForcePoints: number;
  /** Stored base pool (ForcePoints). */
  forcePoints: number;
  /** Levels in classes with a Force die. */
  forceClassLevels: number;
  /** The retail pool those levels give a template-built character. */
  poolFromClasses: number;
}

/**
 * Returns the pool to set, or undefined to keep the stored one. A member with
 * no Force-die class level has no pool. A Jedi with no stored pool gets the
 * pool from its classes; a stored pool on a Jedi is kept as written.
 */
export function resolvePartyForcePool(input: ForcePoolInput): number | undefined {
  const stored = Math.max(Number(input.maxForcePoints) || 0, Number(input.forcePoints) || 0);
  if((Number(input.forceClassLevels) || 0) <= 0){
    return stored > 0 ? 0 : undefined;
  }
  if(stored > 0) return undefined;
  const fromClasses = Number(input.poolFromClasses) || 0;
  return fromClasses > 0 ? fromClasses : undefined;
}
