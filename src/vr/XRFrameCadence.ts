export type EngineFrameSource = 'browser' | 'xr';

/**
 * Only the scheduler that currently owns presentation may advance the engine.
 * A browser rAF already queued before XR session startup can still fire once;
 * rejecting it prevents a duplicate simulation and an out-of-frame XR draw.
 */
export function shouldProcessEngineFrame(
  source: EngineFrameSource,
  xrPresenting: boolean
): boolean {
  return xrPresenting ? source === 'xr' : source === 'browser';
}

export interface XRFrameCadenceReport {
  /** Native cadence reported by WebXR. Null means the runtime did not expose it. */
  runtimeReportedHz: number | null;
  /** Native frame budget derived only from runtimeReportedHz. */
  runtimeBudgetMs: number | null;
  durationSec: number;
  callbacks: {
    xr: number;
    browser: number;
    withXRFrame: number;
    duplicateTimestamps: number;
    estimatedMissed: number | null;
    perFrameMismatches: number;
  };
  engineUpdates: { xr: number; browser: number; total: number };
  renders: number;
  callbackIntervalMs: {
    min: number;
    p50: number;
    p90: number;
    p99: number;
    max: number;
  };
  integrity: {
    oneUpdatePerXRFrame: boolean;
    oneRenderPerXRFrame: boolean;
    noBrowserUpdatesDuringXR: boolean;
    hasXRFrameObjects: boolean;
    trustworthy: boolean;
  };
}

const round = (value: number, places = 2): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const percentile = (sorted: number[], percent: number): number => {
  if (!sorted.length) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1)
  );
  return sorted[index];
};

/**
 * Reconciles the browser, WebXR, engine-update, and XR-render boundaries.
 * XR timestamps are authoritative; wall-clock time inside the engine is not.
 */
export class XRFrameCadence {
  readonly runtimeReportedHz: number | null;
  readonly runtimeBudgetMs: number | null;

  private windowStart = 0;
  private xrCallbacks = 0;
  private browserCallbacks = 0;
  private callbacksWithXRFrame = 0;
  private duplicateTimestamps = 0;
  private estimatedMissed: number | null;
  private xrUpdates = 0;
  private browserUpdates = 0;
  private xrRenders = 0;
  private lastXRTimestamp: number | null = null;
  private readonly callbackIntervals: number[] = [];
  private currentFrame: { timestamp: number; updates: number; renders: number } | null = null;
  private finalizedFrameMismatches = 0;
  private outOfFrameEvents = 0;

  constructor(runtimeReportedHz: number | null) {
    if (runtimeReportedHz !== null && (!Number.isFinite(runtimeReportedHz) || runtimeReportedHz <= 0)) {
      throw new RangeError('XRFrameCadence runtimeReportedHz must be null or a positive finite number');
    }
    this.runtimeReportedHz = runtimeReportedHz;
    this.runtimeBudgetMs = runtimeReportedHz === null ? null : 1000 / runtimeReportedHz;
    this.estimatedMissed = this.runtimeBudgetMs === null ? null : 0;
  }

  start(timestamp: number): void {
    this.windowStart = timestamp;
    this.xrCallbacks = 0;
    this.browserCallbacks = 0;
    this.callbacksWithXRFrame = 0;
    this.duplicateTimestamps = 0;
    this.estimatedMissed = this.runtimeBudgetMs === null ? null : 0;
    this.xrUpdates = 0;
    this.browserUpdates = 0;
    this.xrRenders = 0;
    this.lastXRTimestamp = null;
    this.callbackIntervals.length = 0;
    this.currentFrame = null;
    this.finalizedFrameMismatches = 0;
    this.outOfFrameEvents = 0;
  }

