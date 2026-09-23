/**
 * Feat prerequisite evaluation rules for KotOR II.
 *
 * Checks all prerequisite conditions authored in `feat.2da`:
 * - Character level (`mincharlevel` / `minCharLevel`)
 * - Base attack bonus (`minattackbonus` / `minAttackBonus`)
 * - Ability requirements (`minstr`, `mindex`, `minint`, `minwis`)
 * - Caster level (`minspelllvl` / `minSpellLvl`)
 * - Required feats (`prereqfeat1`, `prereqfeat2`)
 * - Alternative required feats (`orreqfeat0` .. `orreqfeat4`)
 * - Class list status (`<class>_list` = 0 or 1)
 *
 * Free of engine/GUI imports so it remains directly testable under Jest.
 */

export interface FeatPrerequisiteContext {
  readonly characterLevel: number;
  readonly baseAttackBonus?: number;
  readonly spellCasterLevel?: number;
  readonly hasFeat: (featId: number) => boolean;
  readonly attributes?: {
    readonly str?: number;
    readonly dex?: number;
    readonly con?: number;
    readonly int?: number;
    readonly wis?: number;
    readonly cha?: number;
  };
  /**
   * The `<class>_list` status for the candidate class:
   * 0 = Normal selectable feat
   * 1 = Bonus selectable feat
   * 3 = Non-selectable / class-granted
   * 4 = Unavailable
   */
  readonly classListStatus?: number;
}

export interface ParsedFeatPrerequisites {
  readonly minCharLevel: number;
  readonly minAttackBonus: number;
  readonly minSpellLvl: number;
  readonly minStr: number;
  readonly minDex: number;
  readonly minInt: number;
  readonly minWis: number;
  readonly prereqFeat1: number;
  readonly prereqFeat2: number;
  readonly orReqFeats: readonly number[];
}

function parseInteger(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.floor(value) : fallback;
  const str = String(value).trim();
  if (str === '' || str === '****') return fallback;
  const num = Number(str);
  return Number.isFinite(num) ? Math.floor(num) : fallback;
}

export function parseFeatPrerequisites(feat: any): ParsedFeatPrerequisites {
  if (!feat || typeof feat !== 'object') {
    return {
      minCharLevel: 0,
      minAttackBonus: -1,
      minSpellLvl: -1,
      minStr: -1,
      minDex: -1,
      minInt: -1,
      minWis: -1,
      prereqFeat1: -1,
      prereqFeat2: -1,
      orReqFeats: [],
    };
  }

  const minCharLevel = parseInteger(feat.minCharLevel ?? feat.mincharlevel, 0);
  const minAttackBonus = parseInteger(feat.minAttackBonus ?? feat.minattackbonus, -1);
  const minSpellLvl = parseInteger(feat.minSpellLvl ?? feat.minspelllvl, -1);
  const minStr = parseInteger(feat.minStr ?? feat.minstr, -1);
  const minDex = parseInteger(feat.minDex ?? feat.mindex, -1);
  const minInt = parseInteger(feat.minInt ?? feat.minint, -1);
  const minWis = parseInteger(feat.minWis ?? feat.minwis, -1);
  const prereqFeat1 = parseInteger(feat.prereqFeat1 ?? feat.prereqfeat1, -1);
  const prereqFeat2 = parseInteger(feat.prereqFeat2 ?? feat.prereqfeat2, -1);

  const orReqFeats: number[] = [];
  for (let i = 0; i <= 4; i++) {
    const raw = feat[`orReqFeat${i}`] ?? feat[`orreqfeat${i}`];
    const parsed = parseInteger(raw, -1);
    if (parsed >= 0) {
      orReqFeats.push(parsed);
    }
  }

  return {
    minCharLevel,
    minAttackBonus,
    minSpellLvl,
    minStr,
    minDex,
    minInt,
    minWis,
    prereqFeat1,
    prereqFeat2,
    orReqFeats,
  };
}

/**
 * Evaluates whether all prerequisite conditions for a given feat are met.
 */
export function isFeatPrerequisiteMet(
  feat: any,
  context: FeatPrerequisiteContext,
): boolean {
  if (!feat || typeof feat !== 'object') return false;

  // 1. Class availability status (if provided): 0 (class) and 1 (bonus) are selectable
  if (context.classListStatus !== undefined && Number.isFinite(context.classListStatus)) {
    if (context.classListStatus !== 0 && context.classListStatus !== 1) {
      return false;
    }
  }

  const prereqs = parseFeatPrerequisites(feat);

  // 2. Minimum character level
  if (prereqs.minCharLevel > 0 && context.characterLevel < prereqs.minCharLevel) {
    return false;
  }

  // 3. Minimum base attack bonus
  if (prereqs.minAttackBonus > 0 && (context.baseAttackBonus ?? 0) < prereqs.minAttackBonus) {
    return false;
  }

  // 4. Minimum caster/spell level
  if (prereqs.minSpellLvl > 0 && (context.spellCasterLevel ?? 0) < prereqs.minSpellLvl) {
    return false;
  }

  // 5. Attribute requirements
  if (prereqs.minStr > 0 && (context.attributes?.str ?? 0) < prereqs.minStr) return false;
  if (prereqs.minDex > 0 && (context.attributes?.dex ?? 0) < prereqs.minDex) return false;
  if (prereqs.minInt > 0 && (context.attributes?.int ?? 0) < prereqs.minInt) return false;
  if (prereqs.minWis > 0 && (context.attributes?.wis ?? 0) < prereqs.minWis) return false;

  // 6. Direct prerequisite feats (both must be satisfied if non-negative)
  if (prereqs.prereqFeat1 >= 0 && !context.hasFeat(prereqs.prereqFeat1)) {
    return false;
  }
  if (prereqs.prereqFeat2 >= 0 && !context.hasFeat(prereqs.prereqFeat2)) {
    return false;
  }

  // 7. Alternative prerequisite feats (if any specified, at least one must be owned)
  if (prereqs.orReqFeats.length > 0) {
    const hasAnyOr = prereqs.orReqFeats.some((id) => context.hasFeat(id));
    if (!hasAnyOr) return false;
  }

  return true;
}
