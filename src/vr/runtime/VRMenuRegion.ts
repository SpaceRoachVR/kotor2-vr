import type { VRPanelRegion } from './VRPanelHost';

/**
 * The part of the GUI viewport a menu actually occupies (round 14: "the menus
 * and computer console screens should also be trimmed, as they have excess
 * outside of the menu in the form of black or gradient boxes").
 *
 * Almost every in-game menu draws a full-screen fill behind itself (`voidFill`
 * and a `blackfill` or `1600x1200back` background), sized to cover a flat
 * monitor around the authored panel. The VR panel showed the whole viewport,
 * so that fill became a slab of black or gradient around the menu. Menus are
 * built centred on the viewport, so the menu's own panel extent, together
 * with a child menu shown with it (the in-game tab bar), says what to keep.
 */
export interface VRMenuExtent {
  readonly width: number;
  readonly height: number;
}

/** A little of the authored frame is kept, so a border is not cut through. */
const MARGIN_PIXELS = 6;

export function resolveVRMenuRegion(
  extents: readonly (VRMenuExtent | null | undefined)[],
  viewportWidth: number,
  viewportHeight: number,
): VRPanelRegion | null {
  if (!(viewportWidth > 0) || !(viewportHeight > 0)) return null;
  let width = 0;
  let height = 0;
  for (const extent of extents) {
    if (!extent || !(extent.width > 0) || !(extent.height > 0)) continue;
    width = Math.max(width, extent.width);
    height = Math.max(height, extent.height);
  }
  if (!(width > 0) || !(height > 0)) return null;
  const halfU = Math.min(0.5, (width / 2 + MARGIN_PIXELS) / viewportWidth);
  const halfV = Math.min(0.5, (height / 2 + MARGIN_PIXELS) / viewportHeight);
  // Already the whole viewport: nothing to trim.
  if (halfU >= 0.495 && halfV >= 0.495) return null;
  return { uMin: 0.5 - halfU, uMax: 0.5 + halfU, vMin: 0.5 - halfV, vMax: 0.5 + halfV };
}
