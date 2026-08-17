import { describe, expect, test } from '@jest/globals';
import { VRRadialMenuController, VRRadialMenuItem } from '@/vr/runtime/VRRadialMenuController';
import { RoutedXRAction } from '@/vr/runtime/XRInputRouter';
import { SemanticXRAction } from '@/vr/runtime/XRTypes';

describe('VRRadialMenuController', () => {
  test('opens while Menu is held, commits the aimed quadrant on release, and fires once', () => {
    const calls: string[] = [];
    const controller = new VRRadialMenuController();
    const items = ['east', 'north', 'west', 'south'].map((id) => ({ id, label: id, activate: () => calls.push(id) }));
    expect(controller.process(items, [action(SemanticXRAction.Menu, true)])).toBe(true);
    expect(controller.process(items, [action(SemanticXRAction.Menu, true), { ...action(SemanticXRAction.Turn, true), axes: [0, -1] as [number, number] }])).toBe(true);
    controller.process(items, [action(SemanticXRAction.Menu, false)]);
    expect(calls).toEqual(['north']);
    expect(controller.isOpen).toBe(false);
  });

  test('neutral Menu release cancels without firing a default action', () => {
    const calls: string[] = [];
    const controller = new VRRadialMenuController();
    const items = ['east', 'north', 'west', 'south'].map((id) => ({ id, label: id, activate: () => calls.push(id) }));

    controller.process(items, [action(SemanticXRAction.Menu, true)]);
    controller.process(items, [action(SemanticXRAction.Menu, false)]);

    expect(calls).toEqual([]);
    expect(controller.isOpen).toBe(false);
  });

  test('uses the dominant-hand pointer vector while Menu is held', () => {
    const calls: string[] = [];
    const controller = new VRRadialMenuController();
    const items = ['east', 'north', 'west', 'south'].map((id) => ({ id, label: id, activate: () => calls.push(id) }));

    controller.process(items, [action(SemanticXRAction.Menu, true)]);
    controller.process(items, [action(SemanticXRAction.Menu, true)], { x: 0, y: -1 });
    controller.process(items, [action(SemanticXRAction.Menu, false)]);

    expect(calls).toEqual(['north']);
  });

  test('binds to a configurable trigger action, ignoring the default Menu button', () => {
    const calls: string[] = [];
    const controller = new VRRadialMenuController(SemanticXRAction.Wrist);
    const items = ['east', 'north', 'west', 'south'].map((id) => ({ id, label: id, activate: () => calls.push(id) }));

    // Menu presses must not open a controller bound to Wrist.
    controller.process(items, [action(SemanticXRAction.Menu, true)]);
    expect(controller.isOpen).toBe(false);

    controller.process(items, [action(SemanticXRAction.Wrist, true)]);
    controller.process(items, [{ ...action(SemanticXRAction.Wrist, true), axes: null }, { ...action(SemanticXRAction.Turn, true), axes: [1, 0] as [number, number] }]);
    controller.process(items, [action(SemanticXRAction.Wrist, false)]);

    expect(calls).toEqual(['east']);
  });
});

function action(action: SemanticXRAction, pressed: boolean): RoutedXRAction {
  return { action, hand: 'right' as const, pressed, touched: pressed, value: pressed ? 1 : 0, axes: null };
}
