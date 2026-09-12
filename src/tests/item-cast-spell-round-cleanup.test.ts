import { describe, expect, test } from '@jest/globals';
import { CombatActionType } from '@/enums/combat/CombatActionType';
import { releaseUnstartedItemCastCombatAction } from '@/actions/ItemCastSpellRoundCleanup';

describe('releaseUnstartedItemCastCombatAction', () => {
  test('releases a rejected item cast so the next physical tempo input is not blocked', () => {
    const rejectedItemCast = { actionType: CombatActionType.ITEM_CAST_SPELL };
    const unrelatedScheduledAction = { actionType: CombatActionType.ATTACK };
    const round = {
      roundStarted: false,
      action: rejectedItemCast,
      scheduledActionList: [unrelatedScheduledAction],
    };

    expect(releaseUnstartedItemCastCombatAction(round)).toBe(true);
    expect(round.action).toBeUndefined();
    expect(round.scheduledActionList).toEqual([unrelatedScheduledAction]);
  });

  test('does not disturb an already-started round or a different active action', () => {
    const activeItemCast = { actionType: CombatActionType.ITEM_CAST_SPELL };
    const activeAttack = { actionType: CombatActionType.ATTACK };

    expect(releaseUnstartedItemCastCombatAction({ roundStarted: true, action: activeItemCast })).toBe(false);
    expect(releaseUnstartedItemCastCombatAction({ roundStarted: false, action: activeAttack })).toBe(false);
    expect(releaseUnstartedItemCastCombatAction(undefined)).toBe(false);
  });
});
