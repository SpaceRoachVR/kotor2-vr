/** Preserve a possessed companion's roster slot across module transitions. */
export function getTransitionPlayerNpcId(isPlayer: boolean, npcId: number | undefined): number {
  if (typeof isPlayer !== 'boolean') throw new TypeError('player identity must be boolean');
  if (npcId !== undefined && (!Number.isInteger(npcId) || npcId < -1)) {
    throw new RangeError('controlled NPC identity must be -1 or a nonnegative integer');
  }
  return isPlayer ? -1 : npcId ?? -1;
}

export interface SavedCompanionIdentity {
  readonly npcId: number;
  readonly available: boolean;
  readonly tag: string;
}

/** Identify a saved possessed body from the party roster and its authored tag. */
export function resolveSavedControlledNpcId(savedTag: string, roster: readonly SavedCompanionIdentity[]): number {
  if (typeof savedTag !== 'string' || !Array.isArray(roster) || roster.some(entry => !entry ||
      !Number.isInteger(entry.npcId) || entry.npcId < 0 || typeof entry.available !== 'boolean' || typeof entry.tag !== 'string')) {
    throw new TypeError('saved controlled identity requires a tag and valid companion roster');
  }
  const tag = savedTag.trim().toLowerCase();
  if (!tag) return -1;
  const matches = roster.filter(entry => entry.available && entry.tag.trim().toLowerCase() === tag);
  if (matches.length > 1) throw new Error('saved controlled identity matches multiple available companions');
  return matches.length === 1 ? matches[0].npcId : -1;
}
