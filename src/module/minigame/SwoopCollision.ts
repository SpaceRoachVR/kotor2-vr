/**
 * Contact between the swoop and a course object, across the road.
 *
 * Two facts decide the shape of this test. The LYT places obstacles at z 0
 * and the pad tracks put their hooks at z 40, while the rider's hook runs at
 * z 43.8: nothing on the course shares the bike's height, so a sphere test in
 * three dimensions meets nothing. And at gear 5 the bike covers four units a
 * frame, the diameter of a pad's sphere, so a point-in-circle test at frame
 * rate steps clean over most of them. So: the path the bike took this frame,
 * as a segment, against a circle in the road plane. Height is handled by the
 * caller, which skips the test while the bike is airborne.
 */

/** Whether the segment a->b passes within `radius` of (cx, cy), in the plane. */
export function segmentMeetsCircle2D(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number, radius: number,
): boolean {
  if (!(radius > 0)) return false;
  const dx = bx - ax, dy = by - ay;
  const fx = ax - cx, fy = ay - cy;
  const lengthSq = dx * dx + dy * dy;
  let t = 0;
  if (lengthSq > 1e-12) {
    t = -(fx * dx + fy * dy) / lengthSq;
    if (t < 0) t = 0; else if (t > 1) t = 1;
  }
  const px = fx + dx * t, py = fy + dy * t;
  return (px * px + py * py) <= radius * radius;
}
