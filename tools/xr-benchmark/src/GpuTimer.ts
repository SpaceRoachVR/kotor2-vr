import type { XRBenchmarkMetrics } from '../../../src/vr/benchmark/XRBenchmarkMetrics';

interface DisjointTimerQueryExtension {
  GPU_DISJOINT_EXT: number;
  TIME_ELAPSED_EXT: number;
}

export class GpuTimer {
  readonly supported: boolean;
  private readonly extension: DisjointTimerQueryExtension | null;
  private readonly pendingQueries: WebGLQuery[] = [];
  private activeQuery: WebGLQuery | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.extension = gl.getExtension(
      'EXT_disjoint_timer_query_webgl2'
    ) as DisjointTimerQueryExtension | null;
    this.supported = this.extension !== null;
  }

  begin(metrics: XRBenchmarkMetrics): void {
    this.poll(metrics);
    if (!this.extension || this.activeQuery) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
    this.activeQuery = query;
  }

  end(): void {
    if (!this.extension || !this.activeQuery) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pendingQueries.push(this.activeQuery);
    this.activeQuery = null;
  }

  dispose(metrics: XRBenchmarkMetrics): void {
    if (this.activeQuery && this.extension) {
      this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
      this.pendingQueries.push(this.activeQuery);
      this.activeQuery = null;
    }
    this.poll(metrics);
    for (const query of this.pendingQueries) this.gl.deleteQuery(query);
    this.pendingQueries.length = 0;
  }

  private poll(metrics: XRBenchmarkMetrics): void {
    if (!this.extension || !this.pendingQueries.length) return;
    if (this.gl.getParameter(this.extension.GPU_DISJOINT_EXT)) {
      for (const query of this.pendingQueries) {
        metrics.recordGpuDisjointSample();
        this.gl.deleteQuery(query);
      }
      this.pendingQueries.length = 0;
      return;
    }

    while (this.pendingQueries.length) {
      const query = this.pendingQueries[0];
      if (!this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE)) break;
      const nanoseconds = Number(this.gl.getQueryParameter(query, this.gl.QUERY_RESULT));
      if (Number.isFinite(nanoseconds) && nanoseconds >= 0) {
        metrics.recordGpuDuration(nanoseconds / 1_000_000);
      }
      this.gl.deleteQuery(query);
      this.pendingQueries.shift();
    }
  }
}
