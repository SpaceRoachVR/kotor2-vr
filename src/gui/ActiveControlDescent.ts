/**
 * Whether hit-testing should descend into a control's children.
 *
 * GUI children are declared by the GUI file's `Obj_Parent` field, but their
 * widgets are added to `tGuiPanel` and positioned in panel space — a child is
 * *not* laid out inside its logical parent, and can sit wholly outside the
 * parent's box. So the parent's bounds are a containment relationship on paper
 * only, and using them to gate the search silently reduces every child's live
 * area to its intersection with its parent's.
 *
 * On the chargen attribute rows that was severe. `STR_MINUS_BTN` and
 * `STR_PLUS_BTN` are children of `STR_POINTS_BTN`, the value readout that sits
 * between them, so of each 32-unit button only the 8 units overlapping the
 * readout responded: the minus fired only on its right edge and the plus only
 * on its left. Measured by sweeping real clicks across the row — the minus
 * fired across -67..-59 of a -91..-59 box, the plus across -37..-29 of a
 * -37..-5 box. Both are now live across their full width.
 *
 * A list box is the one control that genuinely clips its children — its items
 * scroll within its frame — so it keeps the containment behaviour.
 *
 * Kept in its own module, free of GUI imports, for the same reason as
 * `PointerHitPadding`: importing the GUI barrel into a test pulls a module
 * chain Jest cannot parse.
 *
 * @file ActiveControlDescent.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */

/**
 * @param parentWasHit - whether the pointer is inside the parent's own box
 * @param parentClipsChildren - whether the parent actually clips its children
 *   to that box, which in practice means "is a list box"
 */
export function shouldDescendIntoChildren(
  parentWasHit: boolean,
  parentClipsChildren: boolean,
): boolean {
  return parentWasHit || !parentClipsChildren;
}
