import { describe, expect, test } from '@jest/globals';
import { hasSelectablePlayerPosition } from '@/managers/selectable/SelectablePlayer';

describe('selectable player readiness', () => {
  test.each([
    undefined,
    null,
    {},
    { position: undefined },
    { position: { x: 0, y: 0 } },
    { position: { x: Number.NaN, y: 0, z: 0 } },
    { position: { x: 0, y: Number.POSITIVE_INFINITY, z: 0 } },
  ])('rejects a transition-time player without a finite position', (player) => {
    expect(hasSelectablePlayerPosition(player)).toBe(false);
  });

  test('accepts a player with a finite world position', () => {
    expect(hasSelectablePlayerPosition({ position: { x: -1.25, y: 19.9, z: 9 } })).toBe(true);
  });
});
