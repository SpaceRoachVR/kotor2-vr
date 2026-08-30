import * as THREE from 'three';
import { describe, expect, jest, test } from '@jest/globals';
import { renderGuiSceneToTexture } from '@/gui/renderGuiSceneToTexture';

describe('renderGuiSceneToTexture', () => {
  test('renders with the orthographic camera while XR is disabled and restores the XR target', () => {
    const xrTarget = {} as THREE.WebGLRenderTarget;
    const guiTarget = {} as THREE.WebGLRenderTarget;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera();
    const renderer = createRenderer(xrTarget);

    renderGuiSceneToTexture(
      renderer as unknown as THREE.WebGLRenderer,
      guiTarget,
      scene,
      camera,
      new THREE.Color(0x123456),
      0,
    );

    expect(renderer.xrEnabledDuringRender).toEqual([false]);
    expect(renderer.camerasAtRender).toEqual([camera]);
    expect(renderer.targetsAtRender).toEqual([guiTarget]);
    expect(renderer.currentTarget).toBe(xrTarget);
    expect(renderer.xr.enabled).toBe(true);
    expect(renderer.clearColor.getHex()).toBe(0xabcdef);
    expect(renderer.clearAlpha).toBe(0.75);
  });

  test('restores XR and framebuffer state when the nested render throws', () => {
    const xrTarget = {} as THREE.WebGLRenderTarget;
    const renderer = createRenderer(xrTarget, new Error('render failed'));

    expect(() => renderGuiSceneToTexture(
      renderer as unknown as THREE.WebGLRenderer,
      {} as THREE.WebGLRenderTarget,
      new THREE.Scene(),
      new THREE.OrthographicCamera(),
      new THREE.Color(0),
      0,
    )).toThrow('render failed');

    expect(renderer.currentTarget).toBe(xrTarget);
    expect(renderer.xr.enabled).toBe(true);
    expect(renderer.clearColor.getHex()).toBe(0xabcdef);
    expect(renderer.clearAlpha).toBe(0.75);
  });
});

function createRenderer(previousTarget: THREE.WebGLRenderTarget, renderError?: Error) {
  const state = {
    xr: { enabled: true },
    currentTarget: previousTarget as THREE.WebGLRenderTarget | null,
    clearColor: new THREE.Color(0xabcdef),
    clearAlpha: 0.75,
    xrEnabledDuringRender: [] as boolean[],
    camerasAtRender: [] as THREE.Camera[],
    targetsAtRender: [] as Array<THREE.WebGLRenderTarget | null>,
    getRenderTarget(): THREE.WebGLRenderTarget | null {
      return state.currentTarget;
    },
    setRenderTarget(target: THREE.WebGLRenderTarget | null): void {
      state.currentTarget = target;
    },
    getClearColor(target: THREE.Color): THREE.Color {
      return target.copy(state.clearColor);
    },
    setClearColor(color: THREE.Color, alpha: number): void {
      state.clearColor.copy(color);
      state.clearAlpha = alpha;
    },
    getClearAlpha(): number {
      return state.clearAlpha;
    },
    clear: jest.fn(),
    render(_scene: THREE.Scene, camera: THREE.Camera): void {
      state.xrEnabledDuringRender.push(state.xr.enabled);
      state.camerasAtRender.push(camera);
      state.targetsAtRender.push(state.currentTarget);
      if (renderError) throw renderError;
    },
  };
  return state;
}
