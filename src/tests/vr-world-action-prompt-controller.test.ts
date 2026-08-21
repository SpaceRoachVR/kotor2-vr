import * as THREE from 'three';
import { describe, expect, jest, test } from '@jest/globals';
import {
  VRWorldActionPromptController,
} from '@/vr/runtime/VRWorldActionPromptController';
import {
  VRWorldActionPromptModel,
  VRWorldPromptAction,
  buildVRWorldPromptPages,
} from '@/vr/runtime/VRWorldActionPromptModel';
import { RoutedXRAction } from '@/vr/runtime/XRInputRouter';
import { SemanticXRAction, XRHandRole } from '@/vr/runtime/XRTypes';

describe('VRWorldActionPromptController', () => {
  test('activates the hovered action once on either-hand Select press edge', () => {
    const controller = new VRWorldActionPromptController();
    const security = promptAction('security');
    const model = promptModel('door', [security]);

    const effects = controller.process(model, { left: 'security' }, [select('left', true)]);

    expect(effects).toContainEqual({ type: 'activate', action: security, hand: 'left' });
    expect(controller.process(model, { left: 'security' }, [select('left', true)])).toEqual([]);
    expect(controller.process(model, { left: 'security' }, [select('left', false)])).toEqual([]);
    expect(controller.process(model, { left: 'security' }, [select('left', true)]))
      .toContainEqual({ type: 'activate', action: security, hand: 'left' });
  });

  test('accepts a right-hand Select press edge independently', () => {
    const controller = new VRWorldActionPromptController();
    const use = promptAction('use');
    const model = promptModel('console', [use]);

    expect(controller.process(model, { right: 'use' }, [select('right', true)]))
      .toEqual([
        { type: 'hover-haptic', hand: 'right' },
        { type: 'activate', action: use, hand: 'right' },
      ]);
  });

  test('emits one hover haptic per hand only when that hand enters or changes entries', () => {
    const controller = new VRWorldActionPromptController();
    const model = promptModel('console', [promptAction('use'), promptAction('security')]);

    expect(controller.process(model, { left: 'use' }, [])).toEqual([
      { type: 'hover-haptic', hand: 'left' },
    ]);
    expect(controller.process(model, { left: 'use' }, [])).toEqual([]);
    expect(controller.process(model, { left: 'security', right: 'use' }, [])).toEqual([
      { type: 'hover-haptic', hand: 'left' },
      { type: 'hover-haptic', hand: 'right' },
    ]);
    expect(controller.process(model, { left: 'security', right: 'use' }, [])).toEqual([]);
  });

  test('rearms hover haptics after hover loss, model replacement, and lifecycle loss', () => {
    const controller = new VRWorldActionPromptController();
    const first = promptModel('door', [promptAction('use')]);
    const second = promptModel('console', [promptAction('use')]);

    controller.process(first, { right: 'use' }, []);
    controller.process(first, { right: null }, []);
    expect(controller.process(first, { right: 'use' }, [])).toEqual([
      { type: 'hover-haptic', hand: 'right' },
    ]);
    expect(controller.process(second, { right: 'use' }, [])).toEqual([
      { type: 'hover-haptic', hand: 'right' },
    ]);
    controller.process(null, {}, []);
    expect(controller.process(first, { right: 'use' }, [])).toEqual([
      { type: 'hover-haptic', hand: 'right' },
    ]);
  });

  test('resolves simultaneous press edges in stable left-before-right order', () => {
    const controller = new VRWorldActionPromptController();
    const model = promptModel('door', [promptAction('security'), promptAction('bash')]);

    expect(controller.process(
      model,
      { left: 'security', right: 'bash' },
      [select('right', true), select('left', true)],
    )).toEqual([
      { type: 'hover-haptic', hand: 'left' },
      { type: 'hover-haptic', hand: 'right' },
      { type: 'activate', action: model.pages[0].entries[0], hand: 'left' },
    ]);
  });

  test('revalidates the nominated action and never substitutes another action when invalid', () => {
    const controller = new VRWorldActionPromptController();
    const security = promptAction('security', false);
    const bash = promptAction('bash', true);
    const model = promptModel('door', [security, bash]);

    expect(controller.process(model, { right: 'security' }, [select('right', true)]))
      .toEqual([
        { type: 'hover-haptic', hand: 'right' },
        { type: 'negative-haptic', hand: 'right' },
      ]);
    expect(security.activate).not.toHaveBeenCalled();
    expect(bash.activate).not.toHaveBeenCalled();
  });

  test('clears hover and press state when model eligibility disappears', () => {
    const controller = new VRWorldActionPromptController();
    const model = promptModel('door', [promptAction('use')]);
    controller.process(model, { right: 'use' }, [select('right', true)]);

    expect(controller.process(null, {}, [])).toContainEqual({ type: 'closed' });
    expect(controller.presentation).toBeNull();

    expect(controller.process(model, { right: 'use' }, [select('right', true)]))
      .toContainEqual(expect.objectContaining({ type: 'activate', hand: 'right' }));
  });

  test('navigation changes four-action pages without gameplay activation', () => {
    const controller = new VRWorldActionPromptController();
    const promptActions = Array.from({ length: 5 }, (_, index) => promptAction(`action-${index}`));
    const model = promptModel('door', promptActions);

    expect(controller.process(model, { left: 'prompt:next' }, [select('left', true)]))
      .toEqual([{ type: 'hover-haptic', hand: 'left' }]);
    expect(controller.presentation?.pageIndex).toBe(1);
    expect(promptActions.every((action) => jest.mocked(action.activate).mock.calls.length === 0)).toBe(true);

    controller.process(model, { left: 'prompt:next' }, [select('left', false)]);
    expect(controller.process(model, { left: 'prompt:previous' }, [select('left', true)]))
      .toEqual([{ type: 'hover-haptic', hand: 'left' }]);
    expect(controller.presentation?.pageIndex).toBe(0);
    expect(promptActions.every((action) => jest.mocked(action.activate).mock.calls.length === 0)).toBe(true);
  });

  test('preserves page for the same model identity and resets state for a new identity', () => {
    const controller = new VRWorldActionPromptController();
    const actions = Array.from({ length: 5 }, (_, index) => promptAction(`action-${index}`));
    const original = promptModel('door', actions);

    controller.process(original, { left: 'prompt:next' }, [select('left', true)]);
    expect(controller.presentation?.pageIndex).toBe(1);

    const redraw = { ...original, name: 'Redrawn Door', pages: buildVRWorldPromptPages(actions) };
    controller.process(redraw, {}, [select('left', false)]);
    expect(controller.presentation?.pageIndex).toBe(1);

    const replacement = promptModel('console', [promptAction('use')]);
    controller.process(replacement, {}, []);
    expect(controller.presentation?.pageIndex).toBe(0);
    expect(controller.presentation?.hoveredId).toBeNull();
  });

  test('treats a malformed model page as eligibility loss instead of throwing', () => {
    const controller = new VRWorldActionPromptController();
    controller.process(promptModel('door', [promptAction('use')]), {}, []);
    const malformed = {
      id: 'door',
      name: 'door',
      anchor: new THREE.Vector3(),
      pages: [{ index: 0, entries: null }],
    } as unknown as VRWorldActionPromptModel;

    expect(controller.process(malformed, {}, [])).toEqual([{ type: 'closed' }]);
    expect(controller.presentation).toBeNull();
  });

  test.each([
    'null-pages',
    'null-entry',
    'invalid-kind',
    'duplicate-ids',
    'malformed-callables',
  ] as const)('fails closed without activation for malformed prompt structure: %s', (malformation) => {
    const controller = new VRWorldActionPromptController();
    const validModel = promptModel('door', [promptAction('use')]);
    const activate = jest.fn();
    controller.process(validModel, {}, []);
    let effects: ReturnType<VRWorldActionPromptController['process']> = [];

    expect(() => {
      effects = controller.process(
        malformedPromptModel(validModel, malformation, activate),
        { right: 'use' },
        [select('right', true)],
      );
    }).not.toThrow();
    expect(effects).toEqual([{ type: 'closed' }]);
    expect(activate).not.toHaveBeenCalled();
    expect(controller.presentation).toBeNull();
  });
});

