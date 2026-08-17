import { describe, expect, test } from '@jest/globals';
import { VRKeyboardInputController } from '@/vr/runtime/VRKeyboardInputController';

describe('VRKeyboardInputController', () => {
  test('sends letters, numbers, space, and backspace through the legacy key contract', () => {
    const events: Array<{ which: number; shiftKey: boolean }> = [];
    const controller = new VRKeyboardInputController();
    const sink = { onKeyDown: (event: { which: number; shiftKey: boolean }) => events.push(event) };

    controller.press('A', sink);
    controller.press('7', sink);
    controller.press('SPACE', sink);
    controller.press('BACKSPACE', sink);

    expect(events).toEqual([
      { which: 65, shiftKey: false },
      { which: 55, shiftKey: false },
      { which: 32, shiftKey: false },
      { which: 8, shiftKey: false },
    ]);
  });
});
