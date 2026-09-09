import * as THREE from 'three';

/**
 * Hides the player's own avatar for the duration of one first-person render,
 * and returns the restore.
 *
 * The rig is welded to the avatar at a calibrated eye height, so the model the
 * engine animates for the player sits exactly where the player's own body would
 * be — and it was being drawn. Measured in a settled module with the headset
 * presenting: 15 of 15 meshes of the player model drawn, all 15 in front of the
 * camera in camera space, 11 of them inside the view frustum, nearest part
 * 1.16 m from the eye. It reads as a broken object hanging in front of the face,
 * and it is in every module because the player is always there.
 *
 * The engine never suppressed it because nothing ever had to: flatscreen KOTOR
 * is a third-person game, where drawing the player is the whole point.
 *
 * WHY VISIBILITY RATHER THAN LAYERS
 *
 * Layers are the other way to keep one object out of one camera, and they would
 * also keep the avatar in the shadow pass — but `renderer.shadowMap.enabled` is
 * never set in this engine, so nothing casts shadows and there is nothing to
 * preserve. Visibility is a great deal simpler and cannot leak into another
 * camera's state. If shadows are ever turned on, this is the decision to
 * revisit: the avatar would stop casting one in first person.
 *
 * WHAT IS DELIBERATELY NOT TOUCHED
 *
 * Only the first-person world submission. Authored cutscenes reproject a shot
 * onto a theater surface while the player stands in the real room, so the body
 * belongs in that render; the prerendered-movie path already hides the entire
 * world behind its screen; and the flatscreen path, party-select portraits and
 * every other camera are left exactly as they were.
 */
export function hidePlayerBodyForFirstPerson(
  body: THREE.Object3D | null | undefined,
): () => void {
  // Only an already-visible body is touched, so the restore can never turn on
  // something the engine had deliberately hidden — a creature mid-spawn, or a
  // player hidden by a script. Same rule as hideWorldForTheater.
  if (!body || !body.visible) return () => {};
  body.visible = false;
  return () => { body.visible = true; };
}
