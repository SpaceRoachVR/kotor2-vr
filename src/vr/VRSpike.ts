import * as THREE from "three";
import { XRCoordinateConverter } from "./runtime/XRCoordinateConverter";
import { XRControllerAnchorHost } from "./runtime/XRControllerAnchorHost";
import { XRGamepadReader } from "./runtime/XRGamepadReader";
import { XRInputFrameBuilder } from "./runtime/XRInputFrameBuilder";
import { XRInputRouter } from "./runtime/XRInputRouter";
import { InteractionSystem } from "./runtime/InteractionSystem";
import { InteractionTargetRegistry } from "./runtime/InteractionTargetRegistry";
import { LocomotionController, ResolvedLocomotion } from "./runtime/LocomotionController";
import { VRPanelHost } from "./runtime/VRPanelHost";
import { VRPanelPointerHost } from "./runtime/VRPanelPointerHost";
import { VRKeyboardHost } from "./runtime/VRKeyboardHost";
import { VRKeyboardInputController } from "./runtime/VRKeyboardInputController";
import { VRCombatInputController, VRCombatSwingEvent } from "./runtime/VRCombatInputController";
import { VRForceGesture, VRForceGestureController } from "./runtime/VRForceGestureController";
import { VRRadialMenuController, VRRadialMenuItem } from "./runtime/VRRadialMenuController";
import { VRRadialMenuHost } from "./runtime/VRRadialMenuHost";
import { resolveWallSoftBlockCorrection, VRWalkmeshQuery } from "./runtime/VRWallSoftBlock";
import { VRSnapTurnController } from "./runtime/VRSnapTurnController";
import { VRTeleportController } from "./runtime/VRTeleportController";
import { VRComfortVignetteHost } from "./runtime/VRComfortVignetteHost";
import {
  VRWorldTargetIndicator,
  VRWorldTargetLabelHost,
} from "./runtime/VRWorldTargetLabelHost";
import {
  VRPanelInputController,
  VRPanelMenuController,
  VRPanelPointerSink,
} from "./runtime/VRPanelInputController";
import {
  EngineInteractableObject,
  EngineInteractionActor,
  ModuleObjectInteractionTargetSet,
} from "./runtime/ModuleObjectInteractionTarget";
import { InteractionIntent, SemanticXRAction, VRComfortSettings, XRInputFrame } from "./runtime/XRTypes";
import { PerfSampler, PerfWorldSnapshot } from "./PerfSampler";
import type { EngineFrameSource } from "./XRFrameCadence";

/**
 * Phase 0.1 — stereo perf spike.
 *
 * This is a MEASUREMENT HARNESS, not the VR layer. Roadmap 0.1 says explicitly:
 * do not build the rig here. There is no locomotion, no controller input, no
 * walkmesh coupling and no comfort handling. The only job is to submit two eyes
 * of `101PER` and find out what it costs.
 *
 * Three things had to change in the engine for that to be possible, and each is
 * kept behind an `isPresenting` check so the flatscreen path is untouched:
 *
 *  1. The GL context is created before this runs, so it must be promoted with
 *     `makeXRCompatible()` rather than the usual `{ xrCompatible: true }`.
 *  2. WebXR owns the frame callback. `requestAnimationFrame` runs at monitor
 *     rate, not headset rate, so `GameState.scheduleNextFrame()` defers to
 *     `renderer.setAnimationLoop` while presenting.
 *  3. EffectComposer renders into its own targets and blits to the default
 *     framebuffer. That framebuffer is not the XR one, so nothing reaches the
 *     headset. While presenting we bypass the composer entirely.
 *
 * Point 3 is worth carrying forward: whatever post-processing the mod ends up
 * wanting has to be re-plumbed for XR, it is not free.
 */
/**
 * What the spike needs from the engine. Passed in rather than imported:
 * GameState already imports VRSpike, and importing it back would close a cycle.
 */
const DEFAULT_COMFORT_SETTINGS: VRComfortSettings = {
  locomotionMode: 'smooth',
  turnMode: 'smooth',
  snapTurnDegrees: 45,
  vignetteEnabled: false,
};

export interface VRSpikeHooks {
  /** The engine's frame function. WebXR calls this instead of rAF. */
  update: (timestamp: number, source: EngineFrameSource) => void;
  /** Player's feet in world space, or null before a module is loaded. */
  getPlayerPosition: () => THREE.Vector3 | null;
  /**
   * The player's current room walkmesh, for the wall soft-block check —
   * room-scale head tracking can cross a wall the joystick-driven avatar
   * body never reached, since only the avatar's own movement is
   * walkmesh-collision-checked. Null when no room/walkmesh is resolved yet.
   */
  getCurrentRoomWalkmesh?: () => VRWalkmeshQuery | null;
  /** Comfort settings (ROADMAP 2.5/2.6): locomotion/turn mode and vignette. */
  getComfortSettings?: () => VRComfortSettings;
  setComfortSettings?: (patch: Partial<VRComfortSettings>) => void;
  /** Instantly relocates the player, e.g. for a committed blink-teleport. */
  teleportPlayer?: (point: THREE.Vector3) => void;
  /** Follower camera facing, radians about the world Z axis. */
  getFacing: () => number;
  /** Current module, culling, and player path context for device evidence. */
  getWorldContext: () => PerfWorldSnapshot;
  /** Active creature body yaw in KOTOR world radians. */
  getPlayerFacing?: () => number | null;
  /** Applies resolved input through the active creature's existing movement path. */
  applyLocomotion?: (locomotion: ResolvedLocomotion) => void;
  /** Current engine actor and its already-filtered world interaction targets. */
  getInteractionContext?: () => {
    readonly actor: EngineInteractionActor | null;
    readonly targets: readonly EngineInteractableObject[];
    readonly onInteractionIntent?: (intent: InteractionIntent) =>
      | { readonly feedbackLabel?: string }
      | void;
  };
  /**
   * Current engine combat target and the authoritative d20 action bridge.
   * `aimedTargetId` is VRSpike's own live right-hand interaction-ray
   * resolution for this frame (null if nothing hostile is aimed at) — the
   * hook must nominate its target from this, not from any frozen
   * flatscreen-mouse hover/select state, which never updates once a WebXR
   * session has taken over input.
   */
  getCombatContext?: (aimedTargetId: number | null) => {
    readonly actorId: string;
    readonly nominatedTargetId: string | null;
    readonly weaponMode: import('./runtime/XRTypes').CombatWeaponMode;
    onCombatSwing(event: VRCombatSwingEvent): void;
    cancel?(): void;
  } | null;
  /** Engine-owned models to present while the corresponding controller holds an item. */
  getHeldVisuals?: () => Readonly<{
    readonly left: THREE.Object3D | null;
    readonly right: THREE.Object3D | null;
  }>;
  /**
   * Available Force powers and the engine action bridge for a recognized
   * gesture. `aimedTargetId` is VRSpike's own live right-hand interaction-ray
   * resolution for this frame, for the same reason documented on
   * `getCombatContext`.
   */
  getForceContext?: (aimedTargetId: number | null) => { onForceGesture(gesture: VRForceGesture): void } | null;
  getRadialMenuContext?: (aimedTargetId: number | null) => {
    readonly items: readonly VRRadialMenuItem[];
    setPaused(paused: boolean): void;
  } | null;
  /** Legacy GUI scene and the topmost menu that should own VR input. */
  getPanelContext?: () => {
    readonly menu: VRPanelMenuController | null;
    readonly guiScene: THREE.Scene;
    readonly guiCamera: THREE.Camera;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    readonly pointerSink: VRPanelPointerSink;
  };
  /** Current engine movie and its authoritative skip capability. */
  getMovieContext?: () => {
    readonly canSkip: boolean;
    skip: () => void;
  } | null;
  /**
   * Active engine-authored dialogue/cutscene camera and its current skip
   * rule. `abort` mirrors flatscreen's unconditional DialogAbort — it must
   * work even when `canSkip` is false (an authored `NodeUnskippable` entry),
   * which is exactly the case VR previously had no escape from.
   */
  getCutsceneContext?: () => {
    readonly canSkip: boolean;
    skip: () => void;
    abort?: () => void;
  } | null;
  /** Currently focused editable legacy control, if any. */
  getKeyboardContext?: () => {
    onKeyDown(event: { readonly which: number; readonly shiftKey: boolean }): void;
    cancel(): void;
  } | null;
  /** Current world reticle target for the headset-readable name label. */
  getWorldTargetIndicator?: () => VRWorldTargetIndicator | null;
}

