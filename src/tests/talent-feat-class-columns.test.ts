import { expect, test } from '@jest/globals';
import {
  FEAT_CLASS_COLUMN_CODES,
  readFeatClassColumn,
} from '@/talents/featClassColumns';
import * as fs from 'fs';
import * as path from 'path';

const creatureClassSource = fs.readFileSync(
  path.join(process.cwd(), 'src/combat/CreatureClass.ts'),
  'utf8',
);

/**
 * `classes.2da` stores `skillstable` uppercase ("SCD"). These lookups used to
 * compare it against lowercase literals in a fourteen-case switch and fall
 * through to `default: -1` every time — silently, with nothing thrown and
 * nothing logged. The visible symptom was Quick Character granting a level-1
 * character zero feats.
 */

/** Stands in for a TalentFeat row; the lookup only ever reads columns off it. */
function featWith(columns: Record<string, unknown>) {
  return {
    row: columns,
    getGranted: (skillstable: unknown) => readFeatClassColumn(columns, skillstable, 'Granted'),
    getRecom: (skillstable: unknown) => readFeatClassColumn(columns, skillstable, 'Recom'),
    getList: (skillstable: unknown) => readFeatClassColumn(columns, skillstable, 'List'),
  };
}

test('reads the class column when skillstable is uppercase, as the 2DA stores it', () => {
  const feat = featWith({ scdGranted: 1, scdRecom: 1, scdList: 3 });

  expect(feat.getGranted('SCD')).toBe(1);
  expect(feat.getRecom('SCD')).toBe(1);
  expect(feat.getList('SCD')).toBe(3);
});

test('still reads it when lowercase or padded', () => {
  const feat = featWith({ jcnGranted: 1 });

  expect(feat.getGranted('jcn')).toBe(1);
  expect(feat.getGranted('  JcN  ')).toBe(1);
});

test('every class code in the table resolves its own column', () => {
  // A missed code is a whole class silently granted nothing, which is exactly
  // the failure mode this replaced.
  const codes = FEAT_CLASS_COLUMN_CODES;

  for (const code of codes) {
    const feat = featWith({ [`${code}Granted`]: 1 });
    expect(feat.getGranted((code.toUpperCase()))).toBe(1);
  }
});

test('an unknown, absent, or non-string class code yields -1 rather than an unrelated property', () => {
  const feat = featWith({ scdGranted: 1, constructor: 99 });

  expect(feat.getGranted('nope')).toBe(-1);
  expect(feat.getGranted('')).toBe(-1);
  expect(feat.getGranted(undefined)).toBe(-1);
  // An open property read would have reached something here.
  expect(feat.getGranted('constructor')).toBe(-1);
  expect(feat.getGranted('toString')).toBe(-1);
});

test('a missing or non-numeric column yields -1 rather than NaN', () => {
  const feat = featWith({ solGranted: undefined, solRecom: 'not a number' });

  expect(feat.getGranted('SOL')).toBe(-1);
  expect(feat.getRecom('SOL')).toBe(-1);
  // The column genuinely absent from the row.
  expect(feat.getList('SOL')).toBe(-1);
});

test('a -1 column is preserved, since that is a real "not offered" value', () => {
  const feat = featWith({ jgdGranted: -1 });

  expect(feat.getGranted('JGD')).toBe(-1);
});

test('reads raw 2DA granted columns when a normalized property is unavailable', () => {
  expect(readFeatClassColumn({ sol_granted: '3' }, 'SOL', 'Granted')).toBe(3);
  expect(creatureClassSource).toMatch(/readFeatClassColumn\(feat, this\.featstable, 'Granted'\)/);
});
