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

  test('a pending scripted attack keeps its queue filled even under embodied VR input', () => {
    // 105PER a_bash_console: the PC is commanded to destroy the Turbolift Console.
    expect(shouldAutoQueueControlledBasicAttack({
      isControlledActor: true,
      embodiedVRInputActive: true,
      scriptedAttackPending: true,
    })).toBe(true);
    expect(shouldAutoQueueControlledBasicAttack({
      isControlledActor: true,
      embodiedVRInputActive: true,
      scriptedAttackPending: false,
    })).toBe(false);
    expect(() => shouldAutoQueueControlledBasicAttack({
      isControlledActor: true,
      embodiedVRInputActive: true,
      scriptedAttackPending: 'yes' as unknown as boolean,
    })).toThrow(TypeError);
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
