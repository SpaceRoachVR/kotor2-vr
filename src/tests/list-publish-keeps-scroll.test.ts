import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `setItems(..., { keepScroll: true })` restores the scroll, but the deferred
 * publish then ran `scrollbar.update()`, which snaps the scroll to whole rows
 * (for thumb drags). A list kept at its bottom, whose maxScroll is not a whole
 * number of rows, was pulled up by part of a row on every rebuild: the Lab
 * Station's recipe list moved 108 -> 96 after each Create (probe, final review).
 *
 * Source-level, as list-row-rtt-invalidation.test.ts: GUIListBox pulls in
 * GameState and the GUI tree, which do not load under jest.
 */
describe('publishing a list does not move it', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/gui/GUIListBox.ts'), 'utf8');
  const at = source.indexOf('private _doPublish(): void {');
  const body = source.slice(at, source.indexOf('\n  }', at));

  test('_doPublish restores the scroll scrollbar.update() snapped', () => {
    expect(at).toBeGreaterThan(-1);
    const saved = body.indexOf('const scroll = this.scroll;');
    const update = body.indexOf('this.scrollbar.update();');
    const restored = body.indexOf('this.scroll = scroll;');
    expect(saved).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(saved);
    expect(restored).toBeGreaterThan(update);
  });
});
