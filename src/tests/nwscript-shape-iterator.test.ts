import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { ShapeQueryIterator } from '@/nwscript/ShapeQueryIterator';

/**
 * Round 12 froze in 103PER: k_ai_master on an assassin droid ran
 * GetFirstObjectInShape ~140,000 times a second (round 6 had the same crash at
 * ~460/s and left a counter in to name it). Its sub20 walks a 40 m sphere and,
 * for each creature, runs 4 m sphere scans (sub21/sub22). The old engine kept
 * one cursor per shape type and rebuilt the list on every GetNext from that
 * call's own radius, so the outer loop kept resuming at the inner loop's cursor.
 */

// Positions along a line; "within r of c" is |x - c| < r, as GetObjectsInShape tests distance.
const creatures = [
  { id: 'droid', x: 0 }, { id: 'a', x: 1 }, { id: 'b', x: 10 }, { id: 'c', x: 12 }, { id: 'd', x: 30 },
];
const within = (centre: number, radius: number) => creatures.filter((o) => Math.abs(o.x - centre) < radius);

/** k_ai_master sub20 with sub21/sub22 inlined, against the new iterator. */
function runSub20(iterator: ShapeQueryIterator<{ id: string; x: number }>, cap = 10_000): { steps: number; visited: string[] } {
  let steps = 0;
  const visited: string[] = [];
  let outer = iterator.first(within(0, 40));
  while (outer) {
    if (++steps > cap) throw new Error('shape loop never ended');
    visited.push(outer.id);
    for (const _inner of ['friends', 'enemies']) {
      let o = iterator.first(within(outer.x, 4)); // nested GetFirstObjectInShape
      while (o) { if (++steps > cap) throw new Error('inner loop never ended'); o = iterator.next(); }
    }
    outer = iterator.next(); // outer GetNextObjectInShape
  }
  return { steps, visited };
}

describe('ShapeQueryIterator', () => {
  test('walks the list GetFirst stored, then stays spent', () => {
    const it = new ShapeQueryIterator<string>();
    expect(it.first(['a', 'b', 'c'])).toBe('a');
    expect(it.next()).toBe('b');
    expect(it.next()).toBe('c');
    expect(it.next()).toBeUndefined();
    expect(it.next()).toBeUndefined();
  });

  test('GetNext before any GetFirst, or after a reset, returns nothing', () => {
    const it = new ShapeQueryIterator<string>();
    expect(it.next()).toBeUndefined();
    it.first(['a']);
    it.reset();
    expect(it.next()).toBeUndefined();
  });

  test('an empty or missing list gives nothing', () => {
    const it = new ShapeQueryIterator<string>();
    expect(it.first([])).toBeUndefined();
    expect(it.first(undefined)).toBeUndefined();
    expect(it.next()).toBeUndefined();
  });

  test('the stored list is a snapshot: changing the source does not move the walk', () => {
    const it = new ShapeQueryIterator<string>();
    const source = ['a', 'b'];
    it.first(source);
    source.push('c');
    expect(it.next()).toBe('b');
    expect(it.next()).toBeUndefined();
  });

  test("k_ai_master's nested sphere scans end, cut short as in retail", () => {
    const { steps, visited } = runSub20(new ShapeQueryIterator());
    // The inner scan replaces the list, so the outer loop ends after its first
    // creature, exactly as a single retail iterator behaves. It must end.
    expect(visited).toEqual(['droid']);
    expect(steps).toBeLessThan(20);
  });
});

describe('the engine uses it', () => {
  const k1 = fs.readFileSync(path.join(__dirname, '..', 'nwscript', 'NWScriptDefK1.ts'), 'utf8');

  test('GetFirst stores the whole list and GetNext walks it', () => {
    expect(k1).toContain('return this.shapeQuery.first(objects as ModuleObject[]);');
    expect(k1).toContain('return this.shapeQuery.next();');
    expect(k1).not.toContain('objectInSphapeIndex');
  });

  test('the round-6 diagnostic counter is gone now the loop is found', () => {
    expect(k1).not.toContain('reportShapeQueryRate');
  });
});
