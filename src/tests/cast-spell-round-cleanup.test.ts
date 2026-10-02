import { describe, expect, test } from '@jest/globals';
import { releaseUnstartedCastSpellCombatAction, releaseUnstartedItemCastCombatAction } from '@/actions/ItemCastSpellRoundCleanup';
import { CombatActionType } from '@/enums/combat/CombatActionType';

// Critic runs 5-6: an out-of-range Force cast failed before its round began
// and stayed the round's action, so the round read as committed for good.
describe('a cast that fails before its round starts is released', () => {
  test('an unstarted Force cast is released; a started one is not', () => {
    const round: any = { roundStarted: false, action: { actionType: CombatActionType.CAST_SPELL } };
    expect(releaseUnstartedCastSpellCombatAction(round)).toBe(true);
    expect(round.action).toBeUndefined();
    const started: any = { roundStarted: true, action: { actionType: CombatActionType.CAST_SPELL } };
    expect(releaseUnstartedCastSpellCombatAction(started)).toBe(false);
    expect(started.action).toBeDefined();
  });

  test('each helper releases only its own kind of action', () => {
    const item: any = { roundStarted: false, action: { actionType: CombatActionType.ITEM_CAST_SPELL } };
    expect(releaseUnstartedCastSpellCombatAction(item)).toBe(false);
    expect(releaseUnstartedItemCastCombatAction(item)).toBe(true);
    expect(releaseUnstartedCastSpellCombatAction(null)).toBe(false);
  });
});
