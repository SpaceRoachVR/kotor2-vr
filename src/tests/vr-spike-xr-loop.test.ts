import { VRSpike } from "@/vr/VRSpike";
import * as THREE from 'three';
import { XRCoordinateConverter } from '@/vr/runtime/XRCoordinateConverter';
import {
  LocomotionController,
  ResolvedLocomotion,
} from '@/vr/runtime/LocomotionController';
import { VRHapticFeedback } from '@/vr/runtime/VRHapticFeedback';
import { EngineInteractableObject } from '@/vr/runtime/ModuleObjectInteractionTarget';
import { VRRadialMenuController } from '@/vr/runtime/VRRadialMenuController';
import { VRRadialMenuDefinition } from '@/vr/runtime/VRRadialMenuModel';
import { VRWorldActionPromptController } from '@/vr/runtime/VRWorldActionPromptController';
import {
  VRWorldActionPromptModel,
  VRWorldPromptCandidate,
} from '@/vr/runtime/VRWorldActionPromptModel';
import { XRHandRole, XRWorldPose } from '@/vr/runtime/XRTypes';
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
    (VRSpike as any).radialMenuHost?.dispose?.();
    (VRSpike as any).radialMenuHost = null;
    (VRSpike as any).radialMenuController = new VRRadialMenuController();
    (VRSpike as any).radialMenuPressedLastFrame = false;
    (VRSpike as any).haptics = new VRHapticFeedback();
    (VRSpike as any).worldActionPromptHost?.dispose?.();
    (VRSpike as any).worldActionPromptHost = null;
    (VRSpike as any).worldActionPromptController = new VRWorldActionPromptController();
    (VRSpike as any).worldPromptCandidateId = null;
    (VRSpike as any).worldPromptCandidateStateKey = null;
    (VRSpike as any).worldPromptModelResolved = false;
    (VRSpike as any).worldPromptModel = null;
    (VRSpike as any).worldPromptModule = null;
    (VRSpike as any).worldPromptModuleInitialized = false;
    (VRSpike as any).worldPromptSelectHeld = { left: false, right: false };
    (VRSpike as any).movieOrCutsceneActiveLastFrame = false;
    (VRSpike as any).interactionAimedTargetId = null;

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
        actorId: '7', nominatedTargetId: '42', weaponMode: 'melee-one-handed', inCombat: true,
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
        actorId: '7', nominatedTargetId: null, weaponMode: 'unarmed', inCombat: false,
        onCombatSwing: () => undefined,
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
        actorId: '7', nominatedTargetId: '42', weaponMode: 'unarmed', inCombat: true,
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

  test('activates the ray-hit comfort settings row on a select press edge, once per press', () => {
    const buttons = Array.from({ length: 6 }, () => ({ pressed: false, touched: false, value: 0 }));
    const activatedRows: number[] = [];
    let closed = false;
    VRSpike.scene = new THREE.Scene();
    VRSpike.session = {
      inputSources: [{ handedness: 'right', profiles: ['oculus-touch-v3'], gamepad: { axes: [], buttons } }],
    } as unknown as XRSession;
    (VRSpike as any).latestInputFrame = {
      head: { position: new THREE.Vector3(), orientation: new THREE.Quaternion() },
      hands: { right: { targetRayPose: { position: new THREE.Vector3(), orientation: new THREE.Quaternion() } } },
    };
    (VRSpike as any).comfortSettingsHost = {
      clear: jest.fn(), present: jest.fn(), rowAtRay: jest.fn(() => 2),
    };
    const rows = [
      { label: 'Movement', value: 'Smooth' },
      { label: 'Turning', value: 'Smooth' },
      { label: 'Snap Turn Angle', value: '45°' },
      { label: 'Comfort Vignette', value: 'Off' },
    ];
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => null,
      getFacing: () => 0,
      getWorldContext: () => ({ module: null, position: null, room: null, roomsVisible: 0, roomsTotal: 0 }),
      getComfortSettingsPanelContext: () => ({
        rows,
        activateRow: (index: number) => activatedRows.push(index),
        close: () => { closed = true; },
      }),
    };

    (VRSpike as any).processComfortSettingsInput();
    buttons[0] = { pressed: true, touched: true, value: 1 };
    (VRSpike as any).processComfortSettingsInput();
    (VRSpike as any).processComfortSettingsInput();

    expect(activatedRows).toEqual([2]);

    buttons[0] = { pressed: false, touched: false, value: 0 };
    buttons[5] = { pressed: true, touched: true, value: 1 };
    (VRSpike as any).processComfortSettingsInput();

    expect(closed).toBe(true);
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

  test('keeps ray preview nomination without dispatching generic world activation', () => {
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
      // Positioned so the object's tag — which sits a little above its origin
      // when the engine reports no bounds — lands on the controller ray.
      position: new THREE.Vector3(0, 2, -0.25),
      isUseable: () => true,
      onClick: jest.fn(),
    };
    const genericActivation = jest.spyOn((VRSpike as any).interactionSystem, 'process');
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
      }),
      getWorldActionPromptContext: () => ({
        actor,
        candidates: [],
        createPrompt: () => null,
      }),
    };
    const frame = {
      getViewerPose: () => xrPose(0, 0, 0),
      getPose: () => xrPose(0, 0, 0),
    } as unknown as XRFrame;

    (VRSpike as any).updateTrackedInput(1000, frame);
    (VRSpike as any).processInteractionInput(1000);
    buttons[0] = { pressed: true, touched: true, value: 1 };
    (VRSpike as any).updateTrackedInput(1014, frame);
    (VRSpike as any).processInteractionInput(1014);
    (VRSpike as any).processInteractionInput(1028);

    expect(actor.clearAllActions).not.toHaveBeenCalled();
    expect(target.onClick).not.toHaveBeenCalled();
    expect(genericActivation).not.toHaveBeenCalled();
    expect((VRSpike as any).interactionAimedTargetId).toBe(42);
  });

  test('prompt Select activates exactly once and supersedes generic world interaction', () => {
    const buttons = Array.from({ length: 6 }, releasedButton);
    const promptActivate = jest.fn();
    const genericActivation = jest.spyOn((VRSpike as any).interactionSystem, 'process');
    const actor = { id: 7, position: new THREE.Vector3(), clearAllActions: jest.fn() };
    const target = {
      id: 42,
      objectType: 1 << 13,
      position: new THREE.Vector3(0, 2, 0),
      isUseable: () => true,
      onClick: jest.fn(),
    };
    const model = worldPromptModel('module-object:42', promptActivate);
    VRSpike.scene = new THREE.Scene();
    VRSpike.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
    VRSpike.camera.up.set(0, 0, 1);
    VRSpike.camera.lookAt(new THREE.Vector3(0, 1, 0));
    VRSpike.camera.updateProjectionMatrix();
    VRSpike.camera.updateMatrixWorld(true);
    VRSpike.renderer = {
      xr: { getCamera: () => ({ cameras: [VRSpike.camera] }) },
    } as never;
    VRSpike.session = {
      inputSources: [{
        handedness: 'right',
        profiles: ['oculus-touch-v3'],
        gamepad: { axes: [0, 0, 0, 0], buttons },
      }],
    } as unknown as XRSession;
    (VRSpike as any).latestInputFrame = {
      timestamp: 1_000,
      head: {
        ...worldPose(0, 0, 1.7),
        orientation: new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0),
          Math.PI / 2,
        ),
      },
      hands: {
        right: {
          hand: 'right',
          pose: worldPose(0, 0, 1.2),
          targetRayPose: worldPose(0, 0, 1.2),
          buttons: {},
          axes: [],
          interactionProfile: 'oculus-touch-v3',
        },
      },
      activeInteractionProfiles: ['oculus-touch-v3'],
    };
    const promptHost = {
      present: jest.fn(),
      resolveRay: jest.fn(() => 'direct-use:42'),
      clear: jest.fn(),
      dispose: jest.fn(),
    };
    (VRSpike as any).worldActionPromptHost = promptHost;
    const pulse = jest.fn(async (
      _session: XRSession,
      _hand: XRHandRole,
      _pattern: { readonly durationMs: number; readonly amplitude: number },
    ): Promise<void> => undefined);
    (VRSpike as any).haptics = { pulse };
    VRSpike.hooks = basicHooks({
      getInteractionContext: () => ({ actor, targets: [target] }),
      getWorldActionPromptContext: () => ({
        actor,
        candidates: [{
          id: 'module-object:42',
          name: 'Galaxy Map',
          position: new THREE.Vector3(0, 2, 1),
          actorDistanceMetres: 2,
          hasActions: true,
          inRange: true,
        }],
        createPrompt: () => model,
      }),
    } as never);

    (VRSpike as any).processInteractionInput(1_000);
    buttons[0] = pressedButton();
    (VRSpike as any).processInteractionInput(1_016);
    (VRSpike as any).processInteractionInput(1_032);

    expect(promptActivate).toHaveBeenCalledTimes(1);
    expect(genericActivation).not.toHaveBeenCalled();
    expect(target.onClick).not.toHaveBeenCalled();
    expect(pulse).toHaveBeenCalledWith(expect.anything(), 'right', { durationMs: 35, amplitude: 0.35 });
    expect(promptHost.clear.mock.invocationCallOrder.some(
      (callOrder: number) => callOrder < promptActivate.mock.invocationCallOrder[0]
    )).toBe(true);
  });

  test('lets either ray nominate an eligible object and otherwise prefers the head center', () => {
    const center = promptCandidate('module-object:1', 0, 2);
    const offCenter = promptCandidate('module-object:2', 1, 2);
    const createPrompt = jest.fn((targetId: string) => worldPromptModelForTarget(targetId));
    installWorldPromptHarness([center, offCenter], createPrompt);
    const preview = jest.spyOn((VRSpike as any).interactionSystem, 'preview');

    preview.mockReturnValue(null);
    (VRSpike as any).processInteractionInput(1_000);
    expect((VRSpike as any).worldPromptCandidateId).toBe('module-object:1');

    preview.mockImplementation((_frame: unknown, hand: XRHandRole) => hand === 'left'
      ? rayPreview(offCenter)
      : null);
    (VRSpike as any).processInteractionInput(1_016);
    expect((VRSpike as any).worldPromptCandidateId).toBe('module-object:2');

    preview.mockImplementation((_frame: unknown, hand: XRHandRole) => hand === 'right'
      ? rayPreview(center)
      : null);
    (VRSpike as any).processInteractionInput(1_032);
    expect((VRSpike as any).worldPromptCandidateId).toBe('module-object:1');
    expect(createPrompt.mock.calls.map(([targetId]) => targetId)).toEqual([
      'module-object:1',
      'module-object:2',
      'module-object:1',
    ]);
  });

  test('clears immediately on range, eye-frustum, cone, list, or action loss', () => {
    const candidate = promptCandidate('module-object:42', 0, 2);
    let candidates = [candidate];
    let actionAvailable = true;
    const createPrompt = jest.fn(() => actionAvailable
      ? worldPromptModelForTarget('module-object:42', () => actionAvailable)
      : null);
    const harness = installWorldPromptHarness(candidates, createPrompt, () => candidates);
    jest.spyOn((VRSpike as any).interactionSystem, 'preview').mockReturnValue(null);

    (VRSpike as any).processInteractionInput(1_000);
    expect((VRSpike as any).worldPromptCandidateId).toBe('module-object:42');

    candidates = [{ ...candidate, inRange: false }];
    (VRSpike as any).processInteractionInput(1_016);
    expectPromptCleared(harness.host);

    // Thirty degrees is inside the 55-degree prompt cone, but outside this
    // deliberately narrow 20-degree eye camera.
    candidates = [promptCandidate('module-object:42', 1, Math.sqrt(3))];
    harness.eyeCamera.fov = 20;
    harness.eyeCamera.updateProjectionMatrix();
    (VRSpike as any).processInteractionInput(1_032);
    expectPromptCleared(harness.host);

    // Sixty degrees is visible in the widened eye camera but outside the
    // horizontal prompt cone.
    candidates = [promptCandidate('module-object:42', Math.sqrt(3), 1)];
    harness.eyeCamera.fov = 120;
    harness.eyeCamera.updateProjectionMatrix();
    (VRSpike as any).processInteractionInput(1_048);
    expectPromptCleared(harness.host);

    // The engine's selectable list is also the LOS/object-liveness source.
    candidates = [];
    (VRSpike as any).processInteractionInput(1_064);
    expectPromptCleared(harness.host);

    candidates = [candidate];
    (VRSpike as any).processInteractionInput(1_080);
    actionAvailable = false;
    candidates = [{ ...candidate, hasActions: false }];
    (VRSpike as any).processInteractionInput(1_096);
    expectPromptCleared(harness.host);
  });

  test('accepts an anchor visible to either XR eye frustum', () => {
    const leftEye = createEyeCamera(0, 1);
    const rightEye = createEyeCamera(0, -1);
    VRSpike.camera = new THREE.PerspectiveCamera();
    VRSpike.renderer = {
      xr: { getCamera: () => ({ cameras: [leftEye, rightEye] }) },
    } as never;

    const isVisible = (VRSpike as any).createPerEyeFrustumPredicate();

    expect(isVisible(new THREE.Vector3(0, 2, 1))).toBe(true);
    expect(isVisible(new THREE.Vector3(20, 0, 1))).toBe(false);
  });

  test('clears on module transition and rebuilds eligibility on the next stable frame', () => {
    let module = '101PER';
    const candidate = promptCandidate('module-object:42', 0, 2);
    const createPrompt = jest.fn(() => worldPromptModelForTarget('module-object:42'));
    const harness = installWorldPromptHarness([candidate], createPrompt, undefined, () => module);
    jest.spyOn((VRSpike as any).interactionSystem, 'preview').mockReturnValue(null);

    (VRSpike as any).processInteractionInput(1_000);
    module = '102PER';
    (VRSpike as any).processInteractionInput(1_016);

    expectPromptCleared(harness.host);
    expect(createPrompt).toHaveBeenCalledTimes(1);

    (VRSpike as any).processInteractionInput(1_032);
    expect(createPrompt).toHaveBeenCalledTimes(2);
    expect((VRSpike as any).worldPromptCandidateId).toBe('module-object:42');
  });

  test('reuses a stable selected prompt model without polling every action', () => {
    const candidate = { ...promptCandidate('module-object:42', 0, 2), stateKey: 'stable-v1' };
    const revalidate = jest.fn(() => true);
    const createPrompt = jest.fn(() => worldPromptModelForTarget(candidate.id, revalidate));
    installWorldPromptHarness([candidate], createPrompt);
    jest.spyOn((VRSpike as any).interactionSystem, 'preview').mockReturnValue(null);

    (VRSpike as any).processInteractionInput(1_000);
    (VRSpike as any).processInteractionInput(1_016);

    expect(createPrompt).toHaveBeenCalledTimes(1);
    expect(revalidate).not.toHaveBeenCalled();
  });

  test('rebuilds the selected prompt when its authored availability state changes', () => {
    let stateKey = 'authored-v1';
    const baseCandidate = promptCandidate('module-object:42', 0, 2);
    const createPrompt = jest.fn(() => ({
      ...worldPromptModelForTarget(baseCandidate.id),
      id: `prompt:${stateKey}`,
    }));
    installWorldPromptHarness(
      [{ ...baseCandidate, stateKey }],
      createPrompt,
      () => [{ ...baseCandidate, stateKey }],
    );
    jest.spyOn((VRSpike as any).interactionSystem, 'preview').mockReturnValue(null);

    (VRSpike as any).processInteractionInput(1_000);
    stateKey = 'authored-v2';
    (VRSpike as any).processInteractionInput(1_016);

    expect(createPrompt).toHaveBeenCalledTimes(2);
    expect((VRSpike as any).worldPromptModel?.id).toBe('prompt:authored-v2');
  });

  test('rebuilds a moving target from one shared anchor so prompt and label stay aligned', () => {
    let candidate = { ...promptCandidate('module-object:42', 0, 2), stateKey: 'anchor:0:2:1' };
    const createPrompt = jest.fn(() => ({
      ...worldPromptModelForTarget(candidate.id),
      anchor: candidate.position,
    }));
    installWorldPromptHarness([candidate], createPrompt, () => [candidate]);
    jest.spyOn((VRSpike as any).interactionSystem, 'preview').mockReturnValue(null);

    (VRSpike as any).processInteractionInput(1_000);
    candidate = {
      ...promptCandidate('module-object:42', 0.25, 2),
      stateKey: 'anchor:0.25:2:1',
    };
    (VRSpike as any).processInteractionInput(1_016);

    expect(createPrompt).toHaveBeenCalledTimes(2);
    expect((VRSpike as any).worldPromptModel?.anchor).toBe(candidate.position);
    expect((VRSpike as any).interactionPreviewIndicator?.position).toBe(candidate.position);
  });

  test('opens the action wheel once from left X at the captured head pose without pausing', () => {
    const input = installRadialInput();
    const host = installRadialHost();
    const setPaused = jest.fn();
    const createActionWheel = jest.fn((_aimedTargetId: number | null) => actionWheel());
    (VRSpike as any).interactionAimedTargetId = 42;
    VRSpike.hooks = basicHooks({ createActionWheel, setPaused } as never);

    input.leftButtons[4] = pressedButton();

    expect((VRSpike as any).processRadialMenuInput()).toBe(true);
    expect(createActionWheel).toHaveBeenCalledTimes(1);
    expect(createActionWheel).toHaveBeenCalledWith(42);
    expect(host.present).toHaveBeenCalledWith(
      expect.objectContaining({ menu: expect.objectContaining({ id: 'test-wheel' }) }),
      input.headPose,
    );
    expect(setPaused).not.toHaveBeenCalled();
  });

  test('confirms the current left-ray hit once and clears the host before engine activation', () => {
    const activate = jest.fn();
    const input = installRadialInput();
    const host = installRadialHost({
      rayHit: { kind: 'entry', index: 0 },
    });
    VRSpike.hooks = basicHooks({ createActionWheel: () => actionWheel(activate) });
    input.leftButtons[4] = pressedButton();
    (VRSpike as any).processRadialMenuInput();

    input.leftButtons[0] = pressedButton();
    (VRSpike as any).processRadialMenuInput();
    (VRSpike as any).processRadialMenuInput();

    expect(host.resolveRay).toHaveBeenCalledWith(input.leftTargetRayPose);
    expect(activate).toHaveBeenCalledTimes(1);
    const activationOrder = activate.mock.invocationCallOrder[0];
    expect(host.clear.mock.invocationCallOrder.some((callOrder: number) => callOrder < activationOrder)).toBe(true);
  });

  test('lets either tracked touch activate and does not reopen while X remains held', () => {
    const activate = jest.fn();
    const input = installRadialInput();
    let activeTouchX = -0.2;
    const host = installRadialHost({
      touchHit: (probe) => probe.x === activeTouchX ? { kind: 'entry', index: 0 } : null,
    });
    const createActionWheel = jest.fn(() => actionWheel(activate));
    const pulse = jest.fn(async (
      _session: XRSession,
      _hand: XRHandRole,
      _pattern: { readonly durationMs: number; readonly amplitude: number },
    ): Promise<void> => undefined);
    (VRSpike as any).haptics = { pulse };
    VRSpike.hooks = basicHooks({ createActionWheel });

    input.leftButtons[4] = pressedButton();
    (VRSpike as any).processRadialMenuInput();
    (VRSpike as any).processRadialMenuInput();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(createActionWheel).toHaveBeenCalledTimes(1);

    input.leftButtons[4] = releasedButton();
    (VRSpike as any).processRadialMenuInput();
    activeTouchX = 0.2;
    input.leftButtons[4] = pressedButton();
    (VRSpike as any).processRadialMenuInput();
    (VRSpike as any).processRadialMenuInput();

    expect(activate).toHaveBeenCalledTimes(2);
    expect(host.resolveTouch).toHaveBeenCalledWith(input.leftTargetRayPose.position);
    expect(host.resolveTouch).toHaveBeenCalledWith(input.rightTargetRayPose.position);
    expect(pulse).toHaveBeenCalledWith(expect.anything(), 'left', { durationMs: 35, amplitude: 0.35 });
    expect(pulse).toHaveBeenCalledWith(expect.anything(), 'right', { durationMs: 35, amplitude: 0.35 });
  });

  test('center trigger cancels, no-target trigger does nothing, and X release never activates', () => {
    const activate = jest.fn();
    const input = installRadialInput();
    let rayHit: { kind: 'center' } | null = null;
    installRadialHost({ touchHit: () => null, rayHit: () => rayHit });
    VRSpike.hooks = basicHooks({ createActionWheel: () => actionWheel(activate) });
    input.leftButtons[4] = pressedButton();
    (VRSpike as any).processRadialMenuInput();

    input.leftButtons[0] = pressedButton();
    (VRSpike as any).processRadialMenuInput();
    expect((VRSpike as any).radialMenuController.isOpen).toBe(true);
    input.leftButtons[0] = releasedButton();
    (VRSpike as any).processRadialMenuInput();
    rayHit = { kind: 'center' };
    input.leftButtons[0] = pressedButton();
    (VRSpike as any).processRadialMenuInput();
    expect((VRSpike as any).radialMenuController.isOpen).toBe(false);

    input.leftButtons[4] = releasedButton();
    input.leftButtons[0] = releasedButton();
    (VRSpike as any).processRadialMenuInput();
    input.leftButtons[4] = pressedButton();
    (VRSpike as any).processRadialMenuInput();
    input.leftButtons[4] = releasedButton();
    (VRSpike as any).processRadialMenuInput();

    expect(activate).not.toHaveBeenCalled();
  });

  test('continues locomotion while an open wheel suppresses interaction and combat', () => {
    const input = installRadialInput();
    installRadialHost();
    VRSpike.hooks = basicHooks({ createActionWheel: () => actionWheel() });
    input.leftButtons[4] = pressedButton();
    (VRSpike as any).processRadialMenuInput();

    jest.spyOn(VRSpike as any, 'updateTrackedInput').mockImplementation(() => undefined);
    jest.spyOn(VRSpike as any, 'processMovieInput').mockReturnValue(false);
    jest.spyOn(VRSpike as any, 'processKeyboardInput').mockReturnValue(false);
    const radial = jest.spyOn(VRSpike as any, 'processRadialMenuInput');
    jest.spyOn(VRSpike as any, 'processComfortSettingsInput');
    jest.spyOn(VRSpike as any, 'processPanelInput');
    const locomotion = jest.spyOn(VRSpike as any, 'processLocomotionInput').mockImplementation(() => undefined);
    const interaction = jest.spyOn(VRSpike as any, 'processInteractionInput').mockReturnValue(false);
    const combat = jest.spyOn(VRSpike as any, 'processCombatInput').mockImplementation(() => undefined);
    const clearTargets = jest.spyOn((VRSpike as any).interactionTargetSet, 'clear');
    const cancelInteraction = jest.spyOn((VRSpike as any).interactionSystem, 'cancelTransientState');
    const promptHost = { clear: jest.fn(), dispose: jest.fn() };
    (VRSpike as any).worldActionPromptHost = promptHost;

    (VRSpike as any).frame(1_000, {} as XRFrame);

    expect(radial).toHaveReturnedWith(true);
    expect(locomotion).toHaveBeenCalledTimes(1);
    expect(interaction).not.toHaveBeenCalled();
    expect(combat).not.toHaveBeenCalled();
    expect(clearTargets).toHaveBeenCalled();
    expect(cancelInteraction).toHaveBeenCalled();
    expect(promptHost.clear).toHaveBeenCalled();

    input.leftButtons[4] = releasedButton();
    (VRSpike as any).frame(1_016, {} as XRFrame);
    (VRSpike as any).frame(1_032, {} as XRFrame);

    expect(interaction).toHaveBeenCalledTimes(1);
  });

  test('observes X release under foreground ownership so the next fresh press opens', () => {
    const input = installRadialInput();
    installRadialHost();
    const createActionWheel = jest.fn((_aimedTargetId: number | null) => actionWheel());
    VRSpike.hooks = basicHooks({ createActionWheel });
    input.leftButtons[4] = pressedButton();

    (VRSpike as any).processRadialMenuInput();
    expect(createActionWheel).toHaveBeenCalledTimes(1);

    jest.spyOn(VRSpike as any, 'updateTrackedInput').mockImplementation(() => undefined);
    jest.spyOn(VRSpike as any, 'processMovieInput').mockReturnValue(false);
    jest.spyOn(VRSpike as any, 'processKeyboardInput').mockReturnValue(false);
    jest.spyOn(VRSpike as any, 'processComfortSettingsInput').mockReturnValue(false);
    jest.spyOn(VRSpike as any, 'processPanelInput')
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    jest.spyOn(VRSpike as any, 'processLocomotionInput').mockImplementation(() => undefined);
    jest.spyOn(VRSpike as any, 'processInteractionInput').mockReturnValue(false);
    jest.spyOn(VRSpike as any, 'processCombatInput').mockImplementation(() => undefined);
    const promptHost = { clear: jest.fn(), dispose: jest.fn() };
    (VRSpike as any).worldActionPromptHost = promptHost;

    (VRSpike as any).frame(1_000, {} as XRFrame);
    expect(promptHost.clear).toHaveBeenCalled();
    input.leftButtons[4] = releasedButton();
    (VRSpike as any).frame(1_016, {} as XRFrame);
    input.leftButtons[4] = pressedButton();
    (VRSpike as any).frame(1_032, {} as XRFrame);

    expect(createActionWheel).toHaveBeenCalledTimes(2);
    expect((VRSpike as any).radialMenuController.isOpen).toBe(true);
  });

  test('module transition closes an open wheel before a stale touch can activate it', () => {
    const activate = jest.fn();
    const input = installRadialInput();
    let module = '101PER';
    const actor = { id: 7, position: new THREE.Vector3(), clearAllActions: jest.fn() };
    const host = installRadialHost({
      touchHit: (probe) => probe === input.rightTargetRayPose.position
        ? { kind: 'entry', index: 0 }
        : null,
    });
    const createActionWheel = jest.fn(() => actionWheel(activate));
    VRSpike.hooks = basicHooks({
      createActionWheel,
      getInteractionContext: () => ({ actor, targets: [] as readonly EngineInteractableObject[] }),
      getWorldActionPromptContext: () => ({
        actor,
        candidates: [] as readonly VRWorldPromptCandidate[],
        createPrompt: (): VRWorldActionPromptModel | null => null,
      }),
      getWorldContext: () => ({
        module,
        position: actor.position,
        room: null as string | null,
        roomsVisible: 0,
        roomsTotal: 0,
      }),
    });
    jest.spyOn(VRSpike as any, 'updateTrackedInput').mockImplementation(() => undefined);

    // Establish the outgoing module, then open the wheel on a later frame.
    (VRSpike as any).frame(1_000, {} as XRFrame);
    input.leftButtons[4] = pressedButton();
    (VRSpike as any).frame(1_016, {} as XRFrame);
    expect((VRSpike as any).radialMenuController.isOpen).toBe(true);
    host.clear.mockClear();
    const cancelTransientState = jest.spyOn((VRSpike as any).interactionSystem, 'cancelTransientState');
    cancelTransientState.mockClear();

    module = '102PER';
    (VRSpike as any).frame(1_032, {} as XRFrame);
    (VRSpike as any).frame(1_048, {} as XRFrame);

    expect((VRSpike as any).radialMenuController.isOpen).toBe(false);
    expect(activate).not.toHaveBeenCalled();
    expect(host.clear).toHaveBeenCalled();
    expect(cancelTransientState).toHaveBeenCalled();
    expect(createActionWheel).toHaveBeenCalledTimes(1);

    // The held X/touch state must not become a new opening in the new module.
    input.leftButtons[4] = releasedButton();
    (VRSpike as any).frame(1_064, {} as XRFrame);
    input.leftButtons[4] = pressedButton();
    (VRSpike as any).frame(1_080, {} as XRFrame);
    expect(createActionWheel).toHaveBeenCalledTimes(2);
    expect((VRSpike as any).radialMenuController.isOpen).toBe(true);
  });

  test.each([
    { label: 'skippable dialogue', canSkip: true, expectedDispatch: 'skip' as const },
    { label: 'unskippable dialogue', canSkip: false, expectedDispatch: 'abort' as const },
  ])('$label entry latches held input before dispatch and requires a fresh press', ({
    canSkip,
    expectedDispatch,
  }) => {
    const activate = jest.fn();
    const input = installRadialInput();
    let cutsceneActive = false;
    let skipCount = 0;
    let abortCount = 0;
    const host = installRadialHost({
      rayHit: { kind: 'entry', index: 0 },
      touchHit: () => null,
    });
    const createActionWheel = jest.fn(() => actionWheel(activate));
    const cutsceneContext = {
      canSkip,
      skip: (): void => {
        skipCount += 1;
        cutsceneActive = false;
      },
      abort: (): void => {
        abortCount += 1;
        cutsceneActive = false;
      },
    };
    VRSpike.hooks = basicHooks({
      createActionWheel,
      getCutsceneContext: () => cutsceneActive
        ? cutsceneContext
        : null,
    });
    jest.spyOn(VRSpike as any, 'updateTrackedInput').mockImplementation(() => undefined);

    input.leftButtons[4] = pressedButton();
    (VRSpike as any).frame(1_000, {} as XRFrame);
    expect((VRSpike as any).radialMenuController.isOpen).toBe(true);
    host.clear.mockClear();

    cutsceneActive = true;
    // The wheel confirm and dialogue Select are both already down on the
    // transition frame. A real dialogue callback ends the context
    // synchronously, which used to let the same frame fall through to the
    // still-open wheel after skip/abort mutated engine state.
    input.leftButtons[0] = pressedButton();
    input.rightButtons[0] = pressedButton();
    (VRSpike as any).frame(1_016, {} as XRFrame);
    (VRSpike as any).frame(1_032, {} as XRFrame);

    expect(skipCount).toBe(0);
    expect(abortCount).toBe(0);
    expect(cutsceneActive).toBe(true);
    expect((VRSpike as any).radialMenuController.isOpen).toBe(false);
    expect(activate).not.toHaveBeenCalled();
    expect(host.clear).toHaveBeenCalled();
    expect(createActionWheel).toHaveBeenCalledTimes(1);
    expect((VRSpike as any).worldPromptSelectHeld.left).toBe(true);

    // Only a physical release rearms dialogue input. The release itself does
    // not dispatch and the stale wheel hit remains retired.
    input.leftButtons[4] = releasedButton();
    input.leftButtons[0] = releasedButton();
    input.rightButtons[0] = releasedButton();
    (VRSpike as any).frame(1_048, {} as XRFrame);
    expect(skipCount).toBe(0);
    expect(abortCount).toBe(0);
    expect(activate).not.toHaveBeenCalled();
    expect((VRSpike as any).worldPromptSelectHeld.left).toBe(false);

    // A genuinely fresh dialogue Select may now use the surviving authored
    // context; its synchronous close still cannot revive the retired wheel.
    input.rightButtons[0] = pressedButton();
    (VRSpike as any).frame(1_064, {} as XRFrame);
    (VRSpike as any).frame(1_080, {} as XRFrame);
    expect(skipCount).toBe(expectedDispatch === 'skip' ? 1 : 0);
    expect(abortCount).toBe(expectedDispatch === 'abort' ? 1 : 0);
    expect(cutsceneActive).toBe(false);
    expect(activate).not.toHaveBeenCalled();
    expect(createActionWheel).toHaveBeenCalledTimes(1);
  });

  test.each(['tracking unavailable', 'session end'] as const)(
    '%s closes without activation and disposes radial host resources',
    (reason) => {
      const activate = jest.fn();
      const input = installRadialInput();
      const host = installRadialHost();
      const promptHost = { clear: jest.fn(), dispose: jest.fn() };
      (VRSpike as any).worldActionPromptHost = promptHost;
      VRSpike.hooks = basicHooks({ createActionWheel: () => actionWheel(activate) });
      input.leftButtons[4] = pressedButton();
      (VRSpike as any).processRadialMenuInput();

      if (reason === 'tracking unavailable') {
        (VRSpike as any).clearTrackedInput();
      } else {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: { getElementById: (): null => null },
        });
        Object.defineProperty(globalThis, 'requestAnimationFrame', {
          configurable: true,
          value: () => 1,
        });
        (VRSpike as any).finishSessionEnd();
      }

      expect((VRSpike as any).radialMenuController.isOpen).toBe(false);
      expect(host.dispose).toHaveBeenCalledTimes(1);
      if (reason === 'tracking unavailable') {
        expect(promptHost.clear).toHaveBeenCalled();
        expect(promptHost.dispose).not.toHaveBeenCalled();
      } else {
        expect(promptHost.dispose).toHaveBeenCalledTimes(1);
      }
      expect(activate).not.toHaveBeenCalled();
    },
  );

});

