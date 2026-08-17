/**
 * Retail module data carries designer annotations inside object names — e.g.
 * `Blast Door{Impossible}`, `Body{Invis container}`. They are authoring notes
 * about lock difficulty and helper objects, never meant to reach a player, but
 * `getName()` returns them verbatim and VR renders that straight onto a
 * world-space label an arm's length from the player's face.
 *
 * Strips the annotations for display while leaving the rest of the name (and
 * any engine-appended suffix like ` (Empty)`) intact. Diagnostics should keep
 * using the raw name — the annotations are genuinely useful there.
 */
export function resolveDisplayName(rawName: string | null | undefined): string {
  if (typeof rawName !== 'string') return '';
  return rawName
    .replace(/\{[^}]*\}/g, '')
    // Collapse the double space left behind when an annotation sat between
    // two words, without disturbing intentional spacing elsewhere.
    .replace(/\s{2,}/g, ' ')
    .trim();
}
