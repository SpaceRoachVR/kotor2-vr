export type CharGenSkillKind = 'class' | 'cross-class' | 'unavailable';

export type CharGenSkillAllocationReason =
  | 'invalid-table-data'
  | 'insufficient-points'
  | 'rank-cap';

export interface CharGenSkillAllocationInput {
  readonly skillRow: Record<string, unknown> | undefined;
  readonly classSkillColumn: string | undefined;
  readonly level: number | undefined;
  readonly currentRank: number | undefined;
  readonly availablePoints: number | undefined;
}

export interface CharGenSkillAllocation {
  readonly kind: CharGenSkillKind;
  readonly rankCost: number;
  readonly maximumRank: number;
  readonly canIncrease: boolean;
  readonly reason: CharGenSkillAllocationReason | undefined;
}

export interface CharGenSkillIncrease extends CharGenSkillAllocation {
  readonly nextRank: number;
  readonly remainingPoints: number;
}

export interface CharGenRecommendedSkillAllocationInput {
  readonly skillRows: ReadonlyArray<Record<string, unknown> | undefined>;
  readonly classSkillColumn: string | undefined;
  readonly level: number | undefined;
  readonly ranks: ReadonlyArray<number>;
  readonly availablePoints: number | undefined;
  readonly recommendedOrder: ReadonlyArray<number>;
}

export interface CharGenRecommendedSkillAllocation {
  readonly ranks: number[];
  readonly remainingPoints: number;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isValidClassSkillColumn(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value !== '****';
}

function unavailableAllocation(): CharGenSkillAllocation {
  return {
    kind: 'unavailable',
    rankCost: 0,
    maximumRank: 0,
    canIncrease: false,
    reason: 'invalid-table-data',
  };
}

/**
 * Resolves a rank purchase from the supplied retail `skills.2da` row. The
 * function deliberately accepts plain data so menus and quick creation share
 * one deterministic rules implementation without importing engine state.
 */
export function resolveCharGenSkillAllocation(
  input: CharGenSkillAllocationInput,
): CharGenSkillAllocation {
  if (
    !input ||
    !input.skillRow ||
    !isValidClassSkillColumn(input.classSkillColumn) ||
    !isNonNegativeInteger(input.currentRank) ||
    !isNonNegativeInteger(input.availablePoints) ||
    !isNonNegativeInteger(input.level) ||
    input.level < 1
  ) {
    return unavailableAllocation();
  }

  const classSkillValue = input.skillRow[input.classSkillColumn];
  const kind: CharGenSkillKind = classSkillValue === '1'
    ? 'class'
    : classSkillValue === '0'
      ? 'cross-class'
      : 'unavailable';

  if (kind === 'unavailable') {
    return unavailableAllocation();
  }

  const rankCost = kind === 'class' ? 1 : 2;
  const classMaximumRank = input.level + 3;
  const maximumRank = kind === 'class'
    ? classMaximumRank
    : Math.floor(classMaximumRank / 2);

  if (input.currentRank >= maximumRank) {
    return { kind, rankCost, maximumRank, canIncrease: false, reason: 'rank-cap' };
  }

  if (input.availablePoints < rankCost) {
    return { kind, rankCost, maximumRank, canIncrease: false, reason: 'insufficient-points' };
  }

  return { kind, rankCost, maximumRank, canIncrease: true, reason: undefined };
}

/**
 * Applies a single legal rank purchase without mutating either the input or
 * caller-owned character state. Callers commit the returned values only when
 * `canIncrease` is true.
 */
export function applyCharGenSkillIncrease(
  input: CharGenSkillAllocationInput,
): CharGenSkillIncrease {
  const allocation = resolveCharGenSkillAllocation(input);
  const currentRank = isNonNegativeInteger(input?.currentRank) ? input.currentRank : 0;
  const availablePoints = isNonNegativeInteger(input?.availablePoints) ? input.availablePoints : 0;

  if (!allocation.canIncrease) {
    return {
      ...allocation,
      nextRank: currentRank,
      remainingPoints: availablePoints,
    };
  }

  return {
    ...allocation,
    nextRank: currentRank + 1,
    remainingPoints: availablePoints - allocation.rankCost,
  };
}

/**
 * Applies the authored recommendation order until no entry can legally spend
 * another point. A pass must spend at least one point to continue, making an
 * absent or malformed recommendation list finite by construction.
 */
export function allocateRecommendedCharGenSkills(
  input: CharGenRecommendedSkillAllocationInput,
): CharGenRecommendedSkillAllocation {
  const ranks = Array.isArray(input?.ranks) && input.ranks.every(isNonNegativeInteger)
    ? [...input.ranks]
    : [];
  const remainingPoints = isNonNegativeInteger(input?.availablePoints)
    ? input.availablePoints
    : 0;

  if (
    !Array.isArray(input?.skillRows) ||
    !Array.isArray(input?.recommendedOrder) ||
    !isValidClassSkillColumn(input?.classSkillColumn) ||
    !isNonNegativeInteger(input?.level) ||
    input.level < 1 ||
    ranks.length !== input.skillRows.length
  ) {
    return { ranks, remainingPoints };
  }

  let nextRanks = ranks;
  let nextRemainingPoints = remainingPoints;
  const seenSkillRows = new Set<number>();
  const orderedSkillRows = input.recommendedOrder.filter((skillRow) => {
    if (!isNonNegativeInteger(skillRow) || skillRow >= input.skillRows.length || seenSkillRows.has(skillRow)) {
      return false;
    }
    seenSkillRows.add(skillRow);
    return true;
  });

  while (nextRemainingPoints > 0) {
    let spentPoint = false;
    for (const skillRow of orderedSkillRows) {
      const result = applyCharGenSkillIncrease({
        skillRow: input.skillRows[skillRow],
        classSkillColumn: input.classSkillColumn,
        level: input.level,
        currentRank: nextRanks[skillRow],
        availablePoints: nextRemainingPoints,
      });
      if (!result.canIncrease) continue;

      nextRanks[skillRow] = result.nextRank;
      nextRemainingPoints = result.remainingPoints;
      spentPoint = true;
      if (nextRemainingPoints === 0) break;
    }
    if (!spentPoint) break;
  }

  return { ranks: nextRanks, remainingPoints: nextRemainingPoints };
}
