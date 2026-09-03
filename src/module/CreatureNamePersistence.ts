/**
 * Chooses what a creature's `FirstName` / `LastName` should serialize to.
 *
 * `ModuleCreature.save()` wrote both names straight back out of
 * `this.template`, while every other field in the same method serialized live
 * state (`this.forcePoints`, `this.gender`, `this.int`, ...). Any runtime change
 * to a name was therefore discarded the moment the creature was saved.
 *
 * The visible casualty was the player's own name. Character generation writes
 * the typed name to `CharGenManager.selectedCreature.firstName`, but
 * `CharGenManager` had already stamped a randomly generated name into the
 * template's `FirstName` field. `PartyManager.SwitchPlayerCharacter` then does
 * `ActualPlayerTemplate = Player.save()` and persists it to `pc.utc`, so the
 * random name replaced the chosen one permanently.
 *
 * That template is what every `<FullName>` / `<FirstName>` token resolves
 * against, so the Peragus medbay dummy — whose name field is literally
 * `{Dummy Medbay PC}<FullName>` — displayed a random name instead of the
 * player's. Reported from a headset session.
 *
 * **Why not simply always write the live string.** A `CExoLocString` carries
 * either a TLK string reference or literal substrings. Nearly every creature in
 * the game is TLK-backed, and writing the resolved string as a substring would
 * discard the reference and hard-code one language into the save. So the
 * template's `CExoLocString` is preserved whenever the live name still agrees
 * with it, and the live string is written only where the two have actually
 * diverged — which is exactly the player-edited case.
 */
export interface CreatureNameTemplateField<TLocString> {
  getValue(): unknown;
  getCExoLocString(): TLocString;
}

export function resolveSavedCreatureName<TLocString>(
  liveName: unknown,
  templateField: CreatureNameTemplateField<TLocString> | null | undefined,
): string | TLocString | undefined {
  const templateValue = readTemplateValue(templateField);

  // No template field to fall back on: the live name is all there is.
  if (!templateField) {
    return typeof liveName === 'string' ? liveName : undefined;
  }

  // Unchanged (or never populated) — keep the localised original.
  if (typeof liveName !== 'string' || liveName === templateValue) {
    return safely(() => templateField.getCExoLocString());
  }

  return liveName;
}

function readTemplateValue<TLocString>(
  templateField: CreatureNameTemplateField<TLocString> | null | undefined,
): unknown {
  if (!templateField || typeof templateField.getValue !== 'function') return undefined;
  return safely(() => templateField.getValue());
}

/**
 * A malformed template field must not make saving the creature throw: losing a
 * name is recoverable, losing the save is not.
 */
function safely<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}
