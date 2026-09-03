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
 * - **A dead creature is a container.** `onClick` routes to `actionUseObject`,
 *   so the prompt is offered whenever the corpse is useable — this is the
 *   loot route, and it is the one case where hostility does not disqualify.
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
}

export function hasCreatureWorldPromptAction(state: VRCreaturePromptState): boolean {
  if (!state || state.isSelf) return false;
  if (state.isDead) return state.isUseable === true;
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
  },
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

function safeFlag(read: () => unknown): boolean {
  try {
    return read() === true;
  } catch {
    return false;
  }
}
