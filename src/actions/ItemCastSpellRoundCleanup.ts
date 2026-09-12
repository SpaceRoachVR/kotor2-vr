import { CombatActionType } from '@/enums/combat/CombatActionType';

export interface ItemCastSpellRoundState {
  roundStarted?: unknown;
  action?: { actionType?: unknown } | undefined;
}

/**
 * Releases only an item-cast action that failed before the combat round began.
 *
 * `ActionCombat` makes a scheduled action current before `ActionItemCastSpell`
 * performs its last-moment target and inventory checks. Without this release,
 * a rejected grenade looks like a permanently committed round and prevents the
 * next physical tempo input from reaching the authored queue.
 */
export function releaseUnstartedItemCastCombatAction(
  combatRound: ItemCastSpellRoundState | null | undefined,
): boolean {
  if (!combatRound || combatRound.roundStarted === true) {
    return false;
  }
  if (combatRound.action?.actionType !== CombatActionType.ITEM_CAST_SPELL) {
    return false;
  }
  combatRound.action = undefined;
  return true;
}
