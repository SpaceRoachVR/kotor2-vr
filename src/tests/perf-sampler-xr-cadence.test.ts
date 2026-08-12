import { describe, expect, test } from '@jest/globals';
import { PerfSampler } from '@/vr/PerfSampler';
import type { PerfWindowReport } from '@/vr/PerfSampler';

const createRenderer = () => ({
  xr: { isPresenting: true },
  info: {
    render: { calls: 10, triangles: 20, points: 0, lines: 0 },
    memory: { geometries: 2, textures: 3 },
    programs: [] as unknown[],
  },
});

describe('PerfSampler XR cadence integration', () => {
  test('defaults rollover to a complete one-minute walking evidence window', () => {
    let now = 1000;
    const sampler = new PerfSampler(() => now);
    sampler.attach(createRenderer() as any);
    sampler.start('stereo-walking');

    now += 1;
    sampler.tick();
    now = 31000;
    sampler.tick();
    expect(sampler.reports).toHaveLength(0);

    now = 61000;
    sampler.tick();
    expect(sampler.reports).toHaveLength(1);
    expect(sampler.reports[0].durationSec).toBe(60);
  });

  test('includes independently reconciled XR cadence in a performance report', () => {
    let now = 1000;
    const sampler = new PerfSampler(() => now);
    sampler.targetHz = 90;
    sampler.autoReportSec = 0;
    sampler.attach(createRenderer() as any);
    sampler.start('stereo-rest');

    sampler.recordXRCallback(1000, true);
    sampler.recordEngineUpdate('xr', 1000);
    sampler.recordXRRender(1000);
    sampler.tick();

    now += 1000 / 90;
    sampler.recordXRCallback(now, true);
    sampler.recordEngineUpdate('xr', now);
    sampler.recordXRRender(now);
    sampler.tick();

    const report = sampler.report();

    expect(report?.xrCadence?.callbacks.xr).toBe(2);
    expect(report?.xrCadence?.engineUpdates.total).toBe(2);
    expect(report?.xrCadence?.renders).toBe(2);
    expect(report?.xrCadence?.integrity.trustworthy).toBe(true);
    expect(report?.compositorTelemetry).toBe('unavailable');
  });

  test('reports a rogue browser-driven update during an XR window', () => {
    let now = 2000;
    const sampler = new PerfSampler(() => now);
    sampler.targetHz = 90;
    sampler.autoReportSec = 0;
    sampler.attach(createRenderer() as any);
    sampler.start('stereo-walking');

    sampler.recordXRCallback(now, true);
    sampler.recordEngineUpdate('xr', now);
    sampler.recordXRRender(now);
    sampler.recordBrowserCallback();
    sampler.recordEngineUpdate('browser', now);
    sampler.tick();
    now += 12;
    sampler.tick();

    const report = sampler.report();

    expect(report?.xrCadence?.callbacks.browser).toBe(1);
    expect(report?.xrCadence?.engineUpdates.browser).toBe(1);
    expect(report?.xrCadence?.integrity.noBrowserUpdatesDuringXR).toBe(false);
    expect(report?.xrCadence?.integrity.trustworthy).toBe(false);
  });

  test('automatic rollover reports a fully rendered XR frame before resetting', () => {
    let now = 4000;
    const sampler = new PerfSampler(() => now);
    sampler.targetHz = 90;
    sampler.autoReportSec = 0.01;
    sampler.attach(createRenderer() as any);
    sampler.start('stereo-rest');

    sampler.recordXRCallback(now, true);
    sampler.recordEngineUpdate('xr', now);
    sampler.recordXRRender(now);
    now += 12;
    sampler.tick();

    expect(sampler.reports).toHaveLength(1);
    expect(sampler.reports[0].xrCadence?.callbacks.perFrameMismatches).toBe(0);
    expect(sampler.reports[0].xrCadence?.integrity.trustworthy).toBe(true);
  });

  test('records room culling and path-confirmed movement in the sampled window', () => {
    let now = 3000;
    let position = { x: 0, y: 0, z: 0 };
    let room = '101per2a';
    const sampler = new PerfSampler(() => now);
    sampler.autoReportSec = 0;
    sampler.attach(createRenderer() as any);
    sampler.attachWorldContext(() => ({
      module: '101PER',
      position,
      room,
      roomsVisible: 13,
      roomsTotal: 66,
    }));
    sampler.start('stereo-walking');

    sampler.tick();
    now += 500;
    position = { x: 3, y: 4, z: 0 };
    room = '101perbc';
    sampler.tick();

    const report = sampler.report();

    expect(report?.world).toEqual({
      module: '101PER',
      roomsVisible: 13,
      roomsTotal: 66,
      path: {
        samples: 2,
        distanceMetres: 5,
        maxDisplacementMetres: 5,
        roomsTraversed: ['101per2a', '101perbc'],
      },
    });
  });

  test('exposes one native-90 verdict assembled from walking and memory windows', () => {
    const sampler = new PerfSampler(() => 0);
    const report = {
      runId: 1,
      label: 'stereo-walking',
      presenting: true,
      frames: 5400,
      durationSec: 60,
      fps: 90,
      frametimeMs: { min: 8, p50: 10, p90: 11, p99: 16, max: 20 },
      overBudget: { budgetMs: 11.11, frames: 100, percent: 1.85 },
      render: { calls: 10, triangles: 20, points: 0, lines: 0 },
      memory: { geometries: 20, textures: 30, programs: 4 },
      jsHeapMB: 100,
      xrCadence: {
        targetHz: 90,
        budgetMs: 11.11,
        durationSec: 60,
        callbacks: {
          xr: 5400,
          browser: 0,
          withXRFrame: 5400,
          duplicateTimestamps: 0,
          estimatedMissed: 0,
          perFrameMismatches: 0,
        },
        engineUpdates: { xr: 5400, browser: 0, total: 5400 },
        renders: 5400,
        callbackIntervalMs: { min: 10, p50: 11.11, p90: 11.11, p99: 12, max: 12 },
        integrity: {
          oneUpdatePerXRFrame: true,
          oneRenderPerXRFrame: true,
          noBrowserUpdatesDuringXR: true,
          hasXRFrameObjects: true,
          trustworthy: true,
        },
      },
      compositorTelemetry: 'unavailable',
      world: {
        module: '101PER',
        roomsVisible: 2,
        roomsTotal: 8,
        path: {
          samples: 120,
          distanceMetres: 25,
          maxDisplacementMetres: 6,
          roomsTraversed: ['a', 'b'],
        },
      },
    } satisfies PerfWindowReport;

    sampler.beginXRSession();
    sampler.reports.push(report);
    for (const heap of [100, 101, 100, 101]) {
      sampler.reports.push({
        ...report,
        label: 'stereo-10min',
        frames: 27000,
        durationSec: 300,
        jsHeapMB: heap,
      });
    }

    expect(sampler.native90Verdict(true)?.status).toBe('pass');
    expect(sampler.memoryStability().status).toBe('pass');
  });

  test('does not manufacture a native-90 verdict without a walking report', () => {
    const sampler = new PerfSampler(() => 0);
    expect(sampler.native90Verdict(true)).toBeNull();
  });

  test('does not reuse memory evidence from an earlier XR session', () => {
    const sampler = new PerfSampler(() => 0);
    const firstRun = sampler.beginXRSession();
    const base: PerfWindowReport = {
      runId: firstRun,
      label: 'stereo-10min',
      presenting: true,
      frames: 13500,
      durationSec: 150,
      fps: 90,
      frametimeMs: { min: 8, p50: 10, p90: 11, p99: 16, max: 20 },
      overBudget: { budgetMs: 11.11, frames: 0, percent: 0 },
      render: { calls: 10, triangles: 20, points: 0, lines: 0 },
      memory: { geometries: 20, textures: 30, programs: 4 },
      jsHeapMB: 100,
      xrCadence: null,
      compositorTelemetry: 'unavailable',
      world: null,
    };
    sampler.reports.push(base, { ...base }, { ...base }, { ...base });
    expect(sampler.memoryStability().status).toBe('pass');

    sampler.beginXRSession();
    expect(sampler.memoryStability().status).toBe('incomplete');
  });
});
