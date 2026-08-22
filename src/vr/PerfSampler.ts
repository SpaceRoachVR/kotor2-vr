import * as THREE from "three";
import { EngineFrameSource, XRFrameCadence, XRFrameCadenceReport } from "./XRFrameCadence";
import { evaluateMemoryStability, MemoryStabilityResult } from "./MemoryStability";
import {
  evaluateSustained50Gate,
  SUSTAINED_VR_MINIMUM_FPS,
  Sustained50GateVerdict,
} from "./Sustained50Gate";
import { EMPTY_XR_RUNTIME_RATES, XRRuntimeRates } from './compatibility/XRRuntimeContracts';

/**
 * Frametime and render-load sampler for the Phase 0.1 stereo perf spike.
 *
 * This is measurement scaffolding, not part of the VR layer. It answers one
 * question: can this renderer submit two eyes at rate? It records per-frame
 * wall time plus the renderer's own draw-call and triangle counters, and
 * reports percentiles for a labelled window of time.
 *
 * Percentiles, not averages. A mean frametime hides exactly the spikes that
 * make a headset uncomfortable; 99th percentile is what the wearer feels.
 */

export interface PerfWindowReport {
  /** Monotonic identifier preventing evidence reuse across XR sessions. */
  runId: number;
  label: string;
  presenting: boolean;
  frames: number;
  durationSec: number;
  fps: number;
  frametimeMs: {
    min: number;
    p50: number;
    p90: number;
    p99: number;
    max: number;
  };
  /** Main-thread CPU time split before and inside the renderer call. */
  cpuMs: {
    simulation: PerfPercentiles;
    render: PerfPercentiles;
  };
  /** Frames over the target budget, as a count and a share of the window. */
  overBudget: { budgetMs: number; frames: number; percent: number };
  /** THREE.WebGLRenderer.info at the end of the window. */
  render: { calls: number; triangles: number; points: number; lines: number };
  memory: { geometries: number; textures: number; programs: number };
  /** V8 heap, in MB. Present in Electron/Chromium only. */
  jsHeapMB: number | null;
  /** Independent reconciliation of XR callbacks, engine updates, and renders. */
  xrCadence: XRFrameCadenceReport | null;
  /** Stock WebXR does not expose compositor reprojection telemetry. */
  compositorTelemetry: 'unavailable' | 'not-applicable';
  world: PerfWorldReport | null;
}

export interface PerfPercentiles {
  min: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
}

export interface PerfWorldSnapshot {
  module: string | null;
  position: { x: number; y: number; z: number } | null;
  room: string | null;
  roomsVisible: number;
  roomsTotal: number;
}

export interface PerfWorldReport {
  module: string | null;
  roomsVisible: number;
  roomsTotal: number;
  path: {
    samples: number;
    distanceMetres: number;
    maxDisplacementMetres: number;
    roomsTraversed: string[];
  };
}

const percentile = (sorted: number[], p: number): number => {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
};

const round = (n: number, places = 2): number => {
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
};

const summarize = (samples: number[]): PerfPercentiles => {
  if (!samples.length) return { min: 0, p50: 0, p90: 0, p99: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    min: round(sorted[0]),
    p50: round(percentile(sorted, 50)),
    p90: round(percentile(sorted, 90)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1]),
  };
};

export class PerfSampler {
  /**
   * Free-text tag for the current window. Set it from DevTools before a run:
   *   VRSpike.perf.label = 'stereo-walking'
   */
  label = 'unlabelled';

  /** User-approved continuation floor: sustained 50 FPS minimum. */
  targetHz = SUSTAINED_VR_MINIMUM_FPS;

  /** Runtime claims remain distinct from the observed callback cadence. */
  runtimeRates: XRRuntimeRates = EMPTY_XR_RUNTIME_RATES;

  /** Cadence auditing needs a finite hypothesis even when the runtime omits frameRate. */
  get xrRuntimeHz(): number {
    return this.runtimeRates.runtimeReportedHz ?? this.targetHz;
  }

  set xrRuntimeHz(value: number) {
    this.runtimeRates = {
      ...this.runtimeRates,
      runtimeReportedHz: Number.isFinite(value) && value > 0 ? value : null,
    };
  }

  /** Emit a report to the console every N seconds. 0 disables auto-reporting. */
  autoReportSec = 60;

  /** Every report produced this session, for a single dump at the end. */
  readonly reports: PerfWindowReport[] = [];

