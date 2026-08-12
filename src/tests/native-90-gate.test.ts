import { describe, expect, test } from '@jest/globals';
import { evaluateNative90Gate } from '@/vr/Native90Gate';
import type { PerfWindowReport } from '@/vr/PerfSampler';

const passingReport = (): PerfWindowReport => ({
  runId: 1,
  label: 'stereo-walking',
  presenting: true,
  frames: 5400,
  durationSec: 60,
  fps: 90,
  frametimeMs: { min: 8, p50: 10, p90: 11.11, p99: 16.66, max: 20 },
  overBudget: { budgetMs: 11.11, frames: 270, percent: 5 },
  render: { calls: 380, triangles: 56000, points: 0, lines: 0 },
  memory: { geometries: 100, textures: 200, programs: 20 },
  jsHeapMB: 800,
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
    callbackIntervalMs: { min: 10, p50: 11.11, p90: 11.11, p99: 11.11, max: 12 },
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

describe('native 90 Hz gate', () => {
  test('passes only when timing, cadence, culling, memory, and compositor evidence pass', () => {
    const verdict = evaluateNative90Gate({
      report: passingReport(),
      memoryStability: 'pass',
      nativeCompositorEvidence: true,
    });

    expect(verdict.status).toBe('pass');
    expect(verdict.checks).toEqual({
      targetRate: true,
      cadenceIntegrity: true,
      walkingWindow: true,
      pathConfirmed: true,
      noMissedCallbacks: true,
      p90: true,
      p99: true,
      overBudget: true,
      roomCulling: true,
      memoryStability: true,
      nativeCompositor: true,
    });
  });

  test('fails when a known native-frame requirement fails', () => {
    const report = passingReport();
    report.frametimeMs.p90 = 11.12;
    report.xrCadence!.integrity.trustworthy = false;

    const verdict = evaluateNative90Gate({
      report,
      memoryStability: 'pass',
      nativeCompositorEvidence: true,
    });

    expect(verdict.status).toBe('fail');
    expect(verdict.failed).toEqual(['cadenceIntegrity', 'p90']);
  });

  test('remains incomplete when stock WebXR cannot prove compositor behavior', () => {
    const verdict = evaluateNative90Gate({
      report: passingReport(),
      memoryStability: 'pass',
      nativeCompositorEvidence: null,
    });

    expect(verdict.status).toBe('incomplete');
    expect(verdict.missing).toEqual(['nativeCompositor']);
  });

  test('fails a short stationary window even when scalar timing values pass', () => {
    const report = passingReport();
    report.durationSec = 1;
    report.frames = 90;
    report.world!.path.samples = 2;
    report.world!.path.distanceMetres = 0;
    report.world!.path.maxDisplacementMetres = 0;

    const verdict = evaluateNative90Gate({
      report,
      memoryStability: 'pass',
      nativeCompositorEvidence: true,
    });

    expect(verdict.status).toBe('fail');
    expect(verdict.failed).toEqual(expect.arrayContaining(['walkingWindow', 'pathConfirmed']));
  });
});
