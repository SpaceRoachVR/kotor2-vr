/**
 * Widens the hit area of small clickable GUI controls for a pointer that is not
 * a mouse.
 *
 * The authored GUI is built for a cursor the player positions with a hand on a
 * desk. A headset ray is steadier in intent than in practice, and the character
 * sheet's `+`/`-` controls are 32x32 in GUI units — reported twice from the
 * headset as "hard to click", while the large Back / OK / Recommended buttons
 * on the same screen were fine. That contrast is the evidence this is a size
 * problem rather than a mapping offset: a systematic offset would miss the big
 * buttons too.
 *
 * Padding is deliberately applied ONLY to controls that are clickable. Labels
 * default to `allowClick = true` and frequently overlap the controls they
 * caption — `STR_LBL` spans x -312..-4 across all three Strength buttons — so
 * padding them would let a caption swallow the button underneath it.
 */
export interface HitPaddingBox {
  readonly min: { readonly x: number; readonly y: number };
  readonly max: { readonly x: number; readonly y: number };
}

export interface HitPaddingPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Chosen against the real control layout rather than by feel. On the abilities
 * screen the minus button ends at x -59 and the plus begins at x -37, so the
 * two are 22 units apart with a non-clickable score readout between them.
 * Eight units a side keeps them 6 units clear of each other, so a generous
 * target never becomes an ambiguous one.
 */
export const VR_POINTER_HIT_PADDING = 8;

/** Whether a point hits a box that has been grown by `padding` on every side. */
export function hitsPaddedBox(
  box: HitPaddingBox | undefined,
  point: HitPaddingPoint | undefined,
  padding = 0,
): boolean {
  if (!box || !point) return false;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;

  const grow = Number.isFinite(padding) && padding > 0 ? padding : 0;
  return point.x >= box.min.x - grow
    && point.x <= box.max.x + grow
    && point.y >= box.min.y - grow
    && point.y <= box.max.y + grow;
}

/**
 * The padding currently in force. Held here rather than on `GUIControl` so the
 * engine can drive it without importing the GUI barrel — doing so pulls a
 * module chain Jest cannot parse and broke the VR test suite.
 */
let activePadding = 0;

export function setPointerHitPadding(padding: number): void {
  activePadding = Number.isFinite(padding) && padding > 0 ? padding : 0;
}

export function getPointerHitPadding(): number {
  return activePadding;
}
