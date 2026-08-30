export type CharGenProgressionValidationReason =
  | 'invalid-abilities'
  | 'invalid-skill-ranks'
  | 'invalid-feats'
  | 'invalid-classes'
  | 'invalid-known-powers'
  | 'invalid-force-state'
  | 'invalid-pregame-force-state';

export interface CharGenProgressionSnapshot {
  readonly abilities: {
    readonly str: number;
    readonly dex: number;
    readonly con: number;
    readonly wis: number;
    readonly int: number;
    readonly cha: number;
  };
  readonly skillRanks: number[];
  readonly featIds: number[];
  readonly classKnownPowerIds: number[][];
  readonly forcePoints: number;
  readonly maxForcePoints: number;
  readonly currentForce: number;
}

export type CharGenProgressionValidation =
  | { readonly valid: true; readonly snapshot: CharGenProgressionSnapshot }
  | { readonly valid: false; readonly reason: CharGenProgressionValidationReason };

interface ProgressionClass {
  readonly spellcaster?: unknown;
  readonly spells?: unknown;
  getSpells?: () => unknown;
}

interface ProgressionCreature {
  readonly str?: unknown;
  readonly dex?: unknown;
  readonly con?: unknown;
  readonly wis?: unknown;
  readonly int?: unknown;
  readonly cha?: unknown;
  readonly skills?: unknown;
  readonly feats?: unknown;
  readonly classes?: unknown;
  readonly forcePoints?: unknown;
  readonly maxForcePoints?: unknown;
  readonly currentForce?: unknown;
}

class ProgressionValidationError extends Error {
  constructor(readonly reason: CharGenProgressionValidationReason) {
    super(reason);
  }
}

function isByte(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
}

function readKnownPowerIds(creatureClass: ProgressionClass): number[] {
  const spells = typeof creatureClass.getSpells === 'function'
    ? creatureClass.getSpells()
    : creatureClass.spells;
  if (!Array.isArray(spells)) throw new ProgressionValidationError('invalid-known-powers');

  return spells.map((spell) => {
    const id = (spell as { id?: unknown })?.id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) {
      throw new ProgressionValidationError('invalid-known-powers');
    }
    return id;
  });
}

function readAbilities(creature: ProgressionCreature): CharGenProgressionSnapshot['abilities'] {
  const abilities = {
    str: creature.str,
    dex: creature.dex,
    con: creature.con,
    wis: creature.wis,
    int: creature.int,
    cha: creature.cha,
  };
  if (!Object.values(abilities).every(isByte)) {
    throw new ProgressionValidationError('invalid-abilities');
  }
  return abilities as CharGenProgressionSnapshot['abilities'];
}

/**
 * Creates an immutable, engine-neutral record of values that must survive the
 * custom-character save/load boundary. It validates only representational
 * integrity; authored scripts remain responsible for later class changes and
 * Force-power awards.
 */
export function snapshotCharGenProgression(creature: ProgressionCreature): CharGenProgressionSnapshot {
  if (!creature || typeof creature !== 'object') {
    throw new ProgressionValidationError('invalid-classes');
  }

  const abilities = readAbilities(creature);
  if (!Array.isArray(creature.skills) || creature.skills.length !== 8) {
    throw new ProgressionValidationError('invalid-skill-ranks');
  }
  const skillRanks = creature.skills.map((skill) => (skill as { rank?: unknown })?.rank);
  if (!skillRanks.every(isByte)) throw new ProgressionValidationError('invalid-skill-ranks');

  if (!Array.isArray(creature.feats)) throw new ProgressionValidationError('invalid-feats');
  const featIds = creature.feats.map((feat) => (feat as { id?: unknown })?.id);
  if (!featIds.every((id) => typeof id === 'number' && Number.isInteger(id) && id >= 0)) {
    throw new ProgressionValidationError('invalid-feats');
  }

  if (!Array.isArray(creature.classes) || creature.classes.length === 0) {
    throw new ProgressionValidationError('invalid-classes');
  }
  const classes = creature.classes as ProgressionClass[];
  const classKnownPowerIds = classes.map(readKnownPowerIds);

  if (!isByte(creature.forcePoints) || !isByte(creature.maxForcePoints) || !isByte(creature.currentForce)) {
    throw new ProgressionValidationError('invalid-force-state');
  }
  if (creature.forcePoints > creature.maxForcePoints) {
    throw new ProgressionValidationError('invalid-force-state');
  }

  const hasSpellcaster = classes.some((creatureClass) => creatureClass.spellcaster === true);
  if (!hasSpellcaster && (
    classKnownPowerIds.some((knownPowers) => knownPowers.length > 0) ||
    creature.forcePoints !== 0 ||
    creature.maxForcePoints !== 0 ||
    creature.currentForce !== 0
  )) {
    throw new ProgressionValidationError('invalid-pregame-force-state');
  }

  return {
    abilities,
    skillRanks,
    featIds: featIds as number[],
    classKnownPowerIds,
    forcePoints: creature.forcePoints,
    maxForcePoints: creature.maxForcePoints,
    currentForce: creature.currentForce,
  };
}

export function validateCharGenProgression(creature: ProgressionCreature): CharGenProgressionValidation {
  try {
    return { valid: true, snapshot: snapshotCharGenProgression(creature) };
  } catch (error) {
    if (error instanceof ProgressionValidationError) {
      return { valid: false, reason: error.reason };
    }
    return { valid: false, reason: 'invalid-classes' };
  }
}
