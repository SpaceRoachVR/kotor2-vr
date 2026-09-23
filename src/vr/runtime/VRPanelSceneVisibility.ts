import * as THREE from 'three';

/**
 * Hides GUI roots that do not belong to the panel being composited, and returns
 * the restore.
 *
 * The VR panel draws the **whole** legacy GUI scene into its texture. That is
 * fine when one menu is up, and wrong the moment a menu opens over the in-game
 * HUD: opening a container or a computer terminal composited the container
 * window *and* every other visible GUI root behind it, so the panel showed a
 * full-screen copy of the 2D interface with the popup buried in it. Reported
 * from a headset session as "interacting with a plasteel cylinder brings up the
 * full screen 2D UI instead of just the part that is supposed to pop up".
 *
 * Flatscreen never shows this because the HUD belongs on screen there. In VR
 * the HUD is not presented at all (`INGAME_OVERLAY_PANEL_ENABLED = false`), so
 * anything it draws into the panel is pure leakage.
 *
 * Scoped by hiding the other roots rather than by rendering only the keeper,
 * because the GUI scene also carries the cursor and its lighting — a render
 * restricted to one subtree would lose both, and the pointer is exactly what
 * the player needs in order to use the panel.
 *
 * Follows `hideWorldForTheater`'s rules: only an already-visible object is
 * touched, so the restore can never turn on something the engine deliberately
 * hid, and the caller must restore in a `finally` so a throwing render cannot
 * leave the interface invisible.
 */
export function hideGuiRootsForPanel(
  occluded: readonly (THREE.Object3D | null | undefined)[] | null | undefined,
): () => void {
  if (!Array.isArray(occluded) || occluded.length === 0) return () => {};

  const hidden: THREE.Object3D[] = [];
  for (let i = 0; i < occluded.length; i++) {
    const object = occluded[i];
    if (!object || !object.visible) continue;
    object.visible = false;
    hidden.push(object);
  }

  return () => {
    for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
  };
}
