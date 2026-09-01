import { describe, expect, test } from '@jest/globals';
import {
  buildRecoveryIndex,
  recoverTemplateResRef,
  type PristineInstance,
} from '@/module/TemplateResRefRecovery';

/**
 * Saves written by earlier builds embed module GITs with no TemplateResRef, so
 * loading them skips the .utp merge entirely. The pristine archive still has the
 * resrefs; the difficulty is matching a saved instance back to its counterpart
 * when list order is unstable and tags are not unique.
 *
 * These tests care most about what recovery *refuses*. Handing an object the
 * blueprint of a different object is worse than leaving it without one, because
 * it silently gives it another object's behaviour.
 */
const at = (tag: string, x: number, y: number, z: number, templateResRef: string): PristineInstance =>
  ({ tag, x, y, z, templateResRef });

describe('TemplateResRef recovery', () => {

  test('recovers by tag and position', () => {
    const index = buildRecoveryIndex([
      at('Comcon', 10, 20, 0, 'comppnl002'),
      at('Galaxymap', 30, 40, 0, 'invisible001'),
    ]);
    expect(recoverTemplateResRef(index, { tag: 'Comcon', x: 10, y: 20, z: 0 })).toBe('comppnl002');
    expect(recoverTemplateResRef(index, { tag: 'Galaxymap', x: 30, y: 40, z: 0 })).toBe('invisible001');
  });

  test('tolerates a small position drift', () => {
    // A saved object has usually moved slightly, or come back changed by a float
    // round trip. Exact equality would miss matches that are plainly the same.
    const index = buildRecoveryIndex([at('Comcon', 10, 20, 0, 'comppnl002')]);
    expect(recoverTemplateResRef(index, { tag: 'Comcon', x: 10.02, y: 19.98, z: 0 })).toBe('comppnl002');
    expect(recoverTemplateResRef(index, { tag: 'Comcon', x: 10.3, y: 20.2, z: 0.1 })).toBe('comppnl002');
  });

  test('recovers by tag alone when that tag is unique', () => {
    // An object that walked across the room during play keeps its tag.
    const index = buildRecoveryIndex([at('Hanharr', 1, 1, 0, 'p_hanharr')]);
    expect(recoverTemplateResRef(index, { tag: 'Hanharr', x: 900, y: -400, z: 12 })).toBe('p_hanharr');
  });

  test('refuses a duplicated tag whose instances differ', () => {
    // Modules reuse tags across props. Two footlockers with different blueprints
    // and the same tag cannot be told apart once an object has moved.
    const index = buildRecoveryIndex([
      at('Footlocker', 1, 1, 0, 'g_footlocker01'),
      at('Footlocker', 50, 50, 0, 'g_footlocker02'),
    ]);
    expect(recoverTemplateResRef(index, { tag: 'Footlocker', x: 900, y: 900, z: 0 })).toBeUndefined();
    // ...but each is still recoverable where it actually stands.
    expect(recoverTemplateResRef(index, { tag: 'Footlocker', x: 1, y: 1, z: 0 })).toBe('g_footlocker01');
    expect(recoverTemplateResRef(index, { tag: 'Footlocker', x: 50, y: 50, z: 0 })).toBe('g_footlocker02');
  });

  test('accepts a duplicated tag when every instance agrees', () => {
    // Repeated identical props are not ambiguous: every candidate answers the
    // same thing, so there is nothing to get wrong.
    const index = buildRecoveryIndex([
      at('Crate', 1, 1, 0, 'g_crate01'),
      at('Crate', 50, 50, 0, 'g_crate01'),
    ]);
    expect(recoverTemplateResRef(index, { tag: 'Crate', x: 900, y: 900, z: 0 })).toBe('g_crate01');
  });

  test('refuses an untagged object that has moved', () => {
    // Several modules ship objects with an empty tag; position is the only
    // handle on them, so a moved one is unrecoverable and must stay so.
    const index = buildRecoveryIndex([at('', 5, 5, 0, 'dor_lhr01')]);
    expect(recoverTemplateResRef(index, { tag: '', x: 5, y: 5, z: 0 })).toBe('dor_lhr01');
    expect(recoverTemplateResRef(index, { tag: '', x: 700, y: 700, z: 0 })).toBeUndefined();
  });

  test('ignores pristine instances that have no resref themselves', () => {
    const index = buildRecoveryIndex([
      { tag: 'Broken', x: 1, y: 1, z: 0, templateResRef: '' },
    ]);
    expect(recoverTemplateResRef(index, { tag: 'Broken', x: 1, y: 1, z: 0 })).toBeUndefined();
  });

  test('survives empty and malformed input', () => {
    const index = buildRecoveryIndex([]);
    expect(recoverTemplateResRef(index, { tag: 'x', x: 0, y: 0, z: 0 })).toBeUndefined();
    expect(recoverTemplateResRef(index, { tag: '', x: NaN, y: 0, z: 0 })).toBeUndefined();
    expect(buildRecoveryIndex(undefined as unknown as PristineInstance[]).byUniqueTag.size).toBe(0);
  });

  test('matches a tagged saved object to an untagged pristine stub', () => {
    // The real shape of the problem, and the case the first version of this
    // matcher missed: pristine placeable stubs carry no tag (it lives in the
    // .utp) while the saved struct does. Only position is shared. Doors happen
    // to have tags on both sides, so they matched and placeables did not -
    // 11 of 57 recovered, which is exactly the door count.
    const index = buildRecoveryIndex([
      { tag: '', x: 56, y: 12, z: 0, templateResRef: 'comppnl002' },
      { tag: '', x: 57.203426361083984, y: 13, z: 0, templateResRef: 'g_tresmilhig006' },
    ]);
    expect(recoverTemplateResRef(index, { tag: 'Comcon', x: 56, y: 12, z: 0 }))
      .toBe('comppnl002');
    expect(recoverTemplateResRef(index, { tag: 'PlsCylSpk', x: 57.203426361083984, y: 13, z: 0 }))
      .toBe('g_tresmilhig006');
  });

  test('still refuses two different pristine objects sharing a cell', () => {
    const index = buildRecoveryIndex([
      { tag: '', x: 5, y: 5, z: 0, templateResRef: 'g_one' },
      { tag: '', x: 5, y: 5, z: 0, templateResRef: 'g_two' },
    ]);
    expect(recoverTemplateResRef(index, { tag: 'Whatever', x: 5, y: 5, z: 0 })).toBeUndefined();
  });

});