function basicHooks(overrides: Record<string, unknown> = {}): any {
  return {
    update: (_timestamp: number, _source: string): void => undefined,
    getPlayerPosition: (): THREE.Vector3 | null => null,
    getFacing: (): number => 0,
    getWorldContext: (): any => ({
      module: null as string | null,
      position: null as THREE.Vector3 | null,
      room: null as string | null,
      roomsVisible: 0,
      roomsTotal: 0,
    }),
    ...overrides,
  };
}

function installWorldPromptHarness(
  initialCandidates: readonly ReturnType<typeof promptCandidate>[],
  createPrompt: (targetId: string) => VRWorldActionPromptModel | null,
  getCandidates: (() => readonly ReturnType<typeof promptCandidate>[]) | undefined = undefined,
  getModule: (() => string | null) = () => '101PER',
): {
  readonly host: {
    present: jest.Mock;
    resolveRay: jest.Mock;
    clear: jest.Mock;
    dispose: jest.Mock;
  };
  readonly eyeCamera: THREE.PerspectiveCamera;
} {
  const leftButtons = Array.from({ length: 6 }, releasedButton);
  const rightButtons = Array.from({ length: 6 }, releasedButton);
  const actor = { id: 7, position: new THREE.Vector3(), clearAllActions: jest.fn() };
  const eyeCamera = createEyeCamera(0, 1);
  const head = worldPose(0, 0, 1.7);
  head.orientation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  VRSpike.scene = new THREE.Scene();
  VRSpike.camera = new THREE.PerspectiveCamera();
  VRSpike.renderer = {
    xr: { getCamera: () => ({ cameras: [eyeCamera] }) },
  } as never;
  VRSpike.session = {
    inputSources: [
      { handedness: 'left', profiles: ['oculus-touch-v3'], gamepad: { axes: [0, 0, 0, 0], buttons: leftButtons } },
      { handedness: 'right', profiles: ['oculus-touch-v3'], gamepad: { axes: [0, 0, 0, 0], buttons: rightButtons } },
    ],
  } as unknown as XRSession;
  (VRSpike as any).latestInputFrame = {
    timestamp: 1_000,
    head,
    hands: {
      left: { hand: 'left', pose: worldPose(-0.2, 0, 1.2), targetRayPose: worldPose(-0.2, 0, 1.2), buttons: {}, axes: [], interactionProfile: 'oculus-touch-v3' },
      right: { hand: 'right', pose: worldPose(0.2, 0, 1.2), targetRayPose: worldPose(0.2, 0, 1.2), buttons: {}, axes: [], interactionProfile: 'oculus-touch-v3' },
    },
    activeInteractionProfiles: ['oculus-touch-v3'],
  };
  const host = {
    present: jest.fn(),
    resolveRay: jest.fn(() => null),
    clear: jest.fn(),
    dispose: jest.fn(),
  };
  (VRSpike as any).worldActionPromptHost = host;
  (VRSpike as any).worldActionPromptController = new VRWorldActionPromptController();
  (VRSpike as any).worldPromptCandidateId = null;
  (VRSpike as any).worldPromptCandidateStateKey = null;
  (VRSpike as any).worldPromptModelResolved = false;
  (VRSpike as any).worldPromptModel = null;
  (VRSpike as any).worldPromptModule = null;
  (VRSpike as any).worldPromptModuleInitialized = false;
  (VRSpike as any).worldPromptSelectHeld = { left: false, right: false };
  VRSpike.hooks = basicHooks({
    getInteractionContext: () => ({ actor, targets: [] as unknown as readonly EngineInteractableObject[] }),
    getWorldActionPromptContext: () => ({
      actor,
      candidates: getCandidates?.() ?? initialCandidates,
      createPrompt: (candidate: ReturnType<typeof promptCandidate>) => createPrompt(candidate.id),
    }),
    getWorldContext: () => ({
      module: getModule(),
      position: actor.position,
      room: null as string | null,
      roomsVisible: 0,
      roomsTotal: 0,
    }),
  });
  return { host, eyeCamera };
}

