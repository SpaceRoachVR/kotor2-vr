/** Pure item use-limit rules (no engine imports). */

/** ModuleItemProperty.UseLimitationAlignmentGroup (iprp_aligngrp.2da). */
const ALIGNMENT_GROUP_PROPERTY = 43;

export interface UseLimit { property: number; subType: number }

/**
 * Whether a wielder satisfies an item's use limits. Only alignment group (43)
 * is enforced; any match within that limitation type passes (a Name crystal
 * plus Solari/Qixoni). Subtypes: 0 All, 1 Neutral, 2 Light, 3 Dark,
 * 4 100% Dark, 5 100% Light. Groups follow GetAlignmentGoodEvil thresholds.
 */
export function meetsUseLimits(limits: UseLimit[], wielder: { goodEvil: number }): boolean {
  const alignment = (limits || []).filter(l => l.property === ALIGNMENT_GROUP_PROPERTY);
  if (!alignment.length) return true;
  const g = wielder.goodEvil;
  return alignment.some(l => {
    switch (l.subType) {
      case 0: return true;
      case 1: return g >= 25 && g < 75;
      case 2: return g >= 75;
      case 3: return g < 25;
      case 4: return g === 0;
      case 5: return g === 100;
      default: return false;
    }
  });
}

/** The parts of an item property the use-limit check reads (ItemProperty). */
export interface LimitProperty {
  propertyName: number;
  subType: number;
  isUseable?(): boolean;
}

/**
 * The alignment-group use limits among `properties`: property 43 entries
 * whose isUseable() is true. `installed` = the properties of an installed
 * upgrade part, which always apply (ItemProperty.installedUpgrade), so their
 * isUseable() is not consulted.
 */
export function alignmentLimitsOf(properties: readonly LimitProperty[] | undefined, installed = false): UseLimit[] {
  const limits: UseLimit[] = [];
  for (const p of properties || []) {
    if (p?.propertyName !== ALIGNMENT_GROUP_PROPERTY) continue;
    if (!installed && typeof p.isUseable === 'function' && !p.isUseable()) continue;
    limits.push({ property: p.propertyName, subType: p.subType });
  }
  return limits;
}
