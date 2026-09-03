import { SemanticXRAction, XRButtonState, XRHandRole } from './XRTypes';

export type XRActionContext =
  | 'global'
  | 'locomotion'
  | 'gameplay'
  | 'interaction'
  | 'ui'
  | 'combat'
  | 'radial-wheel'
  | 'world-prompt';
export type XRBindingHand = 'dominant' | 'offhand' | 'either' | XRHandRole;

export type XRPhysicalInput =
  | { readonly kind: 'button'; readonly index: number }
  | { readonly kind: 'axis2d'; readonly xIndex: number; readonly yIndex: number };

export interface SemanticXRBinding {
  readonly action: SemanticXRAction;
  readonly context: XRActionContext;
  readonly hand: XRBindingHand;
  readonly input: XRPhysicalInput;
}

export interface XRControllerSnapshot {
  readonly hand: XRHandRole;
  readonly profiles: readonly string[];
  readonly buttons: readonly XRButtonState[];
  readonly axes: readonly number[];
}

export interface RoutedXRAction {
  readonly action: SemanticXRAction;
  readonly hand: XRHandRole;
  readonly pressed: boolean;
  readonly touched: boolean;
  readonly value: number;
  readonly axes: readonly [number, number] | null;
}

export interface XRInputBindingProfile {
  readonly id: string;
  readonly interactionProfiles: readonly string[];
  readonly bindings: readonly SemanticXRBinding[];
}

export interface XRInputRouterOptions {
  readonly dominantHand: XRHandRole;
  readonly requiredActions?: readonly SemanticXRAction[];
}

export const DEFAULT_REQUIRED_XR_ACTIONS: readonly SemanticXRAction[] = [
  SemanticXRAction.Move,
  SemanticXRAction.Turn,
  SemanticXRAction.Select,
  SemanticXRAction.Cancel,
  SemanticXRAction.Use,
  SemanticXRAction.Grab,
  SemanticXRAction.Menu,
  SemanticXRAction.Recenter,
  SemanticXRAction.WeaponAction,
];

function standardBindings(
  stickAxes: readonly [number, number],
  menuBinding: Pick<SemanticXRBinding, 'hand' | 'input'> = {
    hand: 'offhand',
    input: { kind: 'button', index: 5 },
  },
  // Left unbound by default. On profiles whose Menu already sits on offhand
  // button 5 there is no free face button to give this, and a collision would
  // be worse than the action staying unreachable.
  partyCommandBinding: Pick<SemanticXRBinding, 'hand' | 'input'> | null = null,
): readonly SemanticXRBinding[] {
  return [
    { action: SemanticXRAction.Move, context: 'locomotion', hand: 'offhand', input: { kind: 'axis2d', xIndex: stickAxes[0], yIndex: stickAxes[1] } },
    { action: SemanticXRAction.Turn, context: 'locomotion', hand: 'dominant', input: { kind: 'axis2d', xIndex: stickAxes[0], yIndex: stickAxes[1] } },
    { action: SemanticXRAction.Select, context: 'ui', hand: 'dominant', input: { kind: 'button', index: 0 } },
    { action: SemanticXRAction.Select, context: 'gameplay', hand: 'dominant', input: { kind: 'button', index: 0 } },
    // Either hand, matching world-prompt below. The wheel's ray is resolved by
    // hit rather than by role (see VRPointerHandResolver), so it follows
    // whichever hand aims — usually the right. Binding confirm to one physical
    // hand left the ray live on the other hand with a dead trigger, which reads
    // as a broken menu. Reported from a headset session.
    { action: SemanticXRAction.Select, context: 'radial-wheel', hand: 'either', input: { kind: 'button', index: 0 } },
    { action: SemanticXRAction.Select, context: 'world-prompt', hand: 'either', input: { kind: 'button', index: 0 } },
    { action: SemanticXRAction.Cancel, context: 'ui', hand: 'dominant', input: { kind: 'button', index: 5 } },
    { action: SemanticXRAction.Use, context: 'gameplay', hand: 'dominant', input: { kind: 'button', index: 4 } },
    { action: SemanticXRAction.Grab, context: 'interaction', hand: 'either', input: { kind: 'button', index: 1 } },
    { action: SemanticXRAction.Menu, context: 'global', ...menuBinding },
    { action: SemanticXRAction.Recenter, context: 'global', hand: 'dominant', input: { kind: 'button', index: 3 } },
    { action: SemanticXRAction.Pause, context: 'global', hand: 'dominant', input: { kind: 'button', index: 5 } },
    { action: SemanticXRAction.WeaponAction, context: 'combat', hand: 'dominant', input: { kind: 'button', index: 0 } },
    { action: SemanticXRAction.ToggleWalkRun, context: 'locomotion', hand: 'offhand', input: { kind: 'button', index: 3 } },
    // ToggleLocomotionMode is deliberately unbound. It shared the offhand
    // trigger with radial-wheel Select, and having smooth/blink on a physical
    // button as well as in Comfort Settings made the offhand controls hard to
    // predict — reported from the second headset session. Movement mode now
    // lives only on the Comfort Settings panel, which already exposes it.
    ...(partyCommandBinding === null
      ? []
      : [{ action: SemanticXRAction.PartyCommand, context: 'global', ...partyCommandBinding } as SemanticXRBinding]),
  ];
}