  private renderer: THREE.WebGLRenderer | null = null;
  private frametimes: number[] = [];
  private simulationCpuTimes: number[] = [];
  private renderCpuTimes: number[] = [];
  private windowStart = 0;
  private lastFrame = 0;
  private running = false;
  private cadence: XRFrameCadence | null = null;
  private worldContext: (() => PerfWorldSnapshot) | null = null;
  private worldSamples: Array<{
    position: { x: number; y: number; z: number };
    room: string | null;
  }> = [];
  private lastWorldSample = Number.NEGATIVE_INFINITY;
  private currentRunId = 0;
  private firstXRCallbackTimestamp: number | null = null;
  private lastXRCallbackTimestamp: number | null = null;
  private xrCallbackCount = 0;

  constructor(private readonly now: () => number = () => performance.now()) {}

  attach(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
  }

  attachWorldContext(provider: () => PerfWorldSnapshot): void {
    this.worldContext = provider;
  }

  /** Begin a distinct headset evidence run without discarding historical reports. */
  beginXRSession(): number {
    this.currentRunId++;
    return this.currentRunId;
  }

  /** Discard the current window and start a fresh one. */
  start(label?: string): void {
    if (label) this.label = label;
    this.frametimes = [];
    this.simulationCpuTimes = [];
    this.renderCpuTimes = [];
    this.windowStart = this.now();
    this.lastFrame = this.windowStart;
    this.cadence = new XRFrameCadence(this.xrRuntimeHz);
    this.cadence.start(this.windowStart);
    this.worldSamples = [];
    this.lastWorldSample = Number.NEGATIVE_INFINITY;
    this.firstXRCallbackTimestamp = null;
    this.lastXRCallbackTimestamp = null;
    this.xrCallbackCount = 0;
    this.runtimeRates = { ...this.runtimeRates, observedCallbackHz: null };
    this.running = true;
    console.log(`[PerfSampler] window '${this.label}' started`);
  }

  recordXRCallback(timestamp: number, hasXRFrame: boolean): void {
    if (!this.running) return;
    this.cadence?.recordXRCallback(timestamp, hasXRFrame);
    if (!hasXRFrame || !Number.isFinite(timestamp)) return;
    if (this.firstXRCallbackTimestamp === null) this.firstXRCallbackTimestamp = timestamp;
    this.lastXRCallbackTimestamp = timestamp;
    this.xrCallbackCount += 1;
    const elapsed = this.lastXRCallbackTimestamp - this.firstXRCallbackTimestamp;
    if (elapsed > 0 && this.xrCallbackCount > 1) {
      this.runtimeRates = {
        ...this.runtimeRates,
        observedCallbackHz: round(((this.xrCallbackCount - 1) * 1000) / elapsed),
      };
    }
  }

  recordBrowserCallback(): void {
    if (!this.running) return;
    this.cadence?.recordBrowserCallback();
  }

  recordEngineUpdate(source: EngineFrameSource, timestamp: number): void {
    if (!this.running) return;
    this.cadence?.recordEngineUpdate(source, timestamp);
  }

  recordXRRender(timestamp: number): void {
    if (!this.running) return;
    this.cadence?.recordXRRender(timestamp);
  }

  /** Record paired main-thread timings for one completed engine frame. */
  recordCpuFrame(simulationMs: number, renderMs: number): void {
    if (!this.running) return;
    if (!Number.isFinite(simulationMs) || simulationMs < 0) return;
    if (!Number.isFinite(renderMs) || renderMs < 0) return;
    this.simulationCpuTimes.push(simulationMs);
    this.renderCpuTimes.push(renderMs);
  }

  /** Call once per frame, before rendering. */
  tick(): void {
    if (!this.running) return;
    const now = this.now();
    this.sampleWorld(now);
    const dt = now - this.lastFrame;
    this.lastFrame = now;

    // Drop the first frame of a window and any frame longer than a second —
    // those are load hitches and alt-tabs, not render cost.
    if (this.frametimes.length || dt < 1000) {
      if (dt > 0 && dt < 1000) this.frametimes.push(dt);
    }

    if (this.autoReportSec > 0 && now - this.windowStart >= this.autoReportSec * 1000) {
      this.report();
      this.start();
    }
  }

