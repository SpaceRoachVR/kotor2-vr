import { XRBenchmarkMetrics } from '../../../src/vr/benchmark/XRBenchmarkMetrics';
import { resolveXRRuntimeRate } from '../../../src/vr/benchmark/XRRuntimeRate';
import type { BenchmarkHooks } from './BenchmarkUI';
import { GpuTimer } from './GpuTimer';

export const ACCEPTANCE_HZ = 50;
export const EVIDENCE_DURATION_MS = 60_000;

export interface BenchmarkFrameContext {
  session: XRSession;
  referenceSpace: XRReferenceSpace;
  metrics: XRBenchmarkMetrics;
  gpuTimer: GpuTimer;
  hooks: BenchmarkHooks;
  finishFrame(timestamp: number): void;
}

export interface BenchmarkSessionOptions {
  caseId: string;
  rendererVersion: string;
  framebufferWidth: number;
  framebufferHeight: number;
  gl: WebGL2RenderingContext;
  session: XRSession;
  referenceSpace: XRReferenceSpace;
  hooks: BenchmarkHooks;
}

export function createBenchmarkFrameContext(
  options: BenchmarkSessionOptions
): BenchmarkFrameContext {
  const runtimeHz = resolveXRRuntimeRate(options.session.frameRate);
  const gpuTimer = new GpuTimer(options.gl);
  const metrics = new XRBenchmarkMetrics({
    caseId: options.caseId,
    rendererVersion: options.rendererVersion,
    runtimeHz,
    acceptanceHz: ACCEPTANCE_HZ,
    framebufferWidth: options.framebufferWidth,
    framebufferHeight: options.framebufferHeight,
    gpuTimerSupported: gpuTimer.supported,
    minimumDurationMs: EVIDENCE_DURATION_MS,
  });
  let reportPublished = false;

  return {
    session: options.session,
    referenceSpace: options.referenceSpace,
    metrics,
    gpuTimer,
    hooks: options.hooks,
    finishFrame(timestamp: number): void {
      metrics.recordFrame(timestamp);
      const report = metrics.report();
      const durationComplete = !report.verdict.missing.includes('duration');
      if (!reportPublished && durationComplete) {
        reportPublished = true;
        options.hooks.publishReport(report);
        options.hooks.setStatus(
          `Measurement complete: ${report.fps} FPS, p90 ${report.intervalMs.p90} ms, ` +
            `${report.verdict.status.toUpperCase()}. You may exit VR.`
        );
      }
    },
  };
}

export async function requestBenchmarkSession(): Promise<{
  session: XRSession;
  referenceSpace: XRReferenceSpace;
}> {
  if (!navigator.xr) throw new Error('WebXR is unavailable');
  const session = await navigator.xr.requestSession('immersive-vr', {
    optionalFeatures: ['local-floor'],
  });
  try {
    let referenceSpace: XRReferenceSpace;
    try {
      referenceSpace = await session.requestReferenceSpace('local-floor');
    } catch {
      referenceSpace = await session.requestReferenceSpace('local');
    }
    return { session, referenceSpace };
  } catch (error) {
    await session.end();
    throw error;
  }
}

export function finalReport(context: BenchmarkFrameContext): void {
  context.gpuTimer.dispose(context.metrics);
  context.hooks.publishReport(context.metrics.report());
}
