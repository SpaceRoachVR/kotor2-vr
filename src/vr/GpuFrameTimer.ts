/**
 * GPU time for one wrapped region (the world submission), measured with the
 * disjoint timer query extension. Ported from tools/xr-benchmark GpuTimer, but
 * it serves both context flavours: the engine renders through WebGL1 unless
 * `?gl=webgl2` is given, and the two APIs spell the query calls differently.
 *
 * Results arrive a few frames late, so queries are polled in `begin()` and
 * collected with `drain()`. Timer queries do not change what is drawn.
 */

/** Never hold more than this many unresolved queries. */
const MAX_PENDING_QUERIES = 8;

interface TimerQueryExtensionWebGL1 {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
  QUERY_RESULT_AVAILABLE_EXT: number;
  QUERY_RESULT_EXT: number;
  createQueryEXT(): unknown;
  deleteQueryEXT(query: unknown): void;
  beginQueryEXT(target: number, query: unknown): void;
  endQueryEXT(target: number): void;
  getQueryObjectEXT(query: unknown, pname: number): unknown;
}

interface TimerQueryExtensionWebGL2 {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

type GpuContext = WebGLRenderingContext | WebGL2RenderingContext;

export class GpuFrameTimer {
  readonly supported: boolean;
  /** True once the driver reported a disjoint event; that batch was discarded. */
  disjointSeen = false;

  private readonly gl1: TimerQueryExtensionWebGL1 | null = null;
  private readonly gl2: WebGL2RenderingContext | null = null;
  private readonly gl2Ext: TimerQueryExtensionWebGL2 | null = null;
  private readonly pending: unknown[] = [];
  private active: unknown | null = null;
  private readonly results: number[] = [];

  constructor(private readonly gl: GpuContext) {
    const isGl2 =
      typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    try {
      if (isGl2) {
        const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExtensionWebGL2 | null;
        if (ext) {
          this.gl2 = gl as WebGL2RenderingContext;
          this.gl2Ext = ext;
        }
      } else {
        this.gl1 = gl.getExtension('EXT_disjoint_timer_query') as TimerQueryExtensionWebGL1 | null;
      }
    } catch {
      // A lost context can throw; the timer is simply unavailable.
    }
    this.supported = this.gl1 !== null || this.gl2Ext !== null;
  }

  begin(): void {
    if (!this.supported) return;
    this.poll();
    if (this.active) return;
    const query = this.createQuery();
    if (!query) return;
    this.beginQuery(query);
    this.active = query;
  }

  end(): void {
    if (!this.supported || !this.active) return;
    this.endQuery();
    this.pending.push(this.active);
    this.active = null;
    while (this.pending.length > MAX_PENDING_QUERIES) {
      this.deleteQuery(this.pending.shift());
    }
  }

  /** Completed results in milliseconds; the queries are deleted. */
  drain(): number[] {
    if (!this.supported) return [];
    this.poll();
    return this.results.splice(0, this.results.length);
  }

  /**
   * Take the results already gathered by earlier `begin()` polls, without
   * polling again. Lets a per-frame caller keep the buffer small for free.
   */
  collect(): number[] {
    return this.results.splice(0, this.results.length);
  }

  private poll(): void {
    if (!this.pending.length) return;
    if (this.isDisjoint()) {
      this.disjointSeen = true;
      for (const query of this.pending) this.deleteQuery(query);
      this.pending.length = 0;
      this.results.length = 0;
      return;
    }
    while (this.pending.length) {
      const query = this.pending[0];
      if (!this.resultAvailable(query)) break;
      const nanoseconds = Number(this.resultValue(query));
      if (Number.isFinite(nanoseconds) && nanoseconds >= 0) {
        this.results.push(nanoseconds / 1e6);
      }
      this.deleteQuery(query);
      this.pending.shift();
    }
  }

  private isDisjoint(): boolean {
    const pname = this.gl1 ? this.gl1.GPU_DISJOINT_EXT : this.gl2Ext!.GPU_DISJOINT_EXT;
    return !!this.gl.getParameter(pname);
  }

  private createQuery(): unknown | null {
    return this.gl1 ? this.gl1.createQueryEXT() : this.gl2!.createQuery();
  }

  private beginQuery(query: unknown): void {
    if (this.gl1) this.gl1.beginQueryEXT(this.gl1.TIME_ELAPSED_EXT, query);
    else this.gl2!.beginQuery(this.gl2Ext!.TIME_ELAPSED_EXT, query as WebGLQuery);
  }

  private endQuery(): void {
    if (this.gl1) this.gl1.endQueryEXT(this.gl1.TIME_ELAPSED_EXT);
    else this.gl2!.endQuery(this.gl2Ext!.TIME_ELAPSED_EXT);
  }

  private deleteQuery(query: unknown): void {
    if (this.gl1) this.gl1.deleteQueryEXT(query);
    else this.gl2!.deleteQuery(query as WebGLQuery);
  }

  private resultAvailable(query: unknown): boolean {
    return this.gl1
      ? !!this.gl1.getQueryObjectEXT(query, this.gl1.QUERY_RESULT_AVAILABLE_EXT)
      : !!this.gl2!.getQueryParameter(query as WebGLQuery, this.gl2!.QUERY_RESULT_AVAILABLE);
  }

  private resultValue(query: unknown): unknown {
    return this.gl1
      ? this.gl1.getQueryObjectEXT(query, this.gl1.QUERY_RESULT_EXT)
      : this.gl2!.getQueryParameter(query as WebGLQuery, this.gl2!.QUERY_RESULT);
  }
}
