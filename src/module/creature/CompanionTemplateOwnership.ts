interface CompanionInstance { npcId?: number }

/** Cinematic world copies must not replace the live companion's saved progression. */
export function shouldUpdateCompanionTemplate<T extends CompanionInstance>(
  creature: T,
  party: readonly T[],
  controlledPlayer?: T,
): boolean {
  if (!Number.isInteger(creature.npcId) || creature.npcId < 0) return false;
  const owner = controlledPlayer?.npcId === creature.npcId
    ? controlledPlayer : party.find(member => member?.npcId === creature.npcId);
  // A removed companion can remain in the world; preserve that instance when no live party member owns the slot.
  return !owner || owner === creature;
}