  /** Close the current window, log a report, and return it. */
  report(): PerfWindowReport | null {
    if (!this.renderer || !this.frametimes.length) {
      console.warn('[PerfSampler] nothing sampled yet');
      return null;
    }

    const sorted = [...this.frametimes].sort((a, b) => a - b);
    const reportTimestamp = this.now();
    const durationSec = (reportTimestamp - this.windowStart) / 1000;
    const budgetMs = 1000 / this.targetHz;
    const over = sorted.filter((t) => t > budgetMs).length;

    const info = this.renderer.info;
    const heap = (performance as any).memory?.usedJSHeapSize ?? null;
    const world = this.buildWorldReport();

    const rpt: PerfWindowReport = {
      runId: this.currentRunId,
      label: this.label,
      presenting: !!this.renderer.xr?.isPresenting,
      frames: sorted.length,
      durationSec: round(durationSec),
      fps: round(sorted.length / durationSec),
      frametimeMs: {
        min: round(sorted[0]),
        p50: round(percentile(sorted, 50)),
        p90: round(percentile(sorted, 90)),
        p99: round(percentile(sorted, 99)),
        max: round(sorted[sorted.length - 1]),
      },
      cpuMs: {
        simulation: summarize(this.simulationCpuTimes),
        render: summarize(this.renderCpuTimes),
      },
      overBudget: {
        budgetMs: round(budgetMs),
        frames: over,
        percent: round((over / sorted.length) * 100),
      },
      render: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        points: info.render.points,
        lines: info.render.lines,
      },
      memory: {
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
      },
      jsHeapMB: heap === null ? null : round(heap / 1048576, 1),
      xrCadence: this.renderer.xr?.isPresenting && this.cadence
        ? this.cadence.report(reportTimestamp)
        : null,
      compositorTelemetry: this.renderer.xr?.isPresenting ? 'unavailable' : 'not-applicable',
      world,
    };

    this.reports.push(rpt);
    console.log(
      `[PerfSampler] ${rpt.label} | ${rpt.presenting ? 'STEREO' : 'mono'} | ` +
        `${rpt.fps} fps | p50 ${rpt.frametimeMs.p50}ms p90 ${rpt.frametimeMs.p90}ms ` +
        `p99 ${rpt.frametimeMs.p99}ms | ` +
        `CPU p90 sim ${rpt.cpuMs.simulation.p90}ms render ${rpt.cpuMs.render.p90}ms | ` +
        `${rpt.overBudget.percent}% over ${rpt.overBudget.budgetMs}ms | ` +
        `${rpt.render.calls} calls, ${rpt.render.triangles} tris | ` +
        `heap ${rpt.jsHeapMB}MB | ` +
        `cadence ${rpt.xrCadence?.integrity.trustworthy ? 'trustworthy' : 'not proven'}`,
      rpt
    );
    return rpt;
  }

  stop(): PerfWindowReport | null {
    const rpt = this.report();
    this.running = false;
    return rpt;
  }

  /** Everything recorded this session, as JSON, for pasting into the roadmap. */
  dump(): string {
    const json = JSON.stringify(this.reports, null, 2);
    console.log(json);
    return json;
  }

  /** Evaluate the labelled post-warm memory windows captured this session. */
  memoryStability(label = 'stereo-10min'): MemoryStabilityResult {
    return evaluateMemoryStability(
      this.reports.filter(
        (report) => report.runId === this.currentRunId && report.label === label
      )
    );
  }

  /**
   * Assemble the locked continuation-gate verdict from this session's latest
   * walking window, post-warm memory windows, and separately observed
   * compositor evidence. Returns null until a walking report exists.
   */
  sustained50Verdict(): Sustained50GateVerdict | null {
    const walkingReport = [...this.reports]
      .reverse()
      .find(
        (report) => report.runId === this.currentRunId && report.label === 'stereo-walking'
      );
    if (!walkingReport) return null;

    return evaluateSustained50Gate({
      report: walkingReport,
      memoryStability: this.memoryStability().status,
    });
  }

  private sampleWorld(timestamp: number): void {
    if (!this.worldContext || timestamp - this.lastWorldSample < 500) return;
    const snapshot = this.worldContext();
    if (!snapshot.position) return;
    const { x, y, z } = snapshot.position;
    if (![x, y, z].every(Number.isFinite)) return;

    this.worldSamples.push({ position: { x, y, z }, room: snapshot.room });
    this.lastWorldSample = timestamp;
  }

  private buildWorldReport(): PerfWorldReport | null {
    if (!this.worldContext) return null;
    const snapshot = this.worldContext();
    let distanceMetres = 0;
    let maxDisplacementMetres = 0;
    const roomsTraversed: string[] = [];
    const first = this.worldSamples[0]?.position;

    for (let index = 0; index < this.worldSamples.length; index++) {
      const sample = this.worldSamples[index];
      if (sample.room && !roomsTraversed.includes(sample.room)) roomsTraversed.push(sample.room);
      if (index > 0) distanceMetres += distance(sample.position, this.worldSamples[index - 1].position);
      if (first) maxDisplacementMetres = Math.max(maxDisplacementMetres, distance(sample.position, first));
    }

    return {
      module: snapshot.module,
      roomsVisible: snapshot.roomsVisible,
      roomsTotal: snapshot.roomsTotal,
      path: {
        samples: this.worldSamples.length,
        distanceMetres: round(distanceMetres),
        maxDisplacementMetres: round(maxDisplacementMetres),
        roomsTraversed,
      },
    };
  }
}

const distance = (
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number }
): number => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