export class VRSpike {
  static readonly perf = new PerfSampler();

  static renderer: THREE.WebGLRenderer | null = null;
  static scene: THREE.Scene | null = null;
  static hooks: VRSpikeHooks | null = null;

  /** Parent of the XR camera. Its world transform is the headset's origin. */
  static rig: THREE.Group | null = null;
  /** Passed to `renderer.render`; THREE overwrites it from the headset pose. */
  static camera: THREE.PerspectiveCamera | null = null;

  static session: XRSession | null = null;
  static installed = false;
  private static traceXRStartup = false;
  private static xrFrameRenderTarget: THREE.WebGLRenderTarget | null = null;
  private static readonly inputRouter = new XRInputRouter();
  private static readonly locomotionController = new LocomotionController();
  private static readonly snapTurnController = new VRSnapTurnController();
  private static readonly teleportController = new VRTeleportController();
  private static locomotionModeToggleHeld = false;
  private static comfortVignetteHost: VRComfortVignetteHost | null = null;
  private static previousXRInputTimestamp: number | null = null;
  private static locomotionInputErrorReported = false;
  private static trackedInputErrorReported = false;
  private static panelInputErrorReported = false;
  private static movieInputErrorReported = false;
  private static worldInteractionInputErrorReported = false;
  private static combatInputErrorReported = false;
  private static forceGestureErrorReported = false;
  private static panelPresentationErrorReported = false;
  private static worldTargetLabelErrorReported = false;
  private static syncRigFallbackReported = false;
  private static missingMovieRenderPrerequisiteReported = false;
  private static turnYaw = 0;
  private static readonly turnOriginOffset = new THREE.Vector3();
  private static controllerAnchorHost: XRControllerAnchorHost | null = null;
  private static latestInputFrame: XRInputFrame | null = null;
  private static latestXRFrame: XRFrame | null = null;
  private static latestXRFrameTimestamp = 0;
  private static readonly interactionRegistry = new InteractionTargetRegistry();
  private static readonly interactionSystem = new InteractionSystem(VRSpike.interactionRegistry);
  private static readonly panelInputController = new VRPanelInputController();
  private static panelHost: VRPanelHost | null = null;
  private static keyboardHost: VRKeyboardHost | null = null;
  private static readonly keyboardInputController = new VRKeyboardInputController();
  private static readonly combatInputController = new VRCombatInputController();
  private static readonly forceGestureController = new VRForceGestureController();
  private static readonly radialMenuController = new VRRadialMenuController();
  private static radialMenuHost: VRRadialMenuHost | null = null;
  private static radialPointerHost: VRPanelPointerHost | null = null;
  private static keyboardSelectHeld = false;
  private static keyboardCancelHeld = false;
  private static keyboardGrabHeld = false;
  private static keyboardWasActive = false;
  private static movieHost: VRPanelHost | null = null;
  private static readonly movieOwner = {};
  private static readonly cutsceneOwner = {};
  private static panelPointerHost: VRPanelPointerHost | null = null;
  private static worldTargetLabelHost: VRWorldTargetLabelHost | null = null;
  private static interactionPreviewIndicator: VRWorldTargetIndicator | null = null;
  private static latestPanelPointerPosition: THREE.Vector2 | null = null;
  private static movieCancelHeld = false;
  private static combatCancelHeld = false;
  private static readonly interactionTargetSet = new ModuleObjectInteractionTargetSet(
    VRSpike.interactionRegistry,
    () => VRSpike.hooks?.getInteractionContext?.().actor ?? null
  );

  /**
   * Metres from the walkmesh to the eyes. Fixed and canonical by design
   * decision — no per-player calibration. Only used to place the rig; a
   * `local-floor` reference space supplies the real head height on top.
   */
  static eyeHeight = 1.75;

  /**
   * Yaw correction, radians, applied on top of the follower camera's facing.
   * Exposed because the sign convention is easier to settle by nudging it in
   * DevTools than by reading it out of the camera code.
   */
  static yawOffset = 0;

  /** Follow the in-game camera each frame. Off = stand still and look around. */
  static followCamera = true;

  /**
   * Promote the context, flip on XR, and put an Enter VR button on screen.
   * Safe to call when no headset is attached — it just reports and returns.
   */
  static async install(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    hooks: VRSpikeHooks
  ): Promise<void> {
    if (VRSpike.installed) return;
    VRSpike.installed = true;
    VRSpike.renderer = renderer;
    VRSpike.scene = scene;
    VRSpike.hooks = hooks;
    VRSpike.perf.attach(renderer);
    VRSpike.perf.attachWorldContext(hooks.getWorldContext);

    (window as any).VRSpike = VRSpike;

    if (typeof navigator === 'undefined' || !(navigator as any).xr) {
      console.warn('[VRSpike] navigator.xr is undefined — no WebXR in this runtime.');
      return;
    }

    // The renderer was handed a context that already exists, so the usual
    // `{ xrCompatible: true }` attribute is not an option.
    const gl = renderer.getContext() as WebGLRenderingContext & {
      makeXRCompatible?: () => Promise<void>;
    };
    if (typeof gl.makeXRCompatible === 'function') {
      try {
        await gl.makeXRCompatible();
      } catch (e) {
        // Usually means the GL context is on a different adapter than the HMD.
        const error = e instanceof Error
          ? `${e.name}: ${e.message}`
          : String(e);
        console.error(`[VRSpike] makeXRCompatible failed — ${error}`, e);
        VRSpike.addButton(false, 'VR context unavailable');
        return;
      }
    }

    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');

    VRSpike.rig = new THREE.Group();
    VRSpike.rig.name = 'VRSpike.rig';
    // KOTOR's world is Z-up; WebXR hands back Y-up poses. This rotation is the
    // whole conversion — without it you are lying on your back in the level.
    XRCoordinateConverter.applyXRToGameBasis(VRSpike.rig);
    VRSpike.controllerAnchorHost = new XRControllerAnchorHost(VRSpike.rig);

    VRSpike.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 15000);
    VRSpike.rig.add(VRSpike.camera);
    scene.add(VRSpike.rig);

