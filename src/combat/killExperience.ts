/**
 * Kill experience, from `xptable.2da`.
 *
 * The table is indexed by the **killer's level** down the rows and the
 * **victim's challenge rating** across the columns — row 0 is level 1, and its
 * column "1" holds 125, which is what a level-1 character earns for a CR-1 kill.
 *
 * The engine loaded this table and used it nowhere: `ModuleCreature`
 * read `ChallengeRating` from the template and wrote it back out on save, but
 * nothing ever consulted it, and `addXP`/`GiveXP` were only ever reached from
 * NWScript's `GiveXPToCreature` and the cheat console. So combat awarded no
 * experience at all and a character could never level from fighting. Found by
 * killing a mining droid on Peragus and watching XP stay at 0.
 *
 * Deliberately free of engine imports so it can be tested without pulling in
 * the world, the same reason `featClassColumns.ts` exists.
 */

/** A 2DA's rows as the engine exposes them: an object keyed by row index. */
export type TwoDARows = Readonly<Record<string, Record<string, unknown>>> | undefined | null;

export const NO_KILL_EXPERIENCE = 0;

/**
 * Looks up the experience a kill is worth.
 *
 * Returns 0 rather than throwing for anything it cannot resolve: a missing
 * table, an off-the-end level, an absent column. A kill awarding nothing is a
 * balance problem; a kill throwing would abort the death handler and leave the
 * corpse mid-animation.
 */
export function resolveKillExperience(
  rows: TwoDARows,
  killerLevel: unknown,
  challengeRating: unknown,
): number {
  if (!rows || typeof rows !== 'object') return NO_KILL_EXPERIENCE;

  const level = Math.trunc(Number(killerLevel));
  if (!Number.isFinite(level) || level < 1) return NO_KILL_EXPERIENCE;

  // Challenge ratings are authored as floats (2.5 is a real value). The table
  // has integer columns, so floor rather than round — rounding up would pay out
  // a tier the creature does not belong to.
  const rating = Math.floor(Number(challengeRating));
  if (!Number.isFinite(rating) || rating < 0) return NO_KILL_EXPERIENCE;

  // Row 0 is level 1.
  const row = rows[String(level - 1)];
  if (!row || typeof row !== 'object') return NO_KILL_EXPERIENCE;

  const cell = (row as Record<string, unknown>)[String(rating)];
  if (cell === undefined || cell === null) return NO_KILL_EXPERIENCE;

  // 2DA cells are strings, and "****" is the table's own "no value".
  const value = Number(String(cell).trim());
  if (!Number.isFinite(value) || value <= 0) return NO_KILL_EXPERIENCE;

  return Math.trunc(value);
}
