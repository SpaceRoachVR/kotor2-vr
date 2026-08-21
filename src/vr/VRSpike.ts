import * as THREE from "three";
import { XRCoordinateConverter } from "./runtime/XRCoordinateConverter";
import { XRControllerAnchorHost } from "./runtime/XRControllerAnchorHost";
import { XRGamepadReader } from "./runtime/XRGamepadReader";
import { XRInputFrameBuilder } from "./runtime/XRInputFrameBuilder";
import { RoutedXRAction, XRInputRouter } from "./runtime/XRInputRouter";
import { InteractionSystem } from "./runtime/InteractionSystem";
import { InteractionTargetRegistry } from "./runtime/InteractionTargetRegistry";
import { LocomotionController, ResolvedLocomotion } from "./runtime/LocomotionController";
import { VRPanelHost } from "./runtime/VRPanelHost";
import { VRPanelPointerHost } from "./runtime/VRPanelPointerHost";
import { VRKeyboardHost } from "./runtime/VRKeyboardHost";
import { VRKeyboardInputController } from "./runtime/VRKeyboardInputController";
import { VR_KEYBOARD_DONE_KEY } from "./runtime/VRKeyboardLayout";
import { VRCombatInputController, VRCombatSwingEvent } from "./runtime/VRCombatInputController";
import { VRForceGesture, VRForceGestureController } from "./runtime/VRForceGestureController";
import { VRRadialControllerEffect, VRRadialMenuController } from "./runtime/VRRadialMenuController";
import { VRRadialMenuHost } from "./runtime/VRRadialMenuHost";
import type { VRRadialMenuDefinition } from "./runtime/VRRadialMenuModel";
import { VRHapticFeedback } from "./runtime/VRHapticFeedback";
import { resolveWallSoftBlockCorrection, VRWalkmeshQuery } from "./runtime/VRWallSoftBlock";
import { getVRInteractionRange } from "./runtime/VRWorldUseAdapter";
import { GamePad } from "@/controls/GamePad";
import { VRSnapTurnController } from "./runtime/VRSnapTurnController";
import { VRTeleportController } from "./runtime/VRTeleportController";
import { VRComfortVignetteHost } from "./runtime/VRComfortVignetteHost";
import { VRCutsceneFadeHost, VRCutsceneFadeEnvelope } from "./runtime/VRCutsceneFadeHost";
import { VRComfortSettingsHost, VRComfortSettingsRow } from "./runtime/VRComfortSettingsHost";
import { VRHiltTimerHost } from "./runtime/VRHiltTimerHost";
import { VRBlasterLaserHost } from "./runtime/VRBlasterLaserHost";
import {
  VRWorldTargetIndicator,
  VRWorldTargetLabelHost,
} from "./runtime/VRWorldTargetLabelHost";
import { VRWorldActionPromptController, VRWorldPromptEffect } from "./runtime/VRWorldActionPromptController";
import { VRWorldActionPromptHost } from "./runtime/VRWorldActionPromptHost";
import {
  VRWorldActionPromptModel,
  VRWorldPromptCandidate,
  selectVRWorldPromptCandidate,
} from "./runtime/VRWorldActionPromptModel";
import { VRWorldPromptModelResolver } from "./runtime/VRWorldPromptModelResolver";
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
import { CombatWeaponMode, SemanticXRAction, VRComfortSettings, XRHandRole, XRInputFrame, XRWorldPose } from "./runtime/XRTypes";
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

interface VRMovieInputContext {
  readonly canSkip: boolean;
  skip(): void;
}

interface VRCutsceneInputContext extends VRMovieInputContext {
  abort?(): void;
}

