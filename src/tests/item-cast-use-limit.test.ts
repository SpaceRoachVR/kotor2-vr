import { describe, expect, test } from '@jest/globals';
import { canUseWornItemCast, resolveItemCastUseLimit, spendWornItemCast, type ItemCastUseState } from '@/actions/ItemCastUseLimit';

// iprp_chargecost.2da rows, as read from retail TSL (critic run 5).
describe('worn item cast limits follow iprp_chargecost', () => {
  test('cost values map to the retail rows', () => {
    expect(resolveItemCastUseLimit(1)).toEqual({ kind: 'consume' });
    expect(resolveItemCastUseLimit(2)).toEqual({ kind: 'charges', perUse: 5 });
    expect(resolveItemCastUseLimit(6)).toEqual({ kind: 'charges', perUse: 1 });
    expect(resolveItemCastUseLimit(7)).toEqual({ kind: 'unlimited' });
    expect(resolveItemCastUseLimit(8)).toEqual({ kind: 'per-day', uses: 1 });
    expect(resolveItemCastUseLimit(12)).toEqual({ kind: 'per-day', uses: 5 });
    expect(resolveItemCastUseLimit(13)).toEqual({ kind: 'unlimited' });
    expect(resolveItemCastUseLimit(14)).toEqual({ kind: 'interval', minutes: 1 });
    expect(resolveItemCastUseLimit(18)).toEqual({ kind: 'interval', minutes: 5 });
  });

  test('1 use/day: once, then again the next day', () => {
    const limit = resolveItemCastUseLimit(8);
    const state: ItemCastUseState = { charges: 0 };
    const day1 = { day: 10, nowMs: 0 };
    expect(canUseWornItemCast(limit, state, day1)).toBe(true);
    spendWornItemCast(limit, state, day1);
    expect(canUseWornItemCast(limit, state, day1)).toBe(false);
    expect(canUseWornItemCast(limit, state, { day: 11, nowMs: 0 })).toBe(true);
  });

  test('charges per use run out', () => {
    const limit = resolveItemCastUseLimit(5); // 2 charges per use
    const state: ItemCastUseState = { charges: 3 };
    expect(canUseWornItemCast(limit, state, { day: 0, nowMs: 0 })).toBe(true);
    spendWornItemCast(limit, state, { day: 0, nowMs: 0 });
    expect(state.charges).toBe(1);
    expect(canUseWornItemCast(limit, state, { day: 0, nowMs: 0 })).toBe(false);
  });

  test('once per minute', () => {
    const limit = resolveItemCastUseLimit(14);
    const state: ItemCastUseState = { charges: 0 };
    spendWornItemCast(limit, state, { day: 0, nowMs: 1_000 });
    expect(canUseWornItemCast(limit, state, { day: 0, nowMs: 30_000 })).toBe(false);
    expect(canUseWornItemCast(limit, state, { day: 0, nowMs: 61_000 })).toBe(true);
  });
});
