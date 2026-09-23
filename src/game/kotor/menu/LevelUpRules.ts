/**
 * Level-up rules, as plain data in and plain data out.
 *
 * The engine had no manual level-up at all: `MenuLevelUp` was an empty shell
 * and `ModuleCreature.autoLevelUp` raised the class level, one attribute and
 * hit points, and nothing else — no skill points, no feat picks, no Force
 * powers, no Force points. These functions state what one level is worth,
 * read from the same retail tables the flat game uses, so the level-up screens
 * and any future quick route share one answer. Nothing here imports engine
 * state, which keeps the rules testable without the GUI module chain.
 */

export type LevelUpAbility = 'str' | 'dex' | 'con' | 'wis' | 'int' | 'cha';

export const LEVEL_UP_ABILITIES: ReadonlyArray<LevelUpAbility> = ['str', 'dex', 'con', 'wis', 'int', 'cha'];

/**
 * `spells.2da` carries one minimum-level column per Force-using class. The
 * column names are the table's own; `classes.2da` row ids are the keys. Classes
 * with no column (soldier, scout, droids, ...) learn no powers by level.
 */
export const LEVEL_UP_POWER_CLASS_COLUMNS: Readonly<Record<number, string>> = {
  3: 'guardian',
  4: 'consular',
  5: 'sentinel',
  11: 'weapmstr',
  12: 'jedimaster',
  13: 'watchman',
  14: 'marauder',
  15: 'sithlord',
  16: 'assassin',
};

/** The subset of `CreatureClass` the rules read. */
export interface LevelUpClassRules {
  readonly id: number;
  readonly hitdie: number;
  readonly forcedie: number;
  readonly skillpointbase: number;
  readonly spellcaster: boolean;
  readonly primaryabil: string;
  readonly featGainPoints: ReadonlyArray<number>;
  readonly spellGainPoints: ReadonlyArray<number>;
}

export interface LevelUpAllowances {
  /** One point at every fourth character level. */
  readonly attributePoints: number;
  /** Feat picks from `featgain.2da` for the new class level. */
  readonly featPicks: number;
  /** Force power picks from `classpowergain.2da` for the new class level. */
  readonly powerPicks: number;
}

export interface LevelUpAllowanceInput {
  readonly characterClass: LevelUpClassRules;
  readonly newClassLevel: number;
  readonly newCharacterLevel: number;
}

export interface LevelUpVitalityGain {
  readonly hitPoints: number;
  readonly forcePoints: number;
}

export function abilityModifier(score: number): number {
  return Math.floor((Number(score) - 10) / 2);
}

