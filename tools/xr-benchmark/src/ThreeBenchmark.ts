import type * as ThreeTypes from 'three';
import { resolveXRLayerDimensions } from '../../../src/vr/benchmark/XRLayerDimensions';
import { benchmarkCanvas, type BenchmarkHooks } from './BenchmarkUI';
import {
  createBenchmarkFrameContext,
  finalReport,
  requestBenchmarkSession,
} from './BenchmarkRun';

type ThreeNamespace = typeof ThreeTypes;

export async function startThreeBenchmark(
  THREE: ThreeNamespace,
  caseId: string,
  hooks: BenchmarkHooks
): Promise<() => Promise<void>> {
  const canvas = benchmarkCanvas();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: false,
    antialias: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.setSize(1280, 720, false);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');

  const gl = renderer.getContext();
  if (!(gl instanceof WebGL2RenderingContext)) {
    renderer.dispose();
    throw new Error('WebGL2 is required for the THREE benchmark');
  }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x040509);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 100);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({ color: 0x397fd6 });
  const cube = new THREE.Mesh(geometry, material);
  cube.position.set(0, 1.5, -2);
  scene.add(cube);

  const { session, referenceSpace } = await requestBenchmarkSession();
  let ended = false;
  try {
    renderer.xr.setReferenceSpace(referenceSpace);
    let context: ReturnType<typeof createBenchmarkFrameContext> | null = null;
    const onFrame = (timestamp: number, frame?: XRFrame): void => {
      if (ended || !frame || !context) return;
      context.gpuTimer.begin(context.metrics);
      renderer.render(scene, camera);
      context.gpuTimer.end();
      context.finishFrame(timestamp);
    };
    renderer.xr.setAnimationLoop(onFrame);
    await renderer.xr.setSession(session);
    const layer = renderer.xr.getBaseLayer();
    if (!layer) throw new Error('THREE did not create an XR base layer');
    const dimensions = resolveXRLayerDimensions(layer);
    context = createBenchmarkFrameContext({
      caseId,
      rendererVersion: `THREE r${THREE.REVISION}`,
      framebufferWidth: dimensions.width,
      framebufferHeight: dimensions.height,
      gl,
      session,
      referenceSpace,
      hooks,
    });

    const onEnd = (): void => {
      if (ended) return;
      ended = true;
      renderer.xr.setAnimationLoop(null);
      if (context) finalReport(context);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      hooks.setStatus('XR session ended. The final report is available below.');
    };
    session.addEventListener('end', onEnd, { once: true });
    hooks.setStatus(
      `Measuring THREE r${THREE.REVISION} at runtime ${context.metrics.report().runtimeHz} Hz ` +
        'for 60 seconds…'
    );

    return async () => {
      if (!ended) await session.end();
    };
  } catch (error) {
    renderer.xr.setAnimationLoop(null);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    if (!ended) await session.end().catch((): void => undefined);
    throw error;
  }
}
