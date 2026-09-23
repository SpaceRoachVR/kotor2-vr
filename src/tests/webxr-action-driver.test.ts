import { describe, expect, jest, test } from '@jest/globals';
const { WebXRActionDriver } = require('../../tools/vr-emulator/dsl/WebXRActionDriver');

describe('WebXRActionDriver', () => {
  test('throws if harness does not provide evaluate', () => {
    expect(() => new WebXRActionDriver(null)).toThrow(TypeError);
    expect(() => new WebXRActionDriver({})).toThrow(TypeError);
  });

  test('setButton evaluates controller updateButtonValue', async () => {
    const mockHarness = {
      evaluate: jest.fn<any>().mockResolvedValue(true),
      waitFor: jest.fn<any>().mockResolvedValue(true),
    };
    const driver = new WebXRActionDriver(mockHarness);

    await driver.setButton('right', 'trigger', 0.8);
    expect(mockHarness.evaluate).toHaveBeenCalledTimes(1);
    const evaluatedString = (mockHarness.evaluate as any).mock.calls[0][0];
    expect(evaluatedString).toContain('"right"');
    expect(evaluatedString).toContain('"trigger"');
    expect(evaluatedString).toContain('0.8');
  });

  test('setThumbstick evaluates controller updateAxes', async () => {
    const mockHarness = {
      evaluate: jest.fn<any>().mockResolvedValue(true),
      waitFor: jest.fn<any>().mockResolvedValue(true),
    };
    const driver = new WebXRActionDriver(mockHarness);

    await driver.setThumbstick('left', 0.5, -0.9);
    expect(mockHarness.evaluate).toHaveBeenCalledTimes(1);
    const evaluatedString = (mockHarness.evaluate as any).mock.calls[0][0];
    expect(evaluatedString).toContain('"left"');
    expect(evaluatedString).toContain('0.5');
    expect(evaluatedString).toContain('-0.9');
  });

  test('performForceFlick triggers grip modifier and z-axis displacement', async () => {
    const mockHarness = {
      evaluate: jest.fn<any>().mockResolvedValue(true),
      waitFor: jest.fn<any>().mockResolvedValue(true),
    };
    const driver = new WebXRActionDriver(mockHarness);

    const result = await driver.performForceFlick({ direction: 'push', hand: 'right', speed: 1.8 });
    expect(result.flickCompleted).toBe(true);
    expect(result.direction).toBe('push');
    expect(result.speed).toBe(1.8);
    // At least 3 evaluate calls: grip press (1), flick displacement (2), grip release (3)
    expect((mockHarness.evaluate as any).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test('waitForPrompt delegates to harness waitFor', async () => {
    const mockHarness = {
      evaluate: jest.fn<any>().mockResolvedValue(true),
      waitFor: jest.fn<any>().mockResolvedValue(true),
    };
    const driver = new WebXRActionDriver(mockHarness);

    await driver.waitForPrompt('Medical Console', 3000);
    expect(mockHarness.waitFor).toHaveBeenCalledWith(expect.stringContaining('medical console'), 3000);
  });
});
