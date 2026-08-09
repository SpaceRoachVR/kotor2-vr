import * as THREE from "three";

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
  /** Frames over the target budget, as a count and a share of the window. */
  overBudget: { budgetMs: number; frames: number; percent: number };
  /** THREE.WebGLRenderer.info at the end of the window. */
  render: { calls: number; triangles: number; points: number; lines: number };
  memory: { geometries: number; textures: number; programs: number };
  /** V8 heap, in MB. Present in Electron/Chromium only. */
  jsHeapMB: number | null;
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

export class PerfSampler {
  /**
   * Free-text tag for the current window. Set it from DevTools before a run:
   *   VRSpike.perf.label = 'stereo-walking'
   */
  label = 'unlabelled';

  /** Target refresh. 72 for Quest over Virtual Desktop, 90 for a wired HMD. */
  targetHz = 72;

  /** Emit a report to the console every N seconds. 0 disables auto-reporting. */
  autoReportSec = 30;

  /** Every report produced this session, for a single dump at the end. */
  readonly reports: PerfWindowReport[] = [];

  private renderer: THREE.WebGLRenderer | null = null;
  private frametimes: number[] = [];
  private windowStart = 0;
  private lastFrame = 0;
  private running = false;

  attach(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
  }

  /** Discard the current window and start a fresh one. */
  start(label?: string): void {
    if (label) this.label = label;
    this.frametimes = [];
    this.windowStart = performance.now();
    this.lastFrame = this.windowStart;
    this.running = true;
    console.log(`[PerfSampler] window '${this.label}' started`);
  }

  /** Call once per frame, before rendering. */
  tick(): void {
    if (!this.running) return;
    const now = performance.now();
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
    const durationSec = (performance.now() - this.windowStart) / 1000;
    const budgetMs = 1000 / this.targetHz;
    const over = sorted.filter((t) => t > budgetMs).length;

    const info = this.renderer.info;
    const heap = (performance as any).memory?.usedJSHeapSize ?? null;

    const rpt: PerfWindowReport = {
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
    };

    this.reports.push(rpt);
    console.log(
      `[PerfSampler] ${rpt.label} | ${rpt.presenting ? 'STEREO' : 'mono'} | ` +
        `${rpt.fps} fps | p50 ${rpt.frametimeMs.p50}ms p99 ${rpt.frametimeMs.p99}ms | ` +
        `${rpt.overBudget.percent}% over ${rpt.overBudget.budgetMs}ms | ` +
        `${rpt.render.calls} calls, ${rpt.render.triangles} tris | ` +
        `heap ${rpt.jsHeapMB}MB`,
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
}
