import { shouldProcessEngineFrame, XRFrameCadence } from "@/vr/XRFrameCadence";
import { describe, expect, test } from '@jest/globals';

describe('XRFrameCadence', () => {
  test('rejects stale desktop callbacks while XR owns the engine loop', () => {
    expect(shouldProcessEngineFrame('browser', true)).toBe(false);
    expect(shouldProcessEngineFrame('xr', true)).toBe(true);
    expect(shouldProcessEngineFrame('browser', false)).toBe(true);
    expect(shouldProcessEngineFrame('xr', false)).toBe(false);
  });

  test('reports one update and render for each unique XR frame', () => {
    const cadence = new XRFrameCadence(90);

    cadence.start(1000);
    for (let index = 0; index < 4; index++) {
      const timestamp = 1000 + index * (1000 / 90);
      cadence.recordXRCallback(timestamp, true);
      cadence.recordEngineUpdate('xr', timestamp);
      cadence.recordXRRender(timestamp);
    }

    const report = cadence.report(1000 + 3 * (1000 / 90));

    expect(report.callbacks).toEqual({
      xr: 4,
      browser: 0,
      withXRFrame: 4,
      duplicateTimestamps: 0,
      estimatedMissed: 0,
      perFrameMismatches: 0,
    });
    expect(report.engineUpdates).toEqual({ xr: 4, browser: 0, total: 4 });
    expect(report.renders).toBe(4);
    expect(report.integrity).toEqual({
      oneUpdatePerXRFrame: true,
      oneRenderPerXRFrame: true,
      noBrowserUpdatesDuringXR: true,
      hasXRFrameObjects: true,
      trustworthy: true,
    });
  });

  test('detects duplicate callbacks, browser updates, and unmatched work', () => {
    const cadence = new XRFrameCadence(90);

    cadence.start(2000);
    cadence.recordXRCallback(2000, true);
    cadence.recordEngineUpdate('xr', 2000);
    cadence.recordXRRender(2000);
    cadence.recordXRCallback(2000, false);
    cadence.recordEngineUpdate('xr', 2000);
    cadence.recordEngineUpdate('browser', 2000);

    const report = cadence.report(2010);

    expect(report.callbacks.duplicateTimestamps).toBe(1);
    expect(report.callbacks.perFrameMismatches).toBeGreaterThan(0);
    expect(report.engineUpdates).toEqual({ xr: 2, browser: 1, total: 3 });
    expect(report.renders).toBe(1);
    expect(report.integrity).toEqual({
      oneUpdatePerXRFrame: false,
      oneRenderPerXRFrame: false,
      noBrowserUpdatesDuringXR: false,
      hasXRFrameObjects: false,
      trustworthy: false,
    });
  });

  test('estimates missed frames from XR timestamp gaps against the runtime rate', () => {
    const cadence = new XRFrameCadence(90);

    cadence.start(0);
    cadence.recordXRCallback(0, true);
    cadence.recordEngineUpdate('xr', 0);
    cadence.recordXRRender(0);
    cadence.recordXRCallback(1000 / 90, true);
    cadence.recordEngineUpdate('xr', 1000 / 90);
    cadence.recordXRRender(1000 / 90);
    cadence.recordXRCallback(4 * (1000 / 90), true);
    cadence.recordEngineUpdate('xr', 4 * (1000 / 90));
    cadence.recordXRRender(4 * (1000 / 90));

    const report = cadence.report(4 * (1000 / 90));

    expect(report.callbacks.estimatedMissed).toBe(2);
    expect(report.runtimeReportedHz).toBe(90);
    expect(report.runtimeBudgetMs).toBe(11.11);
    expect(report.callbackIntervalMs).toEqual({
      min: 11.11,
      p50: 11.11,
      p90: 33.33,
      p99: 33.33,
      max: 33.33,
    });
  });

  test('keeps missed-frame estimates and runtime budget unavailable without a reported runtime rate', () => {
    const cadence = new XRFrameCadence(null);

    cadence.start(0);
    cadence.recordXRCallback(0, true);
    cadence.recordEngineUpdate('xr', 0);
    cadence.recordXRRender(0);
    cadence.recordXRCallback(100, true);
    cadence.recordEngineUpdate('xr', 100);
    cadence.recordXRRender(100);

    const report = cadence.report(100);

    expect(report.runtimeReportedHz).toBeNull();
    expect(report.runtimeBudgetMs).toBeNull();
    expect(report.callbacks.estimatedMissed).toBeNull();
  });

  test('does not produce a trustworthy report without XR callbacks', () => {
    const cadence = new XRFrameCadence(90);

    cadence.start(500);
    cadence.recordEngineUpdate('browser', 500);

    const report = cadence.report(600);

    expect(report.integrity.trustworthy).toBe(false);
    expect(report.callbackIntervalMs).toEqual({
      min: 0,
      p50: 0,
      p90: 0,
      p99: 0,
      max: 0,
    });
  });

  test('rejects balanced aggregate totals when work is not one-to-one per frame', () => {
    const cadence = new XRFrameCadence(90);

    cadence.start(0);
    cadence.recordXRCallback(0, true);
    cadence.recordEngineUpdate('xr', 0);
    cadence.recordEngineUpdate('xr', 0);
    cadence.recordXRRender(0);
    cadence.recordXRRender(0);
    cadence.recordXRCallback(1000 / 90, true);

    const report = cadence.report(1000 / 90);

    expect(report.engineUpdates.xr).toBe(report.callbacks.xr);
    expect(report.renders).toBe(report.callbacks.xr);
    expect(report.callbacks.perFrameMismatches).toBe(2);
    expect(report.integrity.oneUpdatePerXRFrame).toBe(false);
    expect(report.integrity.oneRenderPerXRFrame).toBe(false);
    expect(report.integrity.trustworthy).toBe(false);
  });
});
