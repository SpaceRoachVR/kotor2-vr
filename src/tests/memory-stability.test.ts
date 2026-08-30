import { describe, expect, test } from '@jest/globals';
import { evaluateMemoryStability } from '@/vr/MemoryStability';
import type { PerfWindowReport } from '@/vr/PerfSampler';

const memoryReport = (
  heap: number | null,
  geometries: number,
  textures: number
): PerfWindowReport => ({
  runId: 1,
  label: 'stereo-10min',
  presenting: true,
  frames: 13500,
  durationSec: 150,
  fps: 90,
  frametimeMs: { min: 8, p50: 10, p90: 11, p99: 14, max: 20 },
  cpuMs: {
    simulation: { min: 1, p50: 2, p90: 3, p99: 4, max: 5 },
    render: { min: 1, p50: 2, p90: 3, p99: 4, max: 5 },
  },
  overBudget: { budgetMs: 11.11, frames: 0, percent: 0 },
  render: { calls: 300, triangles: 50000, points: 0, lines: 0 },
  memory: { geometries, textures, programs: 10 },
  jsHeapMB: heap,
  xrCadence: null,
  compositorTelemetry: 'unavailable',
  world: null,
});

describe('memory stability', () => {
  test('passes a post-warm window that remains within ten percent and is not monotonic', () => {
    const reports = [
      memoryReport(800, 100, 200),
      memoryReport(830, 102, 205),
      memoryReport(810, 101, 202),
      memoryReport(825, 103, 206),
    ];

    const result = evaluateMemoryStability(reports);

    expect(result.status).toBe('pass');
    expect(result.heapGrowthPercent).toBe(0.31);
    expect(result.monotonicHeapGrowth).toBe(false);
  });

  test('fails sustained monotonic heap growth even before it exceeds ten percent', () => {
    const reports = [
      memoryReport(800, 100, 200),
      memoryReport(820, 101, 201),
      memoryReport(840, 102, 202),
      memoryReport(860, 103, 203),
    ];

    const result = evaluateMemoryStability(reports);

    expect(result.status).toBe('fail');
    expect(result.monotonicHeapGrowth).toBe(true);
  });

  test('fails continuing growth hidden by a small intermediate dip', () => {
    const result = evaluateMemoryStability([
      memoryReport(800, 100, 200),
      memoryReport(850, 105, 205),
      memoryReport(849, 104, 204),
      memoryReport(900, 110, 210),
    ]);

    expect(result.status).toBe('fail');
    expect(result.heapEndpointGrowthPercent).toBe(12.5);
    expect(result.heapTrendGrowthPercent).toBeGreaterThan(10);
  });

  test('is incomplete without at least four heap-bearing post-warm reports', () => {
    const result = evaluateMemoryStability([
      memoryReport(null, 100, 200),
      memoryReport(null, 100, 200),
    ]);

    expect(result.status).toBe('incomplete');
    expect(result.reason).toBe('at least four heap-bearing reports are required');
  });

  test('is incomplete until the reports cover ten minutes', () => {
    const reports = [
      memoryReport(800, 100, 200),
      memoryReport(801, 100, 200),
      memoryReport(800, 100, 200),
      memoryReport(801, 100, 200),
    ].map((report) => ({ ...report, durationSec: 30, frames: 2700 }));

    const result = evaluateMemoryStability(reports);

    expect(result.status).toBe('incomplete');
    expect(result.reason).toBe('reports must cover at least ten minutes');
  });
});
