import { GameEffectType } from "@/enums/effects/GameEffectType";

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
