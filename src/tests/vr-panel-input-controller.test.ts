import { describe, expect, jest, test } from '@jest/globals';
import { VRPanelInputController, VRPanelMenuController } from '@/vr/runtime/VRPanelInputController';
import { RoutedXRAction } from '@/vr/runtime/XRInputRouter';
import { SemanticXRAction } from '@/vr/runtime/XRTypes';
import * as THREE from 'three';

describe('VRPanelInputController', () => {
  test('requires release of the opening A press before the modal accepts A', () => {
    const controller = new VRPanelInputController();
    const menu = createMenu();

    expect(controller.process(menu, [action(SemanticXRAction.Use, true)])).toBe(true);
    expect(menu.triggerControllerAPress).not.toHaveBeenCalled();

    controller.process(menu, [action(SemanticXRAction.Use, false)]);
    controller.process(menu, [action(SemanticXRAction.Use, true)]);
    controller.process(menu, [action(SemanticXRAction.Use, true)]);

    expect(menu.triggerControllerAPress).toHaveBeenCalledTimes(1);
  });

  test('routes the remaining Quest face-button action to the foreground menu', () => {
    const controller = new VRPanelInputController();
    const menu = createMenu();

    controller.process(menu, []);
    controller.process(menu, [action(SemanticXRAction.Cancel, true)]);
    controller.process(menu, [action(SemanticXRAction.Cancel, false)]);

    expect(menu.triggerControllerBPress).toHaveBeenCalledTimes(1);
    expect(menu.triggerControllerXPress).not.toHaveBeenCalled();
    expect(menu.triggerControllerYPress).not.toHaveBeenCalled();
  });

  test('resets edge state when modal ownership is cancelled', () => {
    const controller = new VRPanelInputController();
    const firstMenu = createMenu();
    const secondMenu = createMenu();

    controller.process(firstMenu, []);
    controller.process(firstMenu, [action(SemanticXRAction.Use, true)]);
    expect(firstMenu.triggerControllerAPress).toHaveBeenCalledTimes(1);

    expect(controller.process(null, [action(SemanticXRAction.Use, true)])).toBe(false);
    expect(controller.process(secondMenu, [action(SemanticXRAction.Use, true)])).toBe(true);
    expect(secondMenu.triggerControllerAPress).not.toHaveBeenCalled();
  });

  test('moves the legacy pointer and clicks the pointed control on a trigger edge', () => {
    const controller = new VRPanelInputController();
    const menu = createMenu();
    const pointerPositions: Array<THREE.Vector2 | null> = [];
    let clickCount = 0;
    const pointer = {
      setPointerPosition: (position: THREE.Vector2 | null): void => {
        pointerPositions.push(position?.clone() ?? null);
      },
      activatePointer: (): boolean => {
        clickCount += 1;
        return true;
      },
    };
    const guiPosition = new THREE.Vector2(320, -120);

    controller.process(menu, [], guiPosition, pointer);
    controller.process(menu, [action(SemanticXRAction.Select, true)], guiPosition, pointer);
    controller.process(menu, [action(SemanticXRAction.Select, true)], guiPosition, pointer);

    expect(pointerPositions.at(-1)?.toArray()).toEqual([320, -120]);
    expect(clickCount).toBe(1);
    expect(menu.triggerControllerAPress).not.toHaveBeenCalled();
  });
});

function createMenu(): VRPanelMenuController {
  return {
    triggerControllerAPress: jest.fn(),
    triggerControllerBPress: jest.fn(),
    triggerControllerXPress: jest.fn(),
    triggerControllerYPress: jest.fn(),
  };
}

function action(actionName: SemanticXRAction, pressed: boolean): RoutedXRAction {
  return {
    action: actionName,
    hand: actionName === SemanticXRAction.Menu ? 'left' : 'right',
    pressed,
    touched: pressed,
    value: pressed ? 1 : 0,
    axes: null,
  };
}
