import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * TSL borrows K1's implementation for any routine it has not implemented
 * itself. That is only safe where both tables give the id the same name.
 *
 * The tables diverge at 768-771 (K1 IsMoviePlaying / QueueMovie /
 * PlayMovieQueue / YavinHackCloseDoor vs TSL GetScriptParameter /
 * SetFadeUntilScript / EffectForceBody / GetItemComponent). Inheriting by id
 * alone gave TSL's EffectForceBody K1's PlayMovieQueue body, so using the Force
 * Body power played the movie queue instead.
 *
 * Parsed from source rather than imported: the tables pull in the whole engine,
 * including THREE's ESM examples, which jest cannot load.
 */
const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function parseTable(source: string): Map<number, { name: string; implemented: boolean }> {
  const out = new Map<number, { name: string; implemented: boolean }>();
  const starts = [...source.matchAll(/\n {2}(\d+)\s*:\s*\{/g)];
  starts.forEach((match, i) => {
    const from = match.index as number;
    const to = i + 1 < starts.length ? (starts[i + 1].index as number) : source.length;
    const body = source.slice(from, to);
    const name = body.match(/name:\s*['"]([^'"]+)['"]/);
    out.set(Number(match[1]), {
      name: name ? name[1] : '?',
      implemented: /action:\s*(async\s+)?function/.test(body),
    });
  });
  return out;
}

const k1 = parseTable(read('nwscript/NWScriptDefK1.ts'));
const k2Source = read('nwscript/NWScriptDefK2.ts');
const k2 = parseTable(k2Source);

describe('K1/TSL routine tables', () => {
  test('both tables parse', () => {
    expect(k1.size).toBeGreaterThan(700);
    expect(k2.size).toBeGreaterThan(800);
    expect([...k2.values()].every((e) => e.name !== '?')).toBe(true);
  });

  test('the tables disagree on exactly the four known ids', () => {
    const disagreements = [...k2.keys()]
      .filter((id) => k1.has(id) && k1.get(id)!.name !== k2.get(id)!.name)
      .sort((a, b) => a - b);
    expect(disagreements).toEqual([768, 769, 770, 771]);
  });

  test('inheritance is gated on the name matching, not the id alone', () => {
    const loop = k2Source.slice(k2Source.indexOf('for (const property in NWScriptDefK1.Actions)'));
    expect(loop).toContain('if (k1Action.name !== k2Action.name) continue;');
  });

  test('id 770 is EffectForceBody in TSL and PlayMovieQueue in K1', () => {
    expect(k2.get(770)!.name).toBe('EffectForceBody');
    expect(k1.get(770)!.name).toBe('PlayMovieQueue');
  });
});
