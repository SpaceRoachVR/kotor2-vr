/**
 * What the wheel's Party submenu offers, and what picking an entry does.
 *
 * The submenu used to call `SwitchLeaderAtIndex`, which only reorders the
 * follow order: the possessed body stayed `PartyManager.Player`, and every
 * conversation start calls `MakePlayerLeader`, so a skill-gated console
 * (106PER's Hangar Control: Repair, then Computer Use) always tested the
 * Exile's skills whoever "led". Retail's leader switch is possession, which
 * this engine does through `SwitchPlayerCharacter(npcId)`; -1 is the Exile.
 *
 * While a companion is possessed the Exile is not in the world (the engine
 * keeps one player object), so she is offered as an entry of her own, by the
 * name recorded when she was last possessed, or switching back would be
 * impossible from the wheel.
 */
export interface PartySwitchCandidate {
  readonly id: string;
  readonly name: string;
  readonly npcId: number;
  readonly isPlayer: boolean;
  readonly portrait?: string;
}

export interface PartySwitchEntry {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  /** The SwitchPlayerCharacter argument: an NPC slot, or -1 for the Exile. */
  readonly npcId: number;
}

/** The entry id the Exile is offered under while a companion is possessed. */
export const PLAYER_SWITCH_ENTRY_ID = 'player';

export function buildPartySwitchEntries(
  party: readonly PartySwitchCandidate[],
  playerName: string,
  playerPortrait?: string,
): PartySwitchEntry[] {
  if (!Array.isArray(party) || party.length === 0) return [];
  const leader = party[0];
  const entries: PartySwitchEntry[] = [];
  for (const member of party.slice(1)) {
    if (!member || !Number.isInteger(member.npcId) || member.npcId < 0) continue;
    entries.push({
      id: member.id,
      label: member.name,
      ...(member.portrait ? { icon: member.portrait } : {}),
      npcId: member.npcId,
    });
  }
  if (leader && !leader.isPlayer && typeof playerName === 'string' && playerName.trim().length > 0) {
    entries.push({
      id: PLAYER_SWITCH_ENTRY_ID,
      label: playerName.trim(),
      ...(playerPortrait ? { icon: playerPortrait } : {}),
      npcId: -1,
    });
  }
  return entries;
}
