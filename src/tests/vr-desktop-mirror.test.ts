import { describe, expect, test } from '@jest/globals';
import {
  VRDesktopMirror,
  readMirrorOptionsFromSearch,
  resolveMirrorSourceRect,
} from '@/vr/runtime/VRDesktopMirror';

describe('resolveMirrorSourceRect', () => {
  test('crops a near-square eye to a 16:9 window band, centred', () => {
    const rect = resolveMirrorSourceRect({ x: 0, y: 0, width: 2064, height: 2208 }, 1920, 1080)!;
    expect(rect.width).toBe(2064);
    expect(rect.height).toBe(Math.round(2064 * 9 / 16));
    expect(rect.y).toBe(Math.round((2208 - 2064 * 9 / 16) / 2));
    expect(rect.x).toBe(0);
  });

  test('keeps the right eye inside its own half', () => {
    const rect = resolveMirrorSourceRect({ x: 2064, y: 0, width: 2064, height: 2208 }, 1920, 1080)!;
    expect(rect.x).toBe(2064);
    expect(rect.x + rect.width).toBeLessThanOrEqual(4128);
  });

  test('crops width when the window is taller than the eye', () => {
    const rect = resolveMirrorSourceRect({ x: 0, y: 0, width: 2000, height: 1000 }, 1000, 1000)!;
    expect(rect).toEqual({ x: 500, y: 0, width: 1000, height: 1000 });
  });

  test('zoom crops tighter around the same centre', () => {
    const rect = resolveMirrorSourceRect({ x: 0, y: 0, width: 1600, height: 900 }, 1600, 900, 2)!;
    expect(rect).toEqual({ x: 400, y: 225, width: 800, height: 450 });
  });

  test('a zero-sized canvas (hidden window) yields no copy', () => {
    expect(resolveMirrorSourceRect({ x: 0, y: 0, width: 100, height: 100 }, 0, 0)).toBeNull();
  });
});

describe('readMirrorOptionsFromSearch', () => {
  test('defaults to the left eye, on, unzoomed', () => {
    expect(readMirrorOptionsFromSearch('')).toEqual({ enabled: true, eye: 'left', zoom: 1 });
  });

  test('reads off, right eye and zoom', () => {
    expect(readMirrorOptionsFromSearch('?token=x&mirror=off&mirrorEye=right&mirrorZoom=1.25'))
      .toEqual({ enabled: false, eye: 'right', zoom: 1.25 });
  });
});

function fakeGL() {
  const calls: string[] = [];
  let read: unknown = 'engine-read';
  let draw: unknown = 'engine-draw';
  let scissor = true;
  const gl = {
    READ_FRAMEBUFFER: 1, DRAW_FRAMEBUFFER: 2, READ_FRAMEBUFFER_BINDING: 3, DRAW_FRAMEBUFFER_BINDING: 4,
    SCISSOR_TEST: 5, COLOR_BUFFER_BIT: 6, LINEAR: 7,
    canvas: { width: 1920, height: 1080, toDataURL: () => 'data:image/png;base64,AAAA' },
    getParameter: (p: number) => (p === 3 ? read : draw),
    isEnabled: () => scissor,
    disable: () => { scissor = false; calls.push('scissor-off'); },
    enable: () => { scissor = true; calls.push('scissor-on'); },
    bindFramebuffer: (target: number, fb: unknown) => {
      if (target === 1) read = fb; else draw = fb;
      calls.push(`bind ${target === 1 ? 'read' : 'draw'} ${String(fb)}`);
    },
    blitFramebuffer: (...args: number[]) => {
      calls.push(`blit read=${String(read)} draw=${String(draw)} scissor=${scissor} ${args.slice(0, 8).join(',')}`);
    },
  };
  return { gl, calls, state: () => ({ read, draw, scissor }) };
}

const layer = { framebuffer: 'xr' as unknown as WebGLFramebuffer, framebufferWidth: 4128, framebufferHeight: 2208 };

describe('VRDesktopMirror.mirror', () => {
  test('blits the left eye from the XR framebuffer to the canvas and restores state', () => {
    const { gl, calls, state } = fakeGL();
    const mirror = new VRDesktopMirror();
    mirror.mirror(gl as unknown as WebGL2RenderingContext, layer);
    const blit = calls.find((c) => c.startsWith('blit'))!;
    expect(blit).toContain('read=xr draw=null scissor=false');
    const [sx0, , sx1, , dx0, dy0, dx1, dy1] = blit.split(' ').pop()!.split(',').map(Number);
    expect(sx0).toBe(0);
    expect(sx1).toBe(2064);
    expect([dx0, dy0, dx1, dy1]).toEqual([0, 0, 1920, 1080]);
    expect(state()).toEqual({ read: 'engine-read', draw: 'engine-draw', scissor: true });
    expect(mirror.framesMirrored).toBe(1);
  });

  test('skips the copy when the layer draws straight to the canvas (emulator)', () => {
    const { gl, calls } = fakeGL();
    const mirror = new VRDesktopMirror();
    mirror.mirror(gl as unknown as WebGL2RenderingContext, { ...layer, framebuffer: null });
    expect(calls).toEqual([]);
  });

  test('disabled mirror does nothing', () => {
    const { gl, calls } = fakeGL();
    const mirror = new VRDesktopMirror();
    mirror.enabled = false;
    mirror.mirror(gl as unknown as WebGL2RenderingContext, layer);
    expect(calls).toEqual([]);
  });

  test('capture resolves with the canvas read in the frame that drew it', async () => {
    const { gl } = fakeGL();
    const mirror = new VRDesktopMirror();
    const pending = mirror.capture(1000);
    mirror.mirror(gl as unknown as WebGL2RenderingContext, layer);
    await expect(pending).resolves.toBe('data:image/png;base64,AAAA');
  });
});
