/**
 * Copies one headset eye onto the desktop canvas every XR frame.
 *
 * While an immersive session is up, three renders into the XRWebGLLayer's
 * opaque framebuffer and nothing reaches the page canvas, so the browser
 * window showed black and so did anything capturing it (OBS window capture,
 * screenshots over CDP). OpenVR mirror capture does not help either: the game
 * runs on VDXR's OpenXR runtime, not SteamVR's compositor.
 *
 * A blit from the XR framebuffer is one GPU copy, not a second render, so it
 * costs a fraction of a millisecond against the 31 ms plateau measured in the
 * frame-rate rounds. The eye is cropped to the canvas aspect so the window
 * shows an undistorted view instead of a squashed square eye.
 *
 * Under the emulator (iwer) the layer framebuffer is null - the eye views are
 * already drawn straight onto the canvas - so there is nothing to copy.
 */
export type VRMirrorEye = 'left' | 'right';

export interface VRMirrorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The centred region of an eye viewport whose aspect matches the target's.
 * `zoom` > 1 crops tighter, trimming the stretched lens edges of a wide FOV.
 */
export function resolveMirrorSourceRect(
  eye: VRMirrorRect,
  targetWidth: number,
  targetHeight: number,
  zoom: number = 1,
): VRMirrorRect | null {
  if (!(eye.width > 0 && eye.height > 0 && targetWidth > 0 && targetHeight > 0)) return null;
  const targetAspect = targetWidth / targetHeight;
  let width = eye.width;
  let height = eye.height;
  if (width / height > targetAspect) width = height * targetAspect;
  else height = width / targetAspect;
  const scale = 1 / Math.max(1, Number.isFinite(zoom) ? zoom : 1);
  width *= scale;
  height *= scale;
  return {
    x: Math.round(eye.x + (eye.width - width) / 2),
    y: Math.round(eye.y + (eye.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** Reads `?mirror=off`, `?mirrorEye=right` and `?mirrorZoom=1.2` from the page URL. */
export function readMirrorOptionsFromSearch(search: string): { enabled: boolean; eye: VRMirrorEye; zoom: number } {
  const params = new URLSearchParams(search);
  const mirror = (params.get('mirror') ?? '').toLowerCase();
  const eye = (params.get('mirrorEye') ?? '').toLowerCase() === 'right' ? 'right' : 'left';
  const zoom = Number(params.get('mirrorZoom'));
  return {
    enabled: !['off', '0', 'false', 'no'].includes(mirror),
    eye,
    zoom: Number.isFinite(zoom) && zoom >= 1 ? zoom : 1,
  };
}

interface MirrorLayer {
  framebuffer: WebGLFramebuffer | null;
  framebufferWidth: number;
  framebufferHeight: number;
  getViewport?(view: XRView): XRViewport | null | undefined;
}

export class VRDesktopMirror {
  enabled = true;
  eye: VRMirrorEye = 'left';
  zoom = 1;
  /** Frames copied this session; read over CDP to confirm the mirror is live. */
  framesMirrored = 0;
  private errorReported = false;
  private pendingCaptures: Array<{ resolve: (url: string) => void; reject: (error: Error) => void }> = [];

  /**
   * Call after the frame's last draw into the XR framebuffer. Restores every
   * piece of GL state it touches, because three caches bindings and would
   * otherwise draw the next frame into the canvas.
   */
  mirror(gl: WebGL2RenderingContext | WebGLRenderingContext, layer: MirrorLayer | null | undefined, views?: readonly XRView[] | null): void {
    if (!this.enabled && this.pendingCaptures.length === 0) return;
    if (!layer || !layer.framebuffer) {
      this.flushCaptures(gl.canvas);
      return;
    }
    const gl2 = gl as WebGL2RenderingContext;
    if (typeof gl2.blitFramebuffer !== 'function') {
      this.reportOnce('WebGL2 is required to mirror the headset view');
      return;
    }
    const canvas = gl.canvas;
    const eye = this.resolveEyeViewport(layer, views);
    const source = resolveMirrorSourceRect(eye, canvas.width, canvas.height, this.zoom);
    if (!source) return;

    const previousRead = gl2.getParameter(gl2.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const previousDraw = gl2.getParameter(gl2.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const scissor = gl2.isEnabled(gl2.SCISSOR_TEST);
    try {
      if (scissor) gl2.disable(gl2.SCISSOR_TEST);
      gl2.bindFramebuffer(gl2.READ_FRAMEBUFFER, layer.framebuffer);
      gl2.bindFramebuffer(gl2.DRAW_FRAMEBUFFER, null);
      gl2.blitFramebuffer(
        source.x, source.y, source.x + source.width, source.y + source.height,
        0, 0, canvas.width, canvas.height,
        gl2.COLOR_BUFFER_BIT, gl2.LINEAR,
      );
      this.framesMirrored++;
    } catch (error) {
      this.reportOnce(`blit rejected: ${(error as Error)?.message ?? error}`);
    } finally {
      gl2.bindFramebuffer(gl2.READ_FRAMEBUFFER, previousRead);
      gl2.bindFramebuffer(gl2.DRAW_FRAMEBUFFER, previousDraw);
      if (scissor) gl2.enable(gl2.SCISSOR_TEST);
    }
    this.flushCaptures(canvas);
  }

  /**
   * PNG data URL of the next mirrored frame. The canvas has no preserved
   * drawing buffer, so it can only be read in the same task that drew it.
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
        reject(new Error('no XR frame was mirrored in time (is the headset session running?)'));
      }, timeoutMs);
    });
  }

  private flushCaptures(canvas: HTMLCanvasElement | OffscreenCanvas): void {
    if (this.pendingCaptures.length === 0) return;
    const captures = this.pendingCaptures;
    this.pendingCaptures = [];
    try {
      // toDataURL snapshots synchronously, while the buffer still holds this frame.
      const url = (canvas as HTMLCanvasElement).toDataURL('image/png');
      for (const capture of captures) capture.resolve(url);
    } catch (error) {
      for (const capture of captures) capture.reject(error as Error);
    }
  }

  private resolveEyeViewport(layer: MirrorLayer, views?: readonly XRView[] | null): VRMirrorRect {
    const index = this.eye === 'right' ? 1 : 0;
    const view = views?.[index] ?? views?.[0];
    const viewport = view && layer.getViewport ? layer.getViewport(view) : null;
    if (viewport && viewport.width > 0 && viewport.height > 0) {
      return { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height };
    }
    const half = Math.floor(layer.framebufferWidth / 2);
    return { x: index === 1 ? half : 0, y: 0, width: half, height: layer.framebufferHeight };
  }

  private reportOnce(message: string): void {
    if (this.errorReported) return;
    this.errorReported = true;
    console.warn(`[VRDesktopMirror] ${message}; the desktop window will stay black`);
  }
}
