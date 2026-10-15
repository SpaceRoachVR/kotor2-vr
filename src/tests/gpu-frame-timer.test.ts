import { describe, expect, test } from '@jest/globals';
import { GpuFrameTimer } from '@/vr/GpuFrameTimer';
import { PerfSampler } from '@/vr/PerfSampler';

/** Fake WebGL1 context exposing EXT_disjoint_timer_query. */
function makeFakeGl(options: { extension?: boolean } = {}) {
  const hasExt = options.extension !== false;
  const state = {
    disjoint: false,
    created: 0,
    deleted: 0,
    active: 0,
    begun: 0,
    available: new Set<number>(),
    elapsed: new Map<number, number>(),
  };
  const ext = {
    TIME_ELAPSED_EXT: 0x88bf,
    GPU_DISJOINT_EXT: 0x8fbb,
    QUERY_RESULT_AVAILABLE_EXT: 0x8867,
    QUERY_RESULT_EXT: 0x8866,
    createQueryEXT: () => ({ id: state.created++ }),
    deleteQueryEXT: () => { state.deleted++; },
    beginQueryEXT: () => { state.active++; state.begun++; },
    endQueryEXT: () => { state.active--; },
    getQueryObjectEXT: (q: { id: number }, pname: number) =>
      pname === 0x8867 ? state.available.has(q.id) : state.elapsed.get(q.id) ?? 0,
  };
  const gl = {
    getExtension: (name: string) => (hasExt && name === 'EXT_disjoint_timer_query' ? ext : null),
    getParameter: (pname: number) => (pname === ext.GPU_DISJOINT_EXT ? state.disjoint : 0),
  };
  return { gl: gl as unknown as WebGLRenderingContext, state };
}

describe('GpuFrameTimer', () => {
  test('missing extension: unsupported, everything is a no-op', () => {
    const { gl } = makeFakeGl({ extension: false });
    const timer = new GpuFrameTimer(gl);
    expect(timer.supported).toBe(false);
    timer.begin();
    timer.end();
    expect(timer.drain()).toEqual([]);
    expect(timer.disjointSeen).toBe(false);
  });

  test('a result that becomes available on a later poll is drained in ms', () => {
    const { gl, state } = makeFakeGl();
    const timer = new GpuFrameTimer(gl);
    expect(timer.supported).toBe(true);
    timer.begin();
    timer.end();
    state.elapsed.set(0, 4_500_000);
    expect(timer.drain()).toEqual([]); // not yet available
    state.available.add(0);
    expect(timer.drain()).toEqual([4.5]);
    expect(state.deleted).toBe(1);
    expect(timer.drain()).toEqual([]);
  });

  test('begin() polls pending queries so results do not wait for drain()', () => {
    const { gl, state } = makeFakeGl();
    const timer = new GpuFrameTimer(gl);
    timer.begin();
    timer.end();
    state.elapsed.set(0, 2_000_000);
    state.available.add(0);
    timer.begin();
    timer.end();
    expect(timer.drain()).toEqual([2]);
  });

  test('disjoint GPU: batch discarded, disjointSeen set', () => {
    const { gl, state } = makeFakeGl();
    const timer = new GpuFrameTimer(gl);
    timer.begin();
    timer.end();
    state.elapsed.set(0, 9_000_000);
    state.available.add(0);
    state.disjoint = true;
    expect(timer.drain()).toEqual([]);
    expect(timer.disjointSeen).toBe(true);
    expect(state.deleted).toBe(1);
  });

  test('begin twice without end keeps a single active query', () => {
    const { gl, state } = makeFakeGl();
    const timer = new GpuFrameTimer(gl);
    timer.begin();
    timer.begin();
    expect(state.begun).toBe(1);
    expect(state.active).toBe(1);
    timer.end();
    expect(state.active).toBe(0);
  });

  test('end without begin is a no-op', () => {
    const { gl, state } = makeFakeGl();
    const timer = new GpuFrameTimer(gl);
    timer.end();
    expect(state.active).toBe(0);
  });

  test('pending queue is capped when results never arrive', () => {
    const { gl, state } = makeFakeGl();
    const timer = new GpuFrameTimer(gl);
    for (let i = 0; i < 100; i++) {
      timer.begin();
      timer.end();
    }
    expect(state.created - state.deleted).toBeLessThanOrEqual(8);
  });
});

describe('GpuFrameTimer on WebGL2', () => {
  test('uses EXT_disjoint_timer_query_webgl2 query objects', () => {
    class FakeGl2 {
      pending = 0;
      deleted = 0;
      private n = 0;
      getExtension(name: string) {
        return name === 'EXT_disjoint_timer_query_webgl2'
          ? { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }
          : null;
      }
      getParameter() { return false; }
      createQuery() { return { id: this.n++ }; }
      deleteQuery() { this.deleted++; }
      beginQuery() {}
      endQuery() {}
      QUERY_RESULT_AVAILABLE = 3;
      QUERY_RESULT = 4;
      getQueryParameter(_q: unknown, p: number) { return p === 3 ? true : 3_000_000; }
    }
    (globalThis as any).WebGL2RenderingContext = FakeGl2;
    try {
      const gl = new FakeGl2();
      const timer = new GpuFrameTimer(gl as unknown as WebGL2RenderingContext);
      expect(timer.supported).toBe(true);
      timer.begin();
      timer.end();
      expect(timer.drain()).toEqual([3]);
      expect(gl.deleted).toBe(1);
    } finally {
      delete (globalThis as any).WebGL2RenderingContext;
    }
  });
});

describe('PerfSampler gpuMs', () => {
  const rendererWith = (gl: unknown) => ({
    getContext: () => gl,
    xr: { isPresenting: true },
    info: {
      render: { calls: 1, triangles: 2, points: 0, lines: 0 },
      memory: { geometries: 1, textures: 1 },
      programs: [] as unknown[],
    },
  });

  test('report carries percentiles of the timed submissions', () => {
    const { gl, state } = makeFakeGl();
    let now = 1000;
    const sampler = new PerfSampler(() => now);
    sampler.attach(rendererWith(gl) as any);
    sampler.start('gpu');
    for (let i = 0; i < 10; i++) {
      sampler.beginGpuTimer();
      sampler.endGpuTimer();
      state.elapsed.set(i, (i + 1) * 1e6);
      state.available.add(i);
      now += 11;
      sampler.tick();
    }
    const report = sampler.report();
    expect(report?.gpuMs?.samples).toBeGreaterThan(0);
    expect(report?.gpuMs?.disjoint).toBe(false);
    expect(report?.gpuMs?.p50).toBeGreaterThan(0);
  });

  test('gpuMs is null when the extension is missing', () => {
    const { gl } = makeFakeGl({ extension: false });
    let now = 1000;
    const sampler = new PerfSampler(() => now);
    sampler.attach(rendererWith(gl) as any);
    sampler.start('gpu');
    for (let i = 0; i < 3; i++) {
      sampler.beginGpuTimer();
      sampler.endGpuTimer();
      now += 11;
      sampler.tick();
    }
    expect(sampler.report()?.gpuMs).toBeNull();
  });

  test('no timer queries are issued outside a sampling window', () => {
    const { gl, state } = makeFakeGl();
    const sampler = new PerfSampler(() => 0);
    sampler.attach(rendererWith(gl) as any);
    sampler.beginGpuTimer();
    sampler.endGpuTimer();
    expect(state.created).toBe(0);
  });
});