function promptCandidate(id: string, x: number, y: number): VRWorldPromptCandidate {
  return {
    id,
    name: id === 'module-object:1' ? 'Center' : 'Object',
    position: new THREE.Vector3(x, y, 1),
    actorDistanceMetres: Math.hypot(x, y),
    hasActions: true,
    inRange: true,
  };
}

function worldPromptModelForTarget(
  targetId: string,
  revalidate: () => boolean = () => true,
): VRWorldActionPromptModel {
  return {
    id: `prompt:${targetId}`,
    name: targetId,
    anchor: new THREE.Vector3(0, 2, 1),
    pages: [{
      index: 0,
      entries: [{
        kind: 'action',
        id: `action:${targetId}`,
        label: 'Use',
        revalidate,
        activate: jest.fn(),
      }],
    }],
  };
}

function rayPreview(candidate: ReturnType<typeof promptCandidate>) {
  return {
    id: candidate.id,
    label: candidate.name,
    interactionMode: 'ray' as const,
    position: candidate.position,
  };
}

function createEyeCamera(xDirection: number, yDirection: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
  camera.position.set(0, 0, 1.7);
  camera.up.set(0, 0, 1);
  camera.lookAt(new THREE.Vector3(xDirection, yDirection, 1.7));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function expectPromptCleared(host: { clear: jest.Mock }): void {
  expect((VRSpike as any).worldPromptCandidateId).toBeNull();
  expect((VRSpike as any).worldPromptModel).toBeNull();
  expect((VRSpike as any).interactionPreviewIndicator).toBeNull();
  expect(host.clear).toHaveBeenCalled();
}

function actionWheel(activate = jest.fn()): VRRadialMenuDefinition {
  return {
    id: 'test-wheel',
    title: 'Actions',
    pages: [{
      index: 0,
      entries: [{
        kind: 'action',
        id: 'test-action',
        label: 'Test Action',
        revalidate: () => true,
        activate,
      }],
    }],
  };
}

function worldPromptModel(id: string, activate = jest.fn()): VRWorldActionPromptModel {
  return {
    id,
    name: 'Galaxy Map',
    anchor: new THREE.Vector3(0, 2, 1),
    pages: [{
      index: 0,
      entries: [{
        kind: 'action',
        id: 'direct-use:42',
        label: 'Use: Galaxy Map',
        revalidate: () => true,
        activate,
      }],
    }],
  };
}

function installRadialInput(): {
  readonly leftButtons: Array<{ pressed: boolean; touched: boolean; value: number }>;
  readonly rightButtons: Array<{ pressed: boolean; touched: boolean; value: number }>;
  readonly headPose: ReturnType<typeof worldPose>;
  readonly leftTargetRayPose: ReturnType<typeof worldPose>;
  readonly rightTargetRayPose: ReturnType<typeof worldPose>;
} {
  const leftButtons = Array.from({ length: 6 }, releasedButton);
  const rightButtons = Array.from({ length: 6 }, releasedButton);
  const headPose = worldPose(0, 0, 1.7);
  const leftTargetRayPose = worldPose(-0.2, 0.4, 1.2);
  const rightTargetRayPose = worldPose(0.2, 0.4, 1.2);
  VRSpike.scene = new THREE.Scene();
  VRSpike.session = {
    inputSources: [
      { handedness: 'left', profiles: ['oculus-touch-v3'], gamepad: { axes: [0, 0, 0, 0], buttons: leftButtons } },
      { handedness: 'right', profiles: ['oculus-touch-v3'], gamepad: { axes: [0, 0, 0, 0], buttons: rightButtons } },
    ],
  } as unknown as XRSession;
  (VRSpike as any).latestInputFrame = {
    timestamp: 1_000,
    head: headPose,
    hands: {
      left: { hand: 'left', pose: worldPose(-0.2, 0.4, 1.2), targetRayPose: leftTargetRayPose, buttons: {}, axes: [], interactionProfile: 'oculus-touch-v3' },
      right: { hand: 'right', pose: worldPose(0.2, 0.4, 1.2), targetRayPose: rightTargetRayPose, buttons: {}, axes: [], interactionProfile: 'oculus-touch-v3' },
    },
    activeInteractionProfiles: ['oculus-touch-v3'],
  };
  (VRSpike as any).radialMenuController = new VRRadialMenuController();
  (VRSpike as any).radialMenuPressedLastFrame = false;
  return { leftButtons, rightButtons, headPose, leftTargetRayPose, rightTargetRayPose };
}

function installRadialHost(options: {
  readonly rayHit?: { kind: 'entry'; index: number } | { kind: 'center' } | null | (() => { kind: 'entry'; index: number } | { kind: 'center' } | null);
  readonly touchHit?: ((probe: THREE.Vector3) => { kind: 'entry'; index: number } | { kind: 'center' } | null);
  readonly onClear?: () => void;
} = {}): any {
  const resolveRay = typeof options.rayHit === 'function'
    ? jest.fn(options.rayHit)
    : jest.fn(() => options.rayHit ?? null);
  const host = {
    object: new THREE.Group(),
    present: jest.fn(),
    resolveRay,
    resolveTouch: jest.fn(options.touchHit ?? (() => null)),
    clear: jest.fn(() => options.onClear?.()),
    dispose: jest.fn(),
  };
  (VRSpike as any).radialMenuHost = host;
  return host;
}

function worldPose(x: number, y: number, z: number): XRWorldPose {
  return {
    position: new THREE.Vector3(x, y, z),
    orientation: new THREE.Quaternion(),
    linearVelocity: null,
    angularVelocity: null,
    trackingState: 'tracked' as const,
  };
}

function pressedButton(): { pressed: boolean; touched: boolean; value: number } {
  return { pressed: true, touched: true, value: 1 };
}

function releasedButton(): { pressed: boolean; touched: boolean; value: number } {
  return { pressed: false, touched: false, value: 0 };
}

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

describe('GameState proactive world-prompt assembly', () => {
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation((): void => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('describes an unlocked door without using it during model creation', () => {
    const harness = createGameStateWorldPromptHarness();
    const door = harness.target({
      id: 11,
      name: 'Airlock',
      objectType: harness.objectTypes.ModuleDoor,
      locked: false,
    });
    harness.setTarget(door, []);

    const model = harness.buildPrompt('module-object:11');

    expect(flattenPromptActions(model).map((action) => action.label)).toEqual(['Use: Airlock']);
    expect(door.use).not.toHaveBeenCalled();
  });

  test('uses authoritative authored actions for a locked door and omits direct Open', () => {
    const harness = createGameStateWorldPromptHarness();
    const door = harness.target({
      id: 12,
      name: 'Security Door',
      objectType: harness.objectTypes.ModuleDoor,
      locked: true,
    });
    harness.setTarget(door, [
      harness.entry('iaction_sec'),
      harness.entry('i_use_item', 'Security Tunneler'),
      harness.entry('iaction_attack'),
      harness.entry('iaction_mine'),
    ]);

    const model = harness.buildPrompt('module-object:12');

    expect(flattenPromptActions(model).map((action) => action.label)).toEqual([
      'Security',
      'Security Tunneler',
      'Bash',
      'Mine',
    ]);
    expect(door.use).not.toHaveBeenCalled();
  });

  test('maps authored trap actions to Disarm and Recover', () => {
    const harness = createGameStateWorldPromptHarness();
    const trap = harness.target({
      id: 13,
      name: 'Deadly Gas Mine',
      objectType: harness.objectTypes.ModuleTrigger,
    });
    harness.setTarget(trap, [
      harness.entry('iaction_dismine'),
      harness.entry('iaction_recmine'),
    ]);

    const model = harness.buildPrompt('module-object:13');

    expect(flattenPromptActions(model).map((action) => action.label)).toEqual(['Disarm', 'Recover']);
    expect(trap.use).not.toHaveBeenCalled();
  });

  test('keeps Galaxy Map on its existing direct world-console use route until selection', () => {
    const harness = createGameStateWorldPromptHarness();
    const galaxyMap = harness.target({
      id: 14,
      name: 'Galaxy Map',
      objectType: harness.objectTypes.ModulePlaceable,
      plot: true,
      storyScript: true,
      tag: 'Galaxymap',
      templateResRef: 'invisible001',
    });
    harness.setTarget(galaxyMap, []);

    const [useAction] = flattenPromptActions(harness.buildPrompt('module-object:14'));

    expect(useAction.label).toBe('Use: Galaxy Map');
    expect(galaxyMap.use).not.toHaveBeenCalled();
    useAction.activate();
    expect(galaxyMap.use).toHaveBeenCalledTimes(1);
    expect(galaxyMap.use).toHaveBeenCalledWith(harness.actor);
  });

  test('fails a direct-use descriptor closed when an unlocked target becomes locked', () => {
    const harness = createGameStateWorldPromptHarness();
    const door = harness.target({
      id: 15,
      name: 'Changing Door',
      objectType: harness.objectTypes.ModuleDoor,
    });
    harness.setTarget(door, []);
    const [useAction] = flattenPromptActions(harness.buildPrompt('module-object:15'));

    door.setLocked(true);

    expect(useAction.revalidate()).toBe(false);
    useAction.activate();
    expect(door.use).not.toHaveBeenCalled();
  });

  test.each([
    ['key-required', { keyRequired: true }],
    ['plot-owned', { plot: true }],
    ['story-script-owned', { storyScript: true }],
  ] as const)('does not add direct use for an unlocked %s object', (_reason, safetyState) => {
    const harness = createGameStateWorldPromptHarness();
    const door = harness.target({
      id: 16,
      name: 'Authored Door',
      objectType: harness.objectTypes.ModuleDoor,
      ...safetyState,
    });
    harness.setTarget(door, []);

    expect(harness.buildPrompt('module-object:16')).toBeNull();
    expect(door.use).not.toHaveBeenCalled();
  });

  test('does not add direct use when an unlocked target already has an authored action', () => {
    const harness = createGameStateWorldPromptHarness();
    const consoleTarget = harness.target({
      id: 17,
      name: 'Authored Console',
      objectType: harness.objectTypes.ModulePlaceable,
    });
    harness.setTarget(consoleTarget, [harness.entry('iaction_sec')]);

    expect(flattenPromptActions(harness.buildPrompt('module-object:17')).map((action) => action.label)).toEqual([
      'Security',
    ]);
    expect(consoleTarget.use).not.toHaveBeenCalled();
  });

  test('fails a direct-use descriptor closed when authored ownership appears later', () => {
    const harness = createGameStateWorldPromptHarness();
    const consoleTarget = harness.target({
      id: 18,
      name: 'Changing Console',
      objectType: harness.objectTypes.ModulePlaceable,
    });
    harness.setTarget(consoleTarget, []);
    const [useAction] = flattenPromptActions(harness.buildPrompt('module-object:18'));

    harness.setTarget(consoleTarget, [harness.entry('iaction_sec')]);

    expect(useAction.revalidate()).toBe(false);
    useAction.activate();
    expect(consoleTarget.use).not.toHaveBeenCalled();
  });

  test('enumerates candidates without building action models for unselected neighbors', () => {
    const harness = createGameStateWorldPromptHarness();
    const centerDoor = harness.target({
      id: 19,
      name: 'Center Door',
      objectType: harness.objectTypes.ModuleDoor,
    });
    const sideConsole = harness.target({
      id: 20,
      name: 'Side Console',
      objectType: harness.objectTypes.ModulePlaceable,
      x: 0.5,
    });
    harness.setTargets([centerDoor, sideConsole], []);

    const candidates = harness.buildCandidates();

    expect(candidates.map((candidate: any) => candidate.id)).toEqual([
      'module-object:19',
      'module-object:20',
    ]);
    expect(harness.actionMenuCalls()).toEqual({ setPC: 0, setTarget: 0, update: 0 });
  });

  test('changes candidate state when an authored inventory source identity changes', () => {
    const harness = createGameStateWorldPromptHarness();
    const door = harness.target({
      id: 23,
      name: 'Mineable Door',
      objectType: harness.objectTypes.ModuleDoor,
      locked: true,
    });
    harness.setTargets([door], []);
    harness.setInventory([{ id: 101, baseItemId: 58, getIcon: () => 'mine_a' }]);
    const [first] = harness.buildCandidates();

    harness.setInventory([{ id: 102, baseItemId: 58, getIcon: () => 'mine_b' }]);
    const [second] = harness.buildCandidates();

    expect(second.stateKey).not.toBe(first.stateKey);
    expect(harness.actionMenuCalls()).toEqual({ setPC: 0, setTarget: 0, update: 0 });
  });

  test.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ] as const)('omits a target whose shared anchor contains %s', (_label, invalidCoordinate) => {
    const harness = createGameStateWorldPromptHarness();
    const target = harness.target({
      id: 21,
      name: 'Invalid Anchor',
      objectType: harness.objectTypes.ModulePlaceable,
      x: invalidCoordinate,
    });
    harness.setTargets([target], []);

    expect(harness.buildCandidates()).toEqual([]);
    expect(harness.actionMenuCalls()).toEqual({ setPC: 0, setTarget: 0, update: 0 });
  });

  test('carries the exact finite candidate anchor snapshot into prompt creation', () => {
    const harness = createGameStateWorldPromptHarness();
    const target = harness.target({
      id: 22,
      name: 'Shared Anchor',
      objectType: harness.objectTypes.ModulePlaceable,
    });
    harness.setTargets([target], []);
    const [candidate] = harness.buildCandidates();

    const model = harness.buildPrompt(candidate);

    expect(model).not.toBeNull();
    expect((model as any).anchor).toBe(candidate.position);
  });
});

