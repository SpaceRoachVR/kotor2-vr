/**
 * Framing for the upgrade screen's 3D lightsaber preview (3D_MODEL_LS).
 *
 * The saber is shown with its longest extent up the screen and turned about
 * that axis, so across the screen it sweeps the diagonal of its other two
 * extents. Plain numbers only (no three.js) so the maths is unit-tested.
 *
 * @file upgradePreviewFraming.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */

export type Axis = 'x' | 'y' | 'z';
export type Size = { x: number; y: number; z: number };

/** Distance used when the box has no extent (a model with no geometry). */
const EMPTY_DISTANCE = 1;

/**
 * The camera distance from the box's centre at which the box fits the
 * frustum times `margin`: the largest extent along the view's vertical, and
 * the turning cross-section (the diagonal of the other two extents) along
 * its horizontal, both measured at the box's nearest face to the camera.
 * Proportional to the box's size and to `margin`.
 */
export function previewCameraDistance(size: Size, fovDeg: number, aspect: number, margin = 1.15): number {
  const extents = [size.x, size.y, size.z].map((v) => Math.abs(Number(v) || 0)).sort((a, b) => b - a);
  const [long, a, b] = extents;
  if(!(long > 0)) return EMPTY_DISTANCE;
  const across = Math.hypot(a, b);
  const tanV = Math.tan((fovDeg * Math.PI / 180) / 2);
  const tanH = tanV * (aspect > 0 ? aspect : 1);
  const fit = Math.max((long / 2) / tanV, (across / 2) / tanH);
  return margin * (fit + across / 2);
}

/**
 * The box's long axis (largest extent), shown vertically and turned about,
 * and the axis the camera looks along: the thinner of the other two, so the
 * preview opens on the hilt's broad side.
 */
export function previewAxes(size: Size): { long: Axis; view: Axis } {
  const axes: Axis[] = ['x', 'y', 'z'];
  const extent = (axis: Axis) => Math.abs(Number(size[axis]) || 0);
  const long = axes.reduce((best, axis) => (extent(axis) > extent(best) ? axis : best), 'z' as Axis);
  const others = axes.filter((axis) => axis !== long);
  const view = extent(others[1]) < extent(others[0]) ? others[1] : others[0];
  return { long, view };
}
