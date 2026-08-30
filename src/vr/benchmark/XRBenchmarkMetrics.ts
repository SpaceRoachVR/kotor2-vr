export type XRBenchmarkCheck =
  | 'duration'
  | 'averageFps'
  | 'p90'
  | 'p99'
  | 'uniqueTimestamps'
  | 'gpuTiming';

export interface XRBenchmarkConfiguration {
  caseId: string;
  rendererVersion: string;
  runtimeHz: number;
  acceptanceHz: number;
  framebufferWidth: number;
  framebufferHeight: number;
  gpuTimerSupported: boolean;
  minimumDurationMs?: number;
}

export interface XRBenchmarkPercentiles {
  min: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
}

export interface XRBenchmarkReport {
  schemaVersion: 1;
  caseId: string;
  rendererVersion: string;
  runtimeHz: number;
  acceptanceHz: number;
  framebuffer: { width: number; height: number };
  frames: number;
  durationSec: number;
  fps: number;
  intervalMs: XRBenchmarkPercentiles;
  overBudget: { budgetMs: number; frames: number; percent: number };
  estimatedMissedRuntimeFrames: number;
  duplicateTimestamps: number;
  gpuMs: XRBenchmarkPercentiles & {
    supported: boolean;
    samples: number;
    disjointSamples: number;
  };
  verdict: {
    status: 'pass' | 'fail' | 'incomplete';
    failed: XRBenchmarkCheck[];
    missing: XRBenchmarkCheck[];
  };
}

const CHECK_ORDER: XRBenchmarkCheck[] = [
  'duration',
  'averageFps',
  'p90',
  'p99',
  'uniqueTimestamps',
  'gpuTiming',
];

const P90_LIMIT_MS = 33.33;
const P99_LIMIT_MS = 50;

export class XRBenchmarkMetrics {
  private readonly configuration: Required<XRBenchmarkConfiguration>;
  private readonly acceptanceBudgetMs: number;
  private readonly runtimeBudgetMs: number;
  private readonly intervals: number[] = [];
  private readonly gpuDurations: number[] = [];
  private firstTimestamp: number | null = null;
  private lastTimestamp: number | null = null;
  private frameCount = 0;
  private missedRuntimeFrames = 0;
  private duplicateTimestampCount = 0;
  private disjointGpuSamples = 0;

  constructor(configuration: XRBenchmarkConfiguration) {
    assertNonEmpty(configuration.caseId, 'caseId');
    assertNonEmpty(configuration.rendererVersion, 'rendererVersion');
    assertPositiveFinite(configuration.runtimeHz, 'runtimeHz');
    assertPositiveFinite(configuration.acceptanceHz, 'acceptanceHz');
    assertPositiveInteger(configuration.framebufferWidth, 'framebufferWidth');
    assertPositiveInteger(configuration.framebufferHeight, 'framebufferHeight');
    const minimumDurationMs = configuration.minimumDurationMs ?? 60_000;
    assertPositiveFinite(minimumDurationMs, 'minimumDurationMs');

    this.configuration = { ...configuration, minimumDurationMs };
    this.acceptanceBudgetMs = 1000 / configuration.acceptanceHz;
    this.runtimeBudgetMs = 1000 / configuration.runtimeHz;
  }

  recordFrame(timestamp: number): void {
    if (!Number.isFinite(timestamp)) return;
    if (this.lastTimestamp !== null) {
      const interval = timestamp - this.lastTimestamp;
      if (interval <= 0) {
        this.duplicateTimestampCount++;
        return;
      }
      this.intervals.push(interval);
      const representedRuntimeFrames = Math.max(1, Math.round(interval / this.runtimeBudgetMs));
      this.missedRuntimeFrames += Math.max(0, representedRuntimeFrames - 1);
    } else {
      this.firstTimestamp = timestamp;
    }
    this.lastTimestamp = timestamp;
    this.frameCount++;
  }

  recordGpuDuration(durationMs: number): void {
    if (!this.configuration.gpuTimerSupported) return;
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    this.gpuDurations.push(durationMs);
  }

  recordGpuDisjointSample(): void {
    if (this.configuration.gpuTimerSupported) this.disjointGpuSamples++;
  }

  report(): XRBenchmarkReport {
    const durationMs =
      this.firstTimestamp === null || this.lastTimestamp === null
        ? 0
        : Math.max(0, this.lastTimestamp - this.firstTimestamp);
    const intervalSummary = summarize(this.intervals);
    const gpuSummary = summarize(this.gpuDurations);
    const overBudgetFrames = this.intervals.filter(
      (interval) => interval > this.acceptanceBudgetMs
    ).length;
    const fps = durationMs > 0 ? (this.intervals.length * 1000) / durationMs : 0;
    const checks: Record<XRBenchmarkCheck, boolean | null> = {
      duration: durationMs >= this.configuration.minimumDurationMs ? true : null,
      averageFps: this.intervals.length ? fps >= this.configuration.acceptanceHz : null,
      p90: this.intervals.length ? intervalSummary.p90 <= P90_LIMIT_MS : null,
      p99: this.intervals.length ? intervalSummary.p99 < P99_LIMIT_MS : null,
      uniqueTimestamps: this.duplicateTimestampCount === 0,
      gpuTiming:
        !this.configuration.gpuTimerSupported || this.gpuDurations.length > 0 ? true : null,
    };
    const failed = CHECK_ORDER.filter((check) => checks[check] === false);
    const missing = CHECK_ORDER.filter((check) => checks[check] === null);

    return {
      schemaVersion: 1,
      caseId: this.configuration.caseId,
      rendererVersion: this.configuration.rendererVersion,
      runtimeHz: round(this.configuration.runtimeHz),
      acceptanceHz: round(this.configuration.acceptanceHz),
      framebuffer: {
        width: this.configuration.framebufferWidth,
        height: this.configuration.framebufferHeight,
      },
      frames: this.frameCount,
      durationSec: round(durationMs / 1000),
      fps: round(fps),
      intervalMs: intervalSummary,
      overBudget: {
        budgetMs: round(this.acceptanceBudgetMs),
        frames: overBudgetFrames,
        percent: this.intervals.length
          ? round((overBudgetFrames / this.intervals.length) * 100)
          : 0,
      },
      estimatedMissedRuntimeFrames: this.missedRuntimeFrames,
      duplicateTimestamps: this.duplicateTimestampCount,
      gpuMs: {
        supported: this.configuration.gpuTimerSupported,
        samples: this.gpuDurations.length,
        disjointSamples: this.disjointGpuSamples,
        ...gpuSummary,
      },
      verdict: {
        status: failed.length ? 'fail' : missing.length ? 'incomplete' : 'pass',
        failed,
        missing,
      },
    };
  }
}

function summarize(samples: number[]): XRBenchmarkPercentiles {
  if (!samples.length) return { min: 0, p50: 0, p90: 0, p99: 0, max: 0 };
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    min: round(sorted[0]),
    p50: round(percentile(sorted, 50)),
    p90: round(percentile(sorted, 90)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1]),
  };
}

function percentile(sorted: number[], percent: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1)
  );
  return sorted[index];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new RangeError(`${field} must not be empty`);
}

function assertPositiveFinite(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive finite number`);
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive integer`);
  }
}
