import type { GFFStruct } from "@/resource/GFFStruct";

/**
 * Static cameras are authored once and nothing in the game moves them, yet
 * every save written before `GFFField.setValue` stored vectors carries each one
 * at (0,0,0) with an identity orientation — `ModuleCamera.save()` handed its
 * Position and Orientation to `setValue`, which parked them where the writer
 * never looked. Older builds also truncated Height and Pitch to integers.
 *
 * Loading such a save put every placeable camera at the world origin, so the
 * Ebon Hawk security console's camera views showed empty space (round 8, T5:
 * "security console videos did not show at all"). Fixing the writer stops new
 * damage; these helpers let an area take the authored placement back from its
 * module archive for saves already written.
 */

/** A saved camera that lost its placement: no Position, or exactly the origin. */
export function isUnplacedStaticCamera(strt: GFFStruct): boolean {
  if (!strt?.hasField('Position')) return true;
  const position = strt.getFieldByLabel('Position').getVector();
  return !position || (position.x === 0 && position.y === 0 && position.z === 0);
}

export function readStaticCameraId(strt: GFFStruct): number | null {
  if (!strt?.hasField('CameraID')) return null;
  const id = strt.getFieldByLabel('CameraID').getValue();
  return Number.isInteger(id) ? id : null;
}

/**
 * Pairs each unplaced saved camera with the authored camera of the same
 * CameraID. A saved camera whose id the archive does not hold exactly once is
 * left alone: restoring the wrong placement would be worse than none.
 */
export function matchAuthoredStaticCameras(
  unplaced: readonly GFFStruct[],
  authored: readonly GFFStruct[],
): Map<GFFStruct, GFFStruct> {
  const byId = new Map<number, GFFStruct[]>();
  for (const strt of authored) {
    const id = readStaticCameraId(strt);
    if (id === null || isUnplacedStaticCamera(strt)) continue;
    const list = byId.get(id) ?? [];
    list.push(strt);
    byId.set(id, list);
  }
  const matches = new Map<GFFStruct, GFFStruct>();
  for (const strt of unplaced) {
    const id = readStaticCameraId(strt);
    if (id === null) continue;
    const candidates = byId.get(id);
    if (candidates?.length === 1) matches.set(strt, candidates[0]);
  }
  return matches;
}
