import * as THREE from 'three';
import { markGuiSurfaceRepainted } from '@/gui/GuiSurfaceRevision';

/**
 * Renders a legacy GUI sub-scene without allowing WebXR to replace its camera.
 * The active framebuffer and clear state are restored so callers can safely run
 * this from inside an XR frame.
 *
 * Every GUI-owned offscreen surface goes through here, so this is also where
 * the GUI surface revision is bumped — see `GuiSurfaceRevision`. Marking the
 * chokepoint rather than each control means a future animated control is
 * covered without anyone remembering to opt it in.
 */
export function renderGuiSceneToTexture(
  renderer: THREE.WebGLRenderer,
  renderTarget: THREE.WebGLRenderTarget,
  scene: THREE.Scene,
  camera: THREE.Camera,
  clearColor: THREE.Color,
  clearAlpha: number,
): void {
  const previousTarget = renderer.getRenderTarget();
  const previousXREnabled = renderer.xr.enabled;
  const previousClearColor = renderer.getClearColor(new THREE.Color());
  const previousClearAlpha = renderer.getClearAlpha();

  try {
    renderer.xr.enabled = false;
    renderer.setClearColor(clearColor, clearAlpha);
    renderer.setRenderTarget(renderTarget);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    markGuiSurfaceRepainted();
  } finally {
    try {
      renderer.setClearColor(previousClearColor, previousClearAlpha);
    } finally {
      try {
        renderer.setRenderTarget(previousTarget);
      } finally {
        renderer.xr.enabled = previousXREnabled;
      }
    }
  }
}