export const BUILT_IN_XR_PROFILES: readonly XRInputBindingProfile[] = [
  {
    id: 'quest-touch',
    interactionProfiles: ['oculus-touch-v3', 'oculus-touch-v2', 'oculus-touch'],
    // Quest: Menu is left X (4), so left Y (5) is free for PartyCommand.
    bindings: standardBindings(
      [2, 3],
      { hand: 'left', input: { kind: 'button', index: 4 } },
      { hand: 'left', input: { kind: 'button', index: 5 } },
    ),
  },
  {
    id: 'valve-index',
    interactionProfiles: ['valve-index'],
    bindings: standardBindings([2, 3]),
  },
  {
    id: 'htc-vive',
    interactionProfiles: ['htc-vive'],
    bindings: standardBindings([0, 1]),
  },
  {
    id: 'xr-standard',
    interactionProfiles: ['generic-trigger-squeeze-thumbstick', 'generic-trigger-touchpad'],
    bindings: standardBindings([2, 3]),
  },
];

export class XRInputRouter {
  private readonly requiredActions: readonly SemanticXRAction[];
  private readonly reportedUnmatchedProfiles = new Set<string>();
  private dominantHand: XRHandRole;

  constructor(
    private readonly profiles: readonly XRInputBindingProfile[] = BUILT_IN_XR_PROFILES,
    private readonly options: XRInputRouterOptions = { dominantHand: 'right' }
  ) {
    this.requiredActions = options.requiredActions ?? DEFAULT_REQUIRED_XR_ACTIONS;
    this.dominantHand = options.dominantHand;
    if (profiles.length === 0) {
      throw new Error('At least one XR input binding profile is required');
    }
    for (const profile of profiles) {
      XRInputRouter.validateProfile(profile, this.requiredActions);
    }
  }

  setDominantHand(hand: XRHandRole): void {
    this.dominantHand = hand;
  }

  route(
    controllers: readonly XRControllerSnapshot[],
    activeContexts: ReadonlySet<XRActionContext>
  ): readonly RoutedXRAction[] {
    const routed: RoutedXRAction[] = [];
    for (const controller of controllers) {
      const profile = this.findProfile(controller.profiles);
      if (!profile) {
        const signature = `${controller.hand}:${controller.profiles.join(',')}`;
        if (!this.reportedUnmatchedProfiles.has(signature)) {
          this.reportedUnmatchedProfiles.add(signature);
          console.warn(
            `[XRInputRouter] no binding profile matches ${controller.hand} controller profiles [${controller.profiles.join(', ')}] — every semantic action is unavailable for this controller`
          );
        }
        continue;
      }

      for (const binding of profile.bindings) {
        if (!activeContexts.has(binding.context) || !this.matchesHand(binding.hand, controller.hand)) {
          continue;
        }
        const action = this.readBinding(binding, controller);
        if (action) routed.push(action);
      }
    }
    return routed;
  }

