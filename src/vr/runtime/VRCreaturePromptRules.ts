/**
 * Whether a creature should offer a VR world-interaction prompt.
 *
 * Creatures were absent from the world-prompt type mask entirely — it admitted
 * doors, placeables and triggers only — so no creature could ever become a
 * candidate. Walking up to 3C-FD or to the Peragus medbay dummy produced a
 * target reticle and a name label but never a prompt, and the trigger did
 * nothing. Reported from a headset session.
 *
 * The routing mirrors `ModuleCreature.onClick`, which is the flatscreen path
 * this prompt ultimately invokes:
 *
 * - **Living hostiles are excluded.** `onClick` routes those to
 *   `attackCreature`, and VR combat targeting already owns that interaction
 *   with its own reticle and stance handling. A competing "Talk" prompt there
 *   would offer an affordance combat then overrides.
 * - **A dead creature is a container while it holds something.** `onClick`
 *   routes to `actionUseObject`, and `ModuleCreature.use` opens the loot
 *   screen only when the corpse has inventory — so an empty corpse offered a
 *   "Use" that did nothing at all. Round 8: "Mining droids with no items to
 *   take should not show the option to use." This is the loot route, and the
 *   one case where hostility does not disqualify.
 * - **Everything else needs a conversation.** `onClick` only acts on a living
 *   non-hostile creature when it has one, so offering a prompt without one
 *   would produce a trigger press that visibly does nothing.
 *
 * Checked against the live 001EBO creature list: 3C-FD (`3cfd`) and the medbay
 * dummy (`dummy_pc`) qualify, while HK-50 — which carries no conversation at
 * that point in the prologue — correctly does not.
 */
export interface VRCreaturePromptState {
  /** The prompt never targets the actor driving it. */
  readonly isSelf: boolean;
  readonly isDead: boolean;
  readonly isHostile: boolean;
  readonly hasConversation: boolean;
  readonly isUseable: boolean;
  /** Whether the creature carries anything to take; only read for corpses. */
  readonly hasLoot: boolean;
  /**
   * The actor driving the prompt is in combat. Locked by Allen (2026-10-13):
   * in a fight no creature offers Talk or Use, so no companion, Remote or
   * corpse prompt (or its name plate) floats in the line of fire; "Talk:
   * Remote" and "Talk: Bao-Dur" sat centre-view in a 4-trooper firefight
   * (Anchor, round 17, finding 3). Hostiles never had a prompt.
   */
  readonly actorInCombat?: boolean;
}

export function hasCreatureWorldPromptAction(state: VRCreaturePromptState): boolean {
  if (!state || state.isSelf || state.actorInCombat === true) return false;
  if (state.isDead) return state.isUseable === true && state.hasLoot === true;
  if (state.isHostile) return false;
  return state.hasConversation === true;
}

/**
 * Reads the prompt state off a live engine creature.
 *
 * Every accessor is optional and individually guarded: this runs for every
 * selectable object every frame, and a creature mid-destruction must degrade to
 * "no prompt" rather than throw and suppress the whole candidate list.
 */
export function readVRCreaturePromptState(
  actor: unknown,
  target: {
    isDead?: () => unknown;
    isHostile?: (actor: unknown) => unknown;
    isUseable?: () => unknown;
    getConversation?: () => { resref?: unknown } | null | undefined;
    hasInventory?: () => unknown;
  },
  /**
   * Whether the fight is on, when the caller knows better than the actor's
   * own flag (Part F, decision 1 of 2026-10-13): the flag drops between the
   * player's rounds while hostiles fight the companions, and plates came back
   * mid-firefight in 28 of 30 samples (Anchor, run 2, finding 1).
   */
  fightOn?: boolean,
): VRCreaturePromptState {
  return {
    isSelf: target === actor,
    isDead: safeFlag(() => target.isDead?.()),
    isHostile: safeFlag(() => target.isHostile?.(actor)),
    isUseable: safeFlag(() => target.isUseable?.()),
    hasConversation: safeFlag(() => {
      const conversation = target.getConversation?.();
      const resref = conversation?.resref;
      return typeof resref === 'string' && resref.length > 0;
    }),
    hasLoot: safeFlag(() => {
      // ModuleCreature.hasInventory returns the item count, not a boolean.
      const held = target.hasInventory?.();
      return typeof held === 'number' ? held > 0 : held === true;
    }),
    actorInCombat: typeof fightOn === 'boolean'
      ? fightOn
      : safeFlag(() => (actor as { combatData?: { combatState?: unknown } } | null)?.combatData?.combatState),
  };
}

/**
 * The prompt entry a qualifying creature offers, or null for one that does not.
 *
 * Deliberately separate from the door/placeable direct-use route. That route is
 * wrapped in `classifySafeDirectVRWorldUse`, whose rules exist to stop a generic
 * `use()` from stealing ownership from locks, key requirements and story state
 * on containers — none of which describe talking to an NPC. Reusing it would
 * mean widening container safety semantics to cover creatures; this instead
 * defers to `onClick`, which is the same routing flatscreen uses.
 */
export function describeVRCreaturePromptAction(
  state: VRCreaturePromptState,
  targetId: number,
  name: string,
): { readonly id: string; readonly label: string } | null {
  if (!hasCreatureWorldPromptAction(state)) return null;
  const displayName = typeof name === 'string' && name.trim().length ? name.trim() : 'Creature';
  return {
    id: `creature-use:${targetId}`,
    // A corpse routes to actionUseObject — it is being searched, not spoken to.
    label: state.isDead ? `Use: ${displayName}` : `Talk: ${displayName}`,
  };
}

/**
 * Whether the world target name plate must stay hidden for `target`.
 *
 * Locked by Allen (2026-10-13): while the actor is in combat only hostile
 * creatures carry a plate. The prompt route already drops non-hostile
 * candidates in combat (`actorInCombat`); this covers the engine-cursor
 * fallback, which names whatever was last hovered or selected.
 */
export function isVRCombatNamePlateHidden(
  actor: unknown,
  target: { isHostile?: (actor: unknown) => unknown } | null | undefined,
  targetIsCreature: boolean,
  /** The fight is on, by the caller's own test; see readVRCreaturePromptState. */
  fightOn?: boolean,
): boolean {
  if (!target || !targetIsCreature || (target as unknown) === actor) return false;
  const inCombat = typeof fightOn === 'boolean'
    ? fightOn
    : safeFlag(() => (actor as { combatData?: { combatState?: unknown } } | null)?.combatData?.combatState);
  if (!inCombat) return false;
  return !safeFlag(() => target.isHostile?.(actor));
}

function safeFlag(read: () => unknown): boolean {
  try {
    return read() === true;
  } catch {
    return false;
  }
}
