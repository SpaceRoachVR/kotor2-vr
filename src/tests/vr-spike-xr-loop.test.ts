import { VRSpike } from "@/vr/VRSpike";
import * as THREE from 'three';
import { XRCoordinateConverter } from '@/vr/runtime/XRCoordinateConverter';
import {
  LocomotionController,
  ResolvedLocomotion,
} from '@/vr/runtime/LocomotionController';
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

type CapturedXRCallback = (timestamp: number, frame?: XRFrame) => void;

describe('VRSpike XR loop ownership', () => {
  let originalDocument: PropertyDescriptor | undefined;
  let originalNavigator: PropertyDescriptor | undefined;
  let originalRequestAnimationFrame: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    originalRequestAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
    jest.spyOn(console, 'log').mockImplementation((): void => undefined);
    jest.spyOn(console, 'warn').mockImplementation((): void => undefined);
  });

  afterEach(() => {
    VRSpike.perf.stop();
    VRSpike.renderer = null;
    VRSpike.scene = null;
    VRSpike.camera = null;
    VRSpike.rig = null;
    VRSpike.hooks = null;
    VRSpike.session = null;
    VRSpike.followCamera = true;
    VRSpike.yawOffset = 0;
    (VRSpike as any).controllerAnchorHost?.dispose();
    (VRSpike as any).controllerAnchorHost = null;
    (VRSpike as any).latestInputFrame = null;
    (VRSpike as any).latestXRFrame = null;
    (VRSpike as any).latestXRFrameTimestamp = 0;
    (VRSpike as any).xrFrameRenderTarget = null;
    (VRSpike as any).movieHost?.dispose();
    (VRSpike as any).movieHost = null;
    (VRSpike as any).movieCancelHeld = false;
    (VRSpike as any).keyboardHost?.dispose?.();
    (VRSpike as any).keyboardHost = null;
    (VRSpike as any).keyboardSelectHeld = false;
    (VRSpike as any).keyboardCancelHeld = false;
    (VRSpike as any).keyboardWasActive = false;
    (VRSpike as any).combatCancelHeld = false;
    (VRSpike as any).combatInputController?.reset();
    (VRSpike as any).forceGestureController?.reset();
    (VRSpike as any).interactionTargetSet?.clear();
    (VRSpike as any).interactionSystem?.cancelTransientState();
    (VRSpike as any).previousXRInputTimestamp = null;
    (VRSpike as any).turnYaw = 0;
    (VRSpike as any).turnOriginOffset?.set(0, 0, 0);

    restoreGlobal('document', originalDocument);
    restoreGlobal('navigator', originalNavigator);
    restoreGlobal('requestAnimationFrame', originalRequestAnimationFrame);
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

  test('defers browser handoff until native session end listeners finish', async () => {
    const harness = createXRLoopHarness();

    await VRSpike.enter();
    harness.endRawSession();

    expect(harness.engineUpdates).toEqual([]);
    expect(VRSpike.session).not.toBeNull();

    await Promise.resolve();

    expect(harness.engineUpdates).toEqual([
      { timestamp: 2000, source: 'browser' },
    ]);
    expect(VRSpike.session).toBeNull();

    await VRSpike.enter();
    harness.invokeXRFrame(3000, {} as XRFrame);

    expect(harness.engineUpdates.at(-1)).toEqual({ timestamp: 3000, source: 'xr' });
    expect(harness.configurationEvents).toEqual(['session-start', 'session-start']);
  });

  test('isolates every VR button press phase from legacy window input', () => {
    const listeners = new Map<string, (event: Event) => void>();
    const button = {
      id: '',
      textContent: '',
      style: {},
      disabled: false,
      addEventListener: (type: string, listener: (event: Event) => void): void => {
        listeners.set(type, listener);
      },
    };

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: () => button,
        body: { appendChild: (): void => undefined },
      },
    });

    (VRSpike as any).addButton(true);

    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup']) {
      const event = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      } as unknown as Event;

      listeners.get(type)?.(event);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    }
  });

  test('restores the XR render target after legacy GUI rendering resets it', async () => {
    const harness = createXRLoopHarness();
    VRSpike.scene = {} as never;
    VRSpike.camera = {} as never;
    VRSpike.rig = {} as never;
    VRSpike.followCamera = false;
    VRSpike.hooks!.update = (timestamp, source): void => {
      harness.engineUpdates.push({ timestamp, source });
      harness.resetRenderTargetToDesktop();
      VRSpike.render({} as never, timestamp);
    };

    await VRSpike.enter();
    harness.invokeXRFrame(4000, {} as XRFrame);

    expect(harness.renderTargetsAtRender).toEqual([harness.xrRenderTarget]);
  });

  test('submits an engine movie scene to a theater surface before the XR world frame', () => {
    const worldScene = new THREE.Scene();
    const movieScene = new THREE.Scene();
    const movieCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const xrRenderTarget = { isXRRenderTarget: true };
    let renderTarget: unknown = xrRenderTarget;
    const renderCalls: Array<{ scene: THREE.Scene; camera: THREE.Camera; xrEnabled: boolean }> = [];
    VRSpike.renderer = {
      xr: { enabled: true },
      autoClear: false,
      getRenderTarget: () => renderTarget,
      setRenderTarget: (target: unknown) => { renderTarget = target; },
      getClearAlpha: () => 1,
      setClearAlpha: (): void => undefined,
      clear: (): void => undefined,
      render: (scene: THREE.Scene, camera: THREE.Camera) => {
        renderCalls.push({ scene, camera, xrEnabled: (VRSpike.renderer as any).xr.enabled });
      },
    } as never;
    VRSpike.scene = worldScene;
    VRSpike.camera = new THREE.PerspectiveCamera();
    VRSpike.rig = new THREE.Group();
    (VRSpike as any).latestInputFrame = {
      head: {
        position: new THREE.Vector3(0, 0, 1.7),
        orientation: new THREE.Quaternion(),
      },
    };
    (VRSpike as any).xrFrameRenderTarget = xrRenderTarget;

    (VRSpike as any).renderMovie(movieScene, movieCamera, 1280, 720, 1000);

    expect(renderCalls).toHaveLength(2);
    expect(renderCalls[0]).toMatchObject({ scene: movieScene, camera: movieCamera, xrEnabled: false });
    expect(renderCalls[1]).toMatchObject({ scene: worldScene, camera: VRSpike.camera, xrEnabled: true });
    expect(renderTarget).toBe(xrRenderTarget);
  });

  test('routes a Quest B press to a skippable movie exactly once', () => {
    const buttons = Array.from({ length: 6 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    let skipCount = 0;
    VRSpike.session = {
      inputSources: [{
        handedness: 'right',
        profiles: ['oculus-touch-v3'],
        gamepad: { axes: [], buttons },
      }],
    } as unknown as XRSession;
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => null,
      getFacing: () => 0,
      getWorldContext: () => ({
        module: null,
        position: null,
        room: null,
        roomsVisible: 0,
        roomsTotal: 0,
      }),
      getMovieContext: () => ({
        canSkip: true,
        skip: () => { skipCount += 1; },
      }),
    };

    buttons[5] = { pressed: true, touched: true, value: 1 };
    expect((VRSpike as any).processMovieInput()).toBe(true);
    expect((VRSpike as any).processMovieInput()).toBe(true);

    expect(skipCount).toBe(1);
  });

  test('routes a Quest right-trigger press to a skippable movie exactly once', () => {
    const buttons = Array.from({ length: 6 }, () => ({ pressed: false, touched: false, value: 0 }));
    let skipCount = 0;
    VRSpike.session = {
      inputSources: [{ handedness: 'right', profiles: ['oculus-touch-v3'], gamepad: { axes: [], buttons } }],
    } as unknown as XRSession;
    VRSpike.hooks = {
      update: () => undefined, getPlayerPosition: () => null, getFacing: () => 0,
      getWorldContext: () => ({ module: null, position: null, room: null, roomsVisible: 0, roomsTotal: 0 }),
      getMovieContext: () => ({ canSkip: true, skip: () => { skipCount += 1; } }),
    };

    buttons[4] = { pressed: true, touched: true, value: 1 };
    expect((VRSpike as any).processMovieInput()).toBe(true);
    expect((VRSpike as any).processMovieInput()).toBe(true);
    expect(skipCount).toBe(1);
  });

  test('does not skip a movie the engine has marked non-skippable', () => {
    const buttons = Array.from({ length: 6 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    let skipCount = 0;
    VRSpike.session = {
      inputSources: [{
        handedness: 'right',
        profiles: ['oculus-touch-v3'],
        gamepad: { axes: [], buttons },
      }],
    } as unknown as XRSession;
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => null,
      getFacing: () => 0,
      getWorldContext: () => ({
        module: null,
        position: null,
        room: null,
        roomsVisible: 0,
        roomsTotal: 0,
      }),
      getMovieContext: () => ({
        canSkip: false,
        skip: () => { skipCount += 1; },
      }),
    };

    buttons[5] = { pressed: true, touched: true, value: 1 };
    expect((VRSpike as any).processMovieInput()).toBe(true);

    expect(skipCount).toBe(0);
  });

  test('routes a Quest A press to an authored skippable dialogue line once', () => {
    const buttons = Array.from({ length: 6 }, () => ({ pressed: false, touched: false, value: 0 }));
    let skipCount = 0;
    VRSpike.session = {
      inputSources: [{ handedness: 'right', profiles: ['oculus-touch-v3'], gamepad: { axes: [], buttons } }],
    } as unknown as XRSession;
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => null,
      getFacing: () => 0,
      getWorldContext: () => ({ module: null, position: null, room: null, roomsVisible: 0, roomsTotal: 0 }),
      getCutsceneContext: () => ({ canSkip: true, skip: () => { skipCount += 1; } }),
    };

    buttons[0] = { pressed: true, touched: true, value: 1 };
    expect((VRSpike as any).processMovieInput()).toBe(true);
    expect((VRSpike as any).processMovieInput()).toBe(true);

    expect(skipCount).toBe(1);
  });

  test('aborts an authored unskippable dialogue entry instead of leaving it stuck', () => {
    const buttons = Array.from({ length: 6 }, () => ({ pressed: false, touched: false, value: 0 }));
    let skipCount = 0;
    let abortCount = 0;
    VRSpike.session = {
      inputSources: [{ handedness: 'right', profiles: ['oculus-touch-v3'], gamepad: { axes: [], buttons } }],
    } as unknown as XRSession;
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => null,
      getFacing: () => 0,
      getWorldContext: () => ({ module: null, position: null, room: null, roomsVisible: 0, roomsTotal: 0 }),
      getCutsceneContext: () => ({
        canSkip: false,
        skip: () => { skipCount += 1; },
        abort: () => { abortCount += 1; },
      }),
    };

    buttons[0] = { pressed: true, touched: true, value: 1 };
    (VRSpike as any).processMovieInput();
    (VRSpike as any).processMovieInput();

    expect(skipCount).toBe(0);
    expect(abortCount).toBe(1);
  });

  test('routes a Quest B press to the focused keyboard control cancellation exactly once', () => {
    const buttons = Array.from({ length: 6 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    let cancelCount = 0;
    VRSpike.scene = new THREE.Scene();
    VRSpike.session = {
      inputSources: [{
        handedness: 'right',
        profiles: ['oculus-touch-v3'],
        gamepad: { axes: [], buttons },
      }],
    } as unknown as XRSession;
    (VRSpike as any).latestInputFrame = {
      head: { position: new THREE.Vector3(), orientation: new THREE.Quaternion() },
      hands: {},
    };
    (VRSpike as any).keyboardHost = { clear: jest.fn(), present: jest.fn(), keyAtRay: jest.fn(), isVisible: true };
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => null,
      getFacing: () => 0,
      getWorldContext: () => ({ module: null, position: null, room: null, roomsVisible: 0, roomsTotal: 0 }),
      getKeyboardContext: () => ({ onKeyDown: () => undefined, cancel: () => { cancelCount += 1; } }),
    };

    buttons[5] = { pressed: true, touched: true, value: 1 };
    expect((VRSpike as any).processKeyboardInput()).toBe(true);
    expect((VRSpike as any).processKeyboardInput()).toBe(true);

    expect(cancelCount).toBe(1);
  });

  test('sends a ray-selected keyboard key only to the focused editable sink', () => {
    const buttons = Array.from({ length: 6 }, () => ({ pressed: false, touched: false, value: 0 }));
    const keys: Array<{ readonly which: number; readonly shiftKey: boolean }> = [];
    VRSpike.scene = new THREE.Scene();
    VRSpike.session = {
      inputSources: [{ handedness: 'right', profiles: ['oculus-touch-v3'], gamepad: { axes: [], buttons } }],
    } as unknown as XRSession;
    (VRSpike as any).latestInputFrame = {
      head: { position: new THREE.Vector3(), orientation: new THREE.Quaternion() },
      hands: { right: { targetRayPose: { position: new THREE.Vector3(), orientation: new THREE.Quaternion() } } },
    };
    (VRSpike as any).keyboardHost = {
      clear: jest.fn(), present: jest.fn(), keyAtRay: jest.fn(() => 'A'), isVisible: true,
    };
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => null,
      getFacing: () => 0,
      getWorldContext: () => ({ module: null, position: null, room: null, roomsVisible: 0, roomsTotal: 0 }),
      getKeyboardContext: () => ({ onKeyDown: (event) => keys.push(event), cancel: () => undefined }),
    };

    (VRSpike as any).processKeyboardInput();
    buttons[0] = { pressed: true, touched: true, value: 1 };
    (VRSpike as any).processKeyboardInput();
    (VRSpike as any).processKeyboardInput();

    expect(keys).toEqual([{ which: 65, shiftKey: false }]);
  });

  test('forwards a physical saber swing to the combat bridge while preserving its d20 eligibility', () => {
    const buttons = Array.from({ length: 6 }, () => ({ pressed: false, touched: false, value: 0 }));
    const combatEvents: unknown[] = [];
    VRSpike.session = {
      inputSources: [{ handedness: 'right', profiles: ['oculus-touch-v3'], gamepad: { axes: [], buttons } }],
    } as unknown as XRSession;
    (VRSpike as any).latestInputFrame = {
      head: { position: new THREE.Vector3(), orientation: new THREE.Quaternion(), trackingState: 'tracked' },
      hands: {
        right: {
          pose: { position: new THREE.Vector3(0, 0, 0), orientation: new THREE.Quaternion(), linearVelocity: new THREE.Vector3(0, 2, 0), trackingState: 'tracked' },
          targetRayPose: { position: new THREE.Vector3(), orientation: new THREE.Quaternion(), trackingState: 'tracked' },
        },
      },
    };
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => null,
      getFacing: () => 0,
      getWorldContext: () => ({ module: null, position: null, room: null, roomsVisible: 0, roomsTotal: 0 }),
      getCombatContext: () => ({
        actorId: '7', nominatedTargetId: '42', weaponMode: 'melee-one-handed',
        onCombatSwing: (event) => combatEvents.push(event),
      }),
    };

    (VRSpike as any).processCombatInput(1_000);

    expect(combatEvents).toEqual([expect.objectContaining({ actorId: '7', nominatedTargetId: '42', rollEligible: true })]);
  });

  test('does not invoke combat processing without a nominated hostile target', () => {
    const process = jest.spyOn((VRSpike as any).combatInputController, 'process');
    VRSpike.session = { inputSources: [] } as unknown as XRSession;
    (VRSpike as any).latestInputFrame = {
      head: { position: new THREE.Vector3(), orientation: new THREE.Quaternion() }, hands: {},
    };
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => null,
      getFacing: () => 0,
      getWorldContext: () => ({ module: null, position: null, room: null, roomsVisible: 0, roomsTotal: 0 }),
      getCombatContext: () => ({
        actorId: '7', nominatedTargetId: null, weaponMode: 'unarmed', onCombatSwing: () => undefined,
      }),
    };

    (VRSpike as any).processCombatInput(1_000);

    expect(process).not.toHaveBeenCalled();
  });

  test('cancels an active VR combat request with Quest B exactly once', () => {
    const buttons = Array.from({ length: 6 }, () => ({ pressed: false, touched: false, value: 0 }));
    let cancelCount = 0;
    VRSpike.session = {
      inputSources: [{ handedness: 'right', profiles: ['oculus-touch-v3'], gamepad: { axes: [], buttons } }],
    } as unknown as XRSession;
    (VRSpike as any).latestInputFrame = {
      head: { position: new THREE.Vector3(), orientation: new THREE.Quaternion() },
      hands: { right: { pose: { position: new THREE.Vector3(), orientation: new THREE.Quaternion(), linearVelocity: new THREE.Vector3() } } },
    };
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => null,
      getFacing: () => 0,
      getWorldContext: () => ({ module: null, position: null, room: null, roomsVisible: 0, roomsTotal: 0 }),
      getCombatContext: () => ({
        actorId: '7', nominatedTargetId: '42', weaponMode: 'unarmed',
        onCombatSwing: () => undefined, cancel: () => { cancelCount += 1; },
      }),
    };

    buttons[5] = { pressed: true, touched: true, value: 1 };
    (VRSpike as any).processCombatInput(1_000);
    (VRSpike as any).processCombatInput(1_014);

    expect(cancelCount).toBe(1);
  });

  test('consumes a grip-modified Force flick before it can also activate a nearby object', () => {
    const buttons = Array.from({ length: 6 }, () => ({ pressed: false, touched: false, value: 0 }));
    buttons[1] = { pressed: true, touched: true, value: 1 };
    const gestures: unknown[] = [];
    VRSpike.session = {
      inputSources: [{ handedness: 'right', profiles: ['oculus-touch-v3'], gamepad: { axes: [], buttons } }],
    } as unknown as XRSession;
    (VRSpike as any).latestInputFrame = {
      head: { position: new THREE.Vector3(), orientation: new THREE.Quaternion(), trackingState: 'tracked' },
      hands: {
        right: {
          pose: { position: new THREE.Vector3(), orientation: new THREE.Quaternion(), linearVelocity: new THREE.Vector3(0, 0, -2), trackingState: 'tracked' },
          targetRayPose: { position: new THREE.Vector3(), orientation: new THREE.Quaternion(), trackingState: 'tracked' },
        },
      },
    };
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => null,
      getFacing: () => 0,
      getWorldContext: () => ({ module: null, position: null, room: null, roomsVisible: 0, roomsTotal: 0 }),
      getForceContext: () => ({ onForceGesture: (gesture) => gestures.push(gesture) }),
    };

    expect((VRSpike as any).processForceInput(1_000)).toBe(true);
    expect(gestures).toEqual([expect.objectContaining({ kind: 'push' })]);
  });

  test('aligns neutral headset forward with KOTOR follower-camera forward', () => {
    VRSpike.rig = new THREE.Group();
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => new THREE.Vector3(10, 20, 0),
      getFacing: () => 0,
      getWorldContext: () => ({
        module: null,
        position: null,
        room: null,
        roomsVisible: 0,
        roomsTotal: 0,
      }),
    };

    (VRSpike as any).syncRig(new THREE.PerspectiveCamera());

    expect(
      LocomotionController.worldOrientationToCreatureFacing(VRSpike.rig.quaternion)
    ).toBeCloseTo(Math.PI / 2);
  });

  test('routes Quest movement through head-relative creature locomotion', () => {
    const applied: ResolvedLocomotion[] = [];
    const referenceSpace = {} as XRReferenceSpace;
    const buttons = Array.from({ length: 6 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    const inputSource = {
      handedness: 'left',
      profiles: ['oculus-touch-v3'],
      gamepad: { buttons, axes: [0, 0, 0, -1] },
    } as unknown as XRInputSource;
    const turnInputSource = {
      handedness: 'right',
      profiles: ['oculus-touch-v3'],
      gamepad: { buttons, axes: [0, 0, 1, 0] },
    } as unknown as XRInputSource;
    VRSpike.renderer = {
      xr: { getReferenceSpace: () => referenceSpace },
    } as never;
    VRSpike.session = {
      inputSources: [inputSource, turnInputSource],
    } as unknown as XRSession;
    VRSpike.rig = new THREE.Group();
    XRCoordinateConverter.applyXRToGameBasis(VRSpike.rig);
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => null,
      getFacing: () => 0,
      getPlayerFacing: () => 0,
      applyLocomotion: (locomotion) => applied.push(locomotion),
      getWorldContext: () => ({
        module: null,
        position: null,
        room: null,
        roomsVisible: 0,
        roomsTotal: 0,
      }),
    };
    const frame = {
      getViewerPose: () => ({
        transform: {
          orientation: { x: 0, y: 0, z: 0, w: 1 },
          position: { x: 1, y: 0, z: 0 },
        },
      }),
    } as unknown as XRFrame;

    (VRSpike as any).processLocomotionInput(1000, frame);

    const expectedTurn = -THREE.MathUtils.degToRad(120) / 50;
    expect(applied).toHaveLength(1);
    expect(applied[0].magnitude).toBe(1);
    expect(applied[0].worldDirection.x).toBeCloseTo(-Math.sin(expectedTurn));
    expect(applied[0].worldDirection.y).toBeCloseTo(Math.cos(expectedTurn));
    expect(applied[0].bodyFacing).toBeCloseTo(expectedTurn);
    expect(applied[0].headFacing).toBeCloseTo(0);
    expect((VRSpike as any).turnYaw).toBeCloseTo(expectedTurn);
    expect(VRSpike.yawOffset).toBe(0);
    expect((VRSpike as any).turnOriginOffset.x).toBeCloseTo(1 - Math.cos(expectedTurn));
    expect((VRSpike as any).turnOriginOffset.y).toBeCloseTo(-Math.sin(expectedTurn));
  });

  test('toggles the comfort locomotion mode on an offhand button press edge, once per press', () => {
    const settingsPatches: Array<Record<string, unknown>> = [];
    let locomotionMode: 'smooth' | 'blink' = 'smooth';
    const referenceSpace = {} as XRReferenceSpace;
    const buttons = Array.from({ length: 6 }, () => ({ pressed: false, touched: false, value: 0 }));
    const offhand = {
      handedness: 'left',
      profiles: ['oculus-touch-v3'],
      gamepad: { buttons, axes: [0, 0, 0, 0] },
    } as unknown as XRInputSource;
    VRSpike.renderer = { xr: { getReferenceSpace: () => referenceSpace } } as never;
    VRSpike.session = { inputSources: [offhand] } as unknown as XRSession;
    VRSpike.rig = new THREE.Group();
    XRCoordinateConverter.applyXRToGameBasis(VRSpike.rig);
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => null,
      getFacing: () => 0,
      getPlayerFacing: () => 0,
      applyLocomotion: () => undefined,
      getWorldContext: () => ({ module: null, position: null, room: null, roomsVisible: 0, roomsTotal: 0 }),
      getComfortSettings: () => ({ locomotionMode, turnMode: 'smooth', snapTurnDegrees: 45, vignetteEnabled: false }),
      setComfortSettings: (patch) => {
        settingsPatches.push(patch);
        if (patch.locomotionMode) locomotionMode = patch.locomotionMode;
      },
    };
    const frame = {
      getViewerPose: () => ({
        transform: { orientation: { x: 0, y: 0, z: 0, w: 1 }, position: { x: 0, y: 0, z: 0 } },
      }),
    } as unknown as XRFrame;

    buttons[0] = { pressed: true, touched: true, value: 1 };
    (VRSpike as any).processLocomotionInput(1000, frame);
    (VRSpike as any).processLocomotionInput(1016, frame);

    expect(settingsPatches).toEqual([{ locomotionMode: 'blink' }]);

    buttons[0] = { pressed: false, touched: false, value: 0 };
    (VRSpike as any).processLocomotionInput(1032, frame);
    buttons[0] = { pressed: true, touched: true, value: 1 };
    (VRSpike as any).processLocomotionInput(1048, frame);

    expect(settingsPatches).toEqual([{ locomotionMode: 'blink' }, { locomotionMode: 'smooth' }]);
  });

  test('snap turn applies one fixed increment per deflection instead of a continuous rotation', () => {
    const referenceSpace = {} as XRReferenceSpace;
    const buttons = Array.from({ length: 6 }, () => ({ pressed: false, touched: false, value: 0 }));
    const offhand = {
      handedness: 'left', profiles: ['oculus-touch-v3'], gamepad: { buttons, axes: [0, 0, 0, 0] },
    } as unknown as XRInputSource;
    const dominant = {
      handedness: 'right', profiles: ['oculus-touch-v3'], gamepad: { buttons, axes: [0, 0, 1, 0] },
    } as unknown as XRInputSource;
    VRSpike.renderer = { xr: { getReferenceSpace: () => referenceSpace } } as never;
    VRSpike.session = { inputSources: [offhand, dominant] } as unknown as XRSession;
    VRSpike.rig = new THREE.Group();
    XRCoordinateConverter.applyXRToGameBasis(VRSpike.rig);
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => null,
      getFacing: () => 0,
      getPlayerFacing: () => 0,
      applyLocomotion: () => undefined,
      getWorldContext: () => ({ module: null, position: null, room: null, roomsVisible: 0, roomsTotal: 0 }),
      getComfortSettings: () => ({ locomotionMode: 'smooth', turnMode: 'snap', snapTurnDegrees: 45, vignetteEnabled: false }),
    };
    const frame = {
      getViewerPose: () => ({
        transform: { orientation: { x: 0, y: 0, z: 0, w: 1 }, position: { x: 0, y: 0, z: 0 } },
      }),
    } as unknown as XRFrame;

    (VRSpike as any).processLocomotionInput(1000, frame);
    expect((VRSpike as any).turnYaw).toBeCloseTo(-THREE.MathUtils.degToRad(45));

    // Held past engage without returning to center — must not fire again.
    (VRSpike as any).processLocomotionInput(1016, frame);
    expect((VRSpike as any).turnYaw).toBeCloseTo(-THREE.MathUtils.degToRad(45));
  });

  test('blink-teleport commits a walkmesh-clamped relocation on stick release', () => {
    const referenceSpace = {} as XRReferenceSpace;
    const buttons = Array.from({ length: 6 }, () => ({ pressed: false, touched: false, value: 0 }));
    const axes = [0, 0, 0, -1];
    const offhand = {
      handedness: 'left', profiles: ['oculus-touch-v3'], gamepad: { buttons, axes },
    } as unknown as XRInputSource;
    VRSpike.renderer = { xr: { getReferenceSpace: () => referenceSpace } } as never;
    VRSpike.session = { inputSources: [offhand] } as unknown as XRSession;
    VRSpike.rig = new THREE.Group();
    XRCoordinateConverter.applyXRToGameBasis(VRSpike.rig);
    const teleported: THREE.Vector3[] = [];
    const nearestWalkablePoint = new THREE.Vector3(0, 3, 0);
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => new THREE.Vector3(0, 0, 0),
      getFacing: () => 0,
      getPlayerFacing: () => 0,
      applyLocomotion: () => undefined,
      getWorldContext: () => ({ module: null, position: null, room: null, roomsVisible: 0, roomsTotal: 0 }),
      getComfortSettings: () => ({ locomotionMode: 'blink', turnMode: 'smooth', snapTurnDegrees: 45, vignetteEnabled: false }),
      getCurrentRoomWalkmesh: () => ({
        isPointWalkable: () => false,
        getNearestWalkablePoint: () => nearestWalkablePoint,
      }),
      teleportPlayer: (point) => teleported.push(point.clone()),
    };
    const frame = {
      getViewerPose: () => ({
        transform: { orientation: { x: 0, y: 0, z: 0, w: 1 }, position: { x: 0, y: 0, z: 0 } },
      }),
    } as unknown as XRFrame;

    // Deflect forward to aim — no teleport yet.
    (VRSpike as any).processLocomotionInput(1000, frame);
    expect(teleported).toHaveLength(0);

    // Release — commits, clamped to the mocked nearest walkable point since
    // the raw candidate is reported unwalkable.
    axes[3] = 0;
    (VRSpike as any).processLocomotionInput(1016, frame);
    expect(teleported).toHaveLength(1);
    expect(teleported[0].x).toBeCloseTo(nearestWalkablePoint.x);
    expect(teleported[0].y).toBeCloseTo(nearestWalkablePoint.y);
  });

  test('updates 6DoF controller anchors and hides them when tracking is lost', () => {
    const referenceSpace = {} as XRReferenceSpace;
    const gripSpace = {} as XRSpace;
    VRSpike.rig = new THREE.Group();
    XRCoordinateConverter.applyXRToGameBasis(VRSpike.rig);
    VRSpike.renderer = {
      xr: { getReferenceSpace: () => referenceSpace },
    } as never;
    VRSpike.session = {
      inputSources: [{
        handedness: 'right',
        gripSpace,
        targetRaySpace: gripSpace,
        profiles: ['oculus-touch-v3'],
        gamepad: { axes: [], buttons: [] },
      }],
    } as unknown as XRSession;
    const trackedFrame = {
      getViewerPose: () => xrPose(0, 1.7, 0),
      getPose: (space: XRSpace) => space === gripSpace
        ? xrPose(0.3, 1.2, -0.4)
        : null,
    } as unknown as XRFrame;

    (VRSpike as any).updateTrackedInput(1000, trackedFrame);

    const anchor = VRSpike.rig.getObjectByName('Kotor2VR.rightControllerAnchor');
    expect(anchor).toBeDefined();
    expect(anchor!.visible).toBe(true);
    expect(anchor!.position.toArray()).toEqual([0.3, 1.2, -0.4]);

    (VRSpike as any).updateTrackedInput(1014, {
      getViewerPose: (): XRViewerPose | null => null,
      getPose: (): XRPose | null => null,
    } as unknown as XRFrame);

    expect(anchor!.visible).toBe(false);
  });

  test('rebuilds the main-menu head pose after the rig moves to the current camera origin', () => {
    const referenceSpace = {} as XRReferenceSpace;
    const frame = {
      getViewerPose: () => xrPose(0, 1.7, 0),
      getPose: (): XRPose | null => null,
    } as unknown as XRFrame;
    VRSpike.rig = new THREE.Group();
    VRSpike.renderer = {
      xr: { getReferenceSpace: () => referenceSpace },
    } as never;
    VRSpike.session = { inputSources: [] } as unknown as XRSession;
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => new THREE.Vector3(10, 20, 0),
      getFacing: () => 0,
      getWorldContext: () => ({
        module: null,
        position: null,
        room: null,
        roomsVisible: 0,
        roomsTotal: 0,
      }),
    };

    (VRSpike as any).updateTrackedInput(1000, frame);
    (VRSpike as any).latestXRFrame = frame;
    (VRSpike as any).latestXRFrameTimestamp = 1000;
    (VRSpike as any).syncRig(new THREE.PerspectiveCamera());
    (VRSpike as any).refreshTrackedPresentationPose();

    const head = (VRSpike as any).latestInputFrame.head;
    expect(head.position.toArray()).toEqual([10, 20, 1.7]);
    expect(head.orientation.angleTo(VRSpike.rig.quaternion)).toBeLessThan(1e-10);
  });

  test('routes a Quest use-button to an interaction intent without queuing desktop movement', () => {
    const referenceSpace = {} as XRReferenceSpace;
    const gripSpace = {} as XRSpace;
    const buttons = Array.from({ length: 6 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    const actor = { id: 7, clearAllActions: jest.fn() };
    const target = {
      id: 42,
      position: new THREE.Vector3(0, 2, -1),
      isUseable: () => true,
      onClick: jest.fn(),
    };
    const onInteractionIntent = jest.fn();
    const inputSource = {
      handedness: 'right',
      gripSpace,
      targetRaySpace: gripSpace,
      profiles: ['oculus-touch-v3'],
      gamepad: { axes: [0, 0, 0, 0], buttons },
    } as unknown as XRInputSource;
    VRSpike.rig = new THREE.Group();
    XRCoordinateConverter.applyXRToGameBasis(VRSpike.rig);
    VRSpike.renderer = {
      xr: { getReferenceSpace: () => referenceSpace },
    } as never;
    VRSpike.session = { inputSources: [inputSource] } as unknown as XRSession;
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => null,
      getFacing: () => 0,
      getWorldContext: () => ({
        module: null,
        position: null,
        room: null,
        roomsVisible: 0,
        roomsTotal: 0,
      }),
      getInteractionContext: () => ({
        actor,
        targets: [target],
        onInteractionIntent,
      }),
    };
    const frame = {
      getViewerPose: () => xrPose(0, 0, 0),
      getPose: () => xrPose(0, 0, 0),
    } as unknown as XRFrame;

    (VRSpike as any).updateTrackedInput(1000, frame);
    (VRSpike as any).processInteractionInput(1000);
    buttons[4] = { pressed: true, touched: true, value: 1 };
    (VRSpike as any).updateTrackedInput(1014, frame);
    (VRSpike as any).processInteractionInput(1014);
    (VRSpike as any).processInteractionInput(1028);

    expect(actor.clearAllActions).not.toHaveBeenCalled();
    expect(target.onClick).not.toHaveBeenCalled();
    expect(onInteractionIntent).toHaveBeenCalledTimes(1);
    expect(onInteractionIntent.mock.calls[0][0]).toMatchObject({
      actorId: '7',
      targetId: 'module-object:42',
      interactionMode: 'ray',
    });
  });

});

