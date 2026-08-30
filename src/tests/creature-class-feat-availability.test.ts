import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The character-creation feats screen listed nothing at all, for any class.
 *
 * Measured live: 245 feats loaded, 119 of them prerequisite-free, a creature
 * and main class both set -- and `mainClass.isFeatAvailable()` returned false
 * for every single one.
 *
 * `featstable` is "SCD", so the lookup asked for `scd_list`. Feat rows are
 * normalised to camelCase when built, so the property is actually `scdList`
 * (alongside solList, jgdList, tecList and the rest). `parseInt(undefined)` is
 * NaN, and NaN meant unavailable.
 *
 * Same shape as the earlier skillstable casing bug.
 */
const SOURCE = fs.readFileSync(path.join(process.cwd(), 'src/combat/CreatureClass.ts'), 'utf8');

describe('feat availability reads the column that exists', () => {
  test('the camelCase property is tried', () => {
    expect(SOURCE).toMatch(/\$\{table\}List/);
  });

  test('the snake_case form remains as a fallback for raw 2DA rows', () => {
    expect(SOURCE).toMatch(/\$\{table\}_list/);
  });

  test('neither accessor builds the key inline any more', () => {
    const inline = SOURCE.match(/featstable\.toLowerCase\(\)\s*\+\s*'_list'/g) || [];
    expect(inline).toHaveLength(0);
  });
});

describe('getFeatStatus does not report unknown as status zero', () => {
  test('it returns -1 rather than false', () => {
    // `false == 0` is true in JS, and callers compare `status == 0`, so
    // returning false reported an unknown feat as the first available status.
    const at = SOURCE.indexOf('getFeatStatus(');
    const body = SOURCE.slice(at, at + 400);
    expect(body).toMatch(/isNaN\(status\) \? -1 : status/);
    expect(body).not.toMatch(/return false;/);
  });
});

/** The lookup rule itself, exercised against the real column shape. */
describe('the lookup rule', () => {
  const status = (featstable: string, row: Record<string, unknown>) => {
    const table = String(featstable || '').toLowerCase();
    if (!table) return NaN;
    const camel = `${table}List`;
    const raw = row[camel] !== undefined ? row[camel] : row[`${table}_list`];
    return parseInt(raw as string);
  };

  test('finds the camelCase column a built row carries', () => {
    expect(status('SCD', { scdList: '0' })).toBe(0);
  });

  test('still finds a raw snake_case column', () => {
    expect(status('SCD', { scd_list: '3' })).toBe(3);
  });

  test('is NaN when the class table is unknown', () => {
    expect(Number.isNaN(status('', { scdList: '0' }))).toBe(true);
    expect(Number.isNaN(status('SCD', {}))).toBe(true);
  });

  test('status 4 is the unavailable marker, everything else is offered', () => {
    const available = (s: number) => !Number.isNaN(s) && s !== 4;
    expect(available(status('SCD', { scdList: '4' }))).toBe(false);
    expect(available(status('SCD', { scdList: '0' }))).toBe(true);
    expect(available(status('SCD', { scdList: '3' }))).toBe(true);
  });
});
