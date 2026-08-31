import { getGuiSurfaceRevision } from '@/gui/GuiSurfaceRevision';

/**
 * Everything that can make an open VR panel look different from last frame.
 */
export interface VRPanelRepaintSignals {
  /** The menu the panel belongs to. A different menu is always a repaint. */
  readonly owner: object | null;
  /** GUI-space pointer, or null when the ray is off the panel. */
  readonly pointerX: number | null;
  readonly pointerY: number | null;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  /** `getGuiSurfaceRevision()` — changes when any GUI offscreen surface repainted. */
  readonly surfaceRevision: number;
  readonly nowMs: number;
}

/**
 * Decides whether the VR panel's GUI-to-texture pass has to run this frame.
 *
 * The panel composites the whole legacy GUI scene into a render target up to
 * 1536x1536. That ran on every XR frame for as long as any menu was open — 72
 * times a second to redraw an inventory list that had not changed.
 *
 * **What this is not.** It is not a general "the GUI changed" oracle. Menu
 * state can change with no signal here at all: a text field updated by a timer,
 * a health bar moving while the equipment screen is open. Those are caught only
 * by `maximumStaleMs`, which is why that floor exists and why it is short. The
 * policy trades a bounded, small staleness for most of the repaints.
 *
 * What *is* caught precisely: a different menu, pointer movement (which is what
 * drives hover highlighting), a viewport resize, and — via the surface revision
 * — any GUI control that repainted its own offscreen texture. That last one is
 * what keeps the main menu's rotating model and character creation smooth, and
 * it also covers list boxes, whose textures rebuild when their contents change.
 */
export class VRPanelRepaintPolicy {
  private lastOwner: object | null = null;
  private lastPointerX: number | null = null;
  private lastPointerY: number | null = null;
  private lastViewportWidth = 0;
  private lastViewportHeight = 0;
  private lastSurfaceRevision = -1;
  private lastPaintMs = Number.NEGATIVE_INFINITY;
  private painted = false;

  /**
   * @param maximumStaleMs - longest the panel may go without repainting while
   *   nothing observable has changed. 100 ms (10 Hz) keeps a change no signal
   *   covers imperceptible while removing ~86% of repaints at 72 Hz.
   */
  constructor(private readonly maximumStaleMs: number = 100) {
    if (!Number.isFinite(maximumStaleMs) || maximumStaleMs <= 0) {
      throw new RangeError('maximumStaleMs must be a finite positive number');
    }
  }

  shouldRepaint(signals: VRPanelRepaintSignals): boolean {
    const changed =
      !this.painted ||
      signals.owner !== this.lastOwner ||
      signals.pointerX !== this.lastPointerX ||
      signals.pointerY !== this.lastPointerY ||
      signals.viewportWidth !== this.lastViewportWidth ||
      signals.viewportHeight !== this.lastViewportHeight ||
      signals.surfaceRevision !== this.lastSurfaceRevision ||
      signals.nowMs - this.lastPaintMs >= this.maximumStaleMs;

    if (!changed) return false;

    this.painted = true;
    this.lastOwner = signals.owner;
    this.lastPointerX = signals.pointerX;
    this.lastPointerY = signals.pointerY;
    this.lastViewportWidth = signals.viewportWidth;
    this.lastViewportHeight = signals.viewportHeight;
    this.lastSurfaceRevision = signals.surfaceRevision;
    this.lastPaintMs = signals.nowMs;
    return true;
  }

  /**
   * Forgets everything, so the next frame repaints unconditionally.
   *
   * Call whenever the panel stops being presented. The render target keeps its
   * pixels while hidden, and without this a panel reopened onto the same menu
   * within the stale window would show the previous session's last frame.
   */
  reset(): void {
    this.painted = false;
    this.lastOwner = null;
    this.lastPointerX = null;
    this.lastPointerY = null;
    this.lastViewportWidth = 0;
    this.lastViewportHeight = 0;
    this.lastSurfaceRevision = -1;
    this.lastPaintMs = Number.NEGATIVE_INFINITY;
  }
}

/** Builds the signal set from live state, so callers do not assemble it by hand. */
export function captureVRPanelRepaintSignals(
  owner: object | null,
  pointer: { x: number, y: number } | null,
  viewportWidth: number,
  viewportHeight: number,
  nowMs: number = performance.now(),
): VRPanelRepaintSignals {
  return {
    owner,
    pointerX: pointer ? pointer.x : null,
    pointerY: pointer ? pointer.y : null,
    viewportWidth,
    viewportHeight,
    surfaceRevision: getGuiSurfaceRevision(),
    nowMs,
  };
}
