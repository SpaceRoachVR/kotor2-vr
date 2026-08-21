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
