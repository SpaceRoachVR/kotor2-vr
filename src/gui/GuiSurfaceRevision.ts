/**
 * A counter bumped whenever a GUI-owned offscreen surface repaints itself.
 *
 * Some legacy GUI controls render their own texture during the simulation
 * phase — `LBL_3DView` (the rotating character model on the main menu and
 * through character creation) and the in-game minimap both do. Their content
 * changes every frame without any input, and nothing about the menu's own
 * state reflects that.
 *
 * The VR panel needs to know. It composites the GUI scene into a world-space
 * texture, and repainting that on every XR frame is mostly wasted work for a
 * static menu — but skipping it would freeze a rotating model. This counter is
 * how a consumer distinguishes the two without knowing which menus contain
 * what, and without a per-menu opt-in that a future animated control would
 * silently miss.
 *
 * @file GuiSurfaceRevision.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */

let revision = 0;

/** Called by any GUI control that has just repainted its own offscreen texture. */
export function markGuiSurfaceRepainted(): void {
  revision++;
}

/** Current revision. Compare against a previously held value; do not interpret it. */
export function getGuiSurfaceRevision(): number {
  return revision;
}

/** Test seam only. */
export function resetGuiSurfaceRevisionForTests(): void {
  revision = 0;
}
