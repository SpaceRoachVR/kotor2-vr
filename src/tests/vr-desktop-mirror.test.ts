import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import {
  VRDesktopMirror,
  isMirrorFrameDue,
  readMirrorOptionsFromSearch,
  resolveSpectatorFovDegrees,
} from '@/vr/runtime/VRDesktopMirror';

function eyeProjection(horizontalDeg: number, verticalDeg: number): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  m.elements[0] = 1 / Math.tan(THREE.MathUtils.degToRad(horizontalDeg / 2));
  m.elements[5] = 1 / Math.tan(THREE.MathUtils.degToRad(verticalDeg / 2));
  return m;
}

describe('resolveSpectatorFovDegrees', () => {
  test('a 16:9 window keeps the eye horizontal field and narrows the vertical', () => {
    const fov = resolveSpectatorFovDegrees(eyeProjection(96, 100), 16 / 9);
    const horizontal = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * 16 / 9);
    expect(THREE.MathUtils.radToDeg(horizontal)).toBeCloseTo(96, 5);
    expect(fov).toBeLessThan(100);
  });

  test('a tall window is clamped to the eye vertical field', () => {
    expect(resolveSpectatorFovDegrees(eyeProjection(96, 100), 0.5)).toBeCloseTo(100, 5);
  });

  test('zoom narrows the view', () => {
    const wide = resolveSpectatorFovDegrees(eyeProjection(96, 100), 16 / 9);
    expect(resolveSpectatorFovDegrees(eyeProjection(96, 100), 16 / 9, 1.5)).toBeLessThan(wide);
  });
});

describe('readMirrorOptionsFromSearch', () => {
  test('the live mirror is on unless turned off', () => {
    expect(readMirrorOptionsFromSearch('')).toEqual({ enabled: true, eye: 'left', zoom: 1, fps: 20 });
  });

  test('reads off, right eye, zoom and fps', () => {
    expect(readMirrorOptionsFromSearch('?token=x&mirror=off&mirrorEye=right&mirrorZoom=1.25&mirrorFps=30'))
      .toEqual({ enabled: false, eye: 'right', zoom: 1.25, fps: 30 });
  });
});

describe('isMirrorFrameDue', () => {
  test('a 20 fps cap on a 72 Hz loop draws every fourth refresh, not every fifth', () => {
    const refresh = 1000 / 72;
    let last = 0;
    const drawn: number[] = [];
    for (let i = 1; i <= 72; i++) {
      if (isMirrorFrameDue(i * refresh, last, 20)) { drawn.push(i); last = i * refresh; }
    }
    expect(drawn.length).toBe(18);
    expect(drawn[1] - drawn[0]).toBe(4);
  });

  test('zero fps never draws', () => {
    expect(isMirrorFrameDue(1e9, 0, 0)).toBe(false);
  });
});

function fakeRenderer() {
  const calls: string[] = [];
  const eye = new THREE.PerspectiveCamera(100, 1, 0.05, 15000);
  eye.position.set(1, 2, 3);
  eye.updateMatrixWorld(true);
  const target = { name: 'xr-target' };
  let current: unknown = target;
  const renderer = {
    xr: { enabled: true, getCamera: () => ({ cameras: [eye, eye] }) },
    autoClear: false,
    domElement: { width: 1920, height: 1080, toDataURL: () => 'data:image/png;base64,AAAA' },
    getRenderTarget: () => current,
    setRenderTarget: (t: unknown) => { current = t; calls.push(`target ${t ? 'xr' : 'canvas'}`); },
    render: (_scene: unknown, camera: THREE.PerspectiveCamera) => {
      calls.push(`render xr=${renderer.xr.enabled} target=${current ? 'xr' : 'canvas'} clear=${renderer.autoClear} aspect=${camera.aspect.toFixed(3)} pos=${camera.position.toArray().join(',')}`);
    },
  };
  return { renderer, calls, state: () => ({ target: current, xr: renderer.xr.enabled, autoClear: renderer.autoClear }) };
}

const scene = new THREE.Scene();

describe('VRDesktopMirror.render', () => {
  test('off: no extra draw', () => {
    const { renderer, calls } = fakeRenderer();
    const off = new VRDesktopMirror();
    off.enabled = false;
    off.render(renderer as unknown as THREE.WebGLRenderer, scene, 1000);
    expect(calls).toEqual([]);
  });

  test('when on, draws once from the eye pose to the canvas and restores the XR target', () => {
    const { renderer, calls, state } = fakeRenderer();
    const mirror = new VRDesktopMirror();
    mirror.enabled = true;
    mirror.render(renderer as unknown as THREE.WebGLRenderer, scene, 1000);
    expect(calls).toContain('render xr=false target=canvas clear=true aspect=1.778 pos=1,2,3');
    expect(state()).toEqual({ target: { name: 'xr-target' }, xr: true, autoClear: false });
    expect(mirror.framesMirrored).toBe(1);
  });

  test('respects the frame cap', () => {
    const { renderer, calls } = fakeRenderer();
    const mirror = new VRDesktopMirror();
    mirror.enabled = true;
    mirror.render(renderer as unknown as THREE.WebGLRenderer, scene, 1000);
    mirror.render(renderer as unknown as THREE.WebGLRenderer, scene, 1010);
    expect(calls.filter((c) => c.startsWith('render')).length).toBe(1);
  });

  test('a screenshot draws one frame even with the mirror off', async () => {
    const { renderer, calls } = fakeRenderer();
    const mirror = new VRDesktopMirror();
    mirror.enabled = false;
    const pending = mirror.capture(1000);
    mirror.render(renderer as unknown as THREE.WebGLRenderer, scene, 1000);
    await expect(pending).resolves.toBe('data:image/png;base64,AAAA');
    expect(calls.filter((c) => c.startsWith('render')).length).toBe(1);
    mirror.render(renderer as unknown as THREE.WebGLRenderer, scene, 2000);
    expect(calls.filter((c) => c.startsWith('render')).length).toBe(1);
  });
});
