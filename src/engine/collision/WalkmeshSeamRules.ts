/**
 * Rules for telling a walkmesh *seam* apart from a wall.
 *
 * Odyssey room walkmeshes are not always one connected sheet. `101PER`'s
 * medical bay is the clearest case in the prologue: the kolto tank the Exile
 * wakes on is a 2.2m pad built from faces 13 and 14 at z=9.05, and the medbay
 * floor is faces 0-12 at z=9.02. The two share no vertex and a ~0.2m gap runs
 * between them, so the pad is a walkable island inside a single room.
 *
 * Every perimeter edge of that island carries `transition = -1`, which the
 * collision pass reads as "wall". The result was an Exile who could slide
 * around the pad but never leave it — the authored `WP_player_start` became a
 * sealed box and the prologue could not continue past the medical bay.
 *
 * A real wall has nothing walkable behind it. A seam has the next island right
 * there. That is the whole distinction these helpers encode, and it is kept
 * here as pure geometry so it can be tested without a running engine.
 */

/** How far past an edge to look for the island on the other side, in metres. */
export const SEAM_PROBE_DISTANCE = 0.5;

/**
 * How far the ground beyond an edge may differ in height and still be the same
 * surface, in metres.
 *
 * Walkmesh containment tests are 2D, so without this a balcony, a ramp head or
 * a raised platform counts as "walkable ground right behind the edge" and its
 * guard rail stops being a wall. The Ebon Hawk's exterior Utility Lift sits
 * 1.4m above the hull walkway and is directly over it in plan view — exactly
 * the case that must stay solid. The kolto pad this rule exists for is 0.03m
 * off its floor.
 */
export const SEAM_HEIGHT_TOLERANCE = 0.5;

/** How far a creature may be carried across a seam before the move is refused. */
export const SEAM_BRIDGE_DISTANCE = 0.75;

/** Increment used while searching across a seam for the far island. */
export const SEAM_BRIDGE_STEP = 0.05;

export interface SeamPoint {
  readonly x: number;
  readonly y: number;
}

/** Fractions along the edge that are probed. Endpoints are deliberately
 * excluded: an island corner touches its neighbour's corner often enough that
 * probing there reports a seam for edges that are otherwise solid. */
const EDGE_SAMPLE_FRACTIONS = Object.freeze([0.25, 0.5, 0.75]);

/**
 * True when walkable ground lies immediately beyond `edge`, making it a seam
 * between two islands rather than a wall.
 *
 * `inwardNormal` is the edge normal as the walkmesh stores it, pointing into
 * the walkable region the edge bounds; the probe therefore steps along its
 * negation. `isWalkable` must answer for the SAME room's walkmesh — asking
 * across rooms would let a creature step through a thin inter-room wall, and
 * genuine room-to-room openings are already expressed as transition edges.
 * It must also reject ground outside SEAM_HEIGHT_TOLERANCE of the edge; see
 * that constant for why a 2D answer is not enough.
 */
export function isWalkmeshSeam(
  edgeStart: SeamPoint,
  edgeEnd: SeamPoint,
  inwardNormal: SeamPoint,
  isWalkable: (x: number, y: number) => boolean,
  probeDistance: number = SEAM_PROBE_DISTANCE,
): boolean {
  if (typeof isWalkable !== 'function') {
    throw new TypeError('isWalkable must be a function');
  }
  if (!Number.isFinite(probeDistance) || probeDistance <= 0) {
    throw new RangeError('probeDistance must be a positive finite number');
  }
  for (const point of [edgeStart, edgeEnd, inwardNormal]) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new TypeError('seam geometry requires finite x and y');
    }
  }

  const length = Math.hypot(inwardNormal.x, inwardNormal.y);
  // A degenerate normal cannot say which side is outside, so refuse to guess:
  // reporting "seam" here would delete a wall on no evidence.
  if (length < 1e-8) return false;
  const outwardX = (-inwardNormal.x / length) * probeDistance;
  const outwardY = (-inwardNormal.y / length) * probeDistance;

  for (const fraction of EDGE_SAMPLE_FRACTIONS) {
    const x = edgeStart.x + (edgeEnd.x - edgeStart.x) * fraction + outwardX;
    const y = edgeStart.y + (edgeEnd.y - edgeStart.y) * fraction + outwardY;
    if (isWalkable(x, y)) return true;
  }
  return false;
}

/**
 * The offsets, in metres, at which to look for solid ground while carrying a
 * creature across a seam. Ordered nearest-first so a creature lands on the
 * closest island rather than being flung to the far side of a wide gap.
 */
export function seamBridgeOffsets(
  bridgeDistance: number = SEAM_BRIDGE_DISTANCE,
  step: number = SEAM_BRIDGE_STEP,
): number[] {
  if (!Number.isFinite(bridgeDistance) || bridgeDistance <= 0) {
    throw new RangeError('bridgeDistance must be a positive finite number');
  }
  if (!Number.isFinite(step) || step <= 0) {
    throw new RangeError('step must be a positive finite number');
  }
  const offsets: number[] = [];
  for (let distance = step; distance <= bridgeDistance + 1e-9; distance += step) {
    offsets.push(Number(distance.toFixed(4)));
  }
  return offsets;
}
