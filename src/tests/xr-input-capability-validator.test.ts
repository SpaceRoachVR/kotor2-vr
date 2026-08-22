import { describe, expect, test } from '@jest/globals';
import { SemanticXRAction } from '@/vr/runtime/XRTypes';

describe('XRInputCapabilityValidator', () => {
  test('reports required actions missing from the actual controller topology', () => {
    const { XRInputCapabilityValidator } = require('@/vr/input/XRInputCapabilityValidator') as typeof import('@/vr/input/XRInputCapabilityValidator');
    const validator = new XRInputCapabilityValidator();

    const result = validator.update([{
      hand: 'left',
      profiles: ['htc-vive'],
      targetRayMode: 'tracked-pointer',
      gamepadMapping: 'xr-standard',
      buttonCount: 2,
      axisCount: 2,
      hasGripSpace: true,
      haptics: 'none',
    }]);

    expect(result.changed).toBe(true);
    expect(result.validation.valid).toBe(false);
    expect(result.validation.missingActions).toEqual(expect.arrayContaining([
      SemanticXRAction.Turn,
      SemanticXRAction.Cancel,
      SemanticXRAction.Menu,
    ]));
  });

  test('emits a new validation only when source capabilities change', () => {
    const { XRInputCapabilityValidator } = require('@/vr/input/XRInputCapabilityValidator') as typeof import('@/vr/input/XRInputCapabilityValidator');
    const validator = new XRInputCapabilityValidator();
    const touch = [
      capability('left', 'oculus-touch-v3'),
      capability('right', 'oculus-touch-v3'),
    ] as const;

    expect(validator.update(touch).changed).toBe(true);
    expect(validator.update(touch).changed).toBe(false);
    expect(validator.update([touch[0]]).changed).toBe(true);
  });
});

function capability(hand: 'left' | 'right', profile: string) {
  return {
    hand,
    profiles: [profile],
    targetRayMode: 'tracked-pointer' as XRTargetRayMode,
    gamepadMapping: 'xr-standard',
    buttonCount: 6,
    axisCount: 4,
    hasGripSpace: true,
    haptics: 'pulse' as const,
  };
}
