import { GameEffectType } from "@/enums/effects/GameEffectType";
import { SkillType } from "@/enums/nwscript/SkillType";

/**
 * Effective skill rank: base rank plus any skill-modifying effects.
 *
 * Extracted as a pure rule because `ModuleCreature` cannot be imported into a
 * test — its module graph reaches `GameState`, `CollisionManager` and the
 * managers barrel — and this arithmetic is the whole defect.
 *
 * **Nothing in the engine read `EffectSkillIncrease` / `EffectSkillDecrease`.**
 * The factory built them, `addEffect` attached them, and no consumer existed,
 * so every skill effect in the game was inert.
 *
 * The visible casualty was the security tunneler. `ActionUnlockObject` applies
 * the tunneler's ThievesTools bonus as a temporary `EffectSkillIncrease` on
 * SECURITY and then calls `attemptUnlock`, which resolves the check through
 * `getSkillLevel` — so the bonus was computed, attached, and discarded, and
 * using a tunneler rolled exactly the same as not using one. Reported from a
 * headset session against the combat-training Metal Box (DC 33) and the High
 * Security Cylinder (DC 36), both authored to be unreachable without one.
 *
 * Effective rank is also what retail `GetSkillRank` returns, which is the other
 * caller of `getSkillLevel`.
 */
export interface SkillModifyingEffect {
  readonly type: number;
  getInt(offset: number): number | undefined;
}

/**
 * `intList[0]` is the skill id and `intList[1]` the amount, matching how
 * `ActionUnlockObject` and `GameEffectFactory` populate them.
 *
 * Clamped at zero: a decrease may cancel a skill but never invert it. A
 * non-finite or absent amount contributes nothing rather than poisoning the
 * total with `NaN` — a malformed effect from a save must not make every
 * subsequent skill check unresolvable.
 */
export function resolveEffectiveSkillRank(
  baseRank: number,
  effects: readonly SkillModifyingEffect[] | null | undefined,
  skillId: number,
): number {
  let rank = Number.isFinite(baseRank) ? baseRank : 0;
  if (Array.isArray(effects)) {
    for (let i = 0, len = effects.length; i < len; i++) {
      const effect = effects[i];
      if (!effect || typeof effect.getInt !== 'function') continue;
      if (effect.getInt(0) !== skillId) continue;

      const amount = effect.getInt(1);
      if (!Number.isFinite(amount)) continue;

      if (effect.type === GameEffectType.EffectSkillIncrease) {
        rank += amount as number;
      } else if (effect.type === GameEffectType.EffectSkillDecrease) {
        rank -= amount as number;
      }
    }
  }
  return rank > 0 ? rank : 0;
}

/**
 * A feat family that raises skills: each tier replaces the one below it.
 */
interface SkillFeatFamily {
  readonly skills: readonly number[];
  /** feat.2da ids from the lowest tier up; tier n grants +(n + 1). */
  readonly tiers: readonly number[];
  /** The bonus reaches a skill only once it has a trained rank. */
  readonly requiresTrainedRank: boolean;
}

/**
 * From the in-game feat descriptions (feat.2da names and descriptions in
 * dialog.tlk). Gear Head and Caution state "You must have at least one skill
 * point in a particular skill to receive this bonus"; Empathy sets no such
 * condition.
 */
const SKILL_FEAT_FAMILIES: readonly SkillFeatFamily[] = [
  // GEAR_HEAD, GEAR_HEAD_ADEPT (Improved Gear Head), GEAR_HEAD_MASTER
  {
    skills: [SkillType.REPAIR, SkillType.SECURITY, SkillType.COMPUTER_USE],
    tiers: [12, 119, 120],
    requiresTrainedRank: true,
  },
  // CAUTIOUS, IMPROVED_CAUTION, MASTER_CAUTION
  {
    skills: [SkillType.DEMOLITIONS, SkillType.STEALTH],
    tiers: [7, 117, 118],
    requiresTrainedRank: true,
  },
  // EMPATHY, IMPROVED_EMPATHY, MASTER__EMPATHY
  {
    skills: [SkillType.PERSUADE, SkillType.AWARENESS, SkillType.TREAT_INJURY],
    tiers: [10, 121, 122],
    requiresTrainedRank: false,
  },
];

/**
 * The skill bonus a creature's feats grant, which nothing in the engine applied.
 *
 * T3-M4 carries Gear Head. The Ebon Hawk's High Security Cylinder is DC 36, and
 * the bark beside it tells T3 to open it with the basic Security Tunneler found
 * in the next cylinder: 20 (out of combat) + 3 (INT 16) + 6 ranks + 6 (the
 * tunneler) is 35 without the feat and exactly 36 with it. Round 8 reported
 * the tunneler as "completely broken" after five attempts that each totalled 35.
 */
export function resolveFeatSkillBonus(
  skillId: number,
  trainedRank: number,
  hasFeat: (featId: number) => boolean,
): number {
  let bonus = 0;
  for (const family of SKILL_FEAT_FAMILIES) {
    if (!family.skills.includes(skillId)) continue;
    if (family.requiresTrainedRank && !(trainedRank >= 1)) continue;
    for (let tier = family.tiers.length - 1; tier >= 0; tier--) {
      if (hasFeat(family.tiers[tier])) {
        bonus += tier + 1;
        break;
      }
    }
  }
  return bonus;
}
