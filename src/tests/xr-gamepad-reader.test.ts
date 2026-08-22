import { describe, expect, test } from '@jest/globals';
import { XRGamepadReader } from '@/vr/runtime/XRGamepadReader';

function source(overrides: Partial<XRInputSource> = {}): XRInputSource {
  return {
    handedness: 'left',
    targetRayMode: 'tracked-pointer',
    targetRaySpace: {} as XRSpace,
    gripSpace: {} as XRSpace,
    profiles: ['oculus-touch-v3'],
    gamepad: {
      axes: [0, 0, 2, Number.NaN],
      buttons: [
        { pressed: true, touched: true, value: 1.5 },
        { pressed: false, touched: false, value: Number.NaN },
      ],
      connected: true,
      id: 'Quest Touch',
      index: 0,
      mapping: 'xr-standard',
      timestamp: 1,
      vibrationActuator: null,
    } as unknown as Gamepad,
    ...overrides,
  } as XRInputSource;
}

describe('XRGamepadReader', () => {
  test('copies and clamps transient Quest controller state', () => {
    const snapshots = XRGamepadReader.read([source()]);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].hand).toBe('left');
    expect(snapshots[0].profiles).toEqual(['oculus-touch-v3']);
    expect(snapshots[0].axes).toEqual([0, 0, 1, 0]);
    expect(snapshots[0].buttons[0]).toEqual({ pressed: true, touched: true, value: 1 });
    expect(snapshots[0].buttons[1].value).toBe(0);
  });

  test('ignores unhanded and non-gamepad input sources', () => {
    expect(XRGamepadReader.read([
      source({ handedness: 'none' }),
      source({ gamepad: undefined }),
    ])).toEqual([]);
  });

  test('captures actual topology metadata without reading live button values', () => {
    const [capability] = XRGamepadReader.readCapabilities([source()]);

    expect(capability).toEqual({
      hand: 'left',
      profiles: ['oculus-touch-v3'],
      targetRayMode: 'tracked-pointer',
      gamepadMapping: 'xr-standard',
      buttonCount: 2,
      axisCount: 4,
      hasGripSpace: true,
      haptics: 'none',
    });
  });
});
