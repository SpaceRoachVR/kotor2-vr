import { describe, expect, jest, test } from '@jest/globals';
import { VRContextActionPanelController } from '@/vr/runtime/VRContextActionPanelController';

describe('VRContextActionPanelController', () => {
  test('owns panel input only while the interacted target still has contextual actions', () => {
    const controller = new VRContextActionPanelController(createDelegate());

    expect(controller.resolve('module-object:42', true)).toBeNull();

    controller.open('module-object:42');

    expect(controller.resolve('module-object:42', true)).toBe(controller);
    expect(controller.resolve('module-object:99', true)).toBeNull();
    expect(controller.isOpen).toBe(false);
  });

  test('closes on Back and forwards the remaining face-button actions', () => {
    const delegate = createDelegate();
    const controller = new VRContextActionPanelController(delegate);
    controller.open('module-object:42');

    controller.triggerControllerAPress();
    controller.triggerControllerXPress();
    controller.triggerControllerYPress();
    controller.triggerControllerBPress();

    expect(delegate.triggerControllerAPress).toHaveBeenCalledTimes(1);
    expect(delegate.triggerControllerXPress).toHaveBeenCalledTimes(1);
    expect(delegate.triggerControllerYPress).toHaveBeenCalledTimes(1);
    expect(delegate.triggerControllerBPress).not.toHaveBeenCalled();
    expect(controller.isOpen).toBe(false);
  });

  test('rejects malformed interaction target identifiers', () => {
    const controller = new VRContextActionPanelController(createDelegate());

    expect(() => controller.open('')).toThrow('targetId must be a non-empty string');
    expect(() => controller.resolve('  ', true)).toThrow('targetId must be a non-empty string');
  });
});

function createDelegate() {
  return {
    triggerControllerAPress: jest.fn(),
    triggerControllerBPress: jest.fn(),
    triggerControllerXPress: jest.fn(),
    triggerControllerYPress: jest.fn(),
  };
}
