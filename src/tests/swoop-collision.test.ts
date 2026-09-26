import { describe, expect, test } from '@jest/globals';
import { segmentMeetsCircle2D } from '@/module/minigame/SwoopCollision';

/**
 * Contact with pads, mines and obstacles: a swept test in the road plane.
 * Measured on 211TEL: pads at z 40 under a hook at z 43.8, the bike moving four
 * units a frame at gear 5, and a twenty-second weave through 47 course
 * objects that touched none of them with the old point-in-sphere test.
 */
describe('the bike\'s path this frame, not its position, decides a hit', () => {
  test('a pad the bike steps clean over in one frame is still hit', () => {
    // Pad of radius 2 at y 10; the bike goes from y 7 to y 13 in a frame.
    expect(segmentMeetsCircle2D(0, 7, 0, 13, 0, 10, 2)).toBe(true);
  });

  test('a pad beside the path is missed', () => {
    expect(segmentMeetsCircle2D(0, 7, 0, 13, 5, 10, 2)).toBe(false);
  });

  test('the edge of the circle counts', () => {
    expect(segmentMeetsCircle2D(0, 0, 0, 10, 2, 5, 2)).toBe(true);
    expect(segmentMeetsCircle2D(0, 0, 0, 10, 2.001, 5, 2)).toBe(false);
  });

  test('a stationary bike inside the circle is a hit, outside is not', () => {
    expect(segmentMeetsCircle2D(1, 1, 1, 1, 0, 0, 2)).toBe(true);
    expect(segmentMeetsCircle2D(3, 3, 3, 3, 0, 0, 2)).toBe(false);
  });

  test('the circle behind the start or past the end of the segment is not on the path', () => {
    expect(segmentMeetsCircle2D(0, 10, 0, 20, 0, 5, 2)).toBe(false);
    expect(segmentMeetsCircle2D(0, 10, 0, 20, 0, 25, 2)).toBe(false);
  });

  test('height plays no part: the caller decides that', () => {
    // Only x and y are passed; there is nothing here to get wrong about z.
    expect(segmentMeetsCircle2D(0, 0, 0, 4, 0, 2, 2)).toBe(true);
  });

  test('a zero or negative radius never hits', () => {
    expect(segmentMeetsCircle2D(0, 0, 0, 0, 0, 0, 0)).toBe(false);
    expect(segmentMeetsCircle2D(0, 0, 0, 0, 0, 0, -1)).toBe(false);
  });
});