function countAt(values: ReadonlyArray<number> | undefined, level: number): number {
  if (!Array.isArray(values) || !Number.isInteger(level) || level < 1) return 0;
  const value = Number(values[level - 1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function resolveLevelUpAllowances(input: LevelUpAllowanceInput): LevelUpAllowances {
  const { characterClass, newClassLevel, newCharacterLevel } = input;
  return {
    attributePoints: Number.isInteger(newCharacterLevel) && newCharacterLevel > 0 && newCharacterLevel % 4 === 0 ? 1 : 0,
    featPicks: countAt(characterClass?.featGainPoints, newClassLevel),
    powerPicks: characterClass?.spellcaster ? countAt(characterClass.spellGainPoints, newClassLevel) : 0,
  };
}

/**
 * Skill points for one level: the class base plus the Intelligence modifier,
 * never fewer than one. Read at the moment the Skills step opens, so a point
 * put into Intelligence on the Attributes step already counts — which is why
 * the steps run in order.
 */
export function resolveLevelUpSkillPoints(skillpointbase: number, intelligence: number): number {
  const base = Number.isFinite(Number(skillpointbase)) ? Number(skillpointbase) : 0;
  return Math.max(1, base + abilityModifier(intelligence));
}

/**
 * Vitality and Force points gained on Accept, from the final attributes.
 *
 * TSL's own attribute text says Constitution "adds modifiers to the vitality
 * points gained at each level-up" and Wisdom "adds modifiers to Jedi Force
 * Points" (dialog.tlk 224 and 225), so the class die plus that modifier, as
 * `autoLevelUp` already did for vitality. Retail grants the full die.
 */
export function resolveLevelUpVitalityGain(
  characterClass: Pick<LevelUpClassRules, 'hitdie' | 'forcedie' | 'spellcaster'>,
  constitution: number,
  wisdom: number,
): LevelUpVitalityGain {
  const hitdie = Number(characterClass?.hitdie) || 0;
  const forcedie = Number(characterClass?.forcedie) || 0;
  return {
    hitPoints: Math.max(1, hitdie + abilityModifier(constitution)),
    forcePoints: characterClass?.spellcaster && forcedie > 0
      ? Math.max(1, forcedie + abilityModifier(wisdom))
      : 0,
  };
}

/** A `spells.2da` cell as an integer, or undefined for a blank or `****`. */
function readInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (text === '' || text === '****') return undefined;
  const number = Number(text);
  return Number.isInteger(number) ? number : undefined;
}

export function parsePowerPrerequisites(value: unknown): number[] {
  if (value === undefined || value === null) return [];
  const text = String(value).trim();
  if (text === '' || text === '****') return [];
  return text.split('_').map((part) => Number(part)).filter((id) => Number.isInteger(id) && id >= 0);
}

/**
 * The character level at which a class may learn a power, or undefined when
 * the class never learns it by level. `0` in the table means "from the start".
 * `-1` marks powers only scripts grant (Force Sight, Crush Opposition, ...).
 */
export function readPowerMinimumLevel(row: Record<string, unknown> | undefined, classColumn: string | undefined): number | undefined {
  if (!row || !classColumn) return undefined;
  const level = readInteger(row[classColumn]);
  if (level === undefined || level < 0) return undefined;
  return Math.max(1, level);
}

export type LevelUpPowerState = 'known' | 'selectable' | 'unavailable';

export interface LevelUpPowerEntry {
  readonly id: number;
  readonly row: Record<string, unknown>;
  readonly state: LevelUpPowerState;
  readonly minimumLevel: number | undefined;
  readonly prerequisites: number[];
  readonly priority: number;
}

import { isForcePowerAlignmentAllowed } from "@/talents/forcePowerCostRules";

export interface LevelUpPowerListInput {
  readonly rows: ReadonlyArray<Record<string, unknown> | undefined>;
  readonly classColumn: string | undefined;
  readonly characterLevel: number;
  readonly isKnown: (id: number) => boolean;
  readonly alignment?: number;
  readonly gender?: number;
}

function isForcePowerRow(row: Record<string, unknown>): boolean {
  if (readInteger(row.usertype) !== 1) return false;
  const label = String(row.label ?? '');
  // Cut rows keep their slot with an XXX prefix and no name.
  return !label.startsWith('XXX');
}

function rowId(row: Record<string, unknown>, index: number): number {
  const id = readInteger(row.__index) ?? readInteger(row.__rowlabel);
  return id ?? index;
}

/**
 * Every power the screen should show: those the character knows and those the
 * class can learn by level at all. A learnable power is selectable once the
 * character is high enough and knows every prerequisite (`47_12` means both).
 */
export function listLevelUpPowers(input: LevelUpPowerListInput): LevelUpPowerEntry[] {
  const entries: LevelUpPowerEntry[] = [];
  const rows = Array.isArray(input?.rows) ? input.rows : [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!row || !isForcePowerRow(row)) continue;
    const id = rowId(row, index);
    const known = input.isKnown(id);
    const minimumLevel = readPowerMinimumLevel(row, input.classColumn);
    if (!known && minimumLevel === undefined) continue;
    const prerequisites = parsePowerPrerequisites(row.prerequisites);
    const alignmentAllowed = isForcePowerAlignmentAllowed(id, input.alignment);
    const genderAllowed = (id !== 179) || (input.gender === undefined || input.gender === 0);
    let state: LevelUpPowerState;
    if (known) {
      state = 'known';
    } else if (minimumLevel !== undefined && minimumLevel <= input.characterLevel
      && prerequisites.every((prerequisite) => input.isKnown(prerequisite))
      && alignmentAllowed && genderAllowed) {
      state = 'selectable';
    } else {
      state = 'unavailable';
    }
    entries.push({ id, row, state, minimumLevel, prerequisites, priority: readInteger(row.forcepriority) ?? 0 });
  }
  return entries;
}

/**
 * Arranges powers into the three-slot rows the feat grid draws: a base power,
 * its improved form, its master form. A power whose chain root is not in the
 * list still gets a row of its own, so nothing learnable is dropped.
 */
export function groupLevelUpPowerChains(entries: ReadonlyArray<LevelUpPowerEntry>): LevelUpPowerEntry[][] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const placed = new Set<number>();
  const groups: LevelUpPowerEntry[][] = [];

  const roots = entries.filter((entry) => entry.prerequisites.length === 0 || !byId.has(entry.prerequisites[0]));
  for (const root of roots) {
    if (placed.has(root.id)) continue;
    const group: LevelUpPowerEntry[] = [root];
    placed.add(root.id);
    const middle = entries.find((entry) => !placed.has(entry.id)
      && entry.prerequisites.length === 1 && entry.prerequisites[0] === root.id);
    if (middle) {
      group[1] = middle;
      placed.add(middle.id);
    }
    const end = entries.find((entry) => !placed.has(entry.id)
      && entry.prerequisites.length >= 2 && entry.prerequisites.includes(root.id)
      && (!middle || entry.prerequisites.includes(middle.id)));
    if (end) {
      group[2] = end;
      placed.add(end.id);
    }
    groups.push(group);
  }
  for (const entry of entries) {
    if (!placed.has(entry.id)) {
      groups.push([entry]);
      placed.add(entry.id);
    }
  }
  return groups;
}

/**
 * Recommended picks: the table's own ordering for the character's side of the
 * Force (`light_recom` / `dark_recom`, lower first), then table order.
 */
export function recommendLevelUpPowers(
  entries: ReadonlyArray<LevelUpPowerEntry>,
  picks: number,
  lightSide: boolean,
): number[] {
  if (!Number.isInteger(picks) || picks <= 0) return [];
  const column = lightSide ? 'light_recom' : 'dark_recom';
  const rank = (entry: LevelUpPowerEntry) => readInteger(entry.row[column]) ?? Number.POSITIVE_INFINITY;
  return entries
    .filter((entry) => entry.state === 'selectable')
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => (rank(a.entry) - rank(b.entry)) || (a.order - b.order))
    .slice(0, picks)
    .map(({ entry }) => entry.id);
}
