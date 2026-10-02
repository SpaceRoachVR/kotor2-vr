/**
 * How often a worn item's cast-spell property may be used.
 *
 * The CastSpell item property (itempropdef row 10) takes its cost value from
 * iprp_chargecost.2da. Read from the retail TSL data in the engine
 * (2026-10-02): 0 Random, 1 Single Use, 2-6 "5..1 Charges/Use", 7 "0
 * Charges/Use", 8-12 "1..5 Uses/Day", 13 Unlimited Use, 14-18 "1 / 1..5
 * Minutes". Worn activatables used to be unusable, then, once usable,
 * unlimited whenever they had no charges (critic run 5).
 */
export type ItemCastUseLimit =
  | { readonly kind: 'consume' }
  | { readonly kind: 'charges'; readonly perUse: number }
  | { readonly kind: 'per-day'; readonly uses: number }
  | { readonly kind: 'interval'; readonly minutes: number }
  | { readonly kind: 'unlimited' };

export function resolveItemCastUseLimit(costValue: number): ItemCastUseLimit {
  const value = Number(costValue);
  if (value >= 2 && value <= 6) return { kind: 'charges', perUse: 7 - value };
  if (value === 7 || value === 13) return { kind: 'unlimited' };
  if (value >= 8 && value <= 12) return { kind: 'per-day', uses: value - 7 };
  if (value >= 14 && value <= 18) return { kind: 'interval', minutes: value - 13 };
  return { kind: 'consume' };
}

/** What a worn item remembers between uses. */
export interface ItemCastUseState {
  charges: number;
  usesDay?: number;
  usesToday?: number;
  lastUseMs?: number;
}

export interface ItemCastUseClock {
  /** The game day (ModuleTimeManager.pauseDay). */
  readonly day: number;
  /** Milliseconds on a monotonic clock, for per-minute limits. */
  readonly nowMs: number;
}

export function canUseWornItemCast(limit: ItemCastUseLimit, state: Readonly<ItemCastUseState>, clock: ItemCastUseClock): boolean {
  switch (limit.kind) {
    case 'unlimited': return true;
    case 'charges': return Number(state.charges) >= limit.perUse;
    case 'per-day': return state.usesDay !== clock.day || (state.usesToday ?? 0) < limit.uses;
    case 'interval': return state.lastUseMs === undefined || clock.nowMs - state.lastUseMs >= limit.minutes * 60_000;
    // A single-use property on a worn item is used up by its one use.
    case 'consume': return state.usesToday === undefined;
  }
}

/** Records one use. Returns whether the item itself is spent and should go. */
export function spendWornItemCast(limit: ItemCastUseLimit, state: ItemCastUseState, clock: ItemCastUseClock): boolean {
  switch (limit.kind) {
    case 'charges':
      state.charges = Math.max(0, Number(state.charges) - limit.perUse);
      return false;
    case 'per-day':
      if (state.usesDay !== clock.day) { state.usesDay = clock.day; state.usesToday = 0; }
      state.usesToday = (state.usesToday ?? 0) + 1;
      return false;
    case 'interval':
      state.lastUseMs = clock.nowMs;
      return false;
    case 'consume':
      return true;
    default:
      return false;
  }
}
