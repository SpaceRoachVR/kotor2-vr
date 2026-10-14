import * as THREE from 'three';

/**
 * Draws the headset's view onto the desktop canvas, for OBS window capture
 * and for `tools/vr-emulator/screenshot.js`.
 *
 * While an immersive session is up, three renders into the XRWebGLLayer's
 * framebuffer and nothing reaches the page canvas, so the browser window shows
 * black. Copying the eye image out is not possible here: the engine runs
 * WebGL 1 (WebGL 2 draws flat green, see RendererOptions), the layer is
 * multisampled, and WebGL 1 cannot read a multisampled framebuffer -
 * readPixels and copyTexSubImage2D both fail with INVALID_OPERATION, measured
 * live in the headset on 2026-10-14.
 *
 * So the scene is drawn a second time from the left eye's pose. That costs a
 * second scene submission, so the live mirror is capped (`mirrorFps`,
 * default 20). It is on by default - without it the desktop window freezes on
 * entering VR - and measured no frame-rate cost in Telos (31-33 Hz either
 * way, 2026-10-14); `?mirror=off` or `mirror.js off` disables it. A screenshot is one extra draw on the frame it
 * is taken and needs no mirror at all.
 *
 * The drawing uses only three's own API: raw GL calls here once corrupted
 * three's cached vertex arrays and turned the VR pointers into giant
 * triangles for the rest of the session.
 */
export type VRMirrorEye = 'left' | 'right';

export interface VRMirrorOptions {
  enabled: boolean;
  eye: VRMirrorEye;
  zoom: number;
  fps: number;
}

/** Reads `?mirror=off`, `?mirrorEye=right`, `?mirrorZoom=1.2`, `?mirrorFps=30` from the page URL. */
export function readMirrorOptionsFromSearch(search: string): VRMirrorOptions {
  const params = new URLSearchParams(search);
  const mirror = (params.get('mirror') ?? '').toLowerCase();
  const eye = (params.get('mirrorEye') ?? '').toLowerCase() === 'right' ? 'right' : 'left';
  const zoom = Number(params.get('mirrorZoom'));
  const fps = Number(params.get('mirrorFps'));
  return {
    enabled: !['off', '0', 'false', 'no'].includes(mirror),
    eye,
    zoom: Number.isFinite(zoom) && zoom >= 1 ? zoom : 1,
    fps: Number.isFinite(fps) && fps > 0 ? Math.min(fps, 120) : 20,
  };
}

/**
 * Vertical field of view (degrees) for a desktop view of `aspect` that keeps
 * the eye's full horizontal field, clamped to the eye's own vertical field.
 * Eye projections are slightly asymmetric; the symmetric approximation is
 * fine for a spectator view.
 */
export function resolveSpectatorFovDegrees(eyeProjection: THREE.Matrix4, aspect: number, zoom: number = 1): number {
  const e = eyeProjection.elements;
  const tanHalfX = 1 / e[0];
  const tanHalfY = 1 / e[5];
  if (!(tanHalfX > 0 && tanHalfY > 0 && aspect > 0)) return 90;
  const tanHalf = Math.min(tanHalfX / aspect, tanHalfY) / Math.max(1, zoom);
  return THREE.MathUtils.radToDeg(2 * Math.atan(tanHalf));
}

/** True when enough time has passed since the last live mirror frame. */
export function isMirrorFrameDue(nowMs: number, lastMs: number, fps: number): boolean {
  if (!(fps > 0)) return false;
  // Half a refresh of slack, so a 20 fps cap on a 72 Hz loop does not drift to 18.
  return nowMs - lastMs >= 1000 / fps - 7;
}

export class VRDesktopMirror implements VRMirrorOptions {
  enabled = true;
  eye: VRMirrorEye = 'left';
  zoom = 1;
  fps = 20;
  /** Spectator frames drawn this session; read over CDP to confirm it is live. */
  framesMirrored = 0;
  private lastFrameMs = Number.NEGATIVE_INFINITY;
  private readonly camera = new THREE.PerspectiveCamera(90, 16 / 9, 0.05, 15000);
  private errorReported = false;
  private pendingCaptures: Array<{ resolve: (url: string) => void; reject: (error: Error) => void }> = [];

