import { describe, expect, test } from '@jest/globals';
import {
  BUILT_IN_XR_PROFILES,
  SemanticXRBinding,
  XRControllerSnapshot,
  XRInputBindingProfile,
  XRInputRouter,
} from '@/vr/runtime/XRInputRouter';
import { SemanticXRAction, XRButtonState } from '@/vr/runtime/XRTypes';

const RELEASED_BUTTON: XRButtonState = { pressed: false, touched: false, value: 0 };
const BUILT_IN_TRIGGER_PROFILES = [
  { id: 'quest-touch', interactionProfile: 'oculus-touch-v3', triggerButtonIndex: 0 },
  { id: 'valve-index', interactionProfile: 'valve-index', triggerButtonIndex: 0 },
  { id: 'htc-vive', interactionProfile: 'htc-vive', triggerButtonIndex: 0 },
  { id: 'xr-standard', interactionProfile: 'generic-trigger-squeeze-thumbstick', triggerButtonIndex: 0 },
] as const;

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

function profileController(
  hand: 'left' | 'right',
  interactionProfile: string,
  triggerButtonIndex: number,
): XRControllerSnapshot {
  const buttons = Array.from({ length: 6 }, () => RELEASED_BUTTON);
  buttons[triggerButtonIndex] = { pressed: true, touched: true, value: 1 };
  return {
    hand,
    profiles: [interactionProfile],
    buttons,
    axes: [0, 0, 0, 0],
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

  test.each(BUILT_IN_TRIGGER_PROFILES)(
    'routes only the left trigger as radial-wheel Select for $id',
    ({ interactionProfile, triggerButtonIndex }) => {
      const controllers = (['left', 'right'] as const).map((hand) =>
        profileController(hand, interactionProfile, triggerButtonIndex)
      );

      const actions = new XRInputRouter().route(controllers, new Set(['radial-wheel']));

      expect(actions.filter((action) => action.action === SemanticXRAction.Select)).toEqual([
        expect.objectContaining({ hand: 'left', pressed: true }),
      ]);
    },
  );

  test.each(BUILT_IN_TRIGGER_PROFILES)(
    'routes either trigger as world-prompt Select for $id',
    ({ interactionProfile, triggerButtonIndex }) => {
      const controllers = (['left', 'right'] as const).map((hand) =>
        profileController(hand, interactionProfile, triggerButtonIndex)
      );

      const actions = new XRInputRouter().route(controllers, new Set(['world-prompt']));

      expect(actions.filter((action) => action.action === SemanticXRAction.Select)).toEqual([
        expect.objectContaining({ hand: 'left', pressed: true }),
        expect.objectContaining({ hand: 'right', pressed: true }),
      ]);
    },
  );

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
