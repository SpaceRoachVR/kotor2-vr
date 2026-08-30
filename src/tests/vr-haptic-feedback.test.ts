import { describe, expect, jest, test } from '@jest/globals';
import { VRHapticFeedback } from '@/vr/runtime/VRHapticFeedback';

describe('VRHapticFeedback', () => {
  test('pulses only the requested hand with clamped values', async () => {
    const leftPulse = jest.fn<(amplitude: number, duration: number) => Promise<boolean>>().mockResolvedValue(true);
    const rightPulse = jest.fn<(amplitude: number, duration: number) => Promise<boolean>>().mockResolvedValue(true);

    await new VRHapticFeedback().pulse(
      session(leftPulse, rightPulse),
      'left',
      { durationMs: 20, amplitude: 0.15 },
    );

    expect(leftPulse).toHaveBeenCalledWith(0.15, 20);
    expect(rightPulse).not.toHaveBeenCalled();
  });

  test('clamps unsafe amplitude and duration values before pulsing', async () => {
    const pulse = jest.fn<(amplitude: number, duration: number) => Promise<boolean>>().mockResolvedValue(true);

    await new VRHapticFeedback().pulse(
      session(pulse, jest.fn<(amplitude: number, duration: number) => Promise<boolean>>()),
      'left',
      { durationMs: 2_500, amplitude: -0.5 },
    );

    expect(pulse).toHaveBeenCalledWith(0, 1_000);
  });

  test('uses the standard vibration actuator when a pulse actuator is absent', async () => {
    const playEffect = jest.fn<(effect: string, parameters: GamepadEffectParameters) => Promise<GamepadHapticsResult>>()
      .mockResolvedValue('complete');
    const standardSession = {
      inputSources: [{
        handedness: 'right',
        gamepad: { vibrationActuator: { playEffect } },
      }],
    } as unknown as XRSession;

    await new VRHapticFeedback().pulse(
      standardSession,
      'right',
      { durationMs: 40, amplitude: 0.35 },
    );

    expect(playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 40,
      startDelay: 0,
      strongMagnitude: 0.35,
      weakMagnitude: 0.35,
    });
  });

  test('reports a rejected actuator once per session and hand without rejecting the frame caller', async () => {
    const logger = { warn: jest.fn() };
    const feedback = new VRHapticFeedback(logger);
    const rejectedSession = session(
      jest.fn<(amplitude: number, duration: number) => Promise<boolean>>().mockResolvedValue(true),
      jest.fn<(amplitude: number, duration: number) => Promise<boolean>>().mockRejectedValue(new Error('actuator unavailable')),
    );

    await expect(feedback.pulse(
      rejectedSession,
      'right',
      { durationMs: 60, amplitude: 0.45 },
    )).resolves.toBeUndefined();
    await feedback.pulse(
      rejectedSession,
      'right',
      { durationMs: 60, amplitude: 0.45 },
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test('reports a missing actuator once per session and hand', async () => {
    const logger = { warn: jest.fn() };
    const feedback = new VRHapticFeedback(logger);
    const missingSession = {
      inputSources: [{ handedness: 'left', gamepad: { hapticActuators: [] } }],
    } as unknown as XRSession;

    await feedback.pulse(missingSession, 'left', { durationMs: 20, amplitude: 0.15 });
    await feedback.pulse(missingSession, 'left', { durationMs: 20, amplitude: 0.15 });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('left'),
      expect.anything(),
    );
  });

  test('reports an actuator returning false once per session and hand', async () => {
    const logger = { warn: jest.fn() };
    const feedback = new VRHapticFeedback(logger);
    const falsePulse = jest.fn<(amplitude: number, duration: number) => Promise<boolean>>()
      .mockResolvedValue(false);
    const falseSession = session(falsePulse, jest.fn());

    await feedback.pulse(falseSession, 'left', { durationMs: 20, amplitude: 0.15 });
    await feedback.pulse(falseSession, 'left', { durationMs: 20, amplitude: 0.15 });

    expect(falsePulse).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test('never rejects the frame caller when the optional logger also fails', async () => {
    const feedback = new VRHapticFeedback({
      warn: () => { throw new Error('logger unavailable'); },
    });
    const rejectedSession = session(
      jest.fn<(amplitude: number, duration: number) => Promise<boolean>>().mockRejectedValue(new Error('actuator unavailable')),
      jest.fn<(amplitude: number, duration: number) => Promise<boolean>>().mockResolvedValue(true),
    );

    await expect(feedback.pulse(
      rejectedSession,
      'left',
      { durationMs: 20, amplitude: 0.15 },
    )).resolves.toBeUndefined();
  });
});

function session(
  leftPulse: jest.Mock<(amplitude: number, duration: number) => Promise<boolean>>,
  rightPulse: jest.Mock<(amplitude: number, duration: number) => Promise<boolean>>,
): XRSession {
  return {
    inputSources: [
      inputSource('left', leftPulse),
      inputSource('right', rightPulse),
    ],
  } as unknown as XRSession;
}

function inputSource(
  handedness: XRHandedness,
  pulse: jest.Mock<(amplitude: number, duration: number) => Promise<boolean>>,
): XRInputSource {
  return {
    handedness,
    gamepad: {
      hapticActuators: [{ pulse }],
    },
  } as unknown as XRInputSource;
}