  findProfile(interactionProfiles: readonly string[]): XRInputBindingProfile | null {
    for (const interactionProfile of interactionProfiles) {
      const match = this.profiles.find((profile) =>
        profile.interactionProfiles.includes(interactionProfile)
      );
      if (match) return match;
    }
    return null;
  }

  static validateProfile(
    profile: XRInputBindingProfile,
    requiredActions: readonly SemanticXRAction[] = DEFAULT_REQUIRED_XR_ACTIONS
  ): void {
    if (!profile.id.trim()) throw new Error('XR input profile id cannot be empty');
    if (profile.interactionProfiles.length === 0) {
      throw new Error(`XR input profile ${profile.id} has no interaction profile identifiers`);
    }

    const actions = new Set(profile.bindings.map((binding) => binding.action));
    const missing = requiredActions.filter((action) => !actions.has(action));
    if (missing.length > 0) {
      throw new Error(`XR input profile ${profile.id} is missing required actions: ${missing.join(', ')}`);
    }

    const occupied = new Map<string, SemanticXRAction>();
    for (const binding of profile.bindings) {
      XRInputRouter.validatePhysicalInput(profile.id, binding.input);
      const physical = binding.input.kind === 'button'
        ? `button:${binding.input.index}`
        : `axis2d:${binding.input.xIndex}:${binding.input.yIndex}`;
      const key = `${binding.context}:${binding.hand}:${physical}`;
      const existing = occupied.get(key);
      if (existing) {
        throw new Error(
          `XR input profile ${profile.id} conflicts in ${binding.context}: ` +
          `${existing} and ${binding.action} both use ${binding.hand} ${physical}`
        );
      }
      occupied.set(key, binding.action);
    }
  }

  private static validatePhysicalInput(profileId: string, input: XRPhysicalInput): void {
    const indices = input.kind === 'button'
      ? [input.index]
      : [input.xIndex, input.yIndex];
    if (indices.some((index) => !Number.isInteger(index) || index < 0)) {
      throw new Error(`XR input profile ${profileId} contains an invalid input index`);
    }
    if (input.kind === 'axis2d' && input.xIndex === input.yIndex) {
      throw new Error(`XR input profile ${profileId} must use distinct X and Y axes`);
    }
  }

  private matchesHand(bindingHand: XRBindingHand, controllerHand: XRHandRole): boolean {
    if (bindingHand === 'either') return true;
    if (bindingHand === 'left' || bindingHand === 'right') return controllerHand === bindingHand;
    if (bindingHand === 'dominant') return controllerHand === this.dominantHand;
    return controllerHand !== this.dominantHand;
  }

  private readBinding(
    binding: SemanticXRBinding,
    controller: XRControllerSnapshot
  ): RoutedXRAction | null {
    if (binding.input.kind === 'button') {
      const button = controller.buttons[binding.input.index];
      if (!button) return null;
      return {
        action: binding.action,
        hand: controller.hand,
        pressed: button.pressed,
        touched: button.touched,
        value: Math.min(1, Math.max(0, button.value)),
        axes: null,
      };
    }

    const x = controller.axes[binding.input.xIndex];
    const y = controller.axes[binding.input.yIndex];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const axes: readonly [number, number] = [
      Math.min(1, Math.max(-1, x)),
      Math.min(1, Math.max(-1, y)),
    ];
    const value = Math.min(1, Math.hypot(axes[0], axes[1]));
    return {
      action: binding.action,
      hand: controller.hand,
      pressed: value > 0.5,
      touched: value > 0,
      value,
      axes,
    };
  }
}
