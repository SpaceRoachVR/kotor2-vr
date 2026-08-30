import { benchmarkCanvas, type BenchmarkHooks } from './BenchmarkUI';
import {
  createBenchmarkFrameContext,
  finalReport,
  requestBenchmarkSession,
} from './BenchmarkRun';

interface RawResources {
  program: WebGLProgram;
  vertexBuffer: WebGLBuffer;
  vertexArray: WebGLVertexArrayObject;
  projectionLocation: WebGLUniformLocation;
  viewLocation: WebGLUniformLocation;
}

export async function startRawWebXR(hooks: BenchmarkHooks): Promise<() => Promise<void>> {
  const canvas = benchmarkCanvas();
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: true,
    powerPreference: 'high-performance',
    xrCompatible: true,
  });
  if (!gl) throw new Error('WebGL2 is required for the raw WebXR benchmark');

  const resources = createRawResources(gl);
  const { session, referenceSpace } = await requestBenchmarkSession();
  let ended = false;
  try {
    await gl.makeXRCompatible();
    const layer = new XRWebGLLayer(session, gl, {
      alpha: false,
      antialias: false,
      depth: true,
      framebufferScaleFactor: 1,
    });
    await session.updateRenderState({ baseLayer: layer, depthNear: 0.05, depthFar: 100 });
    const context = createBenchmarkFrameContext({
      caseId: 'raw-webxr',
      rendererVersion: `WebGL2 ${gl.getParameter(gl.VERSION)}`,
      framebufferWidth: layer.framebufferWidth,
      framebufferHeight: layer.framebufferHeight,
      gl,
      session,
      referenceSpace,
      hooks,
    });

    const onFrame = (timestamp: number, frame: XRFrame): void => {
      if (ended) return;
      session.requestAnimationFrame(onFrame);
      context.gpuTimer.begin(context.metrics);
      renderRawFrame(gl, resources, layer, frame, referenceSpace);
      context.gpuTimer.end();
      context.finishFrame(timestamp);
    };
    const onEnd = (): void => {
      if (ended) return;
      ended = true;
      finalReport(context);
      destroyRawResources(gl, resources);
      hooks.setStatus('XR session ended. The final report is available below.');
    };
    session.addEventListener('end', onEnd, { once: true });
    session.requestAnimationFrame(onFrame);
    hooks.setStatus(
      `Measuring raw WebXR at runtime ${context.metrics.report().runtimeHz} Hz for 60 seconds…`
    );

    return async () => {
      if (!ended) await session.end();
    };
  } catch (error) {
    destroyRawResources(gl, resources);
    if (!ended) await session.end().catch((): void => undefined);
    throw error;
  }
}

function renderRawFrame(
  gl: WebGL2RenderingContext,
  resources: RawResources,
  layer: XRWebGLLayer,
  frame: XRFrame,
  referenceSpace: XRReferenceSpace
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.clearColor(0.015, 0.02, 0.035, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const pose = frame.getViewerPose(referenceSpace);
  if (!pose) return;

  gl.useProgram(resources.program);
  gl.bindVertexArray(resources.vertexArray);
  for (const view of pose.views) {
    const viewport = layer.getViewport(view);
    if (!viewport) continue;
    gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
    gl.uniformMatrix4fv(resources.projectionLocation, false, view.projectionMatrix);
    gl.uniformMatrix4fv(resources.viewLocation, false, view.transform.inverse.matrix);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
  }
  gl.bindVertexArray(null);
}

function createRawResources(gl: WebGL2RenderingContext): RawResources {
  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `#version 300 es
    in vec3 a_position;
    uniform mat4 u_projection;
    uniform mat4 u_view;
    out vec3 v_color;
    void main() {
      vec3 worldPosition = a_position + vec3(0.0, 1.5, -2.0);
      gl_Position = u_projection * u_view * vec4(worldPosition, 1.0);
      v_color = a_position + vec3(0.5);
    }`
  );
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `#version 300 es
    precision highp float;
    in vec3 v_color;
    out vec4 out_color;
    void main() { out_color = vec4(0.15 + v_color * vec3(0.2, 0.5, 0.9), 1.0); }`
  );
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to allocate raw WebXR shader program');
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'unknown link error';
    gl.deleteProgram(program);
    throw new Error(`Raw WebXR shader link failed: ${message}`);
  }

  const vertexBuffer = gl.createBuffer();
  const vertexArray = gl.createVertexArray();
  if (!vertexBuffer || !vertexArray) {
    gl.deleteProgram(program);
    if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
    if (vertexArray) gl.deleteVertexArray(vertexArray);
    throw new Error('Unable to allocate raw WebXR cube buffers');
  }
  gl.bindVertexArray(vertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, CUBE_VERTICES, gl.STATIC_DRAW);
  const positionLocation = gl.getAttribLocation(program, 'a_position');
  if (positionLocation < 0) throw new Error('Raw WebXR position attribute is unavailable');
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const projectionLocation = gl.getUniformLocation(program, 'u_projection');
  const viewLocation = gl.getUniformLocation(program, 'u_view');
  if (!projectionLocation || !viewLocation) {
    destroyRawResources(gl, { program, vertexBuffer, vertexArray } as RawResources);
    throw new Error('Raw WebXR matrix uniforms are unavailable');
  }
  return { program, vertexBuffer, vertexArray, projectionLocation, viewLocation };
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to allocate raw WebXR shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'unknown compile error';
    gl.deleteShader(shader);
    throw new Error(`Raw WebXR shader compile failed: ${message}`);
  }
  return shader;
}

function destroyRawResources(gl: WebGL2RenderingContext, resources: RawResources): void {
  gl.deleteVertexArray(resources.vertexArray);
  gl.deleteBuffer(resources.vertexBuffer);
  gl.deleteProgram(resources.program);
}

const CUBE_VERTICES = new Float32Array([
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5,
  -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5,
  0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
  -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5,
  -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5,
  -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
  0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
  0.5, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5,
  -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
  -0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
]);
