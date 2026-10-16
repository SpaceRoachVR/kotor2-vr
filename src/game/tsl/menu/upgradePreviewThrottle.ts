/**
 * Paces the upgrade screen's 3D lightsaber preview. Every preview render
 * bumps the GUI surface revision, and the VR panel re-composites the whole
 * GUI when it changes (VRPanelRepaintPolicy), so rendering the turning saber
 * every XR frame (72 Hz) repaints the panel every frame. The preview renders
 * at `rateHz` instead; force() makes the next tick render (a new model, a
 * new blade colour).
 */
export class PreviewRenderThrottle {
  /** Seconds between renders. */
  readonly interval: number;
  /** Seconds banked toward the next render (the carry keeps the average rate). */
  private banked = 0;
  /** Seconds since the last render: what the view advances its animations by. */
  private sinceRender = 0;
  private forced = true;

  constructor(rateHz: number) {
    this.interval = 1 / rateHz;
  }

  /** The next tick renders whatever has accumulated. */
  force(): void {
    this.forced = true;
  }

  /**
   * Advances by `delta` seconds. Returns the seconds the render should
   * advance animations by when this frame renders, else undefined.
   */
  tick(delta: number): number | undefined {
    const d = Number.isFinite(delta) && delta > 0 ? delta : 0;
    this.banked += d;
    this.sinceRender += d;
    // A frame time a hair under the interval (float error) still counts.
    const due = this.banked >= this.interval * (1 - 1e-6);
    if (!this.forced && !due) return undefined;
    this.forced = false;
    // The carry keeps the average rate; a forced render starts the interval
    // over, and after a stall the carry is dropped (no burst of renders).
    this.banked = due ? this.banked - this.interval : 0;
    if (this.banked < 0 || this.banked >= this.interval * (1 - 1e-6)) this.banked = 0;
    const elapsed = this.sinceRender;
    this.sinceRender = 0;
    return elapsed;
  }
}