  /** Whether `render` would draw this frame. Lets the caller skip setup. */
  wantsFrame(nowMs: number = performance.now()): boolean {
    return this.pendingCaptures.length > 0 ||
      (this.enabled && isMirrorFrameDue(nowMs, this.lastFrameMs, this.fps));
  }

  /**
   * Call right after the stereo submission, while that frame's presentation
   * state (hidden player body, hidden world) is still applied, so the desktop
   * shows exactly what the headset does.
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, nowMs: number = performance.now()): void {
    if (!this.wantsFrame(nowMs)) return;
    const xrCamera = renderer.xr.getCamera() as THREE.ArrayCamera;
    const eye = xrCamera.cameras?.[this.eye === 'right' ? 1 : 0] ?? xrCamera.cameras?.[0];
    const canvas = renderer.domElement;
    if (!eye || !canvas.width || !canvas.height) return;

    this.camera.near = eye.near;
    this.camera.far = eye.far;
    this.camera.aspect = canvas.width / canvas.height;
    this.camera.fov = resolveSpectatorFovDegrees(eye.projectionMatrix, this.camera.aspect, this.zoom);
    this.camera.updateProjectionMatrix();
    eye.matrixWorld.decompose(this.camera.position, this.camera.quaternion, this.camera.scale);
    this.camera.layers.mask = eye.layers.mask;
    this.camera.updateMatrixWorld(true);

    const previousTarget = renderer.getRenderTarget();
    const previousXREnabled = renderer.xr.enabled;
    const previousAutoClear = renderer.autoClear;
    try {
      // xr.enabled would make render() swap in the stereo camera.
      renderer.xr.enabled = false;
      renderer.setRenderTarget(null);
      renderer.autoClear = true;
      renderer.render(scene, this.camera);
      this.framesMirrored++;
      this.lastFrameMs = nowMs;
      this.flushCaptures(canvas);
    } catch (error) {
      this.rejectCaptures(error as Error);
      if (!this.errorReported) {
        this.errorReported = true;
        console.warn('[VRDesktopMirror] spectator render rejected; the desktop window will stay black', error);
      }
    } finally {
      renderer.autoClear = previousAutoClear;
      renderer.xr.enabled = previousXREnabled;
      renderer.setRenderTarget(previousTarget);
    }
  }

  /**
   * PNG data URL of the next headset frame. The canvas has no preserved
   * drawing buffer, so it is read in the same task that drew it.
   */
  capture(timeoutMs: number = 3000): Promise<string> {
    return new Promise((resolve, reject) => {
      const entry = {
        resolve: (url: string) => { clearTimeout(timer); resolve(url); },
        reject: (error: Error) => { clearTimeout(timer); reject(error); },
      };
      this.pendingCaptures.push(entry);
      const timer = setTimeout(() => {
        const index = this.pendingCaptures.indexOf(entry);
        if (index < 0) return;
        this.pendingCaptures.splice(index, 1);
        reject(new Error('no XR frame was drawn in time (is the headset session running?)'));
      }, timeoutMs);
    });
  }

  private flushCaptures(canvas: HTMLCanvasElement): void {
    if (this.pendingCaptures.length === 0) return;
    let url: string;
    try {
      url = canvas.toDataURL('image/png');
    } catch (error) {
      this.rejectCaptures(error as Error);
      return;
    }
    const captures = this.pendingCaptures;
    this.pendingCaptures = [];
    for (const capture of captures) capture.resolve(url);
  }

  private rejectCaptures(error: Error): void {
    const captures = this.pendingCaptures;
    this.pendingCaptures = [];
    for (const capture of captures) capture.reject(error);
  }
}