function xrPose(x: number, y: number, z: number): XRPose {
  return {
    transform: {
      position: { x, y, z, w: 1 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    emulatedPosition: false,
    linearVelocity: null,
    angularVelocity: null,
  } as unknown as XRPose;
}

function createXRLoopHarness(): {
  engineUpdates: Array<{ timestamp: number; source: string }>;
  configurationEvents: string[];
  invokeXRFrame: (timestamp: number, frame?: XRFrame) => void;
  endRawSession: () => void;
  xrRenderTarget: object;
  renderTargetsAtRender: unknown[];
  resetRenderTargetToDesktop: () => void;
} {
  const engineUpdates: Array<{ timestamp: number; source: string }> = [];
  const configurationEvents: string[] = [];
  let xrCallback: CapturedXRCallback | null = null;
  const xrRenderTarget = { isXRRenderTarget: true };
  let currentRenderTarget: unknown = xrRenderTarget;
  const renderTargetsAtRender: unknown[] = [];
  let rawSessionEndListeners: Array<() => void> = [];

  const createSession = (): XRSession => ({
    frameRate: 90,
    addEventListener: (type: string, listener: () => void): void => {
      if (type === 'end') rawSessionEndListeners.push(listener);
    },
    end: (): void => {
      for (const listener of rawSessionEndListeners) listener();
    },
  } as unknown as XRSession);

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
    autoClear: false,
    getRenderTarget: (): unknown => currentRenderTarget,
    setRenderTarget: (target: unknown): void => {
      currentRenderTarget = target;
    },
    render: (): void => {
      renderTargetsAtRender.push(currentRenderTarget);
    },
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
    value: {
      xr: {
        requestSession: async () => {
          rawSessionEndListeners = [];
          return createSession();
        },
      },
    },
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback): number => {
      callback(2000);
      return 1;
    },
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
    endRawSession: () => {
      for (const listener of rawSessionEndListeners) listener();
      // Models Three.js's later raw-session listener completing its teardown
      // synchronously before queued microtasks are allowed to run.
      xrManager.isPresenting = false;
    },
    xrRenderTarget,
    renderTargetsAtRender,
    resetRenderTargetToDesktop: () => {
      currentRenderTarget = null;
    },
  };
}

function restoreGlobal(
  property: 'document' | 'navigator' | 'requestAnimationFrame',
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, property, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, property);
  }
}