interface VRMovieInputContexts {
  readonly movie: VRMovieInputContext | null;
  readonly cutscene: VRCutsceneInputContext | null;
}

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
  };
  /** Live engine candidates and immutable prompt snapshots for world actions. */
  getWorldActionPromptContext?: () => {
    readonly actor: EngineInteractionActor | null;
    readonly candidates: readonly VRWorldPromptCandidate[];
    createPrompt(candidate: VRWorldPromptCandidate): VRWorldActionPromptModel | null;
  };
  /**
   * Current engine combat target and the authoritative d20 action bridge.
   * `aimedTargetId` is VRSpike's own live right-hand interaction-ray
   * resolution for this frame (null if nothing hostile is aimed at) — the
   * hook must nominate its target from this, not from any frozen
   * flatscreen-mouse hover/select state, which never updates once a WebXR
   * session has taken over input.
   */
  /**
   * Phase G1: hand the engine's CursorManager the object VR is aiming at, so
   * `InGameOverlay` can build its own target action menu, name plate and health
   * bar instead of us re-deriving them. Pass null to release a VR-established
   * selection. Returns whether a selection is currently held.
   */
  setVRSelectedObject?: (targetId: number | null) => boolean;
  /**
   * Phase G2: the in-game HUD overlay, presented without claiming foreground
   * input ownership so the player can keep moving while it is up.
   */
  getInGameOverlayContext?: () => {
    /** Identity used by VRPanelHost to detect an owner change. */
    readonly overlay: object;
    readonly guiScene: THREE.Scene;
    readonly guiCamera: THREE.Camera;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
  } | null;
  /**
   * TEMPORARY (VR-PLAYTEST-FIX-PLAN.md issue 8): one-line snapshot of the
   * engine's combat/action queues, used to find what re-queues an attack after
   * a cancel demonstrably runs. Remove with the rest of the issue-8 tracing.
   */
  describeCombatQueue?: () => string;
  getCombatContext?: (aimedTargetId: number | null) => {
    readonly actorId: string;
    readonly nominatedTargetId: string | null;
    readonly weaponMode: import('./runtime/XRTypes').CombatWeaponMode;
    /** True while the actor is in an actual engagement (drives the laser sight). */
    readonly inCombat: boolean;
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
  /** Builds the engine-safe all-purpose action wheel for the current aim. */
  createActionWheel?: (aimedTargetId: number | null) => VRRadialMenuDefinition | null;
  /**
   * Comfort settings panel (ROADMAP 2.6) — the settings the
   * ToggleLocomotionMode button alone doesn't reach: turn mode, snap-turn
   * angle, and the comfort vignette. Opened from the action wheel; always
   * exactly four rows, matching `VRComfortSettingsHost`'s contract.
   */
  getComfortSettingsPanelContext?: () => {
    readonly rows: readonly VRComfortSettingsRow[];
    activateRow(index: number): void;
    close(): void;
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
  getMovieContext?: () => VRMovieInputContext | null;
  /**
   * Active engine-authored dialogue/cutscene camera and its current skip
   * rule. `abort` mirrors flatscreen's unconditional DialogAbort — it must
   * work even when `canSkip` is false (an authored `NodeUnskippable` entry),
   * which is exactly the case VR previously had no escape from.
   */
  getCutsceneContext?: () => VRCutsceneInputContext | null;
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
  private static hiltTimerHost: VRHiltTimerHost | null = null;
  private static blasterLaserHost: VRBlasterLaserHost | null = null;
  private static cutsceneFadeHost: VRCutsceneFadeHost | null = null;
  private static readonly cutsceneFadeEnvelope = new VRCutsceneFadeEnvelope();
  private static lastCutsceneCamera: THREE.Camera | null = null;
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
  private static readonly haptics = new VRHapticFeedback();
  private static radialMenuHost: VRRadialMenuHost | null = null;
  private static radialOpeningHeadPose: XRWorldPose | null = null;
  private static radialMenuPressedLastFrame = false;
  private static comfortSettingsHost: VRComfortSettingsHost | null = null;
  private static comfortSettingsSelectHeld = false;
  private static comfortSettingsCancelHeld = false;
  private static keyboardSelectHeld = false;
  private static keyboardCancelHeld = false;
  private static keyboardGrabHeld = false;
  private static keyboardWasActive = false;
  /** Set by the keyboard's DONE key; cleared on grip or on leaving the screen. */
  private static keyboardDismissed = false;
  private static movieHost: VRPanelHost | null = null;
  private static readonly movieOwner = {};
  private static readonly cutsceneOwner = {};
  private static panelPointerHost: VRPanelPointerHost | null = null;
  private static worldTargetLabelHost: VRWorldTargetLabelHost | null = null;
  private static worldActionPromptHost: VRWorldActionPromptHost | null = null;
  private static worldActionPromptController = new VRWorldActionPromptController();
  private static worldPromptCandidateId: string | null = null;
  private static worldPromptCandidateStateKey: string | null = null;
  private static worldPromptModelResolver = new VRWorldPromptModelResolver();
  private static worldPromptModel: VRWorldActionPromptModel | null = null;
  private static worldPromptModule: string | null = null;
  private static worldPromptModuleInitialized = false;
  private static worldPromptSelectHeld: Record<XRHandRole, boolean> = { left: true, right: true };
  private static interactionAimedTargetId: number | null = null;
  private static interactionPreviewIndicator: VRWorldTargetIndicator | null = null;
  private static latestPanelPointerPosition: THREE.Vector2 | null = null;
  private static movieCancelHeld = false;
  private static movieOrCutsceneActiveLastFrame = false;
  private static combatCancelHeld = false;
  private static readonly interactionTargetSet = new ModuleObjectInteractionTargetSet(
    VRSpike.interactionRegistry,
    () => VRSpike.hooks?.getInteractionContext?.().actor ?? null,
    {
      getInteractionRangeMetres: (object) =>
        getVRInteractionRange(object.objectType ?? 0),
    }
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

    // WebXR talks to whichever OpenXR runtime is currently active, so a
    // headset that works under one runtime and not another (reported for
    // SteamVR vs VDXR) usually surfaces here rather than at requestSession.
    // Report enough to tell a runtime/config problem from a real gap.
    let supported = false;
    try {
      supported = await (navigator as any).xr.isSessionSupported('immersive-vr');
      console.log(
        `[VRSpike] installed. immersive-vr supported: ${supported}` +
        ` (secureContext=${window.isSecureContext}, ua=${navigator.userAgent})`
      );
      if (!supported) {
        console.warn(
          '[VRSpike] the browser reports no immersive-vr support. This is usually the ' +
          'active OpenXR runtime rather than the page: confirm the headset runtime ' +
          '(SteamVR / Oculus / VDXR) is running AND set as the active OpenXR runtime, ' +
          'then reload.'
        );
      }
    } catch (error) {
      console.error('[VRSpike] isSessionSupported threw — treating VR as unavailable', error);
    }
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
      // XR controllers are visible to the Gamepad API too. Silence the legacy
      // pad bindings for the whole session so a VR press cannot also run the
      // flatscreen keymap behind it (see GamePad.suppressed).
      GamePad.suppressed = true;
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
      VRSpike.movieOrCutsceneActiveLastFrame = false;
      VRSpike.keyboardSelectHeld = false;
      VRSpike.keyboardCancelHeld = false;
      VRSpike.keyboardGrabHeld = false;
      VRSpike.turnYaw = 0;
      VRSpike.turnOriginOffset.set(0, 0, 0);
      VRSpike.interactionTargetSet.clear();
      VRSpike.interactionSystem.cancelTransientState();
      VRSpike.clearWorldActionPrompt(false);
      VRSpike.worldPromptModule = null;
      VRSpike.worldPromptModuleInitialized = false;
      VRSpike.worldPromptSelectHeld = { left: true, right: true };
      VRSpike.interactionAimedTargetId = null;
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
      const error = e as { name?: string; message?: string };
      console.error(
        `[VRSpike] requestSession failed (${error?.name ?? 'unknown'}): ${error?.message ?? e}. ` +
        'If the headset works under one OpenXR runtime but not another, check which runtime ' +
        'is set active — the session request is plain immersive-vr with only local-floor / ' +
        'bounded-floor as optional features, which every runtime supports.',
        e
      );
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
    // Hand the flatscreen pad layer back now that VR no longer owns input.
    GamePad.suppressed = false;
    VRSpike.session = null;
    VRSpike.xrFrameRenderTarget = null;
    VRSpike.previousXRInputTimestamp = null;
    VRSpike.latestXRFrame = null;
    VRSpike.latestXRFrameTimestamp = 0;
    VRSpike.movieCancelHeld = false;
    VRSpike.movieOrCutsceneActiveLastFrame = false;
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
    VRSpike.worldTargetLabelHost?.clear();
    VRSpike.clearWorldActionPrompt(true);
    VRSpike.worldPromptModule = null;
    VRSpike.worldPromptModuleInitialized = false;
    VRSpike.worldPromptSelectHeld = { left: true, right: true };
    VRSpike.interactionAimedTargetId = null;
    VRSpike.latestPanelPointerPosition = null;
    VRSpike.comfortVignetteHost?.dispose();
    VRSpike.comfortVignetteHost = null;
    VRSpike.hiltTimerHost?.dispose();
    VRSpike.hiltTimerHost = null;
    VRSpike.blasterLaserHost?.dispose();
    VRSpike.blasterLaserHost = null;
    VRSpike.cutsceneFadeHost?.dispose();
    VRSpike.cutsceneFadeHost = null;
    VRSpike.cutsceneFadeEnvelope.reset();
    VRSpike.lastCutsceneCamera = null;

    const btn = document.getElementById('vr-spike-button');
    if (btn) btn.textContent = 'Enter VR (spike)';

    // Hand the loop back to requestAnimationFrame, exactly once.
    VRSpike.renderer?.xr.setAnimationLoop(null);
    const update = VRSpike.hooks?.update;
    if (update) requestAnimationFrame((timestamp) => update(timestamp, 'browser'));

    // The engine ignores resizes while an immersive session owns the canvas
    // (GameState.EventOnResize early-returns on xr.isPresenting), so a desktop
    // window resized mid-session leaves flatscreen sized for the stale
    // viewport. Replay one — but deferred a frame rather than dispatched
    // synchronously here, so EventOnResize (renderer.setSize, composer, depth
    // target, every camera aspect) cannot re-enter renderer state while three
    // is still tearing the session down.
    requestAnimationFrame(() => {
      try {
        window.dispatchEvent(new Event('resize'));
      } catch (error) {
        console.warn('[VRSpike] could not replay resize after session end', error);
      }
    });
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
    let moduleTransitioned = true;
    try {
      moduleTransitioned = VRSpike.observeWorldModuleTransition();
    } catch (error) {
      if (!VRSpike.worldInteractionInputErrorReported) {
        VRSpike.worldInteractionInputErrorReported = true;
        console.error('[VRSpike] world module lifecycle rejected', error);
      }
    }
    const movieInputContexts = VRSpike.resolveMovieInputContexts();
    const movieOrCutsceneActive = movieInputContexts.movie !== null ||
      movieInputContexts.cutscene !== null;
    const movieOrCutsceneEntered = movieOrCutsceneActive &&
      !VRSpike.movieOrCutsceneActiveLastFrame;
    VRSpike.movieOrCutsceneActiveLastFrame = movieOrCutsceneActive;
    const lifecycleSuspendsGameplayInput = moduleTransitioned || movieOrCutsceneActive;

    // Lifecycle teardown and edge capture must precede authored callbacks.
    // A skip/abort callback may synchronously end dialogue; dispatching first
    // could therefore erase the context and let the same physical press fall
    // through to the still-open wheel later in this frame.
    if (moduleTransitioned || movieOrCutsceneEntered) {
      VRSpike.captureMovieInputLatch();
    }
    if (lifecycleSuspendsGameplayInput) {
      VRSpike.suspendTransientGameplayInputForLifecycle();
    }

    const movieOwnsInput = VRSpike.processMovieInput(movieInputContexts);
    const keyboardOwnsInput = !movieOwnsInput && VRSpike.processKeyboardInput();
    const comfortSettingsOwnsInput = !movieOwnsInput && !keyboardOwnsInput &&
      VRSpike.processComfortSettingsInput();
    const panelOwnsInput = !movieOwnsInput && !keyboardOwnsInput &&
      !comfortSettingsOwnsInput && VRSpike.processPanelInput();
    const foregroundSurfaceOwnsInput = movieOwnsInput || keyboardOwnsInput ||
      comfortSettingsOwnsInput || panelOwnsInput;
    if (foregroundSurfaceOwnsInput && !lifecycleSuspendsGameplayInput) {
      VRSpike.suspendTransientGameplayInputForLifecycle();
    }
    const radialOwnsInput = !foregroundSurfaceOwnsInput && !lifecycleSuspendsGameplayInput &&
      VRSpike.processRadialMenuInput();
    if (radialOwnsInput) {
      VRSpike.captureWorldPromptSelectLatch();
      VRSpike.clearWorldActionPrompt(false);
    }
    if (!foregroundSurfaceOwnsInput) {
      VRSpike.processLocomotionInput(timestamp, frame, !radialOwnsInput);
      if (radialOwnsInput) {
        VRSpike.captureWeaponActionLatch();
        VRSpike.interactionTargetSet.clear();
        VRSpike.interactionSystem.cancelTransientState();
      } else if (!lifecycleSuspendsGameplayInput) {
        VRSpike.processCombatCancel();
        const interactionConsumed = VRSpike.processInteractionInput(timestamp);
        if (interactionConsumed) VRSpike.captureWeaponActionLatch();
        else VRSpike.processCombatInput(timestamp);
      }
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
      // Every controller action reads latestInputFrame, so losing this
      // silently kills all VR input with nothing in the console to say why.
      // Name the missing prerequisite instead.
      VRSpike.reportWorldPromptStageOnce(
        `tracked-input-unavailable rig=${!!rig} session=${!!session}` +
        ` referenceSpace=${!!referenceSpace}` +
        ` getViewerPose=${typeof frame.getViewerPose === 'function'}` +
        ` getPose=${typeof frame.getPose === 'function'}`
      );
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
    VRSpike.closeRadialMenuForLifecycle(true);
    VRSpike.latestInputFrame = null;
    VRSpike.interactionPreviewIndicator = null;
    VRSpike.interactionAimedTargetId = null;
    VRSpike.worldPromptSelectHeld = { left: true, right: true };
    VRSpike.clearWorldActionPrompt(false);
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

  private static resolveMovieInputContexts(): VRMovieInputContexts {
    const movie = VRSpike.hooks?.getMovieContext?.() ?? null;
    return {
      movie,
      cutscene: movie ? null : VRSpike.hooks?.getCutsceneContext?.() ?? null,
    };
  }

  /** Keeps movie playback authoritative while allowing the original skip rule. */
  private static processMovieInput(
    contexts: VRMovieInputContexts = VRSpike.resolveMovieInputContexts(),
  ): boolean {
    const movieContext = contexts.movie;
    const cutsceneContext = contexts.cutscene;
    const context = movieContext ?? cutsceneContext;
    if (!context) {
      VRSpike.movieCancelHeld = false;
      VRSpike.movieHost?.clear();
      return false;
    }

    const session = VRSpike.session;
    if (!session) return true;
    try {
      const skipPressed = VRSpike.readMovieInputPressed(session);
      if (skipPressed && !VRSpike.movieCancelHeld) {
        if (context.canSkip) {
          context.skip();
        } else {
          // The per-line skip is gated by the authored `skippable` flag, but
          // flatscreen also has an unconditional abort (DialogAbort) that
          // works even on a `NodeUnskippable` entry. VR previously had no
          // equivalent, so an unskippable line was a permanent dead end.
          (context as VRCutsceneInputContext).abort?.();
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

  private static readMovieInputPressed(session: XRSession): boolean {
    const actions = VRSpike.inputRouter.route(
      XRGamepadReader.read(Array.from(session.inputSources ?? [])),
      new Set(['ui', 'gameplay']),
    );
    return actions.some((action) =>
      (action.action === SemanticXRAction.Cancel ||
        action.action === SemanticXRAction.Select ||
        action.action === SemanticXRAction.Use) && action.pressed
    );
  }

  /** Captures movie/dialogue controls without invoking authored callbacks. */
  private static captureMovieInputLatch(): void {
    const session = VRSpike.session;
    if (!session) return;
    try {
      VRSpike.movieCancelHeld = VRSpike.readMovieInputPressed(session);
    } catch {
      // Preserve the prior latch on malformed optional input. Treating an
      // unreadable controller as released could manufacture a transition edge.
    }
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
      // Leaving the screen that owned the keyboard also retires its dismissal,
      // so the next name-entry screen opens with a keyboard again.
      VRSpike.keyboardDismissed = false;
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
        // Grabbing both repositions the keyboard and recalls a dismissed one,
        // so finishing entry is never a one-way door if more typing is needed.
        if (VRSpike.keyboardDismissed && !VRSpike.keyboardGrabHeld) VRSpike.keyboardDismissed = false;
        if (hand && !VRSpike.keyboardDismissed) VRSpike.keyboardHost.moveTo(hand.pose, inputFrame.head);
      }
      VRSpike.keyboardGrabHeld = !!grabAction;

      if (VRSpike.keyboardDismissed) {
        // Text entry is finished for now. Release the plane and the ray so the
        // panel underneath — its Accept and Back buttons — becomes reachable.
        VRSpike.keyboardHost.clear();
        VRSpike.keyboardSelectHeld = selectPressed;
        VRSpike.keyboardCancelHeld = cancelPressed;
        return false;
      }

      // Track the aimed key every frame, not only on press: this is what draws
      // the highlight and the on-plane cursor that make the keyboard aimable.
      const rayPose = inputFrame.hands.right?.targetRayPose;
      const aimedKey = rayPose && VRSpike.keyboardHost.isVisible
        ? VRSpike.keyboardHost.keyAtRay(rayPose)
        : null;
      if (selectPressed && !VRSpike.keyboardSelectHeld && aimedKey) {
        if (aimedKey === VR_KEYBOARD_DONE_KEY) {
          VRSpike.keyboardDismissed = true;
          VRSpike.keyboardHost.clear();
        } else {
          VRSpike.keyboardInputController.press(aimedKey, sink);
        }
      }
      VRSpike.keyboardSelectHeld = selectPressed;
      if (cancelPressed && !VRSpike.keyboardCancelHeld) sink.cancel();
      VRSpike.keyboardCancelHeld = cancelPressed;
    } catch (error) {
      VRSpike.keyboardHost?.clear();
      VRSpike.keyboardSelectHeld = false;
      VRSpike.keyboardCancelHeld = false;
      VRSpike.keyboardGrabHeld = false;
      console.error('[VRSpike] virtual keyboard input rejected', error);
    }
    return true;
  }

  /** Comfort settings panel (ROADMAP 2.6), opened from the all-purpose action wheel. */
  private static processComfortSettingsInput(): boolean {
    const context = VRSpike.hooks?.getComfortSettingsPanelContext?.() ?? null;
    const inputFrame = VRSpike.latestInputFrame;
    const session = VRSpike.session;
    const scene = VRSpike.scene;
    if (!context || !inputFrame || !session || !scene) {
      VRSpike.comfortSettingsHost?.clear();
      VRSpike.comfortSettingsSelectHeld = false;
      VRSpike.comfortSettingsCancelHeld = false;
      return false;
    }
    try {
      if (!VRSpike.comfortSettingsHost) VRSpike.comfortSettingsHost = new VRComfortSettingsHost(scene);
      VRSpike.comfortSettingsHost.present(inputFrame.head, context.rows);

      const actions = VRSpike.inputRouter.route(
        XRGamepadReader.read(Array.from(session.inputSources ?? [])),
        new Set(['ui', 'interaction'])
      );
      const selectPressed = actions.some((action) =>
        (action.action === SemanticXRAction.Select || action.action === SemanticXRAction.Use) && action.pressed
      );
      const cancelPressed = actions.some((action) => action.action === SemanticXRAction.Cancel && action.pressed);

      if (selectPressed && !VRSpike.comfortSettingsSelectHeld) {
        const rayPose = inputFrame.hands.right?.targetRayPose;
        const row = rayPose ? VRSpike.comfortSettingsHost.rowAtRay(rayPose) : null;
        if (row !== null) context.activateRow(row);
      }
      VRSpike.comfortSettingsSelectHeld = selectPressed;

      if (cancelPressed && !VRSpike.comfortSettingsCancelHeld) context.close();
      VRSpike.comfortSettingsCancelHeld = cancelPressed;
    } catch (error) {
      VRSpike.comfortSettingsHost?.clear();
      VRSpike.comfortSettingsSelectHeld = false;
      VRSpike.comfortSettingsCancelHeld = false;
      console.error('[VRSpike] comfort settings panel input rejected', error);
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

  private static processInteractionInput(_timestamp: number): boolean {
    const inputFrame = VRSpike.latestInputFrame;
    const session = VRSpike.session;
    const interactionContext = VRSpike.hooks?.getInteractionContext?.();
    const promptContext = VRSpike.hooks?.getWorldActionPromptContext?.();
    if (!inputFrame || !session || !interactionContext?.actor || !promptContext?.actor ||
      interactionContext.actor !== promptContext.actor) {
      VRSpike.interactionAimedTargetId = null;
      VRSpike.clearWorldActionPrompt(false);
      return false;
    }

    try {
      if (VRSpike.observeWorldModuleTransition()) {
        VRSpike.suspendTransientGameplayInputForLifecycle();
        return false;
      }

      VRSpike.interactionTargetSet.synchronize(interactionContext.targets);
      const leftPreview = VRSpike.resolveRayPreview(inputFrame, 'left');
      const rightPreview = VRSpike.resolveRayPreview(inputFrame, 'right');
      VRSpike.interactionAimedTargetId = VRSpike.parseModuleObjectTargetId(rightPreview?.id ?? null);

      const selectedCandidate = selectVRWorldPromptCandidate(
        promptContext.candidates,
        inputFrame.head,
        VRSpike.worldPromptCandidateId,
        [leftPreview?.id, rightPreview?.id].filter((id): id is string => typeof id === 'string'),
        VRSpike.createPerEyeFrustumPredicate(),
      );
      if (!selectedCandidate) {
        VRSpike.reportWorldPromptStageOnce(
          `no-selection candidates=${promptContext.candidates.length}` +
          ` withActions=${promptContext.candidates.filter((c) => c.hasActions).length}` +
          ` inRange=${promptContext.candidates.filter((c) => c.inRange).length}`
        );
        VRSpike.clearWorldActionPrompt(false);
        return false;
      }

      const candidateStateKey = VRSpike.getWorldPromptCandidateStateKey(selectedCandidate);
      const resolution = VRSpike.worldPromptModelResolver.resolve(
        { candidateId: selectedCandidate.id, openingKey: candidateStateKey },
        () => promptContext.createPrompt(selectedCandidate),
      );
      VRSpike.worldPromptModel = resolution.status === 'success'
        ? resolution.model
        : null;
      VRSpike.worldPromptCandidateId = selectedCandidate.id;
      VRSpike.worldPromptCandidateStateKey = candidateStateKey;
      if (!VRSpike.worldPromptModel) {
        VRSpike.reportWorldPromptStageOnce(
          `model-null id=${selectedCandidate.id} name='${selectedCandidate.name}'` +
          ` resolution=${resolution.status}`
        );
        VRSpike.hideWorldActionPromptPresentation();
        return false;
      }
      VRSpike.reportWorldPromptStageOnce(
        `model-ok id=${selectedCandidate.id} name='${selectedCandidate.name}'` +
        ` pages=${VRSpike.worldPromptModel.pages.length}`
      );

      VRSpike.interactionPreviewIndicator = {
        id: selectedCandidate.id,
        name: selectedCandidate.name,
        position: selectedCandidate.position,
      };
      // Phase G1: mirror the resolved candidate into the engine's own cursor
      // selection so InGameOverlay can present its authored target UI. Runs
      // alongside the bespoke prompt for now; the prompt is removed in G4 once
      // the overlay is confirmed in the headset.
      VRSpike.hooks?.setVRSelectedObject?.(
        VRSpike.parseModuleObjectTargetId(selectedCandidate.id)
      );
      const host = VRSpike.getOrCreateWorldActionPromptHost();
      if (!host) {
        VRSpike.hideWorldActionPromptPresentation();
        return false;
      }

      VRSpike.worldActionPromptController.process(VRSpike.worldPromptModel, {}, []);
      const initialPresentation = VRSpike.worldActionPromptController.presentation;
      if (!initialPresentation) {
        VRSpike.hideWorldActionPromptPresentation();
        return false;
      }
      host.present(initialPresentation, inputFrame.head, null);
      const hoveredByHand = {
        left: VRSpike.resolveWorldPromptRay(host, inputFrame, 'left'),
        right: VRSpike.resolveWorldPromptRay(host, inputFrame, 'right'),
      };
      const controllers = XRGamepadReader.read(Array.from(session.inputSources ?? []));
      const routedActions = VRSpike.inputRouter.route(controllers, new Set(['world-prompt']));
      const edgeActions = VRSpike.filterWorldPromptSelectEdges(routedActions);
      const promptSelectConsumed = edgeActions.some((action) =>
        action.action === SemanticXRAction.Select && action.pressed && hoveredByHand[action.hand] !== null
      );
      const effects = VRSpike.worldActionPromptController.process(
        VRSpike.worldPromptModel,
        hoveredByHand,
        edgeActions,
      );
      VRSpike.applyWorldPromptEffects(effects, session);
      const presentation = VRSpike.worldActionPromptController.presentation;
      if (presentation && VRSpike.worldPromptModel) {
        host.present(presentation, inputFrame.head, presentation.hoveredId);
      }
      return promptSelectConsumed;
    } catch (error) {
      VRSpike.interactionAimedTargetId = null;
      VRSpike.clearWorldActionPrompt(false);
      if (!VRSpike.worldInteractionInputErrorReported) {
        VRSpike.worldInteractionInputErrorReported = true;
        console.error('[VRSpike] world action prompt input rejected', error);
      }
      return false;
    }
  }

  private static resolveRayPreview(inputFrame: XRInputFrame, hand: XRHandRole) {
    const handFrame = inputFrame.hands[hand];
    if (!handFrame || handFrame.targetRayPose.trackingState !== 'tracked') return null;
    const preview = VRSpike.interactionSystem.preview(inputFrame, hand);
    return preview?.interactionMode === 'ray' ? preview : null;
  }

  private static createPerEyeFrustumPredicate(): (position: THREE.Vector3) => boolean {
    const renderer = VRSpike.renderer;
    const camera = VRSpike.camera;
    if (!renderer || !camera || typeof renderer.xr.getCamera !== 'function') return () => false;
    const xrCamera = (renderer.xr.getCamera as unknown as (
      sourceCamera: THREE.Camera,
    ) => THREE.ArrayCamera)(camera);
    const cameras: readonly THREE.Camera[] = Array.isArray(xrCamera.cameras) && xrCamera.cameras.length > 0
      ? xrCamera.cameras
      : [xrCamera];
    const frustums = cameras.map((eyeCamera) => {
      const projectionView = new THREE.Matrix4().multiplyMatrices(
        eyeCamera.projectionMatrix,
        eyeCamera.matrixWorldInverse,
      );
      return new THREE.Frustum().setFromProjectionMatrix(projectionView);
    });
    return (position: THREE.Vector3): boolean => frustums.some((frustum) => frustum.containsPoint(position));
  }

  private static getOrCreateWorldActionPromptHost(): VRWorldActionPromptHost | null {
    if (!VRSpike.worldActionPromptHost && VRSpike.scene) {
      VRSpike.worldActionPromptHost = new VRWorldActionPromptHost(VRSpike.scene);
    }
    return VRSpike.worldActionPromptHost;
  }

  private static resolveWorldPromptRay(
    host: VRWorldActionPromptHost,
    inputFrame: XRInputFrame,
    hand: XRHandRole,
  ): string | null {
    const pose = inputFrame.hands[hand]?.targetRayPose;
    return pose?.trackingState === 'tracked' ? host.resolveRay(hand, pose) : null;
  }

  private static filterWorldPromptSelectEdges(actions: readonly RoutedXRAction[]): readonly RoutedXRAction[] {
    const filtered: RoutedXRAction[] = [];
    for (const hand of ['left', 'right'] as const) {
      const action = actions.find((candidate) =>
        candidate.action === SemanticXRAction.Select && candidate.hand === hand
      );
      if (!action) continue;
      const pressed = action.pressed && !VRSpike.worldPromptSelectHeld[hand];
      VRSpike.worldPromptSelectHeld[hand] = action.pressed;
      filtered.push({ ...action, pressed });
    }
    return filtered;
  }

  private static captureWorldPromptSelectLatch(): void {
    const session = VRSpike.session;
    if (!session) return;
    try {
      const controllers = XRGamepadReader.read(Array.from(session.inputSources ?? []));
      const actions = VRSpike.inputRouter.route(controllers, new Set(['world-prompt']));
      for (const hand of ['left', 'right'] as const) {
        const action = actions.find((candidate) =>
          candidate.action === SemanticXRAction.Select && candidate.hand === hand
        );
        if (action) VRSpike.worldPromptSelectHeld[hand] = action.pressed;
      }
    } catch {
      // Preserve the prior latch when optional controller state is unreadable.
    }
  }

  private static applyWorldPromptEffects(
    effects: readonly VRWorldPromptEffect[],
    session: XRSession,
  ): void {
    for (const effect of effects) {
      if (effect.type === 'closed') {
        VRSpike.clearWorldActionPrompt(false);
      } else if (effect.type === 'hover-haptic') {
        void VRSpike.haptics.pulse(session, effect.hand, { durationMs: 20, amplitude: 0.15 });
      } else if (effect.type === 'negative-haptic') {
        VRSpike.clearWorldActionPrompt(false);
        void VRSpike.haptics.pulse(session, effect.hand, { durationMs: 60, amplitude: 0.45 });
      } else if (effect.type === 'activate') {
        const action = effect.action;
        const hand = effect.hand;
        VRSpike.clearWorldActionPrompt(false);
        void VRSpike.haptics.pulse(session, hand, { durationMs: 35, amplitude: 0.35 });
        try {
          action.activate();
        } catch (error) {
          console.error(`[VRSpike] world prompt action '${action.id}' failed`, error);
        }
      }
    }
  }

  private static getWorldPromptCandidateStateKey(candidate: VRWorldPromptCandidate): string {
    return candidate.stateKey ?? JSON.stringify([
      candidate.id,
      candidate.name,
      candidate.position.x,
      candidate.position.y,
      candidate.position.z,
      candidate.actorDistanceMetres,
      candidate.hasActions,
      candidate.inRange,
    ]);
  }

  /** Clears rendering/input ownership while retaining a resolved null model. */
  private static hideWorldActionPromptPresentation(): void {
    VRSpike.worldActionPromptController.process(null, {}, []);
    VRSpike.interactionPreviewIndicator = null;
    VRSpike.worldTargetLabelHost?.clear();
    VRSpike.worldActionPromptHost?.clear();
  }

  private static clearWorldActionPrompt(disposeHost: boolean): void {
    VRSpike.worldActionPromptController.process(null, {}, []);
    VRSpike.worldPromptCandidateId = null;
    VRSpike.worldPromptCandidateStateKey = null;
    VRSpike.worldPromptModelResolver.reset();
    VRSpike.worldPromptModel = null;
    VRSpike.interactionPreviewIndicator = null;
    VRSpike.worldTargetLabelHost?.clear();
    // Phase G1: release the engine cursor selection on the same boundary that
    // drops the prompt, so a module transition, foreground menu, or aim drift
    // cannot strand InGameOverlay showing a target the player is no longer at.
    VRSpike.hooks?.setVRSelectedObject?.(null);
    if (disposeHost) {
      VRSpike.worldActionPromptHost?.dispose();
      VRSpike.worldActionPromptHost = null;
    } else {
      VRSpike.worldActionPromptHost?.clear();
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
    return VRSpike.interactionAimedTargetId;
  }

  private static parseModuleObjectTargetId(id: string | null): number | null {
    if (!id) return null;
    const match = /^module-object:(\d+)$/.exec(id);
    return match ? Number(match[1]) : null;
  }

  /**
   * Combat cancel is an escape hatch and must never be gated behind who owned
   * input this frame. It used to live inside `processCombatInput`, which the
   * frame loop skips whenever a world prompt consumed the trigger — so once
   * prompts began appearing on every nearby object, the only way out of combat
   * became unreachable exactly where the player needed it: standing next to the
   * door they just started bashing. Bashing a door also starts rounds that
   * never resolve on their own, since a door is not a creature that can die.
   *
   * Runs on every gameplay frame, before any owner claims input.
   */
  private static processCombatCancel(): void {
    const session = VRSpike.session;
    if (!session) {
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
      if (cancelPressed && !VRSpike.combatCancelHeld) {
        // Resolve the context without a nominated target: a cancel must still
        // work when the thing that started the round no longer qualifies.
        const context = VRSpike.hooks?.getCombatContext?.(null) ?? null;
        // TEMPORARY (VR-PLAYTEST-FIX-PLAN.md issue 8): B reportedly does not
        // end combat. This distinguishes "the press never arrived", "there was
        // no context", "cancel was missing", and "cancel ran but the engine
        // re-queued the round anyway" — which need different fixes.
        const before = VRSpike.hooks?.describeCombatQueue?.() ?? 'n/a';
        context?.cancel?.();
        const after = VRSpike.hooks?.describeCombatQueue?.() ?? 'n/a';
        // cancel() demonstrably runs, yet rounds keep starting — so something
        // re-queues the attack. Compare the queue immediately either side of
        // the call, then again next frame, to see whether it is cleared and
        // repopulated or never cleared at all.
        console.info(
          `[VR combat cancel] edge=true context=${!!context}` +
          ` hasCancel=${typeof context?.cancel === 'function'}` +
          ` inCombat=${JSON.stringify(context?.inCombat)}` +
          ` nominatedTargetId=${JSON.stringify(context?.nominatedTargetId)}` +
          ` || before=${before} || after=${after}`
        );
        VRSpike.pendingCancelTraceFrames = 3;
      }
      VRSpike.combatCancelHeld = cancelPressed;

      // Follow the queue for a few frames after a cancel: if it is empty here
      // but populated again on the next frame, the re-queue source is what
      // needs fixing, not the cancel itself.
      if (VRSpike.pendingCancelTraceFrames > 0 && !cancelPressed) {
        VRSpike.pendingCancelTraceFrames -= 1;
        console.info(
          `[VR combat cancel] +frame queue=${VRSpike.hooks?.describeCombatQueue?.() ?? 'n/a'}`
        );
      }
    } catch (error) {
      // Deliberately NOT sharing combatInputErrorReported with
      // processCombatInput: a flag already tripped there would have swallowed
      // a cancel exception entirely, which is precisely the failure this
      // method was added to diagnose.
      if (!VRSpike.combatCancelErrorReported) {
        VRSpike.combatCancelErrorReported = true;
        console.error('[VRSpike] combat cancel rejected', error);
      }
    }
  }

  private static pendingCancelTraceFrames = 0;
  private static combatCancelErrorReported = false;

  private static processCombatInput(timestamp: number): void {
    const inputFrame = VRSpike.latestInputFrame;
    const session = VRSpike.session;
    if (!inputFrame || !session) {
      VRSpike.combatCancelHeld = false;
      VRSpike.hiltTimerHost?.clear();
      return;
    }
    const context = VRSpike.hooks?.getCombatContext?.(VRSpike.resolveAimedTargetId()) ?? null;
    if (!context) {
      VRSpike.combatCancelHeld = false;
      VRSpike.hiltTimerHost?.clear();
      return;
    }

    VRSpike.updateHiltTimer(context.weaponMode, timestamp, context.inCombat);

    try {
      const actions = VRSpike.inputRouter.route(
        XRGamepadReader.read(Array.from(session.inputSources ?? [])),
        new Set(['combat', 'interaction', 'ui'])
      );
      // Cancel is handled by processCombatCancel, which runs every gameplay
      // frame regardless of whether a world prompt consumed input first.
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

  private static updateHiltTimer(
    weaponMode: CombatWeaponMode,
    timestamp: number,
    inCombat: boolean
  ): void {
    // The hilt timer is a diegetic ring on the weapon itself, so it belongs on
    // the grip anchor. The blaster laser is an *aiming* line and must use the
    // target-ray anchor instead — grip and target-ray orientations differ
    // substantially (grip follows the handle, target ray follows where the
    // controller points), and putting the laser on the grip is what made it
    // visibly diverge from the correctly-aimed menu pointer.
    const gripAnchor = VRSpike.controllerAnchorHost?.getAnchor('right') ?? null;
    const rayAnchor = VRSpike.controllerAnchorHost?.getRayAnchor('right') ?? null;
    if (!gripAnchor || weaponMode === 'unarmed') {
      VRSpike.hiltTimerHost?.clear();
      VRSpike.blasterLaserHost?.clear();
      return;
    }
    if (!VRSpike.hiltTimerHost) {
      VRSpike.hiltTimerHost = new VRHiltTimerHost(gripAnchor);
    }
    VRSpike.hiltTimerHost.present(VRSpike.combatInputController.getRollReadiness(timestamp));

    // Only show the laser sight during an actual engagement — a permanent red
    // line across the view while exploring is both noisy and misreads as the
    // world-interaction pointer.
    if (weaponMode === 'blaster' && inCombat && rayAnchor) {
      if (!VRSpike.blasterLaserHost) {
        VRSpike.blasterLaserHost = new VRBlasterLaserHost(rayAnchor);
      }
      VRSpike.blasterLaserHost.present();
    } else {
      VRSpike.blasterLaserHost?.clear();
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
    const session = VRSpike.session;
    const inputFrame = VRSpike.latestInputFrame;
    if (!session || !inputFrame) {
      VRSpike.closeRadialMenuForLifecycle(true);
      return false;
    }

    try {
      const wasOpen = VRSpike.radialMenuController.isOpen;
      const actions = VRSpike.inputRouter.route(
        XRGamepadReader.read(Array.from(session.inputSources ?? [])),
        new Set(['global', 'radial-wheel'])
      );
      const menuPressed = actions.some((action) =>
        action.action === SemanticXRAction.Menu && action.hand === 'left' && action.pressed
      );
      const selectPressed = actions.some((action) =>
        action.action === SemanticXRAction.Select && action.hand === 'left' && action.pressed
      );
      let openingMenu: VRRadialMenuDefinition | null = null;
      if (menuPressed && !VRSpike.radialMenuPressedLastFrame && !wasOpen) {
        openingMenu = VRSpike.hooks?.createActionWheel?.(VRSpike.resolveAimedTargetId()) ?? null;
      }
      VRSpike.radialMenuPressedLastFrame = menuPressed;

      const host = VRSpike.radialMenuHost;
      const leftRayPose = inputFrame.hands.left?.targetRayPose;
      const rayHit = wasOpen && host && leftRayPose?.trackingState === 'tracked'
        ? host.resolveRay(leftRayPose)
        : null;
      const touchHits = wasOpen && host
        ? {
          left: VRSpike.resolveRadialTouch(host, inputFrame.hands.left?.targetRayPose),
          right: VRSpike.resolveRadialTouch(host, inputFrame.hands.right?.targetRayPose),
        }
        : {};

      const effects = VRSpike.radialMenuController.process({
        menuPressed,
        selectPressed,
        openingMenu,
        rayHit,
        touchHits,
      });
      VRSpike.applyRadialMenuEffects(effects, session, inputFrame.head);

      const presentation = VRSpike.radialMenuController.presentation;
      if (presentation) {
        const presentationHost = VRSpike.getOrCreateRadialMenuHost();
        const openingHeadPose = VRSpike.radialOpeningHeadPose;
        if (presentationHost && openingHeadPose) presentationHost.present(presentation, openingHeadPose);
      } else {
        VRSpike.radialMenuHost?.clear();
      }
      return wasOpen || VRSpike.radialMenuController.isOpen || menuPressed || effects.length > 0;
    } catch (error) {
      VRSpike.closeRadialMenuForLifecycle(false);
      console.error('[VRSpike] radial menu input rejected', error);
      return true;
    }
  }

  private static resolveRadialTouch(
    host: VRRadialMenuHost,
    targetRayPose: XRWorldPose | undefined,
  ) {
    return targetRayPose?.trackingState === 'tracked'
      ? host.resolveTouch(targetRayPose.position)
      : null;
  }

  private static getOrCreateRadialMenuHost(): VRRadialMenuHost | null {
    if (!VRSpike.radialMenuHost && VRSpike.scene) {
      VRSpike.radialMenuHost = new VRRadialMenuHost(VRSpike.scene);
    }
    return VRSpike.radialMenuHost;
  }

  private static applyRadialMenuEffects(
    effects: readonly VRRadialControllerEffect[],
    session: XRSession,
    currentHeadPose: XRWorldPose,
  ): void {
    for (const effect of effects) {
      if (effect.type === 'opened') {
        VRSpike.radialOpeningHeadPose = cloneXRWorldPose(currentHeadPose);
      } else if (effect.type === 'closed') {
        VRSpike.radialMenuHost?.clear();
        VRSpike.radialOpeningHeadPose = null;
      } else if (effect.type === 'activate') {
        VRSpike.radialMenuHost?.clear();
        try {
          effect.item.activate();
        } catch (error) {
          console.error(`[VRSpike] radial action '${effect.item.id}' failed`, error);
        }
      } else if (effect.type === 'hover-haptic') {
        void VRSpike.haptics.pulse(session, effect.hand, { durationMs: 20, amplitude: 0.15 });
      } else if (effect.type === 'confirm-haptic') {
        void VRSpike.haptics.pulse(session, effect.hand, { durationMs: 35, amplitude: 0.35 });
      } else if (effect.type === 'negative-haptic') {
        void VRSpike.haptics.pulse(session, effect.hand, { durationMs: 60, amplitude: 0.45 });
      }
    }
  }

  private static closeRadialMenuForLifecycle(disposeHost: boolean): void {
    VRSpike.radialMenuController.close('lifecycle');
    VRSpike.radialOpeningHeadPose = null;
    if (disposeHost) {
      VRSpike.radialMenuHost?.dispose();
      VRSpike.radialMenuHost = null;
    } else {
      VRSpike.radialMenuHost?.clear();
    }
  }

  /**
   * Records the current engine module and reports exactly the frame where its
   * stable identity changes. This runs before any gameplay input owner so an
   * open wheel cannot retain a ray/touch selection into the incoming module.
   */
  private static observeWorldModuleTransition(): boolean {
    const module = VRSpike.hooks?.getWorldContext().module ?? null;
    if (!VRSpike.worldPromptModuleInitialized) {
      VRSpike.worldPromptModule = module;
      VRSpike.worldPromptModuleInitialized = true;
      return false;
    }
    if (module === VRSpike.worldPromptModule) return false;
    VRSpike.worldPromptModule = module;
    return true;
  }

  /**
   * Releases transient wheel, prompt, ray, and target ownership without
   * activating engine callbacks. Physical button state is sampled first so a
   * held X/Select cannot become a fresh press after the lifecycle boundary.
   * Already-issued optional haptic pulses are intentionally not cancellable.
   */
  private static suspendTransientGameplayInputForLifecycle(): void {
    VRSpike.captureRadialMenuButtonLatch();
    VRSpike.captureWeaponActionLatch();
    VRSpike.closeRadialMenuForLifecycle(false);
    VRSpike.captureWorldPromptSelectLatch();
    VRSpike.interactionAimedTargetId = null;
    VRSpike.clearWorldActionPrompt(false);
    VRSpike.interactionTargetSet.clear();
    VRSpike.interactionSystem.cancelTransientState();
  }

  /**
   * Keeps combat's weapon-action held state continuous across frames that some
   * other surface owned the trigger. Without it, releasing that ownership while
   * the trigger is still down reads as a fresh press and fires a shot — which
   * is what made selecting a world prompt also attack the object behind it.
   */
  /**
   * One-shot-per-message diagnostic for the world-prompt pipeline. Every failure
   * path in `processInteractionInput` returns quietly, so a door or container
   * that works flatscreen simply produces nothing in VR with no console trace.
   *
   * TEMPORARY: remove once VR-PLAYTEST-FIX-PLAN.md H1 is closed.
   */
  private static readonly reportedWorldPromptStages = new Set<string>();

  private static reportWorldPromptStageOnce(message: string): void {
    if (VRSpike.reportedWorldPromptStages.has(message)) return;
    VRSpike.reportedWorldPromptStages.add(message);
    console.info(`[VR prompt stage] ${message}`);
  }

  private static captureWeaponActionLatch(): void {
    const session = VRSpike.session;
    if (!session) return;
    try {
      const actions = VRSpike.inputRouter.route(
        XRGamepadReader.read(Array.from(session.inputSources ?? [])),
        new Set(['combat']),
      );
      const pressed = actions.some((action) =>
        action.action === SemanticXRAction.WeaponAction && action.hand === 'right' && action.pressed
      );
      VRSpike.combatInputController.synchronizeWeaponActionHeld(pressed);
    } catch {
      // Keep the prior latch on malformed optional input rather than treating
      // an unreadable controller as a release that can fire on the next frame.
    }
  }

  private static captureRadialMenuButtonLatch(): void {
    const session = VRSpike.session;
    if (!session) return;
    try {
      const actions = VRSpike.inputRouter.route(
        XRGamepadReader.read(Array.from(session.inputSources ?? [])),
        new Set(['global']),
      );
      const menuPressed = actions.some((action) =>
        action.action === SemanticXRAction.Menu && action.hand === 'left' && action.pressed
      );
      VRSpike.radialMenuPressedLastFrame = menuPressed;
      VRSpike.radialMenuController.synchronizeMenuPressed(menuPressed);
    } catch {
      // Keep the prior latch on malformed optional input rather than treating
      // an unreadable controller as a release that can reopen the wheel.
    }
  }

  private static processLocomotionInput(
    timestamp: number,
    frame: XRFrame,
    allowGameplayActions = true,
  ): void {
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
        allowGameplayActions
          ? new Set(['locomotion', 'gameplay'])
          : new Set(['locomotion'])
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
      VRSpike.clearWorldActionPrompt(false);
      VRSpike.renderCutscene(worldCamera, frameTimestamp);
      return;
    }
    // Not (or no longer) in a cutscene: the next one's first shot must not
    // fade in against a stale camera reference from a previous, unrelated
    // cutscene.
    VRSpike.lastCutsceneCamera = null;
    VRSpike.cutsceneFadeHost?.setOpacity(0);

    VRSpike.renderKeyboard();
    VRSpike.renderPanel();
    VRSpike.renderInGameOverlay();
    VRSpike.renderWorldActionPrompt();
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
    VRSpike.clearWorldActionPrompt(false);
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

    // Fade-to-black between authored camera cuts (ROADMAP 5.2): the theater
    // reprojection swaps `worldCamera` instantly between shots, which reads
    // as a jarring snap in a headset. `lastCutsceneCamera` starting null
    // means the very first frame of a cutscene never fades — only an
    // actual cut between two already-shown shots does.
    if (VRSpike.lastCutsceneCamera !== null && VRSpike.lastCutsceneCamera !== worldCamera) {
      VRSpike.cutsceneFadeEnvelope.trigger(frameTimestamp);
    }
    VRSpike.lastCutsceneCamera = worldCamera;
    if (!VRSpike.cutsceneFadeHost) {
      VRSpike.cutsceneFadeHost = new VRCutsceneFadeHost(VRSpike.camera);
    }
    VRSpike.cutsceneFadeHost.setOpacity(VRSpike.cutsceneFadeEnvelope.sample(frameTimestamp));

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

  /**
   * Phase G2 — present the engine's own in-game overlay in VR.
   *
   * Presentation only for now: no ray, no click routing. The bespoke world
   * prompt is still live and owns the trigger, so wiring overlay input here
   * too would double-activate. Input moves across in G4 when the bespoke
   * system is removed. The point of this step is to see how the authored
   * target menu, name plate and Cancel Combat button actually read in the
   * headset before committing to the rest.
   */
  private static renderInGameOverlay(): void {
    const renderer = VRSpike.renderer;
    const worldScene = VRSpike.scene;
    const inputFrame = VRSpike.latestInputFrame;
    const context = VRSpike.hooks?.getInGameOverlayContext?.() ?? null;
    if (!renderer || !worldScene || !inputFrame || !context) {
      VRSpike.inGameOverlayHost?.clear();
      return;
    }
    try {
      if (!VRSpike.inGameOverlayHost) {
        VRSpike.inGameOverlayHost = new VRPanelHost(worldScene, {
          distanceMetres: 1.6,
          widthMetres: 1.5,
        });
      }
      VRSpike.inGameOverlayHost.present(
        context.overlay,
        inputFrame.head,
        context.viewportWidth,
        context.viewportHeight
      );
      VRSpike.inGameOverlayHost.renderGui(renderer, context.guiScene, context.guiCamera);
    } catch (error) {
      VRSpike.inGameOverlayHost?.clear();
      if (!VRSpike.inGameOverlayErrorReported) {
        VRSpike.inGameOverlayErrorReported = true;
        console.error('[VRSpike] in-game overlay presentation rejected', error);
      }
    }
  }

  private static inGameOverlayHost: VRPanelHost | null = null;
  private static inGameOverlayErrorReported = false;

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

  private static renderWorldActionPrompt(): void {
    const inputFrame = VRSpike.latestInputFrame;
    const presentation = VRSpike.worldActionPromptController.presentation;
    const host = VRSpike.worldActionPromptHost;
    if (!inputFrame || !presentation || !host) {
      host?.clear();
      return;
    }
    try {
      host.present(presentation, inputFrame.head, presentation.hoveredId);
    } catch (error) {
      VRSpike.clearWorldActionPrompt(false);
      if (!VRSpike.worldInteractionInputErrorReported) {
        VRSpike.worldInteractionInputErrorReported = true;
        console.error('[VRSpike] world action prompt presentation rejected', error);
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
      // Keep the camera's horizontal placement so the world view is roughly
      // where the engine is looking, but put the rig's *floor* on the world
      // floor rather than deriving it from the camera's height. There is no
      // player to stand on and no guarantee `worldCamera` is the elevated
      // follower camera — at the main menu it can be any authored camera —
      // so subtracting eyeHeight from it produced an arbitrary rig height.
      // Panels are placed relative to the head pose, so that arbitrary height
      // is what made a menu already open at VR-entry hang above eye level and
      // then stay there (panels world-lock to their first placement by
      // design). Anchoring to the floor lets the headset's own local-floor
      // tracking put the head at the player's real standing height.
      worldCamera.getWorldPosition(rig.position);
      rig.position.z = 0;
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

function cloneXRWorldPose(pose: XRWorldPose): XRWorldPose {
  return {
    position: pose.position.clone(),
    orientation: pose.orientation.clone(),
    linearVelocity: pose.linearVelocity?.clone() ?? null,
    angularVelocity: pose.angularVelocity?.clone() ?? null,
    trackingState: pose.trackingState,
  };
}
