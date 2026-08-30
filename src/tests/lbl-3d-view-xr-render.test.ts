import * as THREE from 'three';
import { describe, expect, jest, test } from '@jest/globals';
import { LBL_3DView } from '@/gui/LBL_3DView';

jest.mock('@/GameState', () => ({
  GameState: {
    LightManager: class {
      init(): void {}
      update(): void {}
    },
    renderer: null as THREE.WebGLRenderer | null,
  },
}));

jest.mock('@/three/odyssey', () => ({
  OdysseyModel3D: class {},
}));

describe('LBL_3DView', () => {
  test('renders character previews with the legacy camera while immersive XR is active', () => {
    const view = new LBL_3DView(128, 96);
    view.visible = true;
    const renderer = createRenderer();
    const gameStateModule = jest.requireMock('@/GameState') as {
      GameState: { renderer: THREE.WebGLRenderer | null };
    };
    gameStateModule.GameState.renderer = renderer as unknown as THREE.WebGLRenderer;

    view.render();

    expect(renderer.xrEnabledDuringRender).toEqual([false]);
    expect(renderer.camerasAtRender).toEqual([view.camera]);
    expect(renderer.targetsAtRender).toEqual([view.texture]);
    expect(renderer.currentTarget).toBeNull();
    expect(renderer.xr.enabled).toBe(true);
  });
});

function createRenderer() {
  const state = {
    xr: { enabled: true },
    currentTarget: null as THREE.WebGLRenderTarget | null,
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
      return target.setHex(0);
    },
    getClearAlpha(): number {
      return 1;
    },
    setClearColor: jest.fn(),
    clear: jest.fn(),
    render(_scene: THREE.Scene, camera: THREE.Camera): void {
      state.xrEnabledDuringRender.push(state.xr.enabled);
      state.camerasAtRender.push(camera);
      state.targetsAtRender.push(state.currentTarget);
    },
  };
  return state;
}
