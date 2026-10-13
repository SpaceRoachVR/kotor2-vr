/**
 * Part F (decision 8 of 2026-10-13): what the wheel's Force Powers page
 * offers, and in what order.
 *
 * - Droid-only powers are hidden unless the target is a droid. Stun Droid,
 *   Disable Droid and Destroy Droid were offered against human troopers and
 *   could be cast at a human Sith for 15 FP (Anchor and Hilt, run 2). They
 *   are retail spells.2da rows 47 (FORCE_POWER_DROID_STUN), 12
 *   (FORCE_POWER_DROID_DISABLE) and 13 (FORCE_POWER_DROID_DESTROY), the only
 *   Force powers in the table whose effect is droid-only. (A mine is a
 *   trigger, not a creature: its wheel is world actions, with no Force page.)
 * - Powers used in recent fights come first, so they sit on page 1: at L19
 *   the page is 4 deep, and Force Wave took 4.2 s of page flips mid-crowd.
 *
 * Presentation only: what a power does, and whether retail would let it be
 * cast, is untouched; the Abilities screen still lists every power.
 */
export const VR_DROID_ONLY_FORCE_POWER_SPELL_IDS: ReadonlySet<number> = new Set([12, 13, 47]);

export function isVRDroidOnlyForcePower(spellId: unknown): boolean {
  const id = Number(spellId);
  return Number.isInteger(id) && VR_DROID_ONLY_FORCE_POWER_SPELL_IDS.has(id);
}

/** How many recently used powers the wheel remembers. */
export const VR_RECENT_FORCE_POWER_LIMIT = 6;

/** The powers the player has picked lately, most recent first. */
export class VRRecentForcePowers {
  private readonly ids: number[] = [];

  note(spellId: unknown): void {
    const id = Number(spellId);
    if (!Number.isInteger(id) || id < 0) return;
    const at = this.ids.indexOf(id);
    if (at >= 0) this.ids.splice(at, 1);
    this.ids.unshift(id);
    if (this.ids.length > VR_RECENT_FORCE_POWER_LIMIT) this.ids.length = VR_RECENT_FORCE_POWER_LIMIT;
  }

  list(): readonly number[] {
    return [...this.ids];
  }

  clear(): void {
    this.ids.length = 0;
  }
}

/**
 * The page's powers with recently used ones first (most recent first); the
 * rest keep the engine's order. Stable: the same history gives the same page.
 */
export function orderVRForcePowersByRecent<T extends { readonly spellId?: number }>(
  actions: readonly T[],
  recentSpellIds: readonly number[] | null | undefined,
): T[] {
  const rank = new Map<number, number>();
  (recentSpellIds ?? []).forEach((id, index) => { if (!rank.has(id)) rank.set(id, index); });
  return actions
    .map((action, index) => ({ action, index, rank: typeof action.spellId === 'number' && rank.has(action.spellId) ? rank.get(action.spellId)! : Number.POSITIVE_INFINITY }))
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .map((entry) => entry.action);
}
