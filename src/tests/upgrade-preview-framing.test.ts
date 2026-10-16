import { describe, expect, test } from '@jest/globals';
import { previewAxes, previewCameraDistance } from '@/game/tsl/menu/upgradePreviewFraming';

const ASPECT = 168 / 228;
const FOV = 30;

/** The frustum's visible height and width at `distance`. */
function visible(distance: number, fovDeg = FOV, aspect = ASPECT){
  const h = 2 * distance * Math.tan((fovDeg * Math.PI / 180) / 2);
  return { h, w: h * aspect };
}

describe('previewCameraDistance', () => {
  test('a unit cube gives a positive distance', () => {
    const d = previewCameraDistance({ x: 1, y: 1, z: 1 }, FOV, ASPECT);
    expect(d).toBeGreaterThan(0);
    expect(Number.isFinite(d)).toBe(true);
  });

  test('distance grows linearly with size', () => {
    const d1 = previewCameraDistance({ x: 1, y: 1, z: 1 }, FOV, ASPECT);
    const d2 = previewCameraDistance({ x: 2, y: 2, z: 2 }, FOV, ASPECT);
    expect(d2).toBeCloseTo(2 * d1, 6);
  });

  test('distance grows linearly with margin', () => {
    const d1 = previewCameraDistance({ x: 1, y: 1, z: 1 }, FOV, ASPECT, 1);
    const d2 = previewCameraDistance({ x: 1, y: 1, z: 1 }, FOV, ASPECT, 2);
    expect(d2).toBeCloseTo(2 * d1, 6);
    expect(previewCameraDistance({ x: 1, y: 1, z: 1 }, FOV, ASPECT)).toBeGreaterThan(d1);
  });

  test('a long thin box fits its 1.2 extent', () => {
    const d = previewCameraDistance({ x: 0.1, y: 0.1, z: 1.2 }, FOV, ASPECT);
    // The long axis is shown vertically: the frustum at the box's near face
    // must still be at least 1.2 tall, and the turning cross-section fits across.
    const nearFace = d - Math.hypot(0.1, 0.1) / 2;
    expect(visible(nearFace).h).toBeGreaterThanOrEqual(1.2);
    expect(visible(nearFace).w).toBeGreaterThanOrEqual(Math.hypot(0.1, 0.1));
  });

  test('the long extent sets the distance whichever axis carries it', () => {
    const z = previewCameraDistance({ x: 0.1, y: 0.1, z: 1.2 }, FOV, ASPECT);
    const x = previewCameraDistance({ x: 1.2, y: 0.1, z: 0.1 }, FOV, ASPECT);
    expect(x).toBeCloseTo(z, 6);
  });

  test('a wide box is fitted across the narrow portrait frustum', () => {
    const d = previewCameraDistance({ x: 1, y: 1, z: 1.1 }, FOV, ASPECT);
    const nearFace = d - Math.SQRT2 / 2;
    expect(visible(nearFace).w).toBeGreaterThanOrEqual(Math.SQRT2);
  });

  test('an empty box still gives a usable distance', () => {
    const d = previewCameraDistance({ x: 0, y: 0, z: 0 }, FOV, ASPECT);
    expect(d).toBeGreaterThan(0);
    expect(Number.isFinite(d)).toBe(true);
  });
});

describe('previewAxes', () => {
  test('the long axis is the largest extent and the view axis is perpendicular', () => {
    expect(previewAxes({ x: 0.1, y: 0.2, z: 1.2 })).toEqual({ long: 'z', view: 'x' });
    expect(previewAxes({ x: 1.2, y: 0.3, z: 0.1 })).toEqual({ long: 'x', view: 'z' });
    expect(previewAxes({ x: 0.1, y: 1.2, z: 0.2 })).toEqual({ long: 'y', view: 'x' });
  });
});
