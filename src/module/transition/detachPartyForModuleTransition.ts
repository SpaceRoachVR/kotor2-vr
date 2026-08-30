/**
 * The controlled player is re-used by the destination ModuleArea. Detach its
 * outgoing model without destroying gameplay state; destroy every other
 * departing party member as normal.
 */
export interface ModuleTransitionPartyMember {
  readonly container: {
    removeFromParent(): void;
  };
  destroy(): void;
}

export function detachPartyForModuleTransition<T extends ModuleTransitionPartyMember>(
  party: T[],
  player: T | undefined,
): void {
  if (!Array.isArray(party)) {
    throw new TypeError('Module transition party must be an array');
  }

  while (party.length > 0) {
    const partyMember = party.shift();
    if (!partyMember) continue;

    if (partyMember === player) {
      partyMember.container.removeFromParent();
      continue;
    }

    partyMember.destroy();
  }
}
