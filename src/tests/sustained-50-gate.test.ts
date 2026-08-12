import { describe, expect, test } from '@jest/globals';
import { evaluateSustained50Gate } from '@/vr/Sustained50Gate';
import type { PerfWindowReport } from '@/vr/PerfSampler';

const passingReport = (): PerfWindowReport => ({
  runId: 1,
  label: 'stereo-walking',
  presenting: true,
  frames: 3119,
  durationSec: 60,
  fps: 51.98,
  frametimeMs: { min: 5.8, p50: 15.8, p90: 31, p99: 46.4, max: 84.5 },
  cpuMs: {
    simulation: { min: 1, p50: 2, p90: 3, p99: 4, max: 5 },
    render: { min: 1, p50: 2, p90: 3, p99: 4, max: 5 },
  },
  overBudget: { budgetMs: 20, frames: 747, percent: 23.95 },
  render: { calls: 380, triangles: 56000, points: 0, lines: 0 },
  memory: { geometries: 100, textures: 200, programs: 20 },
  jsHeapMB: 800,
  xrCadence: {
    targetHz: 72,
    budgetMs: 13.89,
    durationSec: 60,
    callbacks: {
      xr: 3119,
      browser: 0,
      withXRFrame: 3119,
      duplicateTimestamps: 0,
      estimatedMissed: 747,
      perFrameMismatches: 0,
    },
    engineUpdates: { xr: 3119, browser: 0, total: 3119 },
    renders: 3119,
    callbackIntervalMs: { min: 5.8, p50: 15.8, p90: 31, p99: 46.4, max: 84.5 },
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
    roomsVisible: 13,
    roomsTotal: 66,
    path: {
      samples: 120,
      distanceMetres: 85,
      maxDisplacementMetres: 9,
      roomsTraversed: ['101per2a', '101perbc'],
    },
  },
});

describe('sustained 50 FPS gate', () => {
  test('passes an uneven but sustained over-50 FPS window with valid cadence ownership', () => {
    const verdict = evaluateSustained50Gate({
      report: passingReport(),
      memoryStability: 'pass',
    });

    expect(verdict.status).toBe('pass');
    expect(verdict.checks).toEqual({
      minimumFps: true,
      cadenceIntegrity: true,
      walkingWindow: true,
      pathConfirmed: true,
      p90: true,
      p99: true,
      roomCulling: true,
      memoryStability: true,
    });
  });

  test('fails when average delivery or cadence ownership fails', () => {
    const report = passingReport();
    report.fps = 49.99;
    report.xrCadence!.integrity.trustworthy = false;

    const verdict = evaluateSustained50Gate({
      report,
      memoryStability: 'pass',
    });

    expect(verdict.status).toBe('fail');
    expect(verdict.failed).toEqual(['minimumFps', 'cadenceIntegrity']);
  });

  test('fails a short stationary window even when scalar timing values pass', () => {
    const report = passingReport();
    report.durationSec = 1;
    report.frames = 52;
    report.world!.path.samples = 2;
    report.world!.path.distanceMetres = 0;
    report.world!.path.maxDisplacementMetres = 0;

    const verdict = evaluateSustained50Gate({
      report,
      memoryStability: 'pass',
    });

    expect(verdict.status).toBe('fail');
    expect(verdict.failed).toEqual(expect.arrayContaining(['walkingWindow', 'pathConfirmed']));
  });
});
