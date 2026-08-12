export type EngineFrameSource = 'browser' | 'xr';

export interface XRFrameCadenceReport {
  targetHz: number;
  budgetMs: number;
  durationSec: number;
  callbacks: {
    xr: number;
    browser: number;
    withXRFrame: number;
    duplicateTimestamps: number;
    estimatedMissed: number;
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
  readonly targetHz: number;
  readonly budgetMs: number;

  private windowStart = 0;
  private xrCallbacks = 0;
  private browserCallbacks = 0;
  private callbacksWithXRFrame = 0;
  private duplicateTimestamps = 0;
  private estimatedMissed = 0;
  private xrUpdates = 0;
  private browserUpdates = 0;
  private xrRenders = 0;
  private lastXRTimestamp: number | null = null;
  private readonly callbackIntervals: number[] = [];
  private currentFrame: { timestamp: number; updates: number; renders: number } | null = null;
  private finalizedFrameMismatches = 0;
  private outOfFrameEvents = 0;

  constructor(targetHz: number) {
    if (!Number.isFinite(targetHz) || targetHz <= 0) {
      throw new RangeError('XRFrameCadence targetHz must be a positive finite number');
    }
    this.targetHz = targetHz;
    this.budgetMs = 1000 / targetHz;
  }

  start(timestamp: number): void {
    this.windowStart = timestamp;
    this.xrCallbacks = 0;
    this.browserCallbacks = 0;
    this.callbacksWithXRFrame = 0;
    this.duplicateTimestamps = 0;
    this.estimatedMissed = 0;
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
        const representedFrames = Math.max(1, Math.round(interval / this.budgetMs));
        this.estimatedMissed += Math.max(0, representedFrames - 1);
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
      targetHz: this.targetHz,
      budgetMs: round(this.budgetMs),
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
