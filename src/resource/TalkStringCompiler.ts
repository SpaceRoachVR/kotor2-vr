/**
 * Turns a raw TLK string into the text the player should actually see.
 *
 * Odyssey strings carry three things the engine is expected to resolve:
 *
 * - a `##` suffix, which is authoring metadata and never displayed;
 * - `{...}` designer comments, e.g. the retail string 125641 is literally
 *   `{Dummy Medbay PC}<FullName>` and `001EBO`'s objects carry
 *   `Body{Invis container}`, `Footlocker{Spikes}`, `Blast Door{HK-50}`;
 * - substitution tokens — `<FullName>`, `<FirstName>`, `<LastName>` and
 *   `<CUSTOM##>`, the last set by the NWScript `SetCustomToken`.
 *
 * `DLGNode` and `GameMenu` each grew their own copy of this for dialogue and
 * menu text. Object *names* went through neither, which is why a name tag read
 * `{Dummy Medbay PC}<FullName>` in the headset and every world object logged
 * with its designer comment attached.
 *
 * Pure by design: callers inject the lookups so this stays testable without
 * GameState, PartyManager or the module.
 */
export interface TalkStringTokens {
  /** Player first name, for `<FullName>` and `<FirstName>`. */
  readonly firstName?: string;
  /** Player last name, for `<LastName>`. */
  readonly lastName?: string;
  /** Resolves `<CUSTOM##>`; return undefined when the token was never set. */
  readonly custom?: (index: number) => string | undefined;
  /** Extra literal replacements, e.g. the keymap tokens menus substitute. */
  readonly extra?: ReadonlyArray<readonly [RegExp, string]>;
}

/** Strips authoring metadata: the `##` suffix and `{...}` designer comments. */
export function stripAuthoringMetadata(text: string): string {
  return text.split('##')[0].replace(/\{.*?\}/gi, '').trim();
}

/**
 * An unresolved token is left in place rather than blanked.
 *
 * Substituting an empty string would turn a missing player name into a nameless
 * object, which reads as a rendering fault rather than a data one. Leaving
 * `<FullName>` visible keeps it diagnosable — and it is how the defect that
 * prompted this was noticed in the first place.
 */
export function compileTalkString(text: unknown, tokens: TalkStringTokens = {}): string {
  if (typeof text !== 'string' || !text.length) return '';

  let out = stripAuthoringMetadata(text);

  const substitute = (pattern: RegExp, value: string | undefined) => {
    if (typeof value !== 'string' || !value.length) return;
    out = out.replace(pattern, value);
  };

  substitute(/<FullName>/gm, tokens.firstName);
  substitute(/<FirstName>/gm, tokens.firstName);
  substitute(/<LastName>/gm, tokens.lastName);

  if (typeof tokens.custom === 'function') {
    out = out.replace(/<CUSTOM(\d+)>/gm, (match, digits) => {
      const value = tokens.custom!(parseInt(digits, 10));
      return typeof value === 'string' && value.length ? value : match;
    });
  }

  for (const [pattern, value] of tokens.extra ?? []) {
    if (typeof value === 'string') out = out.replace(pattern, value);
  }

  return out;
}
