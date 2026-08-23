/**
 * Per-class column lookup for `feat.2da`.
 *
 * Each feat row carries one column per class — `scdGranted`, `solRecom`,
 * `jcnList` and so on — selected by the class code in `classes.2da`'s
 * `skillstable` column.
 *
 * This used to be three copies of a fourteen-case `switch` inside `TalentFeat`
 * that compared `skillstable` against **lowercase** literals. The 2DA stores it
 * uppercase ("SCD"), so every call fell through to `default: -1`. Nothing threw
 * and nothing logged; the visible symptom was Quick Character granting a
 * level-1 character zero feats, which reads as missing content rather than a
 * string-case bug. Every other reader of `skillstable` in the codebase
 * lowercases it first — see `CharGenManager.getSkillsTable`.
 *
 * Deliberately free of engine imports so it can be tested without pulling in
 * the world.
 */

export type FeatClassColumnSuffix = 'Granted' | 'Recom' | 'List';

/**
 * An explicit allowlist rather than an open property read: an unexpected
 * `skillstable` value must not be able to reach an unrelated property such as
 * `constructor` or `toString`.
 */
export const FEAT_CLASS_COLUMN_CODES: readonly string[] = [
  'scd', 'sol', 'sct', 'jcn', 'jgd', 'jsn', 'sas',
  'sld', 'sma', 'jwa', 'jma', 'jwm', 'tec', 'drx', 'drc',
];

/** The established "no such column" value these lookups return. */
export const FEAT_CLASS_COLUMN_ABSENT = -1;

export function normalizeFeatClassCode(skillsTable: unknown): string | null {
  const code = String(skillsTable ?? '').trim().toLowerCase();
  return FEAT_CLASS_COLUMN_CODES.includes(code) ? code : null;
}

export function readFeatClassColumn(
  row: unknown,
  skillsTable: unknown,
  suffix: FeatClassColumnSuffix,
): number {
  if (!row || typeof row !== 'object') return FEAT_CLASS_COLUMN_ABSENT;
  const code = normalizeFeatClassCode(skillsTable);
  if (!code) return FEAT_CLASS_COLUMN_ABSENT;

  const value = (row as Record<string, unknown>)[`${code}${suffix}`];
  if (value === undefined || value === null) return FEAT_CLASS_COLUMN_ABSENT;

  const numeric = Number(value);
  // A non-numeric column must not become NaN: callers compare against 1, and
  // NaN would silently fail every comparison the same way the old default did.
  return Number.isFinite(numeric) ? numeric : FEAT_CLASS_COLUMN_ABSENT;
}
