import { beforeEach, describe, expect, test } from '@jest/globals';
import {
  VRPanelRepaintPolicy,
  VRPanelRepaintSignals,
} from '@/vr/runtime/VRPanelRepaintPolicy';
import {
  getGuiSurfaceRevision,
  markGuiSurfaceRepainted,
  resetGuiSurfaceRevisionForTests,
} from '@/gui/GuiSurfaceRevision';

const signals = (overrides: Partial<VRPanelRepaintSignals> = {}): VRPanelRepaintSignals => ({
  owner: MENU,
  pointerX: null,
  pointerY: null,
  viewportWidth: 1600,
  viewportHeight: 1200,
  surfaceRevision: 0,
  nowMs: 0,
  ...overrides,
});

const MENU = { name: 'a menu' };
const OTHER_MENU = { name: 'another menu' };

describe('VR panel repaint policy', () => {
  let policy: VRPanelRepaintPolicy;

  beforeEach(() => {
    policy = new VRPanelRepaintPolicy(100);
    resetGuiSurfaceRevisionForTests();
  });

  test('always paints the first frame it is asked about', () => {
    expect(policy.shouldRepaint(signals())).toBe(true);
  });

  test('skips a frame where nothing observable changed', () => {
    policy.shouldRepaint(signals());
    expect(policy.shouldRepaint(signals({ nowMs: 14 }))).toBe(false);
    expect(policy.shouldRepaint(signals({ nowMs: 28 }))).toBe(false);
  });

  test('paints when the pointer moves, which is what drives hover highlighting', () => {
    policy.shouldRepaint(signals({ pointerX: 10, pointerY: 10 }));
    expect(policy.shouldRepaint(signals({ nowMs: 14, pointerX: 11, pointerY: 10 }))).toBe(true);
    expect(policy.shouldRepaint(signals({ nowMs: 28, pointerX: 11, pointerY: 10 }))).toBe(false);
  });

  test('paints when the ray leaves the panel, so the hover state clears', () => {
    policy.shouldRepaint(signals({ pointerX: 10, pointerY: 10 }));
    expect(policy.shouldRepaint(signals({ nowMs: 14, pointerX: null, pointerY: null }))).toBe(true);
  });

  test('paints when a different menu takes the panel', () => {
    policy.shouldRepaint(signals());
    expect(policy.shouldRepaint(signals({ nowMs: 14, owner: OTHER_MENU }))).toBe(true);
  });

  test('paints when the viewport is resized', () => {
    policy.shouldRepaint(signals());
    expect(policy.shouldRepaint(signals({ nowMs: 14, viewportWidth: 1920 }))).toBe(true);
  });

  test('paints every frame an animated GUI surface repainted itself', () => {
    // The main menu's rotating model and character creation both go through
    // renderGuiSceneToTexture every engine frame. Gating them would freeze the
    // model, which is the failure this signal exists to prevent.
    policy.shouldRepaint(signals({ surfaceRevision: 1 }));
    expect(policy.shouldRepaint(signals({ nowMs: 14, surfaceRevision: 2 }))).toBe(true);
    expect(policy.shouldRepaint(signals({ nowMs: 28, surfaceRevision: 3 }))).toBe(true);
    expect(policy.shouldRepaint(signals({ nowMs: 42, surfaceRevision: 3 }))).toBe(false);
  });

  test('repaints on the staleness floor when no signal covers a change', () => {
    // Menu state can change with nothing here to see it — a timer-driven text
    // field, a health bar. The floor bounds how long that can go unseen.
    policy.shouldRepaint(signals());
    expect(policy.shouldRepaint(signals({ nowMs: 99 }))).toBe(false);
    expect(policy.shouldRepaint(signals({ nowMs: 100 }))).toBe(true);
  });

  test('drops most repaints at 72 Hz on a static menu', () => {
    let painted = 0;
    for(let frame = 0; frame < 72; frame++){
      if(policy.shouldRepaint(signals({ nowMs: frame * (1000 / 72) }))) painted++;
    }
    // 72 frames span 986 ms, so the 100 ms floor fires 9 times counting frame
    // zero — 9 composites where there were 72, an 87% reduction.
    expect(painted).toBe(9);
  });

  test('reset makes the next frame paint unconditionally', () => {
    policy.shouldRepaint(signals());
    expect(policy.shouldRepaint(signals({ nowMs: 14 }))).toBe(false);
    policy.reset();
    expect(policy.shouldRepaint(signals({ nowMs: 14 }))).toBe(true);
  });

  test('rejects a nonsensical staleness floor', () => {
    expect(() => new VRPanelRepaintPolicy(0)).toThrow(RangeError);
    expect(() => new VRPanelRepaintPolicy(-1)).toThrow(RangeError);
    expect(() => new VRPanelRepaintPolicy(Number.NaN)).toThrow(RangeError);
  });
});

describe('GUI surface revision', () => {
  beforeEach(() => resetGuiSurfaceRevisionForTests());

  test('advances once per offscreen GUI repaint', () => {
    const before = getGuiSurfaceRevision();
    markGuiSurfaceRepainted();
    markGuiSurfaceRepainted();
    expect(getGuiSurfaceRevision()).toBe(before + 2);
  });
});
