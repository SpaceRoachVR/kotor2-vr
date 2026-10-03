/**
 * TSL's regeneration rules, from its key/value `regeneration.2da`:
 *
 *   timeperhp 6, outofcombathpbase 1, incombathpbase 0, conmodbonus 0.3,
 *   skillrankbonus 0.1, fpregentime 90, outofcombatfpbase 1.0,
 *   incombatfpbase 0.1, wismodbonus 0, roomforcebonus 0.075
 *
 * K1's table has `forceregen` / `healthregen` columns per combat state; the
 * engine read those from TSL's table, got NaN, and nothing ever regenerated
 * (critic run 12: FP 0/15 for eight minutes; round 15: HP 18 for twenty).
 *
 * Read as: every `timeperhp` seconds a creature regains the base for its
 * combat state plus `conmodbonus` per point of Constitution modifier and
 * `skillrankbonus` per rank of Treat Injury. Force points refill at the base
 * fraction of the pool (plus `wismodbonus` per Wisdom modifier point) per
 * `fpregentime` seconds: a full pool in 90 s out of combat, a tenth of it in
 * combat. `roomforcebonus` (a per-room bonus) is not modelled.
 */
export interface TSLRegenerationTable {
  readonly timeperhp: number;
  readonly outofcombathpbase: number;
  readonly incombathpbase: number;
  readonly conmodbonus: number;
  readonly skillrankbonus: number;
  readonly fpregentime: number;
  readonly outofcombatfpbase: number;
  readonly incombatfpbase: number;
  readonly wismodbonus: number;
}

const KEYS: readonly (keyof TSLRegenerationTable)[] = [
  'timeperhp', 'outofcombathpbase', 'incombathpbase', 'conmodbonus', 'skillrankbonus',
  'fpregentime', 'outofcombatfpbase', 'incombatfpbase', 'wismodbonus',
];

/** The TSL table from 2DA rows labelled by key, or null if this is K1's layout. */
export function readTSLRegenerationTable(rows: Readonly<Record<string, any>> | readonly any[] | null | undefined): TSLRegenerationTable | null {
  if (!rows) return null;
  const list: any[] = Array.isArray(rows) ? rows as any[] : Object.values(rows);
  const byLabel = new Map<string, number>();
  for (const row of list) {
    const label = String(row?.__rowlabel ?? row?.label ?? '').trim().toLowerCase();
    const value = Number.parseFloat(String(row?.value ?? ''));
    if (label && Number.isFinite(value)) byLabel.set(label, value);
  }
  if (!byLabel.has('timeperhp') || !byLabel.has('fpregentime')) return null;
  const table: any = {};
  for (const key of KEYS) table[key] = byLabel.get(key) ?? 0;
  return table as TSLRegenerationTable;
}

export interface TSLRegenerationInput {
  readonly inCombat: boolean;
  readonly constitutionModifier: number;
  readonly wisdomModifier: number;
  readonly treatInjuryRank: number;
  readonly maxForcePoints: number;
}

/** Hit points regained per `timeperhp` tick (never negative). */
export function tslHitPointsPerTick(table: TSLRegenerationTable, input: TSLRegenerationInput): number {
  const base = input.inCombat ? table.incombathpbase : table.outofcombathpbase;
  return Math.max(0, base + table.conmodbonus * input.constitutionModifier + table.skillrankbonus * input.treatInjuryRank);
}

/** Force points regained per second (never negative). */
export function tslForcePointsPerSecond(table: TSLRegenerationTable, input: TSLRegenerationInput): number {
  if (!(table.fpregentime > 0) || !(input.maxForcePoints > 0)) return 0;
  const base = input.inCombat ? table.incombatfpbase : table.outofcombatfpbase;
  const fraction = Math.max(0, base + table.wismodbonus * input.wisdomModifier);
  return input.maxForcePoints * fraction / table.fpregentime;
}
