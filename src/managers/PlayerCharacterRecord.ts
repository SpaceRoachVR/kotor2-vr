/**
 * Which record of the Exile a save writes as pc.utc, and which one a load
 * restores her from.
 *
 * `ActualPlayerTemplate` used to be refreshed only at character creation and
 * when control switched to a companion, and every save exported it as pc.utc.
 * So pc.utc held the Exile as she was at character creation: every save this
 * engine wrote put her at (54.65, 79.62, 1.8), the 001EBO prologue start, with
 * her chargen-era stats. Loads then trusted pc.utc - to rebuild her after a
 * companion switch, and, with no PIFO, to place her - and dropped her off the
 * walkmesh with stale stats.
 */

export interface PartyCharacter<T> {
  readonly isPlayer?: boolean;
  save(): T;
}

/**
 * The live Exile: the controlled character if that is her, otherwise the
 * party follower she became when control moved to a companion. Undefined when
 * she is not in the world (a scripted possession that removes her), in which
 * case the existing record is the best there is.
 */
export function findLivePlayerCharacter<C extends { isPlayer?: boolean }>(
  controlled: C | undefined | null,
  party: readonly (C | undefined | null)[],
): C | undefined {
  if (controlled && controlled.isPlayer) return controlled;
  return party.find((member) => !!member && !!member.isPlayer) || undefined;
}

/** The Exile's current state, or the previous record when she is not in the world. */
export function refreshPlayerCharacterRecord<T, C extends PartyCharacter<T>>(
  previous: T | undefined,
  controlled: C | undefined | null,
  party: readonly (C | undefined | null)[],
  onError: (error: unknown) => void = () => {},
): T | undefined {
  const live = findLivePlayerCharacter(controlled, party);
  if (!live) return previous;
  try {
    return live.save() ?? previous;
  } catch (error) {
    onError(error);
    return previous;
  }
}

/**
 * The record to rebuild the Exile from after loading a save. The module's
 * saved controlled character is current; pc.utc may be stale (see above), so
 * it only stands in when someone else was being controlled.
 */
export function chooseLoadedPlayerCharacterRecord<T>(
  savedControlled: T | undefined,
  savedControlledIsPC: boolean,
  pcUtc: T | undefined,
): T | undefined {
  if (savedControlled && savedControlledIsPC) return savedControlled;
  return pcUtc || savedControlled;
}

/**
 * Whether the module's saved controlled character is the Exile. `IsPC` is not
 * reliable - this engine writes it from `playerCreated`, which is never set, so
 * its saves always say 0 - so a character whose tag is not a companion's is
 * the Exile, the same rule the area loader uses to rebuild the controlled
 * character.
 */
export function isSavedControlledPlayerCharacter(
  isPCFlag: unknown,
  savedTag: string | null | undefined,
  companionTags: readonly (string | null | undefined)[],
): boolean {
  if (Number(isPCFlag) === 1) return true;
  const tag = String(savedTag || '').trim().toLowerCase();
  if (!tag) return true;
  return !companionTags.some((companionTag) => String(companionTag || '').trim().toLowerCase() === tag);
}
