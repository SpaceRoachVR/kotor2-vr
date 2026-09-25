import { describe, expect, test } from '@jest/globals';
import {
  isWalkmeshSeam,
  seamBridgeOffsets,
  SEAM_BRIDGE_DISTANCE,
  SEAM_BRIDGE_STEP,
  SEAM_HEIGHT_TOLERANCE,
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

describe('SEAM_HEIGHT_TOLERANCE', () => {
  // The caller supplies height awareness through isWalkable, because walkmesh
  // containment is 2D. These pin the two real cases the tolerance separates.
  test('admits the 101PER kolto pad, which is 0.03m off its floor', () => {
    expect(Math.abs(9.05 - 9.02)).toBeLessThanOrEqual(SEAM_HEIGHT_TOLERANCE);
  });

  test('rejects the 002EBO Utility Lift platform, 1.4m above the hull walkway', () => {
    expect(Math.abs(10.85 - 9.44)).toBeGreaterThan(SEAM_HEIGHT_TOLERANCE);
  });

  test('a height-aware isWalkable keeps a ledge edge solid', () => {
    // Ground exists beyond the edge in plan view, but 1.4m up.
    const flatAnswer = () => true;
    const heightAware = () => false;
    expect(isWalkmeshSeam(PAD_EDGE_START, PAD_EDGE_END, PAD_INWARD_NORMAL, flatAnswer)).toBe(true);
    expect(isWalkmeshSeam(PAD_EDGE_START, PAD_EDGE_END, PAD_INWARD_NORMAL, heightAware)).toBe(false);
  });
});

import { DOOR_SEAM_BRIDGE_DISTANCE, DOORWAY_MARGIN, isPointInDoorway } from '@/engine/collision/WalkmeshSeamRules';

/**
 * 102PER's fourth PeragusDoor1 at (-7.78,-16.7): rooms 102perg and 102perh
 * stop 1.16m apart under it, and the door's footprint (its closed DWK) spans
 * (-9.9..-5.57, -18.57..-14.92) at z 3.37..6.53.
 */
const TUNNEL_DOOR_BOX = { min: { x: -9.9, y: -18.57, z: 3.37 }, max: { x: -5.57, y: -14.92, z: 6.53 } };

describe('DOOR_SEAM_BRIDGE_DISTANCE', () => {
  test("covers the 1.16m gap under 102PER's fourth tunnel door, which the plain bridge does not", () => {
    expect(SEAM_BRIDGE_DISTANCE).toBeLessThan(1.16);
    expect(Math.max(...seamBridgeOffsets(DOOR_SEAM_BRIDGE_DISTANCE))).toBeGreaterThanOrEqual(1.16);
  });

  test('stays short of a real drop', () => {
    expect(DOOR_SEAM_BRIDGE_DISTANCE).toBeLessThanOrEqual(2.5);
  });
});

describe('isPointInDoorway', () => {
  test('accepts the doorway edges of both rooms and the gap between them', () => {
    // 102perh edge 8 midpoint and 102perg edge 3 midpoint, then the gap centre.
    expect(isPointInDoorway({ x: -7.45, y: -17.15, z: 3.36 }, TUNNEL_DOOR_BOX)).toBe(true);
    expect(isPointInDoorway({ x: -8.22, y: -16.2, z: 3.36 }, TUNNEL_DOOR_BOX)).toBe(true);
    expect(isPointInDoorway({ x: -7.8, y: -16.7, z: 3.4 }, TUNNEL_DOOR_BOX)).toBe(true);
  });

  test('rejects the corridor a few metres away and a doorway on another deck', () => {
    expect(isPointInDoorway({ x: -3, y: -22, z: 3.4 }, TUNNEL_DOOR_BOX)).toBe(false);
    expect(isPointInDoorway({ x: -12, y: -10, z: 3.4 }, TUNNEL_DOOR_BOX)).toBe(false);
    expect(isPointInDoorway({ x: -7.8, y: -16.7, z: 12.4 }, TUNNEL_DOOR_BOX)).toBe(false);
  });

  test('applies the margin in plan view only and validates it', () => {
    expect(isPointInDoorway({ x: -5.57 + DOORWAY_MARGIN - 0.01, y: -16.7 }, TUNNEL_DOOR_BOX)).toBe(true);
    expect(isPointInDoorway({ x: -5.57 + DOORWAY_MARGIN + 0.01, y: -16.7 }, TUNNEL_DOOR_BOX)).toBe(false);
    expect(isPointInDoorway({ x: -7.8, y: -16.7 }, TUNNEL_DOOR_BOX, 0)).toBe(true);
    expect(() => isPointInDoorway({ x: 0, y: 0 }, TUNNEL_DOOR_BOX, -1)).toThrow(RangeError);
    expect(isPointInDoorway({ x: Number.NaN, y: 0 }, TUNNEL_DOOR_BOX)).toBe(false);
  });
});
