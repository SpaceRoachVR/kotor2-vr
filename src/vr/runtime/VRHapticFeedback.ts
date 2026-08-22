import { XRHandRole } from './XRTypes';

export interface VRHapticPattern {
  readonly durationMs: number;
  readonly amplitude: number;
}

export interface VRHapticLogger {
  warn(message: string, error?: unknown): void;
}

interface XRGamepadHapticActuator {
  pulse(amplitude: number, duration: number): Promise<boolean>;
}

interface StandardGamepadHapticActuator {
  playEffect(
    effect: 'dual-rumble',
    parameters: GamepadEffectParameters,
  ): Promise<GamepadHapticsResult>;
}

type HapticGamepad = Gamepad & {
  readonly hapticActuators?: readonly XRGamepadHapticActuator[];
  readonly vibrationActuator?: StandardGamepadHapticActuator;
};

const MIN_DURATION_MS = 1;
const MAX_DURATION_MS = 1_000;

/** Optional WebXR haptics that can never reject or interrupt the frame loop. */
export class VRHapticFeedback {
  private readonly reportedFailures = new WeakMap<XRSession, Set<XRHandRole>>();

  constructor(private readonly logger: VRHapticLogger = console) {}

  async pulse(session: XRSession, hand: XRHandRole, pattern: VRHapticPattern): Promise<void> {
    try {
      const source = Array.from(session.inputSources ?? [])
        .find((candidate) => candidate.handedness === hand);
      const gamepad = source?.gamepad as HapticGamepad | undefined;
      const pulseActuator = gamepad?.hapticActuators?.[0];
      const vibrationActuator = gamepad?.vibrationActuator;
      if (typeof pulseActuator?.pulse !== 'function' && typeof vibrationActuator?.playEffect !== 'function') {
        this.reportFailureOnce(session, hand, new Error('haptic actuator is unavailable'));
        return;
      }

      const amplitude = clampFinite(pattern.amplitude, 0, 1);
      const durationMs = clampFinite(pattern.durationMs, MIN_DURATION_MS, MAX_DURATION_MS);
      const accepted = typeof pulseActuator?.pulse === 'function'
        ? await pulseActuator.pulse(amplitude, durationMs)
        : await vibrationActuator!.playEffect('dual-rumble', {
          duration: durationMs,
          startDelay: 0,
          strongMagnitude: amplitude,
          weakMagnitude: amplitude,
        });
      if (accepted === false || accepted === 'preempted') {
        this.reportFailureOnce(session, hand, new Error('haptic actuator declined the pulse'));
      }
    } catch (error) {
      this.reportFailureOnce(session, hand, error);
    }
  }

  private reportFailureOnce(session: XRSession, hand: XRHandRole, error: unknown): void {
    let reportedHands = this.reportedFailures.get(session);
    if (!reportedHands) {
      reportedHands = new Set<XRHandRole>();
      this.reportedFailures.set(session, reportedHands);
    }
    if (reportedHands.has(hand)) return;
    reportedHands.add(hand);
    try {
      this.logger.warn(`[VRHapticFeedback] ${hand} actuator pulse failed; suppressing repeats for this session`, error);
    } catch {
      // Logging is optional too; haptic feedback must never reject a frame.
    }
  }
}

function clampFinite(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}
