import { describe, expect, test } from '@jest/globals';
import {
  isWalkmeshSeam,
  seamBridgeOffsets,
  SEAM_BRIDGE_DISTANCE,
  SEAM_BRIDGE_STEP,
} from '@/engine/collision/WalkmeshSeamRules';

/**
 * The geometry here is the real 101PER medical bay, reduced to the one edge
 * that mattered: the kolto pad's south-west side, with the medbay floor about
 * 0.2m beyond it. Before the seam rule that edge was a wall and the Exile
 * could not leave the pad the prologue starts them on.
 */
const PAD_EDGE_START = { x: 0.31, y: 24.08 };
const PAD_EDGE_END = { x: 2.16, y: 22.77 };
/** Points into the pad, which is north-east of the edge. */
const PAD_INWARD_NORMAL = { x: 0.578, y: 0.816 };

describe('isWalkmeshSeam', () => {
  test('reports a seam when another island lies just beyond the edge', () => {
    // Everything at least 0.2m south-west of the edge is the medbay floor.
    const isWalkable = (x: number, y: number): boolean =>
      (x - PAD_EDGE_START.x) * PAD_INWARD_NORMAL.x + (y - PAD_EDGE_START.y) * PAD_INWARD_NORMAL.y < -0.2;

    expect(isWalkmeshSeam(PAD_EDGE_START, PAD_EDGE_END, PAD_INWARD_NORMAL, isWalkable)).toBe(true);
  });

  test('reports a wall when nothing is walkable beyond the edge', () => {
    expect(isWalkmeshSeam(PAD_EDGE_START, PAD_EDGE_END, PAD_INWARD_NORMAL, () => false)).toBe(false);
  });

  test('probes outward, never back into the region the edge bounds', () => {
    const probed: Array<{ x: number; y: number }> = [];
    isWalkmeshSeam(PAD_EDGE_START, PAD_EDGE_END, PAD_INWARD_NORMAL, (x, y) => {
      probed.push({ x, y });
      return false;
    });

    expect(probed).toHaveLength(3);
    for (const point of probed) {
      const side = (point.x - PAD_EDGE_START.x) * PAD_INWARD_NORMAL.x +
        (point.y - PAD_EDGE_START.y) * PAD_INWARD_NORMAL.y;
      expect(side).toBeLessThan(0);
    }
  });

  test('refuses to call a degenerate normal a seam rather than guessing a side', () => {
    expect(isWalkmeshSeam(PAD_EDGE_START, PAD_EDGE_END, { x: 0, y: 0 }, () => true)).toBe(false);
  });

  test('rejects non-finite geometry and a non-positive probe distance', () => {
    expect(() => isWalkmeshSeam(PAD_EDGE_START, { x: NaN, y: 0 }, PAD_INWARD_NORMAL, () => true))
      .toThrow(TypeError);
    expect(() => isWalkmeshSeam(PAD_EDGE_START, PAD_EDGE_END, PAD_INWARD_NORMAL, () => true, 0))
      .toThrow(RangeError);
  });
});

describe('seamBridgeOffsets', () => {
  test('searches nearest-first so a creature lands on the closest island', () => {
    const offsets = seamBridgeOffsets();
    expect(offsets[0]).toBeCloseTo(SEAM_BRIDGE_STEP, 6);
    expect(offsets[offsets.length - 1]).toBeLessThanOrEqual(SEAM_BRIDGE_DISTANCE);
    expect([...offsets].sort((left, right) => left - right)).toEqual(offsets);
  });

  test('covers the 0.2m gap the 101PER kolto pad actually has', () => {
    expect(seamBridgeOffsets().some((offset) => offset >= 0.2)).toBe(true);
  });

  test('rejects a non-positive distance or step', () => {
    expect(() => seamBridgeOffsets(0)).toThrow(RangeError);
    expect(() => seamBridgeOffsets(1, 0)).toThrow(RangeError);
  });
});
