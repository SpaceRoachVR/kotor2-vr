import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { shouldDescendIntoChildren } from '@/gui/ActiveControlDescent';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/**
 * GUI children are declared by `Obj_Parent` but their widgets are added to
 * `tGuiPanel` and positioned in panel space, so a child can lie wholly outside
 * its logical parent's box. Gating the hit-test search on the parent's bounds
 * therefore clipped every child's live area to the overlap.
 *
 * Measured on the chargen attribute row before the fix: the minus button's box
 * spans -91..-59 but only -67..-59 decremented, and the plus button's box spans
 * -37..-5 but only -37..-29 incremented — in both cases exactly the 8 units
 * overlapping `STR_POINTS_BTN` (-67..-29), the readout they are children of.
 */
describe('descending into GUI children during hit-testing', () => {
  test('descends into a non-clipping parent even when the parent was missed', () => {
    // The attribute row: the pointer is over the minus button, which lies
    // outside its parent readout. Refusing to descend here is the bug.
    expect(shouldDescendIntoChildren(false, false)).toBe(true);
  });

  test('descends into a parent that was hit, clipping or not', () => {
    expect(shouldDescendIntoChildren(true, false)).toBe(true);
    expect(shouldDescendIntoChildren(true, true)).toBe(true);
  });

  test('does not descend into a missed clipping parent', () => {
    // A list box really does clip: its items scroll inside its frame, so an
    // item must not be clickable when the pointer is outside the list.
    expect(shouldDescendIntoChildren(false, true)).toBe(false);
  });
});

describe('GUIControl uses the shared rule', () => {
  const source = read('src/gui/GUIControl.ts');

  test('the recursion is driven by shouldDescendIntoChildren, not the raw hit', () => {
    expect(source).toMatch(/shouldDescendIntoChildren\(/);
    // The old form gated recursion on a second hit test of the parent.
    expect(source).not.toMatch(
      /if\(control\.box && hitsPaddedBox\(control\.box, Mouse\.positionUI, padding\)\)\{\s*controls = controls\.concat/,
    );
  });

  test('only a list box is treated as clipping its children', () => {
    expect(source).toMatch(/GUIControlTypeMask\.GUIListBox/);
  });
});
