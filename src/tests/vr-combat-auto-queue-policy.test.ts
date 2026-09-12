import { describe, expect, test } from '@jest/globals';
import { shouldAutoQueueControlledBasicAttack } from '@/vr/runtime/VRCombatAutoQueuePolicy';

describe('shouldAutoQueueControlledBasicAttack', () => {
  test('preserves desktop automatic combat for the controlled actor', () => {
    expect(shouldAutoQueueControlledBasicAttack({
      isControlledActor: true,
      embodiedVRInputActive: false,
    })).toBe(true);
  });

  test('requires physical VR input before scheduling the next basic attack', () => {
    expect(shouldAutoQueueControlledBasicAttack({
      isControlledActor: true,
      embodiedVRInputActive: true,
    })).toBe(false);
  });

  test('never auto-queues a non-controlled creature', () => {
    expect(shouldAutoQueueControlledBasicAttack({
      isControlledActor: false,
      embodiedVRInputActive: false,
    })).toBe(false);
  });

  test('fails closed for malformed policy data', () => {
    expect(() => shouldAutoQueueControlledBasicAttack({
      isControlledActor: true,
      embodiedVRInputActive: 'yes' as unknown as boolean,
    })).toThrow(TypeError);
  });
});
