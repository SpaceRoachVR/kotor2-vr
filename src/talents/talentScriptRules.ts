/**
 * What NWScript's talent routines answer, per nwscript.nss.
 *
 * Talent objects carry the engine's TalentObjectType bit flags (TalentObject
 * plus TalentSpell, TalentFeat or TalentSkill), but scripts speak
 * TALENT_TYPE_*: FORCE/SPELL 0, FEAT 1, SKILL 2. The engine compared the
 * flags against 0/1/2, so GetCreatureHasTalent was never true and
 * GetTypeFromTalent returned the flags; the retail party AI (k_inc_generic)
 * checks both before it uses a talent, so companions never used one.
 * GetCreatureTalentBest is "the best talent (i.e. closest to nCRMax without
 * going over)"; the engine returned the lowest.
 *
 * Deliberately free of engine imports so it can be tested without the world.
 */

/** TalentObjectType flags, mirrored so this module stays import-free. */
const FLAG_SPELL = 0x02;
const FLAG_FEAT = 0x04;
const FLAG_SKILL = 0x08;

export const TALENT_TYPE_FORCE = 0;
export const TALENT_TYPE_FEAT = 1;
export const TALENT_TYPE_SKILL = 2;
export const TALENT_EXCLUDE_ALL_OF_TYPE = -1;

export interface TalentLike {
  id: number;
  objectType: number;
  category: number;
  maxCR: number;
}

/** TALENT_TYPE_* of a talent, or -1 when it is none of them. */
export function talentScriptType(talent: { objectType?: number } | undefined): number {
  const flags = Number(talent?.objectType) || 0;
  if(flags & FLAG_SPELL) return TALENT_TYPE_FORCE;
  if(flags & FLAG_FEAT) return TALENT_TYPE_FEAT;
  if(flags & FLAG_SKILL) return TALENT_TYPE_SKILL;
  return -1;
}

/**
 * GetCreatureTalentBest: of the talents in nCategory whose CR does not exceed
 * nCRMax, the one with the highest CR, skipping the excluded ones (a type with
 * TALENT_EXCLUDE_ALL_OF_TYPE, or one id of that type). The first listed wins a
 * tie.
 */
export function pickBestTalent<T extends TalentLike>(
  talents: readonly T[], nCategory: number, nCRMax: number, nExcludeType = -1, nExcludeId = -1,
): T | undefined {
  let best: T | undefined;
  for(const talent of talents){
    if(!talent) continue;
    const category = Number(talent.category);
    if(!(category > -1) || (category & nCategory) != nCategory) continue;
    const cr = Number(talent.maxCR);
    if(!(cr <= nCRMax)) continue;
    if(nExcludeType >= 0 && talentScriptType(talent) == nExcludeType &&
      (nExcludeId == TALENT_EXCLUDE_ALL_OF_TYPE || talent.id == nExcludeId)) continue;
    if(!best || cr > Number(best.maxCR)) best = talent;
  }
  return best;
}

/**
 * GetCreatureTalentRandom: a random talent of the creature in nCategory. The
 * third script argument (nInclusion) is not a category; treating it as one
 * matched every talent with category 0 (skills), so the party AI drew skills
 * such as Stealth and Repair to use on an enemy.
 */
export function pickRandomTalent<T extends TalentLike>(talents: readonly T[], nCategory: number, random: () => number = Math.random): T | undefined {
  const matching = talents.filter((talent) => talent && Number(talent.category) > -1 && Number(talent.category) == nCategory);
  if(!matching.length) return undefined;
  return matching[Math.min(matching.length - 1, Math.floor(random() * matching.length))];
}
