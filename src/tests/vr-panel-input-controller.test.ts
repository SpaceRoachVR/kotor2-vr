import { describe, expect, jest, test } from '@jest/globals';
import { VRPanelInputController, VRPanelMenuController } from '@/vr/runtime/VRPanelInputController';
import { RoutedXRAction } from '@/vr/runtime/XRInputRouter';
import { SemanticXRAction } from '@/vr/runtime/XRTypes';
import * as THREE from 'three';

describe('VRPanelInputController', () => {
  test('scrolls the right stick immediately, then repeats with a bounded delay', () => {
    const controller = new VRPanelInputController();
    const menu = { ...createMenu(), scrollVRList: jest.fn() };
    const scroll = (y: number): RoutedXRAction => ({
      ...action(SemanticXRAction.Scroll, false), axes: [0, y],
    });
    controller.process(menu, [], null, null, 0);
    controller.process(menu, [scroll(1)], null, null, 10);
    controller.process(menu, [scroll(1)], null, null, 359);
    expect(menu.scrollVRList.mock.calls).toEqual([['down']]);
    controller.process(menu, [scroll(1)], null, null, 360);
    controller.process(menu, [scroll(1)], null, null, 459);
    controller.process(menu, [scroll(1)], null, null, 460);
    expect(menu.scrollVRList.mock.calls).toEqual([['down'], ['down'], ['down']]);
    controller.process(menu, [scroll(-1)], null, null, 461);
    expect(menu.scrollVRList).toHaveBeenLastCalledWith('up');
    controller.process(menu, [scroll(0.2)], null, null, 2000);
    expect(menu.scrollVRList).toHaveBeenCalledTimes(4);
    controller.process(menu, [scroll(1)], null, null, 2001);
    expect(menu.scrollVRList).toHaveBeenCalledTimes(5);
  });

  test('requires neutral after an ownership change and ignores invalid or left-hand scrolling', () => {
    const controller = new VRPanelInputController();
    const first = { ...createMenu(), scrollVRList: jest.fn() };
    const second = { ...createMenu(), scrollVRList: jest.fn() };
    const scroll: RoutedXRAction = { ...action(SemanticXRAction.Scroll, false), axes: [0, 1] };
    controller.process(first, [scroll], null, null, 0);
    controller.process(first, [scroll], null, null, 1000);
    expect(first.scrollVRList).not.toHaveBeenCalled();
    controller.process(first, [], null, null, 1001);
    controller.process(first, [scroll], null, null, 1002);
    expect(first.scrollVRList).toHaveBeenCalledTimes(1);
    controller.process(second, [scroll], null, null, 1003);
    controller.process(second, [scroll], null, null, 2000);
    expect(second.scrollVRList).not.toHaveBeenCalled();
    controller.process(second, [], null, null, 2001);
    for (const invalid of [
      { ...scroll, hand: 'left' as const },
      { ...scroll, axes: [0, NaN] as const },
      { ...scroll, axes: [Infinity, 1] as const },
      { ...scroll, axes: null },
      { ...scroll, axes: [1, 0] as const },
    ]) controller.process(second, [invalid], null, null, 2002);
    controller.process(second, [scroll], null, null, NaN);
    expect(second.scrollVRList).not.toHaveBeenCalled();
    controller.process(second, [scroll], null, null, 2003);
    expect(second.scrollVRList).toHaveBeenCalledWith('down');
    controller.cancel();
    controller.process(second, [scroll], null, null, 3000);
    controller.process(second, [scroll], null, null, 4000);
    expect(second.scrollVRList).toHaveBeenCalledTimes(1);
  });

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

  test('clears the legacy pointer when dialogue ownership changes to a computer', () => {
    const controller = new VRPanelInputController();
    const dialogue = createMenu();
    const computer = createMenu();
    const pointerPositions: Array<THREE.Vector2 | null> = [];
    const pointer = {
      setPointerPosition: (position: THREE.Vector2 | null): void => {
        pointerPositions.push(position?.clone() ?? null);
      },
      activatePointer: (): boolean => true,
    };
    const pointerPosition = new THREE.Vector2(320, -120);

    controller.process(dialogue, [], pointerPosition, pointer);
    controller.process(dialogue, [], pointerPosition, pointer);
    controller.process(computer, [], pointerPosition, pointer);

    expect(pointerPositions.at(-1)).toBeNull();
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