    const supported = await (navigator as any).xr.isSessionSupported('immersive-vr');
    console.log(`[VRSpike] installed. immersive-vr supported: ${supported}`);
    VRSpike.addButton(supported);
  }

  private static addButton(supported: boolean, unavailableText = 'VR unavailable'): void {
    const btn = document.createElement('button');
    btn.id = 'vr-spike-button';
    btn.textContent = supported ? 'Enter VR (spike)' : unavailableText;
    Object.assign(btn.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      zIndex: '9999',
      padding: '10px 16px',
      font: '13px monospace',
      background: supported ? '#123' : '#333',
      color: supported ? '#7fd' : '#999',
      border: '1px solid #7fd',
      borderRadius: '4px',
      cursor: supported ? 'pointer' : 'not-allowed',
      opacity: '0.85',
    } as CSSStyleDeclaration);
    btn.disabled = !supported;

    // The engine consumes mouse events from `window`, so a DOM control layered
    // over the canvas must stop each press phase before it bubbles into the
    // legacy GUI raycaster. Otherwise Enter VR can also click the pause toolbar
    // control underneath this button.
    const isolateFromGameInput = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    for (const eventType of ['pointerdown', 'pointerup', 'mousedown', 'mouseup']) {
      btn.addEventListener(eventType, isolateFromGameInput);
    }
    btn.addEventListener('click', (event) => {
      isolateFromGameInput(event);
      if (VRSpike.session) VRSpike.exit();
      else VRSpike.enter();
    });
    document.body.appendChild(btn);
  }

  /** Request an immersive session and hand the frame loop to WebXR. */
  static async enter(): Promise<void> {
    if (!VRSpike.renderer) return;
    if (VRSpike.session) return;

    try {
      const session: XRSession = await (navigator as any).xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor'],
      });
      VRSpike.session = session;
      VRSpike.traceXRStartup = true;
      VRSpike.previousXRInputTimestamp = null;
      VRSpike.locomotionInputErrorReported = false;
      VRSpike.trackedInputErrorReported = false;
      VRSpike.panelInputErrorReported = false;
      VRSpike.movieInputErrorReported = false;
      VRSpike.worldInteractionInputErrorReported = false;
      VRSpike.combatInputErrorReported = false;
      VRSpike.forceGestureErrorReported = false;
      VRSpike.panelPresentationErrorReported = false;
      VRSpike.worldTargetLabelErrorReported = false;
      VRSpike.syncRigFallbackReported = false;
      VRSpike.missingMovieRenderPrerequisiteReported = false;
      VRSpike.latestXRFrame = null;
      VRSpike.latestXRFrameTimestamp = 0;
      VRSpike.movieCancelHeld = false;
      VRSpike.keyboardSelectHeld = false;
      VRSpike.keyboardCancelHeld = false;
      VRSpike.keyboardGrabHeld = false;
      VRSpike.turnYaw = 0;
      VRSpike.turnOriginOffset.set(0, 0, 0);
      VRSpike.interactionTargetSet.clear();
      VRSpike.interactionSystem.cancelTransientState();
      VRSpike.combatInputController.reset();
      VRSpike.forceGestureController.reset();
      VRSpike.snapTurnController.reset();
      VRSpike.teleportController.reset();
      VRSpike.locomotionModeToggleHeld = false;
      VRSpike.panelInputController.cancel();
      VRSpike.panelHost?.clear();
      VRSpike.keyboardHost?.clear();
      VRSpike.movieHost?.clear();
      VRSpike.panelPointerHost?.clear();
      VRSpike.worldTargetLabelHost?.clear();
      VRSpike.latestPanelPointerPosition = null;
      session.addEventListener('end', VRSpike.onSessionEnd);
      session.addEventListener('visibilitychange', VRSpike.onVisibilityChange);

      // Register directly with WebXR before the manager starts its session
      // animation source. WebGLRenderer.setAnimationLoop() also starts a
      // window.requestAnimationFrame loop; calling it after setSession() would
      // drive the engine from both schedulers and render outside XRFrame.
      VRSpike.renderer.xr.setAnimationLoop(VRSpike.frame);
      await VRSpike.renderer.xr.setSession(session as any);

      const btn = document.getElementById('vr-spike-button');
      if (btn) btn.textContent = 'Exit VR (spike)';

      // Keep the runtime cadence separate from the sustained-50 acceptance budget.
      // A faster runtime must not silently tighten the project's minimum gate.
      const rate = (session as any).frameRate;
      VRSpike.perf.xrRuntimeHz = rate || VRSpike.perf.targetHz;

      VRSpike.perf.beginXRSession();
      VRSpike.perf.start('stereo');
      console.log(
        `[VRSpike] presenting at runtime ${VRSpike.perf.xrRuntimeHz} Hz; ` +
        `acceptance minimum ${VRSpike.perf.targetHz} Hz`
      );
    } catch (e) {
      console.error('[VRSpike] requestSession failed:', e);
      VRSpike.renderer.xr.setAnimationLoop(null);
      VRSpike.session = null;
    }
  }

  static exit(): void {
    if (VRSpike.session) VRSpike.session.end();
  }

  private static onSessionEnd = (): void => {
    // Three.js registers its own raw-session end listener after ours. Defer
    // the desktop handoff until every synchronous end listener has run, so its
    // WebXR animation source is fully stopped before we clear the callback.
    queueMicrotask(VRSpike.finishSessionEnd);
  };

  private static onVisibilityChange = (): void => {
    if (VRSpike.session?.visibilityState !== 'visible') {
      VRSpike.clearTrackedInput();
    }
  };

  private static finishSessionEnd = (): void => {
    VRSpike.perf.stop();
    VRSpike.session = null;
    VRSpike.xrFrameRenderTarget = null;
    VRSpike.previousXRInputTimestamp = null;
    VRSpike.latestXRFrame = null;
    VRSpike.latestXRFrameTimestamp = 0;
    VRSpike.movieCancelHeld = false;
    VRSpike.keyboardSelectHeld = false;
    VRSpike.keyboardCancelHeld = false;
    VRSpike.keyboardWasActive = false;
    VRSpike.combatCancelHeld = false;
    VRSpike.clearTrackedInput();
    VRSpike.interactionTargetSet.clear();
    VRSpike.panelInputController.cancel();
    VRSpike.combatInputController.reset();
    VRSpike.forceGestureController.reset();
    VRSpike.snapTurnController.reset();
    VRSpike.teleportController.reset();
    VRSpike.locomotionModeToggleHeld = false;
    VRSpike.panelHost?.clear();
    VRSpike.keyboardHost?.clear();
    VRSpike.movieHost?.clear();
    VRSpike.panelPointerHost?.clear();
    VRSpike.radialPointerHost?.clear();
    VRSpike.worldTargetLabelHost?.clear();
    VRSpike.latestPanelPointerPosition = null;
    VRSpike.comfortVignetteHost?.dispose();
    VRSpike.comfortVignetteHost = null;

    const btn = document.getElementById('vr-spike-button');
    if (btn) btn.textContent = 'Enter VR (spike)';

    // Hand the loop back to requestAnimationFrame, exactly once.
    VRSpike.renderer?.xr.setAnimationLoop(null);
    const update = VRSpike.hooks?.update;
    if (update) requestAnimationFrame((timestamp) => update(timestamp, 'browser'));
    console.log('[VRSpike] session ended, back on requestAnimationFrame');
  };

  /**
   * The frame callback while presenting. WebXR supplies its own timestamp; the
   * engine reads THREE.Clock instead and does not need it.
   */
  private static frame = (timestamp: number, frame?: XRFrame): void => {
    VRSpike.perf.recordXRCallback(timestamp, !!frame);
    if (!frame) return;
    VRSpike.latestXRFrame = frame;
    VRSpike.latestXRFrameTimestamp = timestamp;
    const renderTarget = VRSpike.renderer?.getRenderTarget() ?? null;
    const isXRRenderTarget = !!(renderTarget as (THREE.WebGLRenderTarget & {
      isXRRenderTarget?: boolean;
    }) | null)?.isXRRenderTarget;
    VRSpike.xrFrameRenderTarget = isXRRenderTarget
      ? renderTarget
      : null;
    VRSpike.traceStartupStage('callback');
    VRSpike.updateTrackedInput(timestamp, frame);
    const movieOwnsInput = VRSpike.processMovieInput();
    const keyboardOwnsInput = !movieOwnsInput && VRSpike.processKeyboardInput();
    const radialOwnsInput = !movieOwnsInput && !keyboardOwnsInput && VRSpike.processRadialMenuInput();
    const panelOwnsInput = !movieOwnsInput && !keyboardOwnsInput && !radialOwnsInput && VRSpike.processPanelInput();
    if (movieOwnsInput || keyboardOwnsInput || radialOwnsInput || panelOwnsInput) {
      VRSpike.interactionTargetSet.clear();
      VRSpike.interactionSystem.cancelTransientState();
    } else {
      VRSpike.processLocomotionInput(timestamp, frame);
      const interactionConsumed = VRSpike.processInteractionInput(timestamp);
      if (!interactionConsumed) VRSpike.processCombatInput(timestamp);
    }
    VRSpike.hooks?.update(timestamp, 'xr');
  };

  private static updateTrackedInput(timestamp: number, frame: XRFrame): void {
    const rig = VRSpike.rig;
    const renderer = VRSpike.renderer;
    const session = VRSpike.session;
    const referenceSpace = renderer && typeof renderer.xr.getReferenceSpace === 'function'
      ? renderer.xr.getReferenceSpace()
      : null;
    if (
      !rig ||
      !session ||
      !referenceSpace ||
      typeof frame.getViewerPose !== 'function' ||
      typeof frame.getPose !== 'function'
    ) {
      VRSpike.clearTrackedInput();
      return;
    }

    try {
      const inputFrame = XRInputFrameBuilder.build(
        timestamp,
        frame,
        referenceSpace,
        rig,
        Array.from(session.inputSources ?? [])
      );
      VRSpike.latestInputFrame = inputFrame;
      if (!VRSpike.controllerAnchorHost) {
        VRSpike.controllerAnchorHost = new XRControllerAnchorHost(rig);
      }
      const heldVisuals = VRSpike.hooks?.getHeldVisuals?.();
      VRSpike.controllerAnchorHost.setHeldVisual('left', heldVisuals?.left ?? null);
      VRSpike.controllerAnchorHost.setHeldVisual('right', heldVisuals?.right ?? null);
      VRSpike.controllerAnchorHost.update(inputFrame);
    } catch (error) {
      VRSpike.clearTrackedInput();
      if (!VRSpike.trackedInputErrorReported) {
        VRSpike.trackedInputErrorReported = true;
        console.error('[VRSpike] tracked controller pose rejected', error);
      }
    }
  }

  private static clearTrackedInput(): void {
    VRSpike.latestInputFrame = null;
    VRSpike.interactionPreviewIndicator = null;
    VRSpike.controllerAnchorHost?.clear();
    VRSpike.interactionSystem.cancelTransientState();
    VRSpike.panelInputController.cancel();
    VRSpike.forceGestureController.reset();
  }

  static get inputFrame(): XRInputFrame | null {
    return VRSpike.latestInputFrame;
  }

  /**
   * The XR callback captures input before the engine updates its follower
   * camera. Rendering then synchronizes the rig to that camera, so UI and
   * controller presentation must rebuild the same frame's world pose after
   * the rig transform changes. Without this, a menu opened on the first frame
   * stays anchored at the previous rig origin and orientation.
   */
  private static refreshTrackedPresentationPose(): void {
    if (!VRSpike.latestXRFrame) return;
    VRSpike.updateTrackedInput(
      VRSpike.latestXRFrameTimestamp,
      VRSpike.latestXRFrame
    );
  }

  private static processPanelInput(): boolean {
    const context = VRSpike.hooks?.getPanelContext?.();
    const menu = context?.menu ?? null;
    if (!menu) {
      VRSpike.panelPointerHost?.clear();
      VRSpike.latestPanelPointerPosition = null;
      VRSpike.panelInputController.process(null, [], null, context?.pointerSink ?? null);
      return false;
    }

    const session = VRSpike.session;
    if (!session || !VRSpike.latestInputFrame) {
      VRSpike.panelPointerHost?.clear();
      VRSpike.latestPanelPointerPosition = null;
      context.pointerSink.setPointerPosition(null);
      VRSpike.panelInputController.cancel();
      return true;
    }

    try {
      const worldScene = VRSpike.scene;
      if (!worldScene) return true;
      if (!VRSpike.panelHost) {
        VRSpike.panelHost = new VRPanelHost(worldScene);
      }
      if (!VRSpike.panelPointerHost) {
        VRSpike.panelPointerHost = new VRPanelPointerHost(worldScene);
      }
      // A newly opened panel is placed in renderPanel() after the rig has been
      // synchronized to this frame's XR pose. Sampling before that sync caused
      // the boot menu to be anchored behind the player. The opening frame is
      // intentionally input-safe; the panel accepts rays from the next frame.
      const controllers = XRGamepadReader.read(Array.from(session.inputSources ?? []));
      const actions = VRSpike.inputRouter.route(
        controllers,
        new Set(['gameplay', 'ui', 'global'])
      );
      const dominantHand = VRSpike.latestInputFrame.hands.right;
      const pointerHit = dominantHand && VRSpike.panelHost?.owner === menu && VRSpike.panelHost.isVisible
        ? VRSpike.panelPointerHost?.update(
          VRSpike.panelHost.object,
          dominantHand.targetRayPose,
          context.viewportWidth,
          context.viewportHeight
        ) ?? null
        : null;
      if (!dominantHand) VRSpike.panelPointerHost?.clear();
      VRSpike.latestPanelPointerPosition = pointerHit?.guiPosition.clone() ?? null;
      return VRSpike.panelInputController.process(
        menu,
        actions,
        pointerHit?.guiPosition ?? null,
        context.pointerSink
      );
    } catch (error) {
      if (!VRSpike.panelInputErrorReported) {
        VRSpike.panelInputErrorReported = true;
        console.error('[VRSpike] panel input rejected', error);
      }
      VRSpike.panelInputController.cancel();
      VRSpike.panelPointerHost?.clear();
      VRSpike.latestPanelPointerPosition = null;
      context.pointerSink.setPointerPosition(null);
      return true;
    }
  }

  /** Keeps movie playback authoritative while allowing the original skip rule. */
  private static processMovieInput(): boolean {
    const movieContext = VRSpike.hooks?.getMovieContext?.() ?? null;
    const cutsceneContext = movieContext ? null : VRSpike.hooks?.getCutsceneContext?.() ?? null;
    const context = movieContext ?? cutsceneContext;
    if (!context) {
      VRSpike.movieCancelHeld = false;
      VRSpike.movieHost?.clear();
      return false;
    }

    const session = VRSpike.session;
    if (!session) return true;
    try {
      const actions = VRSpike.inputRouter.route(
        XRGamepadReader.read(Array.from(session.inputSources ?? [])),
        new Set(['ui', 'gameplay'])
      );
      const skipPressed = actions.some((action) =>
        (action.action === SemanticXRAction.Cancel ||
          action.action === SemanticXRAction.Select ||
          action.action === SemanticXRAction.Use) && action.pressed
      );
      if (skipPressed && !VRSpike.movieCancelHeld) {
        if (context.canSkip) {
          context.skip();
        } else {
          // The per-line skip is gated by the authored `skippable` flag, but
          // flatscreen also has an unconditional abort (DialogAbort) that
          // works even on a `NodeUnskippable` entry. VR previously had no
          // equivalent, so an unskippable line was a permanent dead end.
          (context as { abort?: () => void }).abort?.();
        }
      }
      VRSpike.movieCancelHeld = skipPressed;
    } catch (error) {
      VRSpike.movieCancelHeld = false;
      if (!VRSpike.movieInputErrorReported) {
        VRSpike.movieInputErrorReported = true;
        console.error('[VRSpike] movie input rejected', error);
      }
    }
    // A BIK movie owns the entire input surface. Dialogue owns it only while
    // its current authored line may be skipped; once replies are available the
    // normal static panel receives the controller ray again.
    return movieContext !== null || cutsceneContext?.canSkip === true;
  }

  private static processKeyboardInput(): boolean {
    const sink = VRSpike.hooks?.getKeyboardContext?.() ?? null;
    const inputFrame = VRSpike.latestInputFrame;
    const session = VRSpike.session;
    const scene = VRSpike.scene;
    if (!sink || !inputFrame || !session || !scene) {
      VRSpike.keyboardHost?.clear();
      VRSpike.keyboardSelectHeld = false;
      VRSpike.keyboardCancelHeld = false;
      VRSpike.keyboardWasActive = false;
      return false;
    }
    try {
      if (!VRSpike.keyboardHost) VRSpike.keyboardHost = new VRKeyboardHost(scene);
      if (!VRSpike.keyboardWasActive) {
        VRSpike.clearLegacyPanelPointer();
        VRSpike.keyboardWasActive = true;
      }
      const actions = VRSpike.inputRouter.route(
        XRGamepadReader.read(Array.from(session.inputSources ?? [])),
        new Set(['ui', 'interaction', 'gameplay'])
      );
      const selectPressed = actions.some((action) =>
        (action.action === SemanticXRAction.Select || action.action === SemanticXRAction.Use) && action.pressed
      );
      const cancelPressed = actions.some((action) => action.action === SemanticXRAction.Cancel && action.pressed);
      const grabAction = actions.find((action) => action.action === SemanticXRAction.Grab && action.pressed);
      if (grabAction) {
        const hand = inputFrame.hands[grabAction.hand];
        if (hand) VRSpike.keyboardHost.moveTo(hand.pose, inputFrame.head);
      }
      if (selectPressed && !VRSpike.keyboardSelectHeld && VRSpike.keyboardHost.isVisible) {
        const rayPose = inputFrame.hands.right?.targetRayPose;
        const key = rayPose ? VRSpike.keyboardHost.keyAtRay(rayPose) : null;
        if (key) VRSpike.keyboardInputController.press(key, sink);
      }
      VRSpike.keyboardSelectHeld = selectPressed;
      if (cancelPressed && !VRSpike.keyboardCancelHeld) sink.cancel();
      VRSpike.keyboardCancelHeld = cancelPressed;
      VRSpike.keyboardGrabHeld = !!grabAction;
    } catch (error) {
      VRSpike.keyboardHost?.clear();
      VRSpike.keyboardSelectHeld = false;
      VRSpike.keyboardCancelHeld = false;
      VRSpike.keyboardGrabHeld = false;
      console.error('[VRSpike] virtual keyboard input rejected', error);
    }
    return true;
  }

  /** Removes the legacy GUI cursor before another surface takes input ownership. */
  private static clearLegacyPanelPointer(): void {
    const context = VRSpike.hooks?.getPanelContext?.();
    VRSpike.panelPointerHost?.clear();
    VRSpike.latestPanelPointerPosition = null;
    VRSpike.panelInputController.cancel();
    context?.pointerSink.setPointerPosition(null);
  }

  private static processInteractionInput(timestamp: number): boolean {
    const inputFrame = VRSpike.latestInputFrame;
    const session = VRSpike.session;
    const context = VRSpike.hooks?.getInteractionContext?.();
    if (!inputFrame || !session || !context?.actor) {
      VRSpike.interactionPreviewIndicator = null;
      return false;
    }

    try {
      VRSpike.interactionTargetSet.synchronize(context.targets);
      const preview = VRSpike.interactionSystem.preview(inputFrame, 'right');
      VRSpike.interactionPreviewIndicator = preview
        ? { id: preview.id, name: preview.label, position: preview.position }
        : null;
      const controllers = XRGamepadReader.read(Array.from(session.inputSources ?? []));
      const actions = VRSpike.inputRouter.route(controllers, new Set(['gameplay', 'interaction']));
      const intent = VRSpike.interactionSystem.process(
        inputFrame,
        actions,
        String(context.actor.id),
        timestamp
      );
      if (!intent) return false;
      const result = context.onInteractionIntent?.(intent);
      if (result && result.feedbackLabel && VRSpike.interactionPreviewIndicator) {
        VRSpike.interactionPreviewIndicator = {
          ...VRSpike.interactionPreviewIndicator,
          name: result.feedbackLabel,
        };
      }
      return true;
    } catch (error) {
      VRSpike.interactionPreviewIndicator = null;
      if (!VRSpike.worldInteractionInputErrorReported) {
        VRSpike.worldInteractionInputErrorReported = true;
        console.error('[VRSpike] world interaction input rejected', error);
      }
      return false;
    }
  }

  /**
   * The object VRSpike's own right-hand interaction ray is resolving this
   * frame, reused from the world-interaction preview that `processInteractionInput`
   * always computes first. Combat/Force target nomination must derive from
   * this rather than any flatscreen-mouse hover/select state, which freezes
   * the instant a WebXR session takes over input.
   */
  private static resolveAimedTargetId(): number | null {
    const id = VRSpike.interactionPreviewIndicator?.id;
    if (!id) return null;
    const match = /^module-object:(\d+)$/.exec(id);
    return match ? Number(match[1]) : null;
  }

  private static processCombatInput(timestamp: number): void {
    const inputFrame = VRSpike.latestInputFrame;
    const session = VRSpike.session;
    if (!inputFrame || !session) {
      VRSpike.combatCancelHeld = false;
      return;
    }
    const context = VRSpike.hooks?.getCombatContext?.(VRSpike.resolveAimedTargetId()) ?? null;
    if (!context) {
      VRSpike.combatCancelHeld = false;
      return;
    }

    try {
      const actions = VRSpike.inputRouter.route(
        XRGamepadReader.read(Array.from(session.inputSources ?? [])),
        new Set(['combat', 'interaction', 'ui'])
      );
      const cancelPressed = actions.some((action) =>
        action.action === SemanticXRAction.Cancel && action.hand === 'right' && action.pressed
      );
      // Cancel must run unconditionally, before the nominated-target check
      // below returns early — otherwise a target that stops qualifying
      // mid-round (dies, faction flips, walks out of range) takes its only
      // cancel path down with it and orphans an in-flight attack.
      if (cancelPressed && !VRSpike.combatCancelHeld) context.cancel?.();
      VRSpike.combatCancelHeld = cancelPressed;

      if (!context.nominatedTargetId) return;

      const offhandGrip = actions.some((action) =>
        action.action === SemanticXRAction.Grab && action.hand === 'left' && action.pressed
      );
      const weaponActionPressed = actions.some((action) =>
        action.action === SemanticXRAction.WeaponAction && action.hand === 'right' && action.pressed
      );
      const events = VRSpike.combatInputController.process(inputFrame, {
        actorId: context.actorId,
        nominatedTargetId: context.nominatedTargetId,
        weaponMode: context.weaponMode,
        timestamp,
        offhandGrip,
        weaponActionPressed,
      });
      for (const event of events) context.onCombatSwing(event);
    } catch (error) {
      if (!VRSpike.combatInputErrorReported) {
        VRSpike.combatInputErrorReported = true;
        console.error('[VRSpike] combat input rejected', error);
      }
    }
  }

  private static processForceInput(timestamp: number): boolean {
    const inputFrame = VRSpike.latestInputFrame;
    const session = VRSpike.session;
    if (!inputFrame || !session) return false;
    const context = VRSpike.hooks?.getForceContext?.(VRSpike.resolveAimedTargetId()) ?? null;
    if (!context) return false;
    try {
      const actions = VRSpike.inputRouter.route(
        XRGamepadReader.read(Array.from(session.inputSources ?? [])),
        new Set(['interaction'])
      );
      const gripModifierHeld = actions.some((action) =>
        action.action === SemanticXRAction.Grab && action.hand === 'right' && action.pressed
      );
      const gesture = VRSpike.forceGestureController.process(inputFrame, gripModifierHeld, timestamp);
      if (!gesture) return false;
      context.onForceGesture(gesture);
      return true;
    } catch (error) {
      if (!VRSpike.forceGestureErrorReported) {
        VRSpike.forceGestureErrorReported = true;
        console.error('[VRSpike] Force gesture rejected', error);
      }
      return false;
    }
  }

  private static processRadialMenuInput(): boolean {
    const context = VRSpike.hooks?.getRadialMenuContext?.(VRSpike.resolveAimedTargetId()) ?? null;
    const session = VRSpike.session;
    if (!context || !session) return false;
    try {
      const wasOpen = VRSpike.radialMenuController.isOpen;
      const inputFrame = VRSpike.latestInputFrame;
      const actions = VRSpike.inputRouter.route(
        XRGamepadReader.read(Array.from(session.inputSources ?? [])),
        new Set(['global', 'locomotion', 'ui'])
      );
      let pointerVector: { x: number; y: number } | null = null;
      const offHand = inputFrame?.hands.left;
      const dominantHand = inputFrame?.hands.right;
      if (wasOpen && VRSpike.scene && inputFrame && offHand) {
        if (!VRSpike.radialMenuHost) VRSpike.radialMenuHost = new VRRadialMenuHost(VRSpike.scene);
        if (!VRSpike.radialPointerHost) VRSpike.radialPointerHost = new VRPanelPointerHost(VRSpike.scene);
        VRSpike.radialMenuHost.present(offHand.pose, inputFrame.head, context.items, VRSpike.radialMenuController.selected);
        const pointerHit = dominantHand
          ? VRSpike.radialPointerHost.update(VRSpike.radialMenuHost.object, dominantHand.targetRayPose, 800, 800)
          : null;
        pointerVector = pointerHit?.guiPosition ?? null;
      }
      const ownsInput = VRSpike.radialMenuController.process(context.items, actions, pointerVector);
      const isOpen = VRSpike.radialMenuController.isOpen;
      if (isOpen && VRSpike.scene && inputFrame?.hands.left) {
        if (!VRSpike.radialMenuHost) VRSpike.radialMenuHost = new VRRadialMenuHost(VRSpike.scene);
        VRSpike.radialMenuHost.present(inputFrame.hands.left.pose, inputFrame.head, context.items, VRSpike.radialMenuController.selected);
      } else {
        VRSpike.radialMenuHost?.clear();
        VRSpike.radialPointerHost?.clear();
      }
      if (wasOpen !== isOpen) context.setPaused(isOpen);
      return ownsInput;
    } catch (error) {
      VRSpike.radialMenuController.close();
      context.setPaused(false);
      console.error('[VRSpike] radial menu input rejected', error);
      return false;
    }
  }

  private static processLocomotionInput(timestamp: number, frame: XRFrame): void {
    const renderer = VRSpike.renderer;
    const session = VRSpike.session;
    const rig = VRSpike.rig;
    const applyLocomotion = VRSpike.hooks?.applyLocomotion;
    const currentFacing = VRSpike.hooks?.getPlayerFacing?.();
    if (!renderer || !session || !rig || !applyLocomotion || currentFacing == null) return;

    const referenceSpace = renderer.xr.getReferenceSpace();
    if (!referenceSpace || typeof frame.getViewerPose !== 'function') return;
    const controllers = XRGamepadReader.read(Array.from(session.inputSources ?? []));
    if (controllers.length === 0) return;

    try {
      const viewerPose = frame.getViewerPose(referenceSpace);
      if (!viewerPose) return;
      const routedActions = VRSpike.inputRouter.route(
        controllers,
        // 'gameplay' is only needed here for ToggleLocomotionMode, which is
        // bound in that context rather than 'locomotion'.
        new Set(['locomotion', 'gameplay'])
      );
      const move = routedActions.find((action) => action.action === SemanticXRAction.Move);
      const turn = routedActions.find((action) => action.action === SemanticXRAction.Turn);
      if (!move?.axes) return;

      const comfortSettings = VRSpike.hooks?.getComfortSettings?.() ?? DEFAULT_COMFORT_SETTINGS;

      const togglePressed = routedActions.some((action) =>
        action.action === SemanticXRAction.ToggleLocomotionMode && action.pressed
      );
      if (togglePressed && !VRSpike.locomotionModeToggleHeld) {
        VRSpike.hooks?.setComfortSettings?.({
          locomotionMode: comfortSettings.locomotionMode === 'smooth' ? 'blink' : 'smooth',
        });
        VRSpike.teleportController.reset();
      }
      VRSpike.locomotionModeToggleHeld = togglePressed;

      const rawMoveAxes = new THREE.Vector2(move.axes[0], -move.axes[1]);
      const inputDirection = rawMoveAxes.clone();
      const inputMagnitude = Math.min(1, inputDirection.length());
      if (inputMagnitude > 0) inputDirection.divideScalar(inputMagnitude);

      const orientation = viewerPose.transform.orientation;
      const xrHeadOrientation = new THREE.Quaternion(
        orientation.x,
        orientation.y,
        orientation.z,
        orientation.w
      ).normalize();
      const headWorldOrientation = rig.quaternion.clone().multiply(xrHeadOrientation);
      const previousTimestamp = VRSpike.previousXRInputTimestamp;
      const deltaSeconds = previousTimestamp == null
        ? 1 / VRSpike.perf.targetHz
        : Math.min(0.1, Math.max(0, (timestamp - previousTimestamp) / 1000));
      VRSpike.previousXRInputTimestamp = timestamp;

      // Match the legacy KOTOR camera convention: stick-right decreases
      // world yaw and therefore turns the view and creature to the right.
      const turnAxisValue = -(turn?.axes?.[0] ?? 0);
      const useSnapTurn = comfortSettings.turnMode === 'snap';
      const snapTurnDeltaRadians = useSnapTurn
        ? VRSpike.snapTurnController.process(
          turnAxisValue,
          THREE.MathUtils.degToRad(comfortSettings.snapTurnDegrees)
        )
        : 0;

      const resolvedLocomotion = VRSpike.locomotionController.resolve(
        {
          direction: inputDirection,
          magnitude: inputMagnitude,
          turn: useSnapTurn ? 0 : turnAxisValue,
          mode: comfortSettings.locomotionMode,
          referenceFrame: 'head',
        },
        headWorldOrientation,
        currentFacing,
        deltaSeconds
      );
      const turnDeltaRadians = useSnapTurn ? snapTurnDeltaRadians : resolvedLocomotion.turnDeltaRadians;
      if (turnDeltaRadians !== 0) {
        VRSpike.applyTurnAroundHead(turnDeltaRadians, viewerPose.transform.position);
        VRSpike.turnYaw = Math.atan2(
          Math.sin(VRSpike.turnYaw + turnDeltaRadians),
          Math.cos(VRSpike.turnYaw + turnDeltaRadians)
        );
      }

      if (comfortSettings.locomotionMode === 'blink') {
        VRSpike.processTeleportLocomotion(rawMoveAxes, headWorldOrientation);
        VRSpike.updateComfortVignette(0);
      } else {
        VRSpike.teleportController.reset();
        applyLocomotion(resolvedLocomotion);
        // Discrete comfort modes (snap turn) don't need the vignette — it's
        // a mitigation for continuous vection, not instant reorientation.
        VRSpike.updateComfortVignette(
          comfortSettings.vignetteEnabled ? resolvedLocomotion.magnitude : 0
        );
      }
    } catch (error) {
      if (!VRSpike.locomotionInputErrorReported) {
        VRSpike.locomotionInputErrorReported = true;
        console.error('[VRSpike] controller locomotion input rejected', error);
      }
    }
  }

  private static updateComfortVignette(intensity: number): void {
    if (!VRSpike.camera) return;
    if (intensity <= 0 && !VRSpike.comfortVignetteHost) return;
    if (!VRSpike.comfortVignetteHost) {
      VRSpike.comfortVignetteHost = new VRComfortVignetteHost(VRSpike.camera);
    }
    VRSpike.comfortVignetteHost.setIntensity(intensity);
  }

  /**
   * Blink-teleport (ROADMAP 2.5): the comfort alternative to smooth movement.
   * Deflecting the offhand stick aims in that head-relative direction;
   * releasing it commits a single instant relocation, clamped to the
   * nearest walkable point on the player's current room walkmesh so a
   * teleport can't land the player inside geometry or off the level.
   */
  private static processTeleportLocomotion(
    rawMoveAxes: THREE.Vector2,
    headWorldOrientation: THREE.Quaternion
  ): void {
    const result = VRSpike.teleportController.process(rawMoveAxes);
    if (result.phase !== 'committed' || !result.direction) return;

    const feet = VRSpike.hooks?.getPlayerPosition() ?? null;
    const walkmesh = VRSpike.hooks?.getCurrentRoomWalkmesh?.() ?? null;
    const teleportPlayer = VRSpike.hooks?.teleportPlayer;
    if (!feet || !walkmesh || !teleportPlayer) return;

    const headFacing = LocomotionController.worldOrientationToCreatureFacing(headWorldOrientation);
    const worldDirection = result.direction
      .clone()
      .rotateAround(new THREE.Vector2(0, 0), headFacing);
    const candidate = feet.clone().addScaledVector(
      new THREE.Vector3(worldDirection.x, worldDirection.y, 0),
      VRSpike.teleportController.maxDistanceMetres
    );

    const target = walkmesh.isPointWalkable(candidate)
      ? candidate
      : walkmesh.getNearestWalkablePoint(candidate);
    teleportPlayer(target);
  }

  private static applyTurnAroundHead(
    turnDeltaRadians: number,
    xrHeadPosition: DOMPointReadOnly
  ): void {
    const rig = VRSpike.rig;
    if (!rig || Math.abs(turnDeltaRadians) < 1e-10) return;
    const localHeadPosition = new THREE.Vector3(
      xrHeadPosition.x,
      xrHeadPosition.y,
      xrHeadPosition.z
    );
    const oldHeadOffset = localHeadPosition.clone().applyQuaternion(rig.quaternion);
    const turnQuaternion = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      turnDeltaRadians
    );
    const turnedRigOrientation = turnQuaternion.multiply(rig.quaternion);
    const newHeadOffset = localHeadPosition.applyQuaternion(turnedRigOrientation);
    VRSpike.turnOriginOffset.add(oldHeadOffset.sub(newHeadOffset));
  }

  /** One-shot evidence for isolating a blocked first immersive frame. */
  static traceStartupStage(stage: string): void {
    if (!VRSpike.traceXRStartup) return;
    console.log(`[VRSpike] startup stage: ${stage}`);
  }

  static completeStartupTrace(): void {
    if (!VRSpike.traceXRStartup) return;
    console.log('[VRSpike] startup stage: frame-complete');
    VRSpike.traceXRStartup = false;
  }

  static get isPresenting(): boolean {
    return !!VRSpike.renderer?.xr?.isPresenting;
  }

  /**
   * Stereo render path. Replaces `composer.render()` while presenting.
   *
   * `autoClear` is false engine-wide because the flatscreen path layers world,
   * GUI and cursor passes by hand. In XR we own the whole frame, so clear once
   * and submit the world. A visible legacy GUI is first rendered into the
   * world-space VR panel so original menu controls remain authoritative.
   */
  static render(worldCamera: THREE.Camera, frameTimestamp: number): void {
    const renderer = VRSpike.renderer;
    const scene = VRSpike.scene;
    if (!renderer || !scene || !VRSpike.camera || !VRSpike.rig) return;

    // WebXRManager binds this target before invoking the frame callback.
    // KOTOR's GUI texture renders may replace it with an offscreen target and
    // finally null; restore the captured XR target before the world submission.
    if (VRSpike.xrFrameRenderTarget) {
      renderer.setRenderTarget(VRSpike.xrFrameRenderTarget);
    }

    // refreshTrackedPresentationPose() must keep running every frame
    // regardless of cutscene state — it is what builds latestInputFrame,
    // and the theater panel below requires it to place itself from the
    // physical head pose.
    const cutsceneContext = VRSpike.hooks?.getCutsceneContext?.() ?? null;
    if (VRSpike.followCamera && worldCamera) {
      // A scripted cutscene/dialogue camera cut moves the *player*/*camera*
      // to frame a shot — invisible on flatscreen because FollowerCamera is
      // overridden there, but syncRig ties the VR rig 1:1 to that same raw
      // position every frame with no smoothing, so the headset viewpoint
      // got yanked straight into the new shot (too close, or — when the
      // animated camera itself was mistaken for the elevated follower
      // camera by syncRig's null-player fallback — underground). The
      // theater panel is positioned from the physical head pose, not from
      // this sync, so skipping only syncRig during a cutscene costs
      // nothing and stops both bugs.
      if (!cutsceneContext) VRSpike.syncRig(worldCamera);
      VRSpike.refreshTrackedPresentationPose();
    }

    if (cutsceneContext) {
      VRSpike.renderCutscene(worldCamera, frameTimestamp);
      return;
    }

    VRSpike.renderKeyboard();
    VRSpike.renderPanel();
    VRSpike.renderWorldTargetLabel();

    // The GUI texture pass restores the target it observed. Legacy engine
    // renders may already have reset that target, so make the XR target
    // authoritative once more immediately before stereo world submission.
    if (VRSpike.xrFrameRenderTarget) {
      renderer.setRenderTarget(VRSpike.xrFrameRenderTarget);
    }

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.render(scene, VRSpike.camera);
    VRSpike.perf.recordXRRender(frameTimestamp);
    renderer.autoClear = prevAutoClear;
  }

  private static reportMissingMovieRenderPrerequisite(kind: 'movie' | 'cutscene', hadInputFrame: boolean): void {
    if (VRSpike.missingMovieRenderPrerequisiteReported) return;
    VRSpike.missingMovieRenderPrerequisiteReported = true;
    console.warn(
      `[VRSpike] render${kind === 'movie' ? 'Movie' : 'Cutscene'} has no theater surface to submit this frame ` +
      `(renderer=${!!VRSpike.renderer} scene=${!!VRSpike.scene} camera=${!!VRSpike.camera} ` +
      `rig=${!!VRSpike.rig} inputFrame=${hadInputFrame}) — every subsequent frame will silently repeat this ` +
      `until the missing piece recovers, which reads to the player as a frozen headset.`
    );
  }

  /**
   * Submits an engine-authored movie through the XR compositor. Movie mode
   * otherwise renders only to the legacy flat framebuffer, which WebXR never
   * presents to the headset.
   */
  static renderMovie(
    movieScene: THREE.Scene,
    movieCamera: THREE.Camera,
    viewportWidth: number,
    viewportHeight: number,
    frameTimestamp: number
  ): void {
    const renderer = VRSpike.renderer;
    const worldScene = VRSpike.scene;
    const inputFrame = VRSpike.latestInputFrame;
    if (!renderer || !worldScene || !VRSpike.camera || !VRSpike.rig || !inputFrame) {
      // A missing inputFrame here means every subsequent call this session
      // will also bail silently — no theater surface is ever submitted to
      // the XR compositor, which reads to the player as a frozen headset
      // recoverable only by leaving VR. Surface it instead of failing quiet.
      VRSpike.reportMissingMovieRenderPrerequisite('movie', !!inputFrame);
      return;
    }

    VRSpike.clearLegacyPanelPointer();
    VRSpike.worldTargetLabelHost?.clear();
    VRSpike.latestPanelPointerPosition = null;

    try {
      if (!VRSpike.movieHost) {
        VRSpike.movieHost = new VRPanelHost(worldScene, {
          distanceMetres: 2.25,
          widthMetres: 2.4,
        });
      }
      VRSpike.movieHost.present(
        VRSpike.movieOwner,
        inputFrame.head,
        viewportWidth,
        viewportHeight
      );
      VRSpike.movieHost.renderGui(renderer, movieScene, movieCamera);

      if (VRSpike.xrFrameRenderTarget) {
        renderer.setRenderTarget(VRSpike.xrFrameRenderTarget);
      }
      const previousAutoClear = renderer.autoClear;
      renderer.autoClear = true;
      renderer.render(worldScene, VRSpike.camera);
      VRSpike.perf.recordXRRender(frameTimestamp);
      renderer.autoClear = previousAutoClear;
    } catch (error) {
      VRSpike.movieHost?.clear();
      console.error('[VRSpike] movie theater presentation rejected', error);
    }
  }

  /**
   * Captures the authored dialogue camera into the theater while leaving the
   * headset camera under player control. The legacy dialogue panel is then
   * rendered independently as the static subtitle/reply surface.
   */
  private static renderCutscene(worldCamera: THREE.Camera, frameTimestamp: number): void {
    const renderer = VRSpike.renderer;
    const worldScene = VRSpike.scene;
    const inputFrame = VRSpike.latestInputFrame;
    if (!renderer || !worldScene || !VRSpike.camera || !inputFrame) {
      VRSpike.reportMissingMovieRenderPrerequisite('cutscene', !!inputFrame);
      return;
    }
    try {
      if (!VRSpike.movieHost) {
        VRSpike.movieHost = new VRPanelHost(worldScene, { distanceMetres: 2.25, widthMetres: 2.4 });
      }
      VRSpike.movieHost.present(
        VRSpike.cutsceneOwner,
        inputFrame.head,
        Math.max(1, Math.round((VRSpike.renderer?.domElement?.width ?? 1280))),
        Math.max(1, Math.round((VRSpike.renderer?.domElement?.height ?? 720)))
      );
      const movieVisible = VRSpike.movieHost.object.visible;
      const panelVisible = VRSpike.panelHost?.object.visible ?? false;
      try {
        // Do not recursively capture the theater or reply surface.
        VRSpike.movieHost.object.visible = false;
        if (VRSpike.panelHost) VRSpike.panelHost.object.visible = false;
        VRSpike.movieHost.renderGui(renderer, worldScene, worldCamera);
      } finally {
        VRSpike.movieHost.object.visible = movieVisible;
        if (VRSpike.panelHost) VRSpike.panelHost.object.visible = panelVisible;
      }
      VRSpike.renderPanel();
      if (VRSpike.xrFrameRenderTarget) renderer.setRenderTarget(VRSpike.xrFrameRenderTarget);
      const previousAutoClear = renderer.autoClear;
      renderer.autoClear = true;
      renderer.render(worldScene, VRSpike.camera);
      VRSpike.perf.recordXRRender(frameTimestamp);
      renderer.autoClear = previousAutoClear;
    } catch (error) {
      VRSpike.movieHost?.clear();
      console.error('[VRSpike] cutscene theater presentation rejected', error);
    }
  }

  /** Places a newly focused keyboard only after this frame's rig synchronization. */
  private static renderKeyboard(): void {
    const inputFrame = VRSpike.latestInputFrame;
    const sink = VRSpike.hooks?.getKeyboardContext?.() ?? null;
    if (!sink || !inputFrame) {
      VRSpike.keyboardHost?.clear();
      return;
    }
    if (!VRSpike.keyboardHost && VRSpike.scene) {
      VRSpike.keyboardHost = new VRKeyboardHost(VRSpike.scene);
    }
    VRSpike.keyboardHost?.present(inputFrame.head);
  }

  private static renderPanel(): void {
    const renderer = VRSpike.renderer;
    const worldScene = VRSpike.scene;
    const inputFrame = VRSpike.latestInputFrame;
    const context = VRSpike.hooks?.getPanelContext?.();
    if (VRSpike.hooks?.getKeyboardContext?.()) {
      // Keyboard owns input while it has focus, but the panel underneath —
      // e.g. a name-entry popup — must stay visible so the player can see
      // what they're typing; hiding it here made typing look unresponsive
      // even when key routing was working. Only the pointer/cursor is
      // cleared: left alone it would freeze at wherever it was last aimed
      // the instant keyboard focus was taken (often mid-click on the field
      // that opened it) and read as a stray pointer stuck on the name.
      VRSpike.clearLegacyPanelPointer();
    }
    if (!renderer || !worldScene || !context?.menu || !inputFrame) {
      VRSpike.panelHost?.clear();
      VRSpike.panelPointerHost?.clear();
      VRSpike.latestPanelPointerPosition = null;
      context?.pointerSink.setPointerPosition(null);
      return;
    }

    try {
      if (!VRSpike.panelHost) {
        VRSpike.panelHost = new VRPanelHost(worldScene);
      }
      if (!VRSpike.panelPointerHost) {
        VRSpike.panelPointerHost = new VRPanelPointerHost(worldScene);
      }
      VRSpike.panelHost.present(
        context.menu,
        inputFrame.head,
        context.viewportWidth,
        context.viewportHeight
      );
      // GameState deliberately hides the legacy mouse cursor during ordinary
      // XR play. Reapply the panel hit after simulation so the original cursor
      // is included only in this GUI-to-texture pass.
      context.pointerSink.setPointerPosition(VRSpike.latestPanelPointerPosition);
      VRSpike.panelHost.renderGui(renderer, context.guiScene, context.guiCamera);
    } catch (error) {
      VRSpike.panelHost?.clear();
      VRSpike.panelPointerHost?.clear();
      VRSpike.latestPanelPointerPosition = null;
      context.pointerSink.setPointerPosition(null);
      if (!VRSpike.panelPresentationErrorReported) {
        VRSpike.panelPresentationErrorReported = true;
        console.error('[VRSpike] panel presentation rejected', error);
      }
    }
  }

  private static renderWorldTargetLabel(): void {
    const worldScene = VRSpike.scene;
    const menu = VRSpike.hooks?.getPanelContext?.().menu ?? null;
    const indicator = menu
      ? null
      : VRSpike.interactionPreviewIndicator ?? VRSpike.hooks?.getWorldTargetIndicator?.() ?? null;
    if (!worldScene || !indicator) {
      VRSpike.worldTargetLabelHost?.clear();
      return;
    }
    try {
      if (!VRSpike.worldTargetLabelHost) {
        VRSpike.worldTargetLabelHost = new VRWorldTargetLabelHost(worldScene);
      }
      VRSpike.worldTargetLabelHost.update(indicator);
    } catch (error) {
      VRSpike.worldTargetLabelHost?.clear();
      if (!VRSpike.worldTargetLabelErrorReported) {
        VRSpike.worldTargetLabelErrorReported = true;
        console.error('[VRSpike] world target label rejected', error);
      }
    }
  }

  /**
   * Put the rig where the player is standing. Height comes from the floor, not
   * from the follower camera, which sits well above the head and pitched down.
   */
  private static syncRig(worldCamera: THREE.Camera): void {
    const rig = VRSpike.rig;
    if (!rig) return;

    const feet = VRSpike.hooks?.getPlayerPosition() ?? null;
    if (feet) {
      rig.position.copy(feet);
    } else {
      if (!VRSpike.syncRigFallbackReported) {
        VRSpike.syncRigFallbackReported = true;
        console.warn(
          `[VRSpike] syncRig: getPlayerPosition() returned null, falling back to ` +
          `worldCamera (${worldCamera.name || worldCamera.type}) minus eyeHeight — ` +
          `this is wrong if worldCamera is an animated/cutscene camera rather than ` +
          `the elevated follower camera`
        );
      }
      worldCamera.getWorldPosition(rig.position);
      rig.position.z -= VRSpike.eyeHeight;
    }
    rig.position.add(VRSpike.turnOriginOffset);

    // Soft-block on wall intrusion (ROADMAP 2.4): the joystick-driven avatar
    // body is already walkmesh-collision-checked, but physical room-scale
    // head tracking is layered on top of the rig placed above and isn't —
    // the player's real footsteps can put their head past a wall the avatar
    // never reached. Nudge the rig back by exactly the delta needed every
    // frame; no fade, no hard stop, and it self-corrects as the player's
    // physical position changes rather than accumulating state.
    const headPosition = VRSpike.latestInputFrame?.head.position ?? null;
    if (headPosition) {
      const walkmesh = VRSpike.hooks?.getCurrentRoomWalkmesh?.() ?? null;
      const correction = resolveWallSoftBlockCorrection(headPosition, walkmesh);
      if (correction) rig.position.add(correction);
    }

    // Rebuild the rotation each frame: Z-up conversion first, then yaw about
    // the world's up axis. Order matters — yaw is applied in world space.
    const facing = VRSpike.hooks?.getFacing() ?? 0;
    XRCoordinateConverter.applyXRToGameBasis(rig);
    rig.rotateOnWorldAxis(
      new THREE.Vector3(0, 0, 1),
      // FollowerCamera.facing is the orbit bearing. KOTOR renders its camera
      // and drives forward creature movement at bearing + 90 degrees.
      facing + Math.PI / 2 + VRSpike.yawOffset + VRSpike.turnYaw
    );
  }
}
