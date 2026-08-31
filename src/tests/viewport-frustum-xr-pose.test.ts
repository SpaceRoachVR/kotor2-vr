import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';

/**
 * The culling frustum has to be built from a camera that carries a WORLD pose.
 *
 * three writes the reference-space-local head pose into its XR camera at frame
 * start and only composes the rig transform during `render()`. `GameState`
 * runs its simulation phase — which is where `updateViewportFrustum()` lived —
 * before that, so while presenting it read a camera sitting near the world
 * origin. Measured in-headset: (-0.62, 0.69, -0.31) at the engine's own call
 * site against (44.37, 44.64, 2.50) immediately after render, with the player
 * standing at (44.55, 44.64).
 *
 * Culling against an origin-anchored frustum hid every door and creature in
 * 001EBO (0/11 and 0/3 visible) while placeables, which do not run the same
 * per-frame visibility path, kept rendering — and made hidden objects reappear
 * only when the world origin swung through view.
 *
 * The first fix added the post-render rebuild but LEFT the simulation-phase
 * rebuild in all four `Update*` modes, on the reasoning that flatscreen needs
 * it and the new call is merely additive. That reasoning was wrong in one
 * specific way: the simulation-phase call runs four lines before
 * `lightManager.update`, whose `canShowLight` culls every dynamic light
 * against `viewportFrustum`. So while presenting, lights went on being culled
 * against exactly the origin-anchored frustum the fix was written to
 * eliminate — the same defect, a second instance, surviving its own fix.
 *
 * The rebuild is now the only one in the frame. Flatscreen pays one frame of
 * latency on light and reticle culling for it, which is invisible; a frustum
 * in the wrong place is not. Room and selectable-object culling are unchanged
 * either way — both run inside `module.tick()`, ahead of where the
 * simulation-phase rebuild used to sit, so they always read the previous
 * frame's frustum.
 */
describe('the culling frustum is rebuilt after the render', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/GameState.ts'), 'utf8');
  const callSites = source.match(/GameState\.updateViewportFrustum\(\);/g) ?? [];

  test('updateViewportFrustum is called after GameState.Render', () => {
    const renderAt = source.indexOf('GameState.Render(delta, timestamp);');
    expect(renderAt).toBeGreaterThan(-1);
    expect(source.indexOf('GameState.updateViewportFrustum();')).toBeGreaterThan(renderAt);
  });

  test('nothing rebuilds the frustum during the simulation phase', () => {
    // Any second call site is a simulation-phase rebuild, and a simulation-phase
    // rebuild is origin-anchored while presenting. See the note above.
    expect(callSites.length).toBe(1);
  });

  test('the four playable modes drive the shared world-systems helper', () => {
    // The rebuild was duplicated across four modes, which is how one instance
    // outlived its own fix. One helper, one call site each.
    for (const mode of ['UpdateIngame', 'UpdateDialog', 'UpdateMinigame', 'UpdateFreeLook']) {
      const body = source.slice(source.indexOf(`static ${mode}(`));
      expect(body.slice(0, body.indexOf('\n  static '))).toContain('GameState.updateWorldSystems(');
    }
  });
});

/**
 * The geometry the bug rested on, pinned against the real three build: a
 * frustum built from a camera parked at the origin does not contain a point
 * standing where the player actually was.
 */
describe('why an origin-anchored frustum hides the world', () => {
  function frustumAt(position: THREE.Vector3, lookAt: THREE.Vector3): THREE.Frustum {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 15000);
    camera.position.copy(position);
    camera.lookAt(lookAt);
    camera.updateMatrixWorld(true);
    return new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
  }

  const playerHead = new THREE.Vector3(44.37, 44.64, 2.5);
  const localHead = new THREE.Vector3(-0.62, 0.69, -0.31);
  // A door three metres in front of the player, roughly where 001EBODrSec sits.
  const doorInFront = new THREE.Vector3(41.37, 44.64, 2.5);

  test('a world-posed camera sees the door in front of the player', () => {
    expect(frustumAt(playerHead, doorInFront).containsPoint(doorInFront)).toBe(true);
  });

  test('the local-posed camera the engine used to read does not', () => {
    expect(frustumAt(localHead, new THREE.Vector3(0, 0, 0)).containsPoint(doorInFront)).toBe(false);
  });
});
