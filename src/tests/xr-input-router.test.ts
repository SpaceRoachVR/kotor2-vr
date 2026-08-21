import { describe, expect, test } from '@jest/globals';
import {
  BUILT_IN_XR_PROFILES,
  SemanticXRBinding,
  XRControllerSnapshot,
  XRActionContext,
  XRInputBindingProfile,
  XRInputRouter,
} from '@/vr/runtime/XRInputRouter';
import { SemanticXRAction, XRButtonState } from '@/vr/runtime/XRTypes';

const RELEASED_BUTTON: XRButtonState = { pressed: false, touched: false, value: 0 };

function questController(
  hand: 'left' | 'right',
  axes: readonly number[] = [0, 0, 0, 0]
): XRControllerSnapshot {
  return {
    hand,
    profiles: ['oculus-touch-v3'],
    buttons: Array.from({ length: 6 }, () => RELEASED_BUTTON),
    axes,
  };
}

describe('XRInputRouter', () => {
  test('routes Quest off-hand movement and dominant-hand turning', () => {
    const router = new XRInputRouter();
    const actions = router.route(
      [
        questController('left', [0, 0, 0.25, -0.75]),
        questController('right', [0, 0, -0.5, 0.1]),
      ],
      new Set(['locomotion'])
    );

    const move = actions.find((action) => action.action === SemanticXRAction.Move);
    const turn = actions.find((action) => action.action === SemanticXRAction.Turn);
    expect(move?.hand).toBe('left');
    expect(move?.axes).toEqual([0.25, -0.75]);
    expect(turn?.hand).toBe('right');
    expect(turn?.axes).toEqual([-0.5, 0.1]);
  });

  test('routes the dominant trigger as select in gameplay for world interactions', () => {
    const router = new XRInputRouter();
    const baseController = questController('right');
    const controller: XRControllerSnapshot = {
      ...baseController,
      buttons: [
        { pressed: true, touched: true, value: 1 },
        ...baseController.buttons.slice(1),
      ],
    };

    const actions = router.route([controller], new Set(['gameplay']));

    expect(actions).toContainEqual(expect.objectContaining({
      action: SemanticXRAction.Select,
      hand: 'right',
      pressed: true,
    }));
  });

  test('routes Quest left X as Menu and no longer emits Wrist', () => {
    const left = questController('left');
    const buttons = [...left.buttons];
    buttons[4] = { pressed: true, touched: true, value: 1 };

    const actions = new XRInputRouter().route([{ ...left, buttons }], new Set(['global']));

    expect(actions).toContainEqual(expect.objectContaining({
      action: SemanticXRAction.Menu,
      hand: 'left',
      pressed: true,
    }));
    expect(actions.some((action) => String(action.action) === 'wrist')).toBe(false);
  });

  test('routes only the Quest left trigger as Select in the radial-wheel context', () => {
    const controllers = (['left', 'right'] as const).map((hand) => {
      const controller = questController(hand);
      const buttons = [...controller.buttons];
      buttons[0] = { pressed: true, touched: true, value: 1 };
      return { ...controller, buttons };
    });

    const actions = new XRInputRouter().route(
      controllers,
      new Set(['radial-wheel' as XRActionContext]),
    );

    expect(actions.filter((action) => action.action === SemanticXRAction.Select)).toEqual([
      expect.objectContaining({ hand: 'left', pressed: true }),
    ]);
  });

  test('routes either Quest trigger as Select only in the world-prompt context', () => {
    const controllers = (['left', 'right'] as const).map((hand) => {
      const controller = questController(hand);
      const buttons = [...controller.buttons];
      buttons[0] = { pressed: true, touched: true, value: 1 };
      return { ...controller, buttons };
    });

    const actions = new XRInputRouter().route(
      controllers,
      new Set(['world-prompt' as XRActionContext]),
    );

    expect(actions.filter((action) => action.action === SemanticXRAction.Select)).toEqual([
      expect.objectContaining({ hand: 'left', pressed: true }),
      expect.objectContaining({ hand: 'right', pressed: true }),
    ]);
  });

  test('swaps dominant and off-hand semantic actions for left-handed play', () => {
    const router = new XRInputRouter(BUILT_IN_XR_PROFILES, { dominantHand: 'left' });
    const actions = router.route(
      [questController('left'), questController('right')],
      new Set(['locomotion'])
    );

    expect(actions.find((action) => action.action === SemanticXRAction.Move)?.hand).toBe('right');
    expect(actions.find((action) => action.action === SemanticXRAction.Turn)?.hand).toBe('left');
  });

  test('uses the first supported WebXR interaction profile', () => {
    const router = new XRInputRouter();

    expect(router.findProfile(['unknown-controller', 'valve-index'])?.id).toBe('valve-index');
    expect(router.findProfile(['unknown-controller'])).toBeNull();
  });

  test('rejects missing required actions', () => {
    const invalid: XRInputBindingProfile = {
      id: 'incomplete',
      interactionProfiles: ['example-controller'],
      bindings: [],
    };

    expect(() => new XRInputRouter([invalid])).toThrow('missing required actions');
  });

  test('rejects physical binding conflicts in the same context', () => {
    const base = BUILT_IN_XR_PROFILES[0];
    const duplicate: SemanticXRBinding = {
      action: SemanticXRAction.PartyCommand,
      context: 'gameplay',
      hand: 'dominant',
      input: { kind: 'button', index: 4 },
    };
    const invalid: XRInputBindingProfile = {
      ...base,
      id: 'conflicting',
      bindings: [...base.bindings, duplicate],
    };

    expect(() => new XRInputRouter([invalid])).toThrow('conflicts in gameplay');
  });

  test('clamps malformed controller values at the input boundary', () => {
    const router = new XRInputRouter();
    const actions = router.route(
      [questController('left', [0, 0, 2, -3])],
      new Set(['locomotion'])
    );

    const move = actions.find((action) => action.action === SemanticXRAction.Move);
    expect(move?.axes).toEqual([1, -1]);
    expect(move?.value).toBe(1);
  });
});