function promptModel(id: string, actions: readonly VRWorldPromptAction[]): VRWorldActionPromptModel {
  return {
    id,
    name: id,
    anchor: new THREE.Vector3(1, 2, 1),
    pages: buildVRWorldPromptPages(actions),
  };
}

function promptAction(id: string, valid = true): VRWorldPromptAction {
  return {
    kind: 'action',
    id,
    label: id,
    icon: `icon-${id}`,
    revalidate: jest.fn(() => valid),
    activate: jest.fn(),
  };
}

function select(hand: XRHandRole, pressed: boolean): RoutedXRAction {
  return {
    action: SemanticXRAction.Select,
    hand,
    pressed,
    touched: pressed,
    value: pressed ? 1 : 0,
    axes: null,
  };
}

type PromptMalformation =
  | 'null-pages'
  | 'null-entry'
  | 'invalid-kind'
  | 'duplicate-ids'
  | 'malformed-callables';

function malformedPromptModel(
  validModel: VRWorldActionPromptModel,
  malformation: PromptMalformation,
  activate: jest.Mock,
): VRWorldActionPromptModel {
  const validAction = {
    kind: 'action',
    id: 'use',
    label: 'Use',
    revalidate: () => true,
    activate,
  };
  const malformed = malformation === 'null-pages'
    ? { ...validModel, pages: null }
    : malformation === 'null-entry'
      ? { ...validModel, pages: [{ index: 0, entries: [null] }] }
      : malformation === 'invalid-kind'
        ? { ...validModel, pages: [{ index: 0, entries: [{ ...validAction, kind: 'unsupported' }] }] }
        : malformation === 'duplicate-ids'
          ? { ...validModel, pages: [{ index: 0, entries: [validAction, { ...validAction }] }] }
          : {
              ...validModel,
              pages: [{
                index: 0,
                entries: [{ ...validAction, revalidate: 'not-callable', activate: 'not-callable' }],
              }],
            };
  return malformed as unknown as VRWorldActionPromptModel;
}
