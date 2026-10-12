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
/**
 * Marks an effect model attached to a creature (a beam, a Force aura) as part
 * of the world rather than of the body, so first person still draws it.
 *
 * Round 14 (N4): T3-M4's Shock Arm and Flame Thrower beams are parented to the
 * caster's model, and playing as T3 the whole model was hidden, beam and all.
 */
export const VR_KEEP_IN_FIRST_PERSON = 'kotor2vrKeepInFirstPerson';

export function markVisibleInFirstPerson(object: THREE.Object3D): void {
  object.userData[VR_KEEP_IN_FIRST_PERSON] = true;
}

/** A layer no camera enables; see hidePlayerBodyForFirstPerson. */
const FIRST_PERSON_HIDDEN_LAYER = 31;

export function hidePlayerBodyForFirstPerson(
  body: THREE.Object3D | null | undefined,
): () => void {
  // Only an already-visible body is touched, so the restore can never turn on
  // something the engine had deliberately hidden — a creature mid-spawn, or a
  // player hidden by a script. Same rule as hideWorldForTheater.
  if (!body || !body.visible) return () => {};
  let kept = false;
  if (typeof body.traverse === "function") body.traverse((object) => { if (object.userData?.[VR_KEEP_IN_FIRST_PERSON]) kept = true; });
  if (!kept) {
    body.visible = false;
    return () => { body.visible = true; };
  }
  // An effect rides on the body: hide every visible branch that does not lead
  // to one, and leave the path down to the effect (and the effect) drawn.
  const hidden: THREE.Object3D[] = [];
  // A node on the path to the effect cannot be made invisible (that hides
  // the effect under it too). When it draws something itself, a body mesh
  // with the beam parented below, it moves to a layer no camera renders;
  // layers, unlike visibility, are not inherited. Critic run 4: those meshes
  // stayed drawn in first person.
  const relayered: Array<[THREE.Object3D, number]> = [];
  const holdsKept = (object: THREE.Object3D): boolean => {
    let found = false;
    object.traverse((child) => { if (child.userData?.[VR_KEEP_IN_FIRST_PERSON]) found = true; });
    return found;
  };
  const drawsItself = (object: THREE.Object3D): boolean =>
    (object as any).isMesh === true || (object as any).isPoints === true || (object as any).isLine === true;
  const hideBranch = (object: THREE.Object3D) => {
    for (const child of object.children) {
      if (child.userData?.[VR_KEEP_IN_FIRST_PERSON]) continue;
      if (holdsKept(child)) {
        if (drawsItself(child) && child.layers) {
          relayered.push([child, child.layers.mask]);
          child.layers.set(FIRST_PERSON_HIDDEN_LAYER);
        }
        hideBranch(child);
        continue;
      }
      if (child.visible) { child.visible = false; hidden.push(child); }
    }
  };
  hideBranch(body);
  return () => {
    for (const object of hidden) object.visible = true;
    for (const [object, mask] of relayered) object.layers.mask = mask;
  };
}

export interface VRPointLike { readonly x: number; readonly y: number; readonly z: number; }

/**
 * Whether an authored camera sits inside the player's own body.
 *
 * A theater shot films the scene from the authored camera, and the body belongs
 * in that picture (see above) - unless the player has walked onto the spot the
 * camera stands at. Round 12: at Atton's cell, camera 21 (76.1, -13.1) is where
 * the player stands at the cell door, and the shot was filmed from inside the
 * Exile's model. The body is an upright cylinder on the feet (Z up).
 */
export function isCameraInsideBody(
  camera: VRPointLike,
  feet: VRPointLike,
  radiusMetres = 0.6,
  heightMetres = 2.2,
): boolean {
  if (![camera.x, camera.y, camera.z, feet.x, feet.y, feet.z].every(Number.isFinite)) return false;
  const horizontal = Math.hypot(camera.x - feet.x, camera.y - feet.y);
  return horizontal <= radiusMetres && camera.z >= feet.z - 0.2 && camera.z <= feet.z + heightMetres;
}
