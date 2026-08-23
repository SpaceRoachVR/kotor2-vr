import { beforeEach, describe, expect, test } from '@jest/globals';
import { VRPointerHandResolver } from '@/vr/runtime/VRPointerHandResolver';
import { XRHandRole, XRInputFrame, XRWorldPose } from '@/vr/runtime/XRTypes';

function pose(x: number, tracked = true): XRWorldPose {
  return {
    position: { x, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    trackingState: tracked ? 'tracked' : 'emulated',
  } as unknown as XRWorldPose;
}

function frame(hands: Partial<Record<XRHandRole, XRWorldPose>>): XRInputFrame {
  const entries = Object.entries(hands).map(([hand, targetRayPose]) => [hand, { hand, targetRayPose }]);
  return { hands: Object.fromEntries(entries) } as unknown as XRInputFrame;
}

/** Hits whenever the ray's x matches one of the given values. */
function hitsAt(...xs: readonly number[]) {
  return (p: XRWorldPose) => (xs.includes((p.position as { x: number }).x) ? 'hit' : null);
}

describe('VRPointerHandResolver', () => {
  let resolver: VRPointerHandResolver;
  beforeEach(() => { resolver = new VRPointerHandResolver(); });

  test('either hand can own the surface', () => {
    // The reported bug: the radial took a ray from the left hand only, so
    // pointing with the right did nothing and the menu read as broken.
    expect(resolver.resolve(frame({ left: pose(1) }), hitsAt(1))?.hand).toBe('left');

    resolver.reset();
    expect(resolver.resolve(frame({ right: pose(2) }), hitsAt(2))?.hand).toBe('right');
  });

  test('a miss owns nothing', () => {
    expect(resolver.resolve(frame({ left: pose(1), right: pose(2) }), hitsAt(9))).toBeNull();
    expect(resolver.pointingHand).toBeNull();
  });

  test('the holding hand keeps the pointer while both hands hit', () => {
    // Without this, a ray resting near a wedge seam flickers between hands
    // every frame and the highlight strobes.
    const both = frame({ left: pose(1), right: pose(2) });
    resolver.resolve(frame({ left: pose(1) }), hitsAt(1));

    for (let i = 0; i < 5; i += 1) {
      expect(resolver.resolve(both, hitsAt(1, 2))?.hand).toBe('left');
    }
  });

  test('ownership transfers when the holding hand stops hitting', () => {
    resolver.resolve(frame({ left: pose(1) }), hitsAt(1));

    expect(resolver.resolve(frame({ left: pose(1), right: pose(2) }), hitsAt(2))?.hand).toBe('right');
  });

  test('untracked rays are ignored', () => {
    // A controller that has been put down still reports a stale pose.
    expect(resolver.resolve(frame({ right: pose(2, false) }), hitsAt(2))).toBeNull();
  });

  test('a hit test that throws is a miss for that hand only', () => {
    const result = resolver.resolve(frame({ left: pose(1), right: pose(2) }), (p, hand) => {
      if (hand === 'right') throw new Error('bad projection');
      return 'hit';
    });

    expect(result?.hand).toBe('left');
  });

  test('a missing frame drops ownership', () => {
    resolver.resolve(frame({ left: pose(1) }), hitsAt(1));

    expect(resolver.resolve(null, hitsAt(1))).toBeNull();
    expect(resolver.pointingHand).toBeNull();
  });

  test('the resolved hit and pose come from the owning hand', () => {
    const result = resolver.resolve(frame({ left: pose(1), right: pose(2) }), (p) => {
      const { x } = p.position as { x: number };
      return x === 1 ? { row: 3 } : null;
    });

    expect(result?.hit).toEqual({ row: 3 });
    expect((result?.pose.position as { x: number }).x).toBe(1);
  });
});
