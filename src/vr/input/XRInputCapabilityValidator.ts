import {
  BUILT_IN_XR_PROFILES,
  DEFAULT_REQUIRED_XR_ACTIONS,
  XRBindingHand,
  XRInputBindingProfile,
  XRPhysicalInput,
} from '../runtime/XRInputRouter';
import { SemanticXRAction, XRHandRole } from '../runtime/XRTypes';

export type XRHapticCapability = 'none' | 'pulse';

export interface XRInputCapabilitySnapshot {
  readonly hand: XRHandRole;
  readonly profiles: readonly string[];
  readonly targetRayMode: XRTargetRayMode;
  readonly gamepadMapping: string;
  readonly buttonCount: number;
  readonly axisCount: number;
  readonly hasGripSpace: boolean;
  readonly haptics: XRHapticCapability;
}

export interface XRInputCapabilityValidation {
  readonly valid: boolean;
  readonly missingActions: readonly SemanticXRAction[];
  readonly unmatchedHands: readonly XRHandRole[];
}

export interface XRInputTopologyUpdate {
  readonly changed: boolean;
  readonly topologyKey: string;
  readonly validation: XRInputCapabilityValidation;
}

export class XRInputCapabilityValidator {
  private previousTopologyKey: string | null = null;

  constructor(
    private readonly profiles: readonly XRInputBindingProfile[] = BUILT_IN_XR_PROFILES,
    private readonly dominantHand: XRHandRole = 'right',
    private readonly requiredActions: readonly SemanticXRAction[] = DEFAULT_REQUIRED_XR_ACTIONS,
  ) {}

  update(sources: readonly XRInputCapabilitySnapshot[]): XRInputTopologyUpdate {
    const topologyKey = buildTopologyKey(sources);
    const changed = topologyKey !== this.previousTopologyKey;
    this.previousTopologyKey = topologyKey;
    return { changed, topologyKey, validation: this.validate(sources) };
  }

  validate(sources: readonly XRInputCapabilitySnapshot[]): XRInputCapabilityValidation {
    const matchedSources = sources.map((source) => ({
      source,
      profile: this.findProfile(source.profiles),
    }));
    const unmatchedHands = matchedSources
      .filter(({ profile }) => profile === null)
      .map(({ source }) => source.hand);
    const missingActions = this.requiredActions.filter((action) =>
      !matchedSources.some(({ source, profile }) => profile !== null &&
        profile.bindings.some((binding) =>
          binding.action === action &&
          matchesHand(binding.hand, source.hand, this.dominantHand) &&
          supportsPhysicalInput(source, binding.input)
        ))
    );
    return {
      valid: unmatchedHands.length === 0 && missingActions.length === 0,
      missingActions,
      unmatchedHands,
    };
  }

  private findProfile(interactionProfiles: readonly string[]): XRInputBindingProfile | null {
    for (const interactionProfile of interactionProfiles) {
      const profile = this.profiles.find((candidate) =>
        candidate.interactionProfiles.includes(interactionProfile)
      );
      if (profile) return profile;
    }
    return null;
  }
}

function supportsPhysicalInput(source: XRInputCapabilitySnapshot, input: XRPhysicalInput): boolean {
  return input.kind === 'button'
    ? input.index < source.buttonCount
    : input.xIndex < source.axisCount && input.yIndex < source.axisCount;
}

function matchesHand(binding: XRBindingHand, hand: XRHandRole, dominantHand: XRHandRole): boolean {
  if (binding === 'either') return true;
  if (binding === 'left' || binding === 'right') return binding === hand;
  return binding === 'dominant' ? hand === dominantHand : hand !== dominantHand;
}

function buildTopologyKey(sources: readonly XRInputCapabilitySnapshot[]): string {
  return JSON.stringify([...sources]
    .sort((left, right) => left.hand.localeCompare(right.hand))
    .map((source) => ({
      hand: source.hand,
      profiles: [...source.profiles],
      targetRayMode: source.targetRayMode,
      gamepadMapping: source.gamepadMapping,
      buttonCount: source.buttonCount,
      axisCount: source.axisCount,
      hasGripSpace: source.hasGripSpace,
      haptics: source.haptics,
    })));
}