  recordXRCallback(timestamp: number, hasXRFrame: boolean): void {
    this.finalizeCurrentFrame();
    this.xrCallbacks++;
    if (hasXRFrame) this.callbacksWithXRFrame++;

    if (this.lastXRTimestamp !== null) {
      const interval = timestamp - this.lastXRTimestamp;
      if (interval <= 0) {
        this.duplicateTimestamps++;
      } else {
        this.callbackIntervals.push(interval);
        if (this.runtimeBudgetMs !== null && this.estimatedMissed !== null) {
          const representedFrames = Math.max(1, Math.round(interval / this.runtimeBudgetMs));
          this.estimatedMissed += Math.max(0, representedFrames - 1);
        }
      }
    }
    this.lastXRTimestamp = timestamp;
    this.currentFrame = { timestamp, updates: 0, renders: 0 };
  }

  recordBrowserCallback(): void {
    this.browserCallbacks++;
  }

  recordEngineUpdate(source: EngineFrameSource, timestamp: number): void {
    if (source === 'xr') {
      this.xrUpdates++;
      if (this.currentFrame?.timestamp === timestamp) this.currentFrame.updates++;
      else this.outOfFrameEvents++;
    } else {
      this.browserUpdates++;
    }
  }

  recordXRRender(timestamp: number): void {
    this.xrRenders++;
    if (this.currentFrame?.timestamp === timestamp) this.currentFrame.renders++;
    else this.outOfFrameEvents++;
  }

  report(timestamp: number): XRFrameCadenceReport {
    const sorted = [...this.callbackIntervals].sort((left, right) => left - right);
    const currentFrameMismatch =
      this.currentFrame && (this.currentFrame.updates !== 1 || this.currentFrame.renders !== 1)
        ? 1
        : 0;
    const perFrameMismatches =
      this.finalizedFrameMismatches + currentFrameMismatch + this.outOfFrameEvents;
    const hasUniqueXRTimestamps = this.duplicateTimestamps === 0;
    const oneUpdatePerXRFrame =
      this.xrCallbacks > 0 &&
      this.xrUpdates === this.xrCallbacks &&
      perFrameMismatches === 0 &&
      hasUniqueXRTimestamps;
    const oneRenderPerXRFrame =
      this.xrCallbacks > 0 &&
      this.xrRenders === this.xrCallbacks &&
      perFrameMismatches === 0 &&
      hasUniqueXRTimestamps;
    const noBrowserUpdatesDuringXR = this.browserUpdates === 0;
    const hasXRFrameObjects =
      this.xrCallbacks > 0 && this.callbacksWithXRFrame === this.xrCallbacks;
    const trustworthy =
      oneUpdatePerXRFrame &&
      oneRenderPerXRFrame &&
      noBrowserUpdatesDuringXR &&
      hasXRFrameObjects &&
      hasUniqueXRTimestamps;

    return {
      runtimeReportedHz: this.runtimeReportedHz,
      runtimeBudgetMs: this.runtimeBudgetMs === null ? null : round(this.runtimeBudgetMs),
      durationSec: round(Math.max(0, timestamp - this.windowStart) / 1000),
      callbacks: {
        xr: this.xrCallbacks,
        browser: this.browserCallbacks,
        withXRFrame: this.callbacksWithXRFrame,
        duplicateTimestamps: this.duplicateTimestamps,
        estimatedMissed: this.estimatedMissed,
        perFrameMismatches,
      },
      engineUpdates: {
        xr: this.xrUpdates,
        browser: this.browserUpdates,
        total: this.xrUpdates + this.browserUpdates,
      },
      renders: this.xrRenders,
      callbackIntervalMs: {
        min: round(sorted[0] ?? 0),
        p50: round(percentile(sorted, 50)),
        p90: round(percentile(sorted, 90)),
        p99: round(percentile(sorted, 99)),
        max: round(sorted[sorted.length - 1] ?? 0),
      },
      integrity: {
        oneUpdatePerXRFrame,
        oneRenderPerXRFrame,
        noBrowserUpdatesDuringXR,
        hasXRFrameObjects,
        trustworthy,
      },
    };
  }

  private finalizeCurrentFrame(): void {
    if (!this.currentFrame) return;
    if (this.currentFrame.updates !== 1 || this.currentFrame.renders !== 1) {
      this.finalizedFrameMismatches++;
    }
  }
}
