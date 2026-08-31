import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import * as THREE from 'three';
import { VRPanelHost } from '@/vr/runtime/VRPanelHost';
import { resetGuiSurfaceRevisionForTests } from '@/gui/GuiSurfaceRevision';
import { XRWorldPose } from '@/vr/runtime/XRTypes';

const headPose = (): XRWorldPose => ({
  position: new THREE.Vector3(0, 0, 1.6),
  orientation: new THREE.Quaternion(),
  linearVelocity: null,
  angularVelocity: null,
  trackingState: 'tracked',
});

describe('VRPanelHost composite gating', () => {
  let host: VRPanelHost;
  let renderGui: jest.SpiedFunction<VRPanelHost['renderGui']>;
  const guiScene = new THREE.Scene();
  const guiCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 10);
  const renderer = {} as THREE.WebGLRenderer;
  const menu = { gui_resref: 'inventory' };

  const paint = (pointer: { x: number, y: number } | null = null) =>
    host.renderGuiIfChanged(renderer, guiScene, guiCamera, null, pointer);

  beforeEach(() => {
    resetGuiSurfaceRevisionForTests();
    host = new VRPanelHost(new THREE.Scene());
    renderGui = jest.spyOn(host, 'renderGui').mockImplementation(() => {});
  });

  test('composites the frame a menu opens and then stops', () => {
    host.present(menu, headPose(), 1600, 1200);
    expect(paint()).toBe(true);
    expect(paint()).toBe(false);
    expect(renderGui).toHaveBeenCalledTimes(1);
  });

  test('composites again when the pointer moves across the panel', () => {
    host.present(menu, headPose(), 1600, 1200);
    expect(paint({ x: 4, y: 4 })).toBe(true);
    expect(paint({ x: 4, y: 4 })).toBe(false);
    expect(paint({ x: 5, y: 4 })).toBe(true);
  });

  test('a reopened panel repaints rather than showing the last frame of the old one', () => {
    // clear() hides the mesh but the render target keeps its pixels. Without a
    // reset the policy would still consider this menu painted and skip.
    host.present(menu, headPose(), 1600, 1200);
    expect(paint()).toBe(true);
    expect(paint()).toBe(false);

    host.clear();
    host.present(menu, headPose(), 1600, 1200);

    expect(paint()).toBe(true);
  });

  test('a viewport change forces a composite at the new size', () => {
    host.present(menu, headPose(), 1600, 1200);
    expect(paint()).toBe(true);
    host.present(menu, headPose(), 1920, 1080);
    expect(paint()).toBe(true);
  });

  test('renderGui stays ungated for callers that composite every frame', () => {
    // The cutscene theater path drives renderGuiLayers/renderGui directly and
    // must not be throttled — its content changes every frame by definition.
    host.present(menu, headPose(), 1600, 1200);
    paint();
    host.renderGui(renderer, guiScene, guiCamera, null);
    host.renderGui(renderer, guiScene, guiCamera, null);
    expect(renderGui).toHaveBeenCalledTimes(3);
  });
});
