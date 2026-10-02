import * as THREE from 'three';

/**
 * Hides the game world for the duration of one theater render, and returns the
 * restore.
 *
 * A prerendered movie is not somewhere the player is standing, but the XR movie
 * path drew the world behind the theater surface anyway. Two visible wrongs
 * followed, both reported from a headset session: the Peragus intro played on a
 * screen floating in the middle of the cargo bay, and because the module is
 * already loaded by the time the intro runs, the placeholder body was on show
 * until T3-M4 spawned over it.
 *
 * Flatscreen shows a movie fullscreen over black. Hiding the world for the
 * render is the VR equivalent, and it needs no change to *when* the module
 * loads — reordering that would touch game flow and save state for a purely
 * presentational problem.
 *
 * Authored cutscenes deliberately keep their surroundings: there the player is
 * in the room the scene is reprojected from, so this is not applied to them.
 */
export function hideWorldForTheater(
  worldScene: Pick<THREE.Scene, 'children'> | null | undefined,
  keep: THREE.Object3D | null | undefined,
): () => void {
  const hidden: THREE.Object3D[] = [];
  const children = worldScene?.children;
  if (!Array.isArray(children)) return () => {};

  // Fail open. This function can only ever REMOVE things from the view, so if
  // the theater surface is not itself in the scene about to be rendered there
  // is nothing left to look at and the player gets an unexplained black void
  // — strictly worse than the world it replaced. A movieHost left parented to
  // a scene from before a restart does exactly that. Hiding nothing shows the
  // world behind the movie, which is the old cosmetic bug, not a blackout.
  if (!keep || !children.includes(keep as THREE.Object3D)) return () => {};

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    // Only objects that were actually visible are touched, so restoring can
    // never turn on something the engine had deliberately hidden.
    if (!child || child === keep || !child.visible) continue;
    child.visible = false;
    hidden.push(child);
  }
  return () => {
    for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
  };
}

/** The VR objects a loading screen needs: the panel and the pointer aimed at it. */
const VR_LOADING_INTERFACE_NAMES: ReadonlySet<string> = new Set([
  'Kotor2VR.VRPanelHost',
  'Kotor2VR.VRPanelPointerRay',
  'Kotor2VR.VRPanelPointerCursor',
]);

/**
 * The engine hides the whole world scene while a module loads, and the VR
 * panel is a child of that scene, so the retail loading screen was rendered
 * into the panel and never drawn: a player waited in black (Allen,
 * 2026-10-02; measured: the panel's parent chain read `Scene!HIDDEN` for the
 * whole 20 s load). For one XR render this shows the scene again with every
 * child hidden except the loading interface, so the loading screen floats in
 * the dark instead of nothing. Does nothing while the scene is visible.
 */
export function revealVRInterfaceOverHiddenWorld(
  worldScene: THREE.Object3D | null | undefined,
): () => void {
  if (!worldScene || worldScene.visible) return () => {};
  const children = worldScene.children;
  if (!Array.isArray(children)) return () => {};
  if (!children.some((child) => child?.visible && child.name === 'Kotor2VR.VRPanelHost')) return () => {};
  const hidden: THREE.Object3D[] = [];
  for (const child of children) {
    if (!child || !child.visible || VR_LOADING_INTERFACE_NAMES.has(child.name)) continue;
    child.visible = false;
    hidden.push(child);
  }
  worldScene.visible = true;
  return () => {
    worldScene.visible = false;
    for (const child of hidden) child.visible = true;
  };
}
