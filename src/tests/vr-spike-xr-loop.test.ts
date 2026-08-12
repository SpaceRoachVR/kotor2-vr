import { VRSpike } from "@/vr/VRSpike";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

type CapturedXRCallback = (timestamp: number, frame?: XRFrame) => void;

describe('VRSpike XR loop ownership', () => {
  let originalDocument: PropertyDescriptor | undefined;
  let originalNavigator: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    jest.spyOn(console, 'log').mockImplementation((): void => undefined);
    jest.spyOn(console, 'warn').mockImplementation((): void => undefined);
  });

  afterEach(() => {
    VRSpike.perf.stop();
    VRSpike.renderer = null;
    VRSpike.hooks = null;
    VRSpike.session = null;

    restoreGlobal('document', originalDocument);
    restoreGlobal('navigator', originalNavigator);
    jest.restoreAllMocks();
  });

  test('registers the XR callback without starting the desktop animation loop', async () => {
    const harness = createXRLoopHarness();

    await VRSpike.enter();

    expect(harness.engineUpdates).toEqual([]);
    expect(harness.configurationEvents).toEqual(['session-start']);
    expect(VRSpike.perf.targetHz).toBe(50);
    expect(VRSpike.perf.xrRuntimeHz).toBe(90);

    harness.invokeXRFrame(1000, {} as XRFrame);

    expect(harness.engineUpdates).toEqual([
      { timestamp: 1000, source: 'xr' },
    ]);
  });

  test('rejects callbacks that do not carry an XRFrame', async () => {
    const harness = createXRLoopHarness();

    await VRSpike.enter();
    harness.invokeXRFrame(1000, undefined);

    expect(harness.engineUpdates).toEqual([]);
  });
});

function createXRLoopHarness(): {
  engineUpdates: Array<{ timestamp: number; source: string }>;
  configurationEvents: string[];
  invokeXRFrame: (timestamp: number, frame?: XRFrame) => void;
} {
  const engineUpdates: Array<{ timestamp: number; source: string }> = [];
  const configurationEvents: string[] = [];
  let xrCallback: CapturedXRCallback | null = null;

  const session = {
    frameRate: 90,
    addEventListener: (): void => undefined,
    end: (): void => undefined,
  } as unknown as XRSession;

  const xrManager = {
    isPresenting: false,
    setAnimationLoop: (callback: CapturedXRCallback | null) => {
      xrCallback = callback;
    },
    setSession: async () => {
      configurationEvents.push('session-start');
      xrManager.isPresenting = true;
    },
  };

  const renderer = {
    xr: xrManager,
    setAnimationLoop: (callback: CapturedXRCallback | null) => {
      xrCallback = callback;
      // Three's renderer-level method starts window.requestAnimationFrame.
      // A callback after the XR session starts therefore has no XRFrame.
      callback?.(0, undefined);
    },
  };

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { getElementById: (): null => null },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { xr: { requestSession: async () => session } },
  });

  VRSpike.renderer = renderer as never;
  VRSpike.hooks = {
    update: (timestamp, source) => engineUpdates.push({ timestamp, source }),
    getPlayerPosition: () => null,
    getFacing: () => 0,
    getWorldContext: () => ({
      module: null,
      position: null,
      room: null,
      roomsVisible: 0,
      roomsTotal: 0,
    }),
  };

  return {
    engineUpdates,
    configurationEvents,
    invokeXRFrame: (timestamp, frame) => {
      if (!xrCallback) throw new Error('XR callback was not registered');
      xrCallback(timestamp, frame);
    },
  };
}

function restoreGlobal(
  property: 'document' | 'navigator',
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, property, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, property);
  }
}
