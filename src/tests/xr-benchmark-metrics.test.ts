import { describe, expect, test } from '@jest/globals';
import { XRBenchmarkMetrics } from '@/vr/benchmark/XRBenchmarkMetrics';

describe('XRBenchmarkMetrics', () => {
  test('passes a complete sustained-50 callback window while reporting runtime cadence separately', () => {
    const metrics = new XRBenchmarkMetrics({
      caseId: 'raw-webxr',
      rendererVersion: 'WebGL2',
      runtimeHz: 90,
      acceptanceHz: 50,
      framebufferWidth: 4128,
      framebufferHeight: 2208,
      gpuTimerSupported: true,
      minimumDurationMs: 30,
    });

    for (const timestamp of [0, 10, 20, 30]) {
      metrics.recordFrame(timestamp);
      metrics.recordGpuDuration(4);
    }

    expect(metrics.report()).toMatchObject({
      caseId: 'raw-webxr',
      rendererVersion: 'WebGL2',
      runtimeHz: 90,
      acceptanceHz: 50,
      framebuffer: { width: 4128, height: 2208 },
      frames: 4,
      durationSec: 0.03,
      fps: 100,
      intervalMs: { min: 10, p50: 10, p90: 10, p99: 10, max: 10 },
      overBudget: { budgetMs: 20, frames: 0, percent: 0 },
      estimatedMissedRuntimeFrames: 0,
      duplicateTimestamps: 0,
      gpuMs: {
        supported: true,
        samples: 4,
        disjointSamples: 0,
        p90: 4,
      },
      verdict: { status: 'pass', failed: [], missing: [] },
    });
  });

  test('fails slow delivery and accounts for runtime frames represented by long intervals', () => {
    const metrics = new XRBenchmarkMetrics({
      caseId: 'three-r149',
      rendererVersion: '0.149.0',
      runtimeHz: 90,
      acceptanceHz: 50,
      framebufferWidth: 4128,
      framebufferHeight: 2208,
      gpuTimerSupported: true,
      minimumDurationMs: 60,
    });

    for (const timestamp of [0, 30, 60]) metrics.recordFrame(timestamp);

    const report = metrics.report();
    expect(report.estimatedMissedRuntimeFrames).toBe(4);
    expect(report.verdict.status).toBe('fail');
    expect(report.verdict.failed).toEqual(['averageFps']);
    expect(report.verdict.missing).toEqual(['gpuTiming']);
  });

  test('rejects invalid configuration and ignores invalid timing samples', () => {
    expect(
      () =>
        new XRBenchmarkMetrics({
          caseId: '',
          rendererVersion: 'WebGL2',
          runtimeHz: 90,
          acceptanceHz: 50,
          framebufferWidth: 1,
          framebufferHeight: 1,
          gpuTimerSupported: false,
        })
    ).toThrow(RangeError);

    const metrics = new XRBenchmarkMetrics({
      caseId: 'three-current',
      rendererVersion: '0.185.1',
      runtimeHz: 90,
      acceptanceHz: 50,
      framebufferWidth: 1,
      framebufferHeight: 1,
      gpuTimerSupported: true,
      minimumDurationMs: 10,
    });
    metrics.recordFrame(0);
    metrics.recordFrame(Number.NaN);
    metrics.recordFrame(0);
    metrics.recordGpuDuration(-1);
    metrics.recordGpuDisjointSample();
    metrics.recordGpuDuration(2);
    metrics.recordFrame(10);

    expect(metrics.report()).toMatchObject({
      frames: 2,
      duplicateTimestamps: 1,
      gpuMs: { supported: true, samples: 1, disjointSamples: 1 },
      verdict: { status: 'fail', failed: ['uniqueTimestamps'], missing: [] },
    });
  });

  test('remains incomplete until the configured evidence duration is reached', () => {
    const metrics = new XRBenchmarkMetrics({
      caseId: 'three-current',
      rendererVersion: '0.185.1',
      runtimeHz: 90,
      acceptanceHz: 50,
      framebufferWidth: 1,
      framebufferHeight: 1,
      gpuTimerSupported: true,
      minimumDurationMs: 60_000,
    });
    metrics.recordFrame(0);
    metrics.recordFrame(10);

    expect(metrics.report().verdict).toEqual({
      status: 'incomplete',
      failed: [],
      missing: ['duration', 'gpuTiming'],
    });
  });

  test('does not treat a rounded 60-second display value as complete evidence', () => {
    const metrics = new XRBenchmarkMetrics({
      caseId: 'raw-webxr',
      rendererVersion: 'WebGL2',
      runtimeHz: 72,
      acceptanceHz: 50,
      framebufferWidth: 1,
      framebufferHeight: 1,
      gpuTimerSupported: false,
      minimumDurationMs: 60_000,
    });
    metrics.recordFrame(0);
    metrics.recordFrame(59_999);

    expect(metrics.report()).toMatchObject({
      durationSec: 60,
      verdict: { status: 'fail', missing: ['duration'] },
    });
  });
});
