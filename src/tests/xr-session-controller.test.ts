import { describe, expect, jest, test } from '@jest/globals';

describe('XRSessionController', () => {
  test('does not seize existing input ownership when session acquisition fails', async () => {
    const { XRSessionController } = require('@/vr/runtime/XRSessionController') as typeof import('@/vr/runtime/XRSessionController');
    let inputSuppressed = true;
    const setInputSuppressed = jest.fn((suppressed: boolean) => { inputSuppressed = suppressed; });
    const controller = new XRSessionController({
      requestSession: async () => { throw new Error('session denied'); },
      bindSession: async () => undefined,
      setAnimationLoopActive: () => undefined,
      getInputSuppressed: () => inputSuppressed,
      setInputSuppressed,
    });

    await expect(controller.enter()).rejects.toThrow('session denied');

    expect(inputSuppressed).toBe(true);
    expect(setInputSuppressed).not.toHaveBeenCalled();
    expect(controller.state).toBe('failed');
  });

  test('restores pre-session input and listeners when renderer binding fails', async () => {
    const { XRSessionController } = require('@/vr/runtime/XRSessionController') as typeof import('@/vr/runtime/XRSessionController');
    const session = createSession();
    let inputSuppressed = false;
    let animationLoopActive = false;
    const controller = new XRSessionController({
      requestSession: async () => session.value,
      bindSession: async () => { throw new Error('SteamVR binding failed'); },
      setAnimationLoopActive: (active) => { animationLoopActive = active; },
      getInputSuppressed: () => inputSuppressed,
      setInputSuppressed: (suppressed) => { inputSuppressed = suppressed; },
    });

    await expect(controller.enter()).rejects.toThrow('SteamVR binding failed');

    expect(controller.state).toBe('failed');
    expect(inputSuppressed).toBe(false);
    expect(animationLoopActive).toBe(false);
    expect(session.listenerCount()).toBe(0);
    expect(session.endCalls()).toBe(1);
  });

  test('cleans local state even when the runtime rejects session end', async () => {
    const { XRSessionController } = require('@/vr/runtime/XRSessionController') as typeof import('@/vr/runtime/XRSessionController');
    const session = createSession({ endError: new Error('runtime disconnected') });
    let inputSuppressed = false;
    let animationLoopActive = false;
    const controller = new XRSessionController({
      requestSession: async () => session.value,
      bindSession: async () => undefined,
      setAnimationLoopActive: (active) => { animationLoopActive = active; },
      getInputSuppressed: () => inputSuppressed,
      setInputSuppressed: (suppressed) => { inputSuppressed = suppressed; },
    });
    await controller.enter();

    await expect(controller.end()).rejects.toThrow('runtime disconnected');

    expect(controller.state).toBe('failed');
    expect(controller.session).toBeNull();
    expect(inputSuppressed).toBe(false);
    expect(animationLoopActive).toBe(false);
    expect(session.listenerCount()).toBe(0);
  });

  test('classifies an unsolicited session end as runtime loss', async () => {
    const { XRSessionController } = require('@/vr/runtime/XRSessionController') as typeof import('@/vr/runtime/XRSessionController');
    const session = createSession();
    let inputSuppressed = false;
    const controller = new XRSessionController({
      requestSession: async () => session.value,
      bindSession: async () => undefined,
      setAnimationLoopActive: () => undefined,
      getInputSuppressed: () => inputSuppressed,
      setInputSuppressed: (suppressed) => { inputSuppressed = suppressed; },
    });
    await controller.enter();

    session.dispatchEnd();
    await Promise.resolve();

    expect(controller.state).toBe('lost');
    expect(controller.session).toBeNull();
    expect(inputSuppressed).toBe(false);
  });
});

function createSession(options: { endError?: Error } = {}) {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  let endCalls = 0;
  const value = {
    inputSources: [],
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'end') listeners.add(listener);
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'end') listeners.delete(listener);
    },
    end: jest.fn(async () => {
      endCalls += 1;
      if (options.endError) throw options.endError;
    }),
  } as unknown as XRSession;
  return {
    value,
    listenerCount: () => listeners.size,
    endCalls: () => endCalls,
    dispatchEnd: () => {
      for (const listener of [...listeners]) {
        if (typeof listener === 'function') listener(new Event('end'));
        else listener.handleEvent(new Event('end'));
      }
    },
  };
}