interface GameStatePromptTestTarget {
  readonly id: number;
  readonly objectType: number;
  readonly position: THREE.Vector3;
  readonly destroyed: boolean;
  readonly willDestroy: boolean;
  readonly use: jest.Mock;
  readonly onClick: jest.Mock;
  getName(): string;
  isUseable(): boolean;
  isLocked(): boolean;
  setLocked(value: boolean): void;
  readonly keyRequired: boolean;
  readonly plot: boolean;
  readonly scripts: Readonly<Record<string, unknown>>;
  readonly tag: string;
  readonly templateResRef: string;
  getTag(): string;
  getTemplateResRef(): string;
}

interface GameStatePromptTestAction {
  readonly kind: 'action';
  readonly id: string;
  readonly label: string;
  revalidate(): boolean;
  activate(): void;
}

function createGameStateWorldPromptHarness(): {
  readonly actor: { readonly id: number; readonly position: THREE.Vector3 };
  readonly objectTypes: { readonly ModuleDoor: number; readonly ModulePlaceable: number; readonly ModuleTrigger: number };
  target(options: {
    readonly id: number;
    readonly name: string;
    readonly objectType: number;
    readonly locked?: boolean;
    readonly keyRequired?: boolean;
    readonly plot?: boolean;
    readonly storyScript?: boolean;
    readonly tag?: string;
    readonly templateResRef?: string;
    readonly x?: number;
  }): GameStatePromptTestTarget;
  entry(icon: string, itemName?: string): Record<string, unknown>;
  setTarget(target: GameStatePromptTestTarget, actions: readonly Record<string, unknown>[]): void;
  setTargets(targets: readonly GameStatePromptTestTarget[], actions: readonly Record<string, unknown>[]): void;
  setInventory(items: readonly Record<string, unknown>[]): void;
  buildCandidates(): readonly any[];
  buildPrompt(target: unknown): any;
  actionMenuCalls(): { readonly setPC: number; readonly setTarget: number; readonly update: number };
} {
  const EmptyClass = class {};
  const mockNamedExports = (): object => new Proxy({}, { get: () => EmptyClass });
  let loaded: any;

  jest.isolateModules(() => {
    jest.doMock('@/managers', mockNamedExports);
    jest.doMock('@/controls/IngameControls', () => ({ IngameControls: EmptyClass }));
    jest.doMock('@/controls/Mouse', () => ({ Mouse: {} }));
    jest.doMock('@/engine/INIConfig', () => ({ INIConfig: EmptyClass }));
    jest.doMock('@/audio', mockNamedExports);
    jest.doMock('@/resource/TGAObject', () => ({ TGAObject: EmptyClass }));
    jest.doMock('@/utility/ConfigClient', () => ({ ConfigClient: EmptyClass }));
    jest.doMock('@/engine/FollowerCamera', () => ({ FollowerCamera: EmptyClass }));
    jest.doMock('@/shaders/pass/OdysseyShaderPass', () => ({ OdysseyShaderPass: EmptyClass }));
    jest.doMock('@/loaders', mockNamedExports);
    jest.doMock('@/vr/VRSpike', () => ({ VRSpike }));
    jest.doMock('@/vr/runtime/CreatureLocomotionAdapter', () => ({ CreatureLocomotionAdapter: EmptyClass }));
    jest.doMock('@/vr/runtime/LegacyGUIVRPointerAdapter', () => ({ LegacyGUIVRPointerAdapter: EmptyClass }));
    jest.doMock('@/engine/EngineLocation', () => ({ __esModule: true, default: EmptyClass }));
    jest.doMock('three/examples/jsm/postprocessing/EffectComposer', () => ({ EffectComposer: EmptyClass }));
    jest.doMock('three/examples/jsm/postprocessing/RenderPass', () => ({ RenderPass: EmptyClass }));
    jest.doMock('three/examples/jsm/postprocessing/SSAARenderPass', () => ({ SSAARenderPass: EmptyClass }));
    jest.doMock('three/examples/jsm/postprocessing/ShaderPass', () => ({ ShaderPass: EmptyClass }));
    jest.doMock('three/examples/jsm/postprocessing/BloomPass', () => ({ BloomPass: EmptyClass }));
    jest.doMock('three/examples/jsm/postprocessing/BokehPass', () => ({ BokehPass: EmptyClass }));
    jest.doMock('three/examples/jsm/shaders/ColorCorrectionShader', () => ({ ColorCorrectionShader: {} }));
    jest.doMock('three/examples/jsm/shaders/CopyShader', () => ({ CopyShader: {} }));
    jest.doMock('three/examples/jsm/libs/stats.module', () => ({ __esModule: true, default: EmptyClass }));
    jest.doMock('@/engine/Planetary', () => ({ Planetary: EmptyClass }));
    jest.doMock('@/engine/Debugger', () => ({ Debugger: EmptyClass }));
    jest.doMock('@/utility/PerformanceMonitor', () => ({ PerformanceMonitor: EmptyClass }));
    loaded = {
      ...require('@/GameState'),
      THREE: require('three'),
    };
  });

  const {
    GameState,
    buildVRWorldActionPrompt,
    buildVRWorldPromptCandidates,
    THREE: engineThree,
  } = loaded;
  const { ModuleObjectType } = require('@/enums/module/ModuleObjectType');
  let inventory: readonly Record<string, unknown>[] = [];
  const actor = {
    id: 7,
    position: new engineThree.Vector3(0, 0, 0),
    getSkillLevel: () => 1,
    getInventory: () => inventory,
  };
  const actionPanels = {
    targetPanels: [] as Array<{ actions: readonly Record<string, unknown>[]; selectedIndex: number }>,
    selfPanels: [] as Array<{ actions: readonly Record<string, unknown>[]; selectedIndex: number }>,
  };
  const actionMenuManager = {
    ActionPanels: actionPanels,
    SetPC: jest.fn(),
    SetTarget: jest.fn(),
    UpdateMenuActions: jest.fn(),
    onTargetMenuAction: jest.fn(),
    onSelfMenuAction: jest.fn(),
  };
  GameState.PartyManager = { party: [actor], Player: actor };
  GameState.ModuleObjectManager = { playerSelectableObjects: [] };
  GameState.ActionMenuManager = actionMenuManager;

  return {
    actor,
    objectTypes: ModuleObjectType,
    target: ({
      id,
      name,
      objectType,
      locked = false,
      keyRequired = false,
      plot = false,
      storyScript = false,
      tag = '',
      templateResRef = '',
      x = 0,
    }) => {
      let currentLocked = locked;
      return {
        id,
        objectType,
        position: new engineThree.Vector3(x, 1, 0),
        destroyed: false,
        willDestroy: false,
        keyRequired,
        plot,
        scripts: storyScript ? { OnFailToOpen: { name: 'a_compdlg' } } : {},
        tag,
        templateResRef,
        use: jest.fn(),
        onClick: jest.fn(),
        getName: () => name,
        getTag: () => tag,
        getTemplateResRef: () => templateResRef,
        isUseable: () => true,
        isLocked: () => currentLocked,
        setLocked: (value: boolean) => { currentLocked = value; },
      };
    },
    entry: (icon, itemName) => ({
      icon,
      action: { type: icon },
      ...(itemName ? { item: { id: icon, getName: () => itemName } } : {}),
    }),
    setTarget: (target, actions) => {
      GameState.ModuleObjectManager.playerSelectableObjects = [target];
      actionPanels.targetPanels = [{ actions, selectedIndex: 0 }];
    },
    setTargets: (targets, actions) => {
      GameState.ModuleObjectManager.playerSelectableObjects = [...targets];
      actionPanels.targetPanels = [{ actions, selectedIndex: 0 }];
    },
    setInventory: (items) => { inventory = items; },
    buildCandidates: () => buildVRWorldPromptCandidates(
      actor,
      GameState.ModuleObjectManager.playerSelectableObjects,
    ),
    buildPrompt: (target) => buildVRWorldActionPrompt(target),
    actionMenuCalls: () => ({
      setPC: actionMenuManager.SetPC.mock.calls.length,
      setTarget: actionMenuManager.SetTarget.mock.calls.length,
      update: actionMenuManager.UpdateMenuActions.mock.calls.length,
    }),
  };
}

function flattenPromptActions(model: any): readonly GameStatePromptTestAction[] {
  if (!model) throw new Error('expected a world prompt model');
  return model.pages.flatMap((page: any) =>
    page.entries.filter((entry: any) => entry.kind === 'action')
  );
}
