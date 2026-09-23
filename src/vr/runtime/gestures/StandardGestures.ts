import { GestureDefinition } from './VRGestureTypes';

export const ForcePushGesture: GestureDefinition = {
  id: 'force-push',
  name: 'Force Push',
  handRequirement: 'dominant',
  requiredModifier: 'grip',
  minimumSpeedMetresPerSecond: 1.2,
  cooldownMilliseconds: 650,
  directionConstraint: 'forward',
  directionConeCosine: 0.5,
};

export const ForcePullGesture: GestureDefinition = {
  id: 'force-pull',
  name: 'Force Pull',
  handRequirement: 'dominant',
  requiredModifier: 'grip',
  minimumSpeedMetresPerSecond: 1.2,
  cooldownMilliseconds: 650,
  directionConstraint: 'backward',
  directionConeCosine: 0.5,
};

export const ForceLightningGesture: GestureDefinition = {
  id: 'force-lightning',
  name: 'Force Lightning',
  handRequirement: 'both',
  requiredModifier: 'grip',
  minimumSpeedMetresPerSecond: 1.0,
  cooldownMilliseconds: 1000,
  directionConstraint: 'forward',
  directionConeCosine: 0.5,
};

export const MeleeSwingHorizontal: GestureDefinition = {
  id: 'melee-swing-horizontal',
  name: 'Melee Swing Horizontal',
  handRequirement: 'dominant',
  requiredModifier: 'none',
  minimumSpeedMetresPerSecond: 0.8,
  cooldownMilliseconds: 250,
  directionConstraint: 'any',
  customEvaluator: (samples) => {
    if (samples.length < 2) return { valid: false };
    const latest = samples[samples.length - 1];
    const prev = samples[0];
    const dx = latest.position.x - prev.position.x;
    const dy = latest.position.y - prev.position.y;
    // Horizontal sweep has predominantly horizontal displacement relative to vertical
    const isHorizontal = Math.abs(dx) > Math.abs(dy) * 0.7;
    return { valid: isHorizontal, confidence: isHorizontal ? 0.9 : 0.4 };
  },
};

export const MeleeSwingOverhead: GestureDefinition = {
  id: 'melee-swing-overhead',
  name: 'Melee Swing Overhead',
  handRequirement: 'dominant',
  requiredModifier: 'none',
  minimumSpeedMetresPerSecond: 0.8,
  cooldownMilliseconds: 250,
  directionConstraint: 'down',
  directionConeCosine: 0.5,
};

export const STANDARD_GESTURES: readonly GestureDefinition[] = [
  ForcePushGesture,
  ForcePullGesture,
  ForceLightningGesture,
  MeleeSwingHorizontal,
  MeleeSwingOverhead,
];
