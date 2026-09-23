import * as THREE from "three";
import { XRCoordinateConverter } from "./runtime/XRCoordinateConverter";
import { XRControllerAnchorHost } from "./runtime/XRControllerAnchorHost";
import type { HeldItemVisualDescriptor } from "./runtime/XRControllerAnchorHost";
import type { VRHandModelLoader } from "./runtime/hands/VRHandModel";
import { XRGamepadReader } from "./runtime/XRGamepadReader";
import { XRInputFrameBuilder } from "./runtime/XRInputFrameBuilder";
import { VRInputRecorder } from "./runtime/recording/VRInputRecorder";
import { VRTracePlayer } from "./runtime/recording/VRTracePlayer";
import type { VRPlayerOptions } from "./runtime/recording/VRTracePlayer";
import type { VRTraceMetadata, VRTraceRecording } from "./runtime/recording/VRTraceTypes";
import { RoutedXRAction, XRActionContext, XRInputRouter } from "./runtime/XRInputRouter";
import { InteractionSystem } from "./runtime/InteractionSystem";
import { InteractionTargetRegistry } from "./runtime/InteractionTargetRegistry";
import { VRInteractionGizmoHost } from "./runtime/debug/VRInteractionGizmoHost";
import { LocomotionController, ResolvedLocomotion } from "./runtime/LocomotionController";
import { VRPanelHost } from "./runtime/VRPanelHost";
import type { LegacyPanelRenderLayer, VRPanelPresentOptions } from "./runtime/VRPanelHost";
import { DEFAULT_XR_FRAMEBUFFER_SCALE, parseXRFramebufferScale } from "@/utility/RendererOptions";
import { VRPanelPointerHost } from "./runtime/VRPanelPointerHost";
import { VRPointerHandResolver } from "./runtime/VRPointerHandResolver";
import { VRKeyboardHost } from "./runtime/VRKeyboardHost";
import { VRKeyboardInputController } from "./runtime/VRKeyboardInputController";
import { VR_KEYBOARD_DONE_KEY } from "./runtime/VRKeyboardLayout";
import { VRCombatInputController, VRCombatSwingEvent } from "./runtime/VRCombatInputController";
import { VRCombatTargetLock } from "./runtime/VRCombatTargetLock";
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
import { VRTeleportMarkerHost } from "./runtime/VRTeleportMarkerHost";
import { resolveVRTeleportAim } from "./runtime/VRTeleportAimResolver";
import { VRComfortVignetteHost } from "./runtime/VRComfortVignetteHost";
import { VRCutsceneFadeHost, VRCutsceneFadeEnvelope } from "./runtime/VRCutsceneFadeHost";
import { hideWorldForTheater } from "./runtime/VRTheaterWorldVisibility";
import { hidePlayerBodyForFirstPerson } from "./runtime/VRFirstPersonBody";
import { hideGuiRootsForPanel } from "./runtime/VRPanelSceneVisibility";
import { VRComfortSettingsHost, VRComfortSettingsRow } from "./runtime/VRComfortSettingsHost";
import { VRRecenterHoldGate } from "./runtime/VRRecenterHoldGate";
import { ActionApproachPolicy } from "@/engine/interaction/ActionApproachPolicy";
import { VRHiltTimerHost } from "./runtime/VRHiltTimerHost";
import { VRWeaponStanceHost } from "./runtime/VRWeaponStanceHost";
import { VRCombatTargetHighlightHost, type VRCombatTargetHighlight } from "./runtime/VRCombatTargetHighlightHost";
import { VRBlasterLaserHost } from "./runtime/VRBlasterLaserHost";
import {
  resolveVRCombatAimedTargetId,
  type VRCombatAimCandidate,
} from "./runtime/VRCombatAimResolver";
import {
  VRCombatVisualEventObserver,
  type VRCombatActorSnapshot,
} from "./runtime/VRCombatVisualEvents";
import { VRBlasterBoltHost } from "./runtime/VRBlasterBoltHost";
import { VRDroidExplosionHost } from "./runtime/VRDroidExplosionHost";
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
import { CombatWeaponMode, SemanticXRAction, VRComfortSettings, XRHandInputFrame, XRHandRole, XRInputFrame, XRWorldPose } from "./runtime/XRTypes";
import { PerfSampler, PerfWorldSnapshot } from "./PerfSampler";
import type { EngineFrameSource } from "./XRFrameCadence";
import { XRSessionController } from './runtime/XRSessionController';
import { XRInputCapabilityValidator } from './input/XRInputCapabilityValidator';

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
/**
 * Minimum horizontal length of the head's forward vector for a recenter to
 * be trusted. 0.26 is roughly 75 degrees of pitch: beyond that the yaw a
 * forward vector reports is mostly tracking noise.
 */
const RECENTER_MIN_HORIZONTAL_FORWARD = 0.26;
/** Steady head frames (~half a second) whose median is the player's standing head height. */
const HEAD_HEIGHT_CALIBRATION_FRAMES = 36;
/** How far an untargeted presentation shot travels. */
const PRESENTATION_SHOT_RANGE_METRES = 20;

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
  /**
   * 'theater' for a scripted cutscene with an authored animated camera;
   * 'world' for a character conversation, shown in the scene with the
   * dialogue as a floating panel. Absent is treated as 'theater'.
   */
  readonly presentation?: 'theater' | 'world';
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
  /**
   * The floor the avatar stands on at `floorZ`, across its room and the rooms
   * that room links to — what the wall soft-block tests the head against.
   * Falls back to `getCurrentRoomWalkmesh` when absent.
   */
  getSoftBlockFloor?: (floorZ: number) => VRWalkmeshQuery | null;
  /** Comfort settings (ROADMAP 2.5/2.6): locomotion/turn mode and vignette. */
  getComfortSettings?: () => VRComfortSettings;
  setComfortSettings?: (patch: Partial<VRComfortSettings>) => void;
  /**
   * Flips the player between the engine's walk and run rates. The rates and the
   * `walk` flag already exist on the creature and already feed
   * `getMovementSpeed()`; only VR had no way to reach them.
   */
  toggleWalkRun?: () => void;
  /** Toggles the engine's own pause, as the flatscreen pause control does. */
  togglePause?: () => void;
  /**
   * Cycles the party leader to the next member. The action wheel's Party
   * submenu remains the way to pick a specific one.
   */
  cyclePartyLeader?: () => boolean;
  /**
   * The creature the player is currently driving. Used to scope approach
   * suppression, so only the player stops walking to targets.
   */
  getControlledActor?: () => unknown;
  /**
   * Eye height, in metres above the feet, of the character being driven — or
   * null when it cannot be read. See `VRSpike.resolveEyeHeightOffset`.
   */
  getEyeHeight?: () => number | null;
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
    /**
     * The overlay menu itself: identity for VRPanelHost owner tracking, and
     * the controller-button sink for VRPanelInputController.
     */
    readonly overlay: VRPanelMenuController;
    readonly guiScene: THREE.Scene;
    readonly guiCamera: THREE.Camera;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    readonly pointerSink: VRPanelPointerSink;
  } | null;
  /**
   * TEMPORARY (VR-PLAYTEST-FIX-PLAN.md issue 8): one-line snapshot of the
   * engine's combat/action queues, used to find what re-queues an attack after
   * a cancel demonstrably runs. Remove with the rest of the issue-8 tracing.
   */
  describeCombatQueue?: () => string;
  /**
   * Hostiles the weapon hand may aim at, and the reach combat actually allows.
   *
   * Deliberately not `getInteractionContext`: that set is capped at each
   * object's use distance — 3 m for a creature — so that selecting something
   * distant can never queue the engine's walk-to-target. Shooting is allowed
   * out to `resolveVRCombatRange` (15 m ranged), so every hostile between the
   * two ranges was targetable by the rules of combat and invisible to aim
   * resolution. Returns null when there is no actor to aim from.
   */
  getCombatAimCandidates?: () => {
    readonly actorPosition: THREE.Vector3;
    readonly maxRangeMetres: number;
    readonly candidates: readonly VRCombatAimCandidate[];
  } | null;
  /**
   * Per-frame combat state for the VR-authored visuals the engine never had:
   * blaster bolts and droid destruction bursts.
   *
   * Snapshots rather than callbacks, so VRSpike derives the one-shot events by
   * observing transitions and the engine stays untouched — the same reasoning
   * behind `vrAttackStance.observeRound`. `localActorId` marks the player, whose
   * bolt must start at the weapon in their hand rather than at their avatar,
   * because first person hides that avatar.
   */
  getCombatVisualSnapshots?: () => {
    readonly localActorId: number | null;
    readonly snapshots: readonly VRCombatActorSnapshot[];
    /** The player's weapon report, for the bolts VR draws on their behalf. */
    playLocalShotSound?(): void;
  } | null;
  getCombatContext?: (aimedTargetId: number | null) => {
    readonly actorId: string;
    readonly nominatedTargetId: string | null;
    readonly weaponMode: import('./runtime/XRTypes').CombatWeaponMode;
    /** True while the actor is in an actual engagement (drives the laser sight). */
    readonly inCombat: boolean;
    /**
     * ROADMAP 4.8 — the armed attack stance, for the diegetic readout beside
     * the round timer on the weapon. Empty string when there is nothing worth
     * showing. Names both sides while a change is queued, because until the
     * round turns over the swing still rolls as the *active* stance.
     */
    readonly stanceReadout: string;
    /** 0 while the engine owns the round, 1 for its next legal input window. */
    readonly tempoReadiness?: number;
    /** True only while the queue head needs an aimed dominant-hand trigger. */
    readonly allowDominantTrigger?: boolean;
    onCombatSwing(event: VRCombatSwingEvent): void;
    /** Returns true only when the gesture was spent on a queued Push/Pull. */
    onDirectionalForceGesture?(gesture: VRForceGesture): boolean;
    onGrenadeTrigger?(): void;
    /**
     * True when the off hand holds a ranged weapon and no grenade is armed, so
     * the off-hand trigger shoots instead of throwing.
     */
    readonly offhandShotAvailable?: boolean;
    /** Where a shot at the locked target should land, in world space; null without one. */
    readonly nominatedTargetAimPoint?: THREE.Vector3 | null;
    /** Plays the equipped blaster's own shot sound. Presentation only. */
    playShotSound?(): void;
    /** Plays the off-hand blaster's shot sound. Presentation only. */
    playOffhandShotSound?(): void;
    /** Cancels transient target-dependent VR state after engine invalidation. */
    onCombatTargetInvalidated?(): void;
    cancel?(): void;
  } | null;
  /** Engine-owned held-item descriptors; the anchor host creates presentation-only clones. */
  getHeldVisuals?: () => Readonly<{
    readonly left: HeldItemVisualDescriptor | null;
    readonly right: HeldItemVisualDescriptor | null;
  }>;
  /**
   * Humanoids receive first-person sleeve/hand presentation around their
   * controller-anchored equipment. Droids deliberately retain only the
   * stabilized floating equipment presentation.
   */
  getAvatarPresentation?: () => Readonly<{ humanoidHands: boolean }> | null;
  /**
   * Loads the skinned first-person hand. Supplied by the engine side because
   * the production loader depends on three's ESM GLTF loader, which the VR
   * runtime must not import (see GenericHandLoader).
   */
  loadHandModel?: VRHandModelLoader;
  /**
   * Available Force powers and the engine action bridge for a recognized
   * gesture. `aimedTargetId` is VRSpike's own live right-hand interaction-ray
   * resolution for this frame, for the same reason documented on
   * `getCombatContext`.
   */
  getForceContext?: (aimedTargetId: number | null) => { onForceGesture(gesture: VRForceGesture): void } | null;
  /** Clears VR-only lock, queue, and armed-item state on a session lifecycle boundary. */
  resetCombatInteraction?: () => void;
  /** Builds the engine-safe all-purpose action wheel for the current aim. */
  createActionWheel?: (aimedTargetId: number | null) => VRRadialMenuDefinition | null;
  /**
   * ROADMAP 4.8 — where to draw the world-space highlight for the target the
   * open wheel is acting on. Returns null unless the id is a live hostile
   * creature, so a wheel opened on a door or on nothing marks nothing.
   */
  getCombatTargetHighlight?: (targetId: number | null) => VRCombatTargetHighlight | null;
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
    /**
     * GUI roots that are visible but do not belong to this panel — the in-game
     * HUD and any menu underneath the foreground one. Hidden for the composite
     * so the panel shows its own menu rather than a copy of the whole 2D
     * interface. See `hideGuiRootsForPanel`.
     */
    readonly occludedGuiRoots?: readonly THREE.Object3D[];
    /**
     * How the panel is shown: a conversation held in the world shows only its
     * lower, dialogue part below the player's eyeline. Absent is a full panel.
     */
    readonly presentOptions?: VRPanelPresentOptions;
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
    /** Stable editable-control identity; a new owner is an explicit focus change. */
    readonly owner?: object;
    /** A caller may deliberately recall the keyboard without changing focus. */
    readonly recallRequested?: boolean;
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
  /**
   * The player's own standing head height above the XR floor, calibrated from
   * the first steady frames of a session and again on every recenter.
   */
  private static headHeightBaselineMetres: number | null = null;
  private static headHeightSamples: number[] = [];
  /** Whether syncRig has placed the rig at least once in this session. */
  private static rigSyncedThisSession = false;
  /**
   * The headset's position in the XR reference space, straight from the viewer
   * pose. `syncRig` measures the head offset through the rig orientation it is
   * about to build, which the world-space head in `latestInputFrame` cannot
   * give it: that one was computed through last frame's rig.
   */
  private static latestLocalHeadPosition: THREE.Vector3 | null = null;
  /** The follower-camera facing `syncRig` last built the rig from. */
  private static lastRigFacing: number | null = null;
  /** `performance.now()` of the last rig sync, to notice when syncing stopped. */
  private static lastRigSyncMs = Number.NEGATIVE_INFINITY;
  /** Put the head back over the avatar on the next sync that has a player. */
  private static rigAnchorPending = true;
  /**
   * A gap this long without a rig sync means the view was owned by something
   * else — a theater cutscene, a movie, a load — during which the engine may
   * have moved the avatar. The head is re-seated over it when syncing resumes.
   */
  private static readonly RIG_RESUME_ANCHOR_MS = 500;
  /** Passed to `renderer.render`; THREE overwrites it from the headset pose. */
  static camera: THREE.PerspectiveCamera | null = null;

  static session: XRSession | null = null;
  static installed = false;
  private static traceXRStartup = false;
  private static traceXRStartupCallbacksSeen = 0;
  private static xrFrameRenderTarget: THREE.WebGLRenderTarget | null = null;
  /**
   * Minigame input, injected by the engine so VRSpike keeps no dependency on
   * engine state (its tests mock the world, and importing GameState here pulled
   * the whole engine into them).
   */
  static miniGameInput: { update: (frame: XRInputFrame | null) => void; reset: () => void } | null = null;
  private static readonly inputRouter = new XRInputRouter();
  static readonly inputRecorder = new VRInputRecorder();
  static readonly tracePlayer = new VRTracePlayer();
  private static dominantHand: XRHandRole = 'right';
  private static inputCapabilityValidator = new XRInputCapabilityValidator();
  private static desktopLoopNeedsRestart = false;
  private static readonly sessionController = new XRSessionController({
    requestSession: async () => (navigator as any).xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor'],
    }),
    prepareSession: (session) => VRSpike.prepareXRSession(session),
    bindSession: async (session) => {
      if (!VRSpike.renderer) throw new Error('XR renderer is unavailable');
      await VRSpike.renderer.xr.setSession(session as any);
      VRSpike.desktopLoopNeedsRestart = true;
    },
    setAnimationLoopActive: (active) => {
      VRSpike.renderer?.xr.setAnimationLoop(active ? VRSpike.frame : null);
    },
    getInputSuppressed: () => GamePad.suppressed,
    setInputSuppressed: (suppressed) => { GamePad.suppressed = suppressed; },
    cleanupSession: (session) => VRSpike.cleanupXRSession(session),
  });
  private static readonly locomotionController = new LocomotionController();
  private static readonly snapTurnController = new VRSnapTurnController();
  private static readonly teleportController = new VRTeleportController();
  private static teleportMarkerHost: VRTeleportMarkerHost | null = null;
  private static readonly teleportAimHand = new VRPointerHandResolver();
  private static locomotionModeToggleHeld = false;
  private static readonly recenterHoldGate = new VRRecenterHoldGate();
  private static walkRunToggleHeld = false;
  private static walkRunToggleErrorReported = false;
  private static pauseToggleHeld = false;
  private static partyCommandHeld = false;
  private static comfortVignetteHost: VRComfortVignetteHost | null = null;
  private static hiltTimerHost: VRHiltTimerHost | null = null;
  private static weaponStanceHost: VRWeaponStanceHost | null = null;
  // A longer switch dwell than the class default. With a group of droids the
  // ray crosses several in the course of an ordinary swing, and 180 ms let the
  // lock hop between them — reported as "aim still quickly flickers between
  // opponents when they're grouped".
  private static readonly combatTargetLock = new VRCombatTargetLock({ switchDwellMilliseconds: 400 });
  private static offhandGrenadeTriggerHeld = false;
  private static dominantShotTriggerHeld = false;
  private static combatTargetHighlightHost: VRCombatTargetHighlightHost | null = null;
  private static combatTargetHighlightErrorReported = false;
  /**
   * The target the open wheel was built for (ROADMAP 4.8).
   *
   * Captured at the instant the wheel opens, not re-read per frame: the wheel
   * is world-fixed while held and cannot be re-aimed, so the page in front of
   * the player belongs to whatever was aimed at when it opened. The highlight
   * has to agree with that or it would point at the wrong creature.
   */
  private static radialFrozenTargetId: number | null = null;
  private static weaponStanceErrorReported = false;
  private static blasterLaserHost: VRBlasterLaserHost | null = null;
  private static blasterBoltHost: VRBlasterBoltHost | null = null;
  private static droidExplosionHost: VRDroidExplosionHost | null = null;
  private static readonly combatVisualObserver = new VRCombatVisualEventObserver();
  private static combatVisualsErrorReported = false;
  private static cutsceneFadeHost: VRCutsceneFadeHost | null = null;
  private static readonly cutsceneFadeEnvelope = new VRCutsceneFadeEnvelope();
  private static lastCutsceneCamera: THREE.Camera | null = null;
  private static previousXRInputTimestamp: number | null = null;
  private static locomotionInputErrorReported = false;
  private static trackedInputErrorReported = false;
  private static panelInputErrorReported = false;
  private static movieInputErrorReported = false;
  private static worldInteractionInputErrorReported = false;
  private static engineUpdateErrorReported = false;
  private static combatInputErrorReported = false;
  private static forceGestureErrorReported = false;
  private static panelPresentationErrorReported = false;
  private static worldTargetLabelErrorReported = false;
  private static syncRigFallbackReported = false;
  private static missingMovieRenderPrerequisiteReported = false;
  /**
   * TEMPORARY (headset R4): movies reported as showing "space with stars and
   * asteroids" while the correct audio plays. If `scene_movie` is empty at the
   * moment it is composited, the theater texture keeps whatever was drawn into
   * it last, which would read exactly that way. One line per distinct shape.
   */
  private static reportedMovieTheaterShapes = new Set<string>();
  private static lastMovieTheaterShape: string | null = null;
  private static movieTheaterShapeFrames = 0;
  private static lastCutsceneTheaterShape: string | null = null;
  private static cutsceneTheaterShapeFrames = 0;
  private static turnYaw = 0;
  private static readonly turnOriginOffset = new THREE.Vector3();
  private static controllerAnchorHost: XRControllerAnchorHost | null = null;

  /**
   * Draws a hand at a fixed world pose until cleared - a hand that has taken
   * hold of something the world owns, such as a swoop's handlebar. Input still
   * comes from the real controller; only the visual is pinned.
   */
  static setPinnedHandPose(hand: XRHandRole, pose: XRWorldPose | null): void {
    VRSpike.controllerAnchorHost?.setPinnedPose(hand, pose);
  }
  private static latestInputFrame: XRInputFrame | null = null;
  private static latestXRFrame: XRFrame | null = null;
  private static latestXRFrameTimestamp = 0;
  static readonly interactionRegistry = new InteractionTargetRegistry();
  static interactionGizmoHost: VRInteractionGizmoHost | null = null;
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
  private static readonly radialRayHand = new VRPointerHandResolver();
  private static radialOpeningHeadPose: XRWorldPose | null = null;
  private static radialMenuPressedLastFrame = false;
  private static comfortSettingsHost: VRComfortSettingsHost | null = null;
  private static comfortSettingsPointerHost: VRPanelPointerHost | null = null;
  private static readonly comfortSettingsPointerHand = new VRPointerHandResolver();
  private static comfortSettingsSelectHeld = false;
  private static comfortSettingsCancelHeld = false;
  private static keyboardSelectHeld = false;
  private static keyboardCancelHeld = false;
  private static keyboardGrabHeld = false;
  private static keyboardWasActive = false;
  private static keyboardOwner: object | null = null;
  /** Set by DONE; cleared only by focus ownership change, explicit recall, or leaving the screen. */
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
      VRSpike.sessionController.markUnavailable();
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
        VRSpike.sessionController.markUnavailable();
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

    // Render resolution is the bluntest performance lever a VR title has, and
    // this build had no way to move it — Phase 0 measured a 4224x2304 target
    // and lived with it. Scaling is roughly quadratic in fill rate, so 0.8 is
    // about a third less work per eye. Must be set before the session starts.
    const framebufferScale = parseXRFramebufferScale(
      typeof window !== 'undefined' ? window.location.search : ''
    );
    if (framebufferScale !== DEFAULT_XR_FRAMEBUFFER_SCALE) {
      renderer.xr.setFramebufferScaleFactor(framebufferScale);
      console.log(`[VRSpike] XR framebuffer scale: ${framebufferScale}`);
    }

    VRSpike.rig = new THREE.Group();
    VRSpike.rig.name = 'VRSpike.rig';
    // KOTOR's world is Z-up; WebXR hands back Y-up poses. This rotation is the
    // whole conversion — without it you are lying on your back in the level.
    XRCoordinateConverter.applyXRToGameBasis(VRSpike.rig);
    VRSpike.controllerAnchorHost = VRSpike.createControllerAnchorHost(VRSpike.rig);

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
        VRSpike.sessionController.markUnavailable();
        console.warn(
          '[VRSpike] the browser reports no immersive-vr support. This is usually the ' +
          'active OpenXR runtime rather than the page: confirm the headset runtime ' +
          '(SteamVR / Oculus / VDXR) is running AND set as the active OpenXR runtime, ' +
          'then reload.'
        );
      } else {
        VRSpike.sessionController.markReady();
      }
    } catch (error) {
      VRSpike.sessionController.markUnavailable();
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
      const session = await VRSpike.sessionController.enter();

      const btn = document.getElementById('vr-spike-button');
      if (btn) btn.textContent = 'Exit VR (spike)';

      const diagnostic = VRSpike.sessionController.diagnosticSnapshot;
      VRSpike.perf.runtimeRates = {
        runtimeReportedHz: diagnostic.runtimeReportedHz,
        runtimeSupportedHz: diagnostic.runtimeSupportedHz,
        requestedHz: diagnostic.requestedHz,
        observedCallbackHz: diagnostic.observedCallbackHz,
      };

      VRSpike.perf.beginXRSession();
      VRSpike.perf.start('stereo');
      console.log(
        `[VRSpike] runtime-reported cadence ${diagnostic.runtimeReportedHz ?? 'unreported'} Hz; ` +
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
    }
  }

  static exit(): void {
    void VRSpike.sessionController.end().catch((error) => {
      console.error('[VRSpike] XR session end failed after local cleanup', error);
    });
  }

  private static onVisibilityChange = (): void => {
    if (VRSpike.session?.visibilityState !== 'visible') {
      VRSpike.clearTrackedInput();
    }
  };

  private static onInputSourcesChange = (): void => {
    const session = VRSpike.session;
    if (!session) return;
    const sources = Array.from(session.inputSources ?? []);
    // A session reports an empty input source list until the runtime delivers
    // its first `inputsourceschange`, and this runs once on entry before that.
    // Validating an empty list reports every required action as missing, so
    // entering VR always warned that the controllers were unusable while the
    // real topology — once it arrived — matched the quest-touch profile fine.
    // No sources means "not known yet", not "unsupported".
    if (sources.length === 0) return;
    const update = VRSpike.inputCapabilityValidator.update(
      XRGamepadReader.readCapabilities(sources)
    );
    if (update.changed && !update.validation.valid) {
      console.warn('[VRSpike] XR controller topology is missing required semantic actions', update);
    }
  };

  /** Hooks are read at load time, so a host built before they are set still gets hands. */
  private static createControllerAnchorHost(rig: THREE.Object3D): XRControllerAnchorHost {
    return new XRControllerAnchorHost(rig, false, {
      loadHandModel: (hand) => {
        const loader = VRSpike.hooks?.loadHandModel;
        return loader
          ? loader(hand)
          : Promise.reject(new Error('VRSpike hooks supply no loadHandModel'));
      },
    });
  }

  static setDominantHand(hand: XRHandRole): void {
    if (hand !== 'left' && hand !== 'right') throw new TypeError('dominant hand must be left or right');
    if (hand !== VRSpike.dominantHand) {
      // These are mounted to a concrete controller anchor. Recreate them on
      // the next combat frame so a preference change never leaves the timer,
      // stance plaque, or aiming laser attached to the former weapon hand.
      VRSpike.hiltTimerHost?.dispose();
      VRSpike.hiltTimerHost = null;
      VRSpike.weaponStanceHost?.dispose();
      VRSpike.weaponStanceHost = null;
      VRSpike.blasterLaserHost?.dispose();
      VRSpike.blasterLaserHost = null;
    }
    VRSpike.dominantHand = hand;
    VRSpike.inputRouter.setDominantHand(hand);
    VRSpike.inputCapabilityValidator = new XRInputCapabilityValidator(undefined, hand);
    VRSpike.onInputSourcesChange();
  }

  /** Current weapon/aim hand, shared with held-item presentation. */
  static getDominantHand(): XRHandRole {
    return VRSpike.dominantHand;
  }

  private static prepareXRSession(session: XRSession): void {
    VRSpike.session = session;
    // While VR owns the player's position, queued actions must never walk the
    // actor to a target — the rig is anchored to the avatar, so an engine-driven
    // approach drags the player through the world. Scoped to the actor the
    // player is driving, so party and NPC movement is untouched.
    ActionApproachPolicy.setControlledActorProbe(
      (actor) => actor != null && actor === VRSpike.hooks?.getControlledActor?.()
    );
    ActionApproachPolicy.setApproachSuppressed(true);
    VRSpike.traceXRStartup = true;
    VRSpike.traceXRStartupCallbacksSeen = 0;
    VRSpike.previousXRInputTimestamp = null;
    VRSpike.locomotionInputErrorReported = false;
    VRSpike.trackedInputErrorReported = false;
    VRSpike.panelInputErrorReported = false;
    VRSpike.movieInputErrorReported = false;
    VRSpike.worldInteractionInputErrorReported = false;
    VRSpike.engineUpdateErrorReported = false;
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
    VRSpike.latestLocalHeadPosition = null;
    VRSpike.lastRigFacing = null;
    VRSpike.lastRigSyncMs = Number.NEGATIVE_INFINITY;
    VRSpike.rigAnchorPending = true;
    VRSpike.interactionTargetSet.clear();
    VRSpike.interactionSystem.cancelTransientState();
    VRSpike.clearWorldActionPrompt(false);
    VRSpike.worldPromptModule = null;
    VRSpike.worldPromptModuleInitialized = false;
    VRSpike.worldPromptSelectHeld = { left: true, right: true };
    VRSpike.interactionAimedTargetId = null;
    VRSpike.combatInputController.reset();
    VRSpike.combatTargetLock.clear();
    VRSpike.offhandGrenadeTriggerHeld = false;
    VRSpike.hooks?.resetCombatInteraction?.();
    VRSpike.forceGestureController.reset();
    VRSpike.snapTurnController.reset();
    VRSpike.teleportController.reset();
    VRSpike.clearTeleportMarker();
    VRSpike.locomotionModeToggleHeld = false;
    VRSpike.recenterHoldGate.reset();
    VRSpike.walkRunToggleHeld = false;
    VRSpike.pauseToggleHeld = false;
    VRSpike.partyCommandHeld = false;
    VRSpike.panelInputController.cancel();
    VRSpike.panelHost?.clear();
    VRSpike.keyboardHost?.clear();
    VRSpike.movieHost?.clear();
    VRSpike.panelPointerHost?.clear();
    VRSpike.worldTargetLabelHost?.clear();
    VRSpike.latestPanelPointerPosition = null;
    session.addEventListener('visibilitychange', VRSpike.onVisibilityChange);
    session.addEventListener('inputsourceschange', VRSpike.onInputSourcesChange);
    VRSpike.onInputSourcesChange();
  }

  private static cleanupXRSession(session: XRSession | null): Promise<void> {
    session?.removeEventListener('visibilitychange', VRSpike.onVisibilityChange);
    session?.removeEventListener('inputsourceschange', VRSpike.onInputSourcesChange);
    return new Promise<void>((resolve, reject) => queueMicrotask(() => {
      let detachError: unknown = null;
      try {
        // Let Three's native raw-session end listener run first when there is
        // an actual end event. The local dispatch is only needed if that owner
        // is still bound after the event turn.
        VRSpike.detachThreeXRSession(session);
      } catch (error) {
        detachError = error;
      } finally {
        VRSpike.finishSessionEnd();
      }
      if (detachError) reject(detachError);
      else resolve();
    }));
  }

  /**
   * Three r149 has no public local-detach method. Its private `end` listener is
   * the owner that removes controller listeners, restores the pre-XR render
   * target, clears the bound session, stops its WebXR animation, and flips
   * `isPresenting`. Dispatching a local end event invokes that teardown when a
   * runtime `end()` rejection (or a partial `setSession()` failure) does not.
   */
  private static detachThreeXRSession(session: XRSession | null): void {
    if (!session || !VRSpike.renderer) return;
    const xrManager = VRSpike.renderer.xr as THREE.WebXRManager & {
      getSession?: () => XRSession | null;
    };
    const boundSession = xrManager.getSession?.() ?? null;
    if (boundSession !== session && !xrManager.isPresenting) return;
    session.dispatchEvent(new Event('end'));
    if ((xrManager.getSession?.() ?? null) === session || xrManager.isPresenting) {
      throw new Error('Three XR manager did not release the ended session locally');
    }
  }

  private static finishSessionEnd = (): void => {
    VRSpike.perf.stop();
    VRSpike.session = null;
    VRSpike.headHeightBaselineMetres = null;
    VRSpike.headHeightSamples = [];
    VRSpike.rigSyncedThisSession = false;
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
    VRSpike.offhandGrenadeTriggerHeld = false;
    VRSpike.combatTargetLock.clear();
    VRSpike.hooks?.resetCombatInteraction?.();
    VRSpike.clearTrackedInput();
    VRSpike.interactionTargetSet.clear();
    VRSpike.panelInputController.cancel();
    VRSpike.combatInputController.reset();
    VRSpike.forceGestureController.reset();
    VRSpike.snapTurnController.reset();
    VRSpike.teleportController.reset();
    VRSpike.clearTeleportMarker();
    VRSpike.locomotionModeToggleHeld = false;
    VRSpike.recenterHoldGate.reset();
    VRSpike.walkRunToggleHeld = false;
    VRSpike.pauseToggleHeld = false;
    VRSpike.partyCommandHeld = false;
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
    VRSpike.blasterBoltHost?.dispose();
    VRSpike.blasterBoltHost = null;
    VRSpike.droidExplosionHost?.dispose();
    VRSpike.droidExplosionHost = null;
    // Latched attack/death state belongs to creatures that no longer exist;
    // carrying it across would let a reused object id read as a fresh shot.
    VRSpike.combatVisualObserver.reset();
    VRSpike.cutsceneFadeHost?.dispose();
    VRSpike.cutsceneFadeHost = null;
    VRSpike.cutsceneFadeEnvelope.reset();
    VRSpike.lastCutsceneCamera = null;

    const btn = document.getElementById('vr-spike-button');
    if (btn) btn.textContent = 'Enter VR (spike)';

    // A successful XR bind lets the queued desktop callback drain while Three
    // presents. Failed binds leave that existing desktop chain intact and must
    // not start a second chain during rollback.
    const restartDesktopLoop = VRSpike.desktopLoopNeedsRestart;
    VRSpike.desktopLoopNeedsRestart = false;
    const update = VRSpike.hooks?.update;
    if (restartDesktopLoop && update) {
      requestAnimationFrame((timestamp) => update(timestamp, 'browser'));
    }

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
    // Desktop click-to-walk is correct again once the headset is off.
    ActionApproachPolicy.setApproachSuppressed(false);
    console.log('[VRSpike] session ended, back on requestAnimationFrame');
  };

  /**
   * The frame callback while presenting. WebXR supplies its own timestamp; the
   * engine reads THREE.Clock instead and does not need it.
   */
  private static frame = (timestamp: number, frame?: XRFrame): void => {
    VRSpike.perf.recordXRCallback(timestamp, !!frame);
    VRSpike.sessionController.updateObservedCallbackHz(VRSpike.perf.runtimeRates.observedCallbackHz);
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
    VRSpike.beginStartupTraceFrame();
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
    if (movieOwnsInput || keyboardOwnsInput || comfortSettingsOwnsInput) {
      // processPanelInput did not run, so nothing refreshed the panel ray this
      // frame. Left alone it hangs in the air where it last was: a skippable
      // line after a reply choice hands input to the movie/dialogue skip, and
      // the ray froze at the click for the rest of the line (round 8, S5).
      VRSpike.clearLegacyPanelPointer();
    }
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
        // Phase G: the engine overlay is the interaction surface. It still runs
        // through processInteractionInput to resolve *which* object VR is
        // aiming at (that feeds CursorManager, which is what makes the overlay
        // show its target UI at all), but when the bespoke prompt is disabled
        // that call no longer presents or activates anything itself.
        const interactionConsumed = VRSpike.processInteractionInput(timestamp);
        const overlayConsumed = VRSpike.processInGameOverlayInput();
        if (interactionConsumed || overlayConsumed) VRSpike.captureWeaponActionLatch();
        else VRSpike.processCombatInput(timestamp);
      }
    }
    // The engine tick is the last thing the XR callback does, and an exception
    // escaping here does not just skip a frame — it propagates out of the
    // requestAnimationFrame callback and the session stops presenting, so the
    // headset goes to a black screen with nothing on screen to explain it.
    // Observed in a headset session: a still-loading room sound threw out of
    // ModuleRoom.show during a save-load and took the whole view down.
    //
    // One engine defect should cost a frame, not the session. Reported once so
    // a per-frame throw cannot itself flood the console it is diagnosed from.
    try {
      VRSpike.hooks?.update(timestamp, 'xr');
    } catch (error) {
      // Once per distinct error, not once per session. A throw here aborts the
      // rest of that engine tick — including the draw — so a per-frame throw
      // reads in the headset as a black screen, and a second, different one
      // later in the session used to be completely invisible behind the first.
      const signature = String((error as Error)?.stack ?? error).split('\n').slice(0, 2).join(' | ');
      if (VRSpike.engineUpdateErrorSignatures.size < 20 && !VRSpike.engineUpdateErrorSignatures.has(signature)) {
        VRSpike.engineUpdateErrorSignatures.add(signature);
        VRSpike.engineUpdateErrorReported = true;
        console.error(
          '[VRSpike] engine update threw inside the XR frame callback; the frame loop ' +
          'has been kept alive and repeats of this error are suppressed',
          error
        );
      }
    }
  };

  private static readonly engineUpdateErrorSignatures = new Set<string>();

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
      let inputFrame = VRSpike.tracePlayer.isPlaying()
        ? VRSpike.tracePlayer.sample(timestamp)
        : null;

      if (!inputFrame) {
        inputFrame = XRInputFrameBuilder.build(
          timestamp,
          frame,
          referenceSpace,
          rig,
          Array.from(session.inputSources ?? [])
        );
      }
      VRSpike.latestInputFrame = inputFrame;
      const viewerPosition = frame.getViewerPose(referenceSpace)?.transform.position;
      if (viewerPosition && Number.isFinite(viewerPosition.x) && Number.isFinite(viewerPosition.y) &&
        Number.isFinite(viewerPosition.z)) {
        (VRSpike.latestLocalHeadPosition ??= new THREE.Vector3())
          .set(viewerPosition.x, viewerPosition.y, viewerPosition.z);
      }
      VRSpike.sampleHeadHeight(frame, referenceSpace);
      if (!VRSpike.controllerAnchorHost) {
        VRSpike.controllerAnchorHost = VRSpike.createControllerAnchorHost(rig);
      }
      const heldVisuals = VRSpike.hooks?.getHeldVisuals?.();
      VRSpike.controllerAnchorHost.setHeldVisual('left', heldVisuals?.left ?? null);
      VRSpike.controllerAnchorHost.setHeldVisual('right', heldVisuals?.right ?? null);
      const avatarPresentation = VRSpike.hooks?.getAvatarPresentation?.();
      VRSpike.controllerAnchorHost.setHumanoidHandsVisible(avatarPresentation?.humanoidHands === true);
      const presentationOwnsView = VRSpike.isViewOwnedByPresentation();
      VRSpike.controllerAnchorHost.setPresentationSuppressed(presentationOwnsView);
      // While a menu, dialogue or movie owns the view the weapon is hidden, so
      // panels keep the controller's own ray. In the world a held blaster aims.
      const aimedFrame = (presentationOwnsView || !inputFrame)
        ? inputFrame
        : VRSpike.alignRaysToHeldWeapons(inputFrame, VRSpike.controllerAnchorHost);
      VRSpike.latestInputFrame = aimedFrame;
      VRSpike.controllerAnchorHost.update(aimedFrame);
      if (VRSpike.scene) {
        if (!VRSpike.interactionGizmoHost) {
          VRSpike.interactionGizmoHost = new VRInteractionGizmoHost(VRSpike.scene);
        }
        if (VRSpike.interactionGizmoHost.isEnabled()) {
          VRSpike.interactionGizmoHost.update(aimedFrame, VRSpike.interactionRegistry);
        }
      }
      if (aimedFrame && VRSpike.inputRecorder.isRecording()) {
        VRSpike.inputRecorder.recordFrame(aimedFrame, timestamp);
      }
      // Swoop and turret input, alongside the flatscreen KeyMapper handlers
      // rather than replacing them. Reached through the runtime import so
      // VRSpike keeps no dependency on engine state. It reads grips and
      // buttons, so it takes the raw frame rather than the weapon-aimed one.
      VRSpike.miniGameInput?.update(inputFrame);
    } catch (error) {
      VRSpike.clearTrackedInput();
      if (!VRSpike.trackedInputErrorReported) {
        VRSpike.trackedInputErrorReported = true;
        console.error('[VRSpike] tracked controller pose rejected', error);
      }
    }
  }

  /**
   * Replaces each hand's target ray with its held ranged weapon's barrel ray.
   * Done once here, where the frame is built, so every gameplay consumer —
   * world prompts, combat aim, the blaster laser, presentation bolts and the
   * ray anchor — agrees on one aim instead of each re-deriving it.
   */
  private static alignRaysToHeldWeapons(
    inputFrame: XRInputFrame,
    anchorHost: Pick<XRControllerAnchorHost, 'getAimPose'>,
  ): XRInputFrame {
    let hands: Partial<Record<XRHandRole, XRHandInputFrame>> | null = null;
    for (const hand of ['left', 'right'] as const) {
      const handFrame = inputFrame.hands[hand];
      if (!handFrame) continue;
      const aimPose = anchorHost.getAimPose(hand, handFrame.pose);
      if (!aimPose) continue;
      hands ??= { ...inputFrame.hands };
      hands[hand] = { ...handFrame, targetRayPose: aimPose };
    }
    return hands ? { ...inputFrame, hands } : inputFrame;
  }

  /** True while a movie, cutscene/conversation or a foreground menu owns the view. */
  private static isViewOwnedByPresentation(): boolean {
    try {
      return !!VRSpike.hooks?.getMovieContext?.() ||
        !!VRSpike.hooks?.getCutsceneContext?.() ||
        !!VRSpike.hooks?.getPanelContext?.()?.menu;
    } catch {
      return false;
    }
  }

  private static clearTrackedInput(): void {
    VRSpike.miniGameInput?.reset();
    VRSpike.closeRadialMenuForLifecycle(true);
    VRSpike.latestInputFrame = null;
    VRSpike.interactionPreviewIndicator = null;
    VRSpike.interactionAimedTargetId = null;
    VRSpike.combatTargetLock.clear();
    VRSpike.offhandGrenadeTriggerHeld = false;
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
    // Guard the context itself, not only the menu it carried: a menu implies a
    // context, but only to a reader.
    if (!context || !menu) {
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
      // Only a theater cutscene composites the dialogue into the theater
      // surface. A conversation presented in the world uses the ordinary panel.
      const cutsceneForInput = VRSpike.hooks?.getCutsceneContext?.() ?? null;
      const cutsceneOwnsTheater = cutsceneForInput !== null && cutsceneForInput.presentation !== 'world';
      if (!cutsceneOwnsTheater && !VRSpike.panelHost) {
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
      // Dialogue replies are drawn into the same theater texture as the
      // authored camera shot. Re-use that surface for hit testing once its
      // presentation frame exists; creating a second panel makes captions
      // visibly drift away from the cutscene.
      const presentationHost = cutsceneOwnsTheater ? VRSpike.movieHost : VRSpike.panelHost;
      const expectedOwner = cutsceneOwnsTheater ? VRSpike.cutsceneOwner : menu;
      const dominantHand = VRSpike.latestInputFrame.hands.right;
      const pointerHit = dominantHand && presentationHost?.owner === expectedOwner && presentationHost.isVisible
        ? VRSpike.panelPointerHost?.update(
          presentationHost.object,
          dominantHand.targetRayPose,
          context.viewportWidth,
          context.viewportHeight
        ) ?? null
        : null;
      // No hit test ran — no hand, or the presenting surface is not this
      // menu's yet — so the ray must not keep last frame's position either.
      if (!pointerHit) VRSpike.panelPointerHost?.clear();
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

  /**
   * Phase G3 — ray, pointer and click routing into the engine's in-game
   * overlay.
   *
   * Unlike `processPanelInput` this must NOT claim blanket foreground
   * ownership: the HUD is up the whole time the player is walking around, so
   * seizing input would suspend locomotion permanently. Instead it consumes
   * the trigger only on the frame a select edge lands on a control that the
   * overlay actually accepts — the same narrow-consumption pattern the world
   * prompt used — leaving the trigger free for combat otherwise.
   *
   * Returns whether this frame's activation was consumed by the overlay.
   */
  private static processInGameOverlayInput(): boolean {
    // Disabled by ROADMAP 4.8 — see INGAME_OVERLAY_PANEL_ENABLED. Resolving to
    // a null context reuses the existing teardown path below rather than adding
    // a second one, so the pointer host, input controller and cursor all clear
    // exactly as they do when the overlay legitimately goes away.
    const context = VRSpike.INGAME_OVERLAY_PANEL_ENABLED
      ? (VRSpike.hooks?.getInGameOverlayContext?.() ?? null)
      : null;
    const session = VRSpike.session;
    const inputFrame = VRSpike.latestInputFrame;
    const worldScene = VRSpike.scene;
    if (!context || !session || !inputFrame || !worldScene) {
      VRSpike.inGameOverlayPointerHost?.clear();
      VRSpike.inGameOverlayInputController.cancel();
      VRSpike.latestInGameOverlayPointerPosition = null;
      // `context?.` short-circuits exactly when context is null — which is the
      // case that needs clearing. GameState hides the legacy cursor during XR
      // play, so a pointer left set here keeps drawing the flatscreen 2D UI
      // into the headset after the overlay is gone (seen when a computer
      // console dialog took over). Reach the same adapter via the panel
      // context, which shares it.
      VRSpike.hooks?.getPanelContext?.().pointerSink.setPointerPosition(null);
      return false;
    }

    try {
      if (!VRSpike.inGameOverlayPointerHost) {
        VRSpike.inGameOverlayPointerHost = new VRPanelPointerHost(worldScene);
      }
      const host = VRSpike.inGameOverlayHost;
      const hand = inputFrame.hands.right;
      const pointerHit = hand && host?.isVisible
        ? VRSpike.inGameOverlayPointerHost.update(
          host.object,
          hand.targetRayPose,
          context.viewportWidth,
          context.viewportHeight
        ) ?? null
        : null;
      if (!hand || !pointerHit) VRSpike.inGameOverlayPointerHost.clear();

      // Feed the hit to the legacy GUI so the overlay's own hover/highlight
      // state tracks the ray, exactly as the mouse would drive it flatscreen.
      VRSpike.latestInGameOverlayPointerPosition = pointerHit?.guiPosition.clone() ?? null;

      const actions = VRSpike.inputRouter.route(
        XRGamepadReader.read(Array.from(session.inputSources ?? [])),
        new Set(['ui', 'gameplay'])
      );
      const consumed = VRSpike.inGameOverlayInputController.process(
        context.overlay,
        actions,
        pointerHit?.guiPosition ?? null,
        context.pointerSink
      );
      return consumed && !!pointerHit;
    } catch (error) {
      VRSpike.inGameOverlayInputController.cancel();
      VRSpike.inGameOverlayPointerHost?.clear();
      VRSpike.latestInGameOverlayPointerPosition = null;
      if (!VRSpike.inGameOverlayInputErrorReported) {
        VRSpike.inGameOverlayInputErrorReported = true;
        console.error('[VRSpike] in-game overlay input rejected', error);
      }
      return false;
    }
  }

  private static inGameOverlayPointerHost: VRPanelPointerHost | null = null;
  private static readonly inGameOverlayInputController = new VRPanelInputController();
  private static latestInGameOverlayPointerPosition: THREE.Vector2 | null = null;
  private static inGameOverlayInputErrorReported = false;

  private static resolveMovieInputContexts(): VRMovieInputContexts {
    const movie = VRSpike.hooks?.getMovieContext?.() ?? null;
    return {
      movie,
      cutscene: movie ? null : VRSpike.hooks?.getCutsceneContext?.() ?? null,
    };
  }

  /**
   * Select must be HELD this long on an unskippable dialogue line before the
   * whole conversation is abandoned.
   *
   * A tap used to do it. Skip and abort shared one press edge — skip when the
   * line was skippable, otherwise abort — so the press a player naturally makes
   * to move past a scripted beat ended the conversation instead. That is how
   * the prologue could not be finished: the Galaxy Map's `outro` reached "T3
   * moves to hallway, makes a sound" (LISTENING_TO_SPEAKER, unskippable), one
   * press aborted it with its reply still pending, and the end-of-conversation
   * script that starts the travel to Peragus never ran. Logged twice in one
   * headset session as `endConversation(aborted) dlg='outro' state=0
   * replies=1`.
   *
   * Flatscreen keeps these on separate keys — a click does nothing on an
   * unskippable line, Escape abandons the conversation — and a hold is the VR
   * equivalent of reaching for a different key. The escape hatch for a
   * genuinely stuck line survives; it just can no longer be reached by
   * accident. Longer than recenter's hold because what it destroys is story
   * state: an aborted conversation skips its ending script.
   */
  private static readonly cutsceneAbortHoldGate = new VRRecenterHoldGate(1500);
  /** A hold must begin while the line is unskippable; one carried in does not count. */
  private static cutsceneAbortNeedsFreshPress = true;

  /** Keeps movie playback authoritative while allowing the original skip rule. */
  private static processMovieInput(
    contexts: VRMovieInputContexts = VRSpike.resolveMovieInputContexts(),
    timestampMs: number = performance.now(),
  ): boolean {
    const movieContext = contexts.movie;
    const cutsceneContext = contexts.cutscene;
    const context = movieContext ?? cutsceneContext;
    if (!context) {
      VRSpike.movieCancelHeld = false;
      VRSpike.cutsceneAbortHoldGate.reset();
      VRSpike.cutsceneAbortNeedsFreshPress = true;
      VRSpike.movieHost?.clear();
      return false;
    }

    const session = VRSpike.session;
    if (!session) return true;
    try {
      const skipPressed = VRSpike.readMovieInputPressed(session);
      if (context.canSkip) {
        // A skip still held when the next line turns out to be unskippable
        // must not start counting toward an abort.
        VRSpike.cutsceneAbortHoldGate.reset();
        VRSpike.cutsceneAbortNeedsFreshPress = skipPressed;
        if (skipPressed && !VRSpike.movieCancelHeld) context.skip();
      } else if ((context as VRCutsceneInputContext).abort) {
        // The per-line skip is gated by the authored `skippable` flag, but
        // flatscreen also has an unconditional abort (DialogAbort) that works
        // even on a `NodeUnskippable` entry. VR keeps that escape hatch behind
        // a deliberate hold — see cutsceneAbortHoldGate.
        if (!skipPressed) VRSpike.cutsceneAbortNeedsFreshPress = false;
        const holding = skipPressed && !VRSpike.cutsceneAbortNeedsFreshPress;
        if (VRSpike.cutsceneAbortHoldGate.update(holding, timestampMs)) {
          console.info('[VRSpike] dialogue abandoned: Select held 1.5 s on an unskippable line');
          (context as VRCutsceneInputContext).abort?.();
        }
      }
      VRSpike.movieCancelHeld = skipPressed;
    } catch (error) {
      VRSpike.movieCancelHeld = false;
      VRSpike.cutsceneAbortHoldGate.reset();
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
      VRSpike.keyboardGrabHeld = false;
      VRSpike.keyboardWasActive = false;
      VRSpike.keyboardOwner = null;
      VRSpike.keyboardInputController.reset();
      // Leaving the screen that owned the keyboard also retires its dismissal,
      // so the next name-entry screen opens with a keyboard again.
      VRSpike.keyboardDismissed = false;
      return false;
    }
    try {
      if (sink.owner && sink.owner !== VRSpike.keyboardOwner) {
        VRSpike.keyboardOwner = sink.owner;
        VRSpike.keyboardDismissed = false;
        VRSpike.keyboardInputController.reset();
      }
      if (sink.recallRequested) VRSpike.keyboardDismissed = false;
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
      if (grabAction && !VRSpike.keyboardDismissed) {
        const hand = inputFrame.hands[grabAction.hand];
        // Grip repositions an active keyboard only. DONE hands the ray back to
        // the panel; grip must not silently steal that ownership back.
        if (hand) VRSpike.keyboardHost.moveTo(hand.pose, inputFrame.head);
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
          // A recalled keyboard can return while the panel still retains its
          // input edge history. Reset that handoff before yielding ownership so
          // this Select is observed as held until release, never as a panel
          // activation on the next XR frame.
          VRSpike.clearLegacyPanelPointer();
        } else {
          VRSpike.keyboardInputController.press(aimedKey, sink);
        }
      }
      VRSpike.keyboardHost.setModifierState?.(VRSpike.keyboardInputController.state);
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

  /** Deliberately restores a keyboard dismissed with DONE for the current focused control. */
  static recallKeyboard(): void {
    VRSpike.keyboardDismissed = false;
  }

  /** Comfort settings panel (ROADMAP 2.6), opened from the all-purpose action wheel. */
  private static processComfortSettingsInput(): boolean {
    const context = VRSpike.hooks?.getComfortSettingsPanelContext?.() ?? null;
    const inputFrame = VRSpike.latestInputFrame;
    const session = VRSpike.session;
    const scene = VRSpike.scene;
    if (!context || !inputFrame || !session || !scene) {
      VRSpike.clearComfortSettingsPointer();
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

      // The panel was hit-tested from the right controller only and drew no
      // ray, so the player had no way to see where they were aiming and the
      // left hand did nothing at all — the panel read as inert. Resolve the
      // row from whichever hand is actually on it, and draw that hand's ray.
      const panel = VRSpike.comfortSettingsHost.object;
      const resolution = VRSpike.comfortSettingsPointerHand.resolve(
        inputFrame,
        (pose) => VRSpike.comfortSettingsHost?.rowAtRay(pose) ?? null,
      );
      VRSpike.drawComfortSettingsPointer(scene, panel, resolution?.pose ?? VRSpike.anyTrackedRay(inputFrame));

      if (selectPressed && !VRSpike.comfortSettingsSelectHeld && resolution) {
        context.activateRow(resolution.hit);
      }
      VRSpike.comfortSettingsSelectHeld = selectPressed;

      if (cancelPressed && !VRSpike.comfortSettingsCancelHeld) context.close();
      VRSpike.comfortSettingsCancelHeld = cancelPressed;
    } catch (error) {
      VRSpike.clearComfortSettingsPointer();
      VRSpike.comfortSettingsSelectHeld = false;
      VRSpike.comfortSettingsCancelHeld = false;
      console.error('[VRSpike] comfort settings panel input rejected', error);
    }
    return true;
  }

  /**
   * Draws the comfort panel's ray from the pointing hand, falling back to any
   * tracked ray so the player can see where they are aiming even while off the
   * panel — a ray that appears only once it already hits teaches nothing.
   */
  private static drawComfortSettingsPointer(
    scene: THREE.Scene,
    panel: THREE.Object3D,
    pose: XRWorldPose | null,
  ): void {
    if (!pose) {
      VRSpike.comfortSettingsPointerHost?.clear();
      return;
    }
    if (!VRSpike.comfortSettingsPointerHost) {
      VRSpike.comfortSettingsPointerHost = new VRPanelPointerHost(scene);
    }
    // The panel resolves its own rows; only the ray and cursor are wanted here,
    // so the viewport is a unit square and the GUI position is discarded.
    VRSpike.comfortSettingsPointerHost.update(panel, pose, 1, 1);
  }

  private static anyTrackedRay(inputFrame: XRInputFrame): XRWorldPose | null {
    for (const hand of ['right', 'left'] as const) {
      const pose = inputFrame.hands[hand]?.targetRayPose;
      if (pose?.trackingState === 'tracked') return pose;
    }
    return null;
  }

  /** Tears down the comfort panel and its pointer together. */
  private static clearComfortSettingsPointer(): void {
    VRSpike.comfortSettingsHost?.clear();
    VRSpike.comfortSettingsPointerHost?.clear();
    VRSpike.comfortSettingsPointerHand.reset();
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

      // Phase G: drive the engine cursor from aim resolution alone. This used
      // to sit after the bespoke prompt model was built, so a candidate whose
      // model failed to build never reached CursorManager and the overlay
      // showed nothing — even though the object was perfectly selectable.
      VRSpike.hooks?.setVRSelectedObject?.(
        VRSpike.parseModuleObjectTargetId(selectedCandidate.id)
      );

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
      if (!VRSpike.BESPOKE_WORLD_PROMPT_ENABLED) {
        // Aim resolution above already fed CursorManager, which is all the
        // engine overlay needs. Do not present or activate the bespoke prompt.
        return false;
      }
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
        // TEMPORARY (issue 11 / medbay container): a refused activation is the
        // exact signature of "the option was there but clicking did nothing" —
        // the action revalidated false and was dropped silently. Haptics are
        // unavailable on this rig, so there is no feedback at all without this.
        console.info(
          `[VR prompt activate] REFUSED hand=${effect.hand}` +
          ` prompt=${VRSpike.worldPromptCandidateId ?? 'none'}`
        );
        VRSpike.clearWorldActionPrompt(false);
        void VRSpike.haptics.pulse(session, effect.hand, { durationMs: 60, amplitude: 0.45 });
      } else if (effect.type === 'activate') {
        const action = effect.action;
        const hand = effect.hand;
        console.info(
          `[VR prompt activate] id=${action.id} label='${action.label}' hand=${hand}`
        );
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

  /**
   * Extra radius on every combat aim candidate.
   *
   * A sensor droid subtends well under a degree across a room, and holding a
   * controller steady enough to intersect its true bounding sphere at 12 m is
   * not a skill this game ever asked for — KOTOR's own targeting is a click on
   * a screen-space reticle. Reported from a headset session as "targeting
   * combat droids was difficult".
   */
  private static readonly COMBAT_AIM_ASSIST_RADIUS_METRES = 0.6;

  /**
   * The hostile creature the weapon hand is pointing at.
   *
   * Strictly a fallback behind `resolveAimedTargetId`: whenever the interaction
   * ray has already resolved something, that stays authoritative, so aiming at
   * a door or a footlocker still opens its own actions and is never overridden
   * by a creature standing behind it. This only fills the gap the interaction
   * set cannot cover — hostiles beyond its 3 m per-type use distance but inside
   * combat range — which is why the wheel opened with no Attacks wedge and no
   * target highlight while four hostile droids stood in the room.
   *
   * Builds its candidate list on demand rather than caching: it runs only when
   * nothing is already aimed at, the list is a handful of creatures, and a
   * cache would have to be invalidated on every spawn, death and module load.
   */
  private static resolveAimedCombatTargetId(): number | null {
    const rayPose = VRSpike.latestInputFrame?.hands.right?.targetRayPose;
    if (!rayPose || rayPose.trackingState !== 'tracked') return null;
    try {
      const context = VRSpike.hooks?.getCombatAimCandidates?.() ?? null;
      if (!context || !context.candidates.length) return null;
      return resolveVRCombatAimedTargetId({
        rayPose,
        actorPosition: context.actorPosition,
        candidates: context.candidates,
        maxRangeMetres: context.maxRangeMetres,
        aimAssistRadiusMetres: VRSpike.COMBAT_AIM_ASSIST_RADIUS_METRES,
      });
    } catch {
      // Aim resolution must never break the frame loop; no target is the
      // honest outcome and the player can step closer.
      return null;
    }
  }

  /** Interaction aim first, then combat reach. See `resolveAimedCombatTargetId`. */
  private static resolveAimedTargetIdForCombat(): number | null {
    return VRSpike.resolveAimedTargetId() ?? VRSpike.resolveAimedCombatTargetId();
  }

  private static parseModuleObjectTargetId(id: string | null): number | null {
    if (!id) return null;
    const match = /^module-object:(\d+)$/.exec(id);
    if (match) return Number(match[1]);
    return /^\d+$/.test(id) ? Number(id) : null;
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
        action.action === SemanticXRAction.Cancel && action.hand === VRSpike.dominantHand && action.pressed
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
      VRSpike.weaponStanceHost?.clear();
      VRSpike.combatTargetLock.clear();
      VRSpike.updateCombatTargetHighlight();
      return;
    }
    // Resolve the candidate through the engine first. The lock intentionally
    // never sees raw ray ids, because a door, corpse, or stale selectable must
    // not become a combat target during the aim-loss grace window.
    const candidateContext = VRSpike.hooks?.getCombatContext?.(VRSpike.resolveAimedTargetIdForCombat()) ?? null;
    const lock = VRSpike.combatTargetLock.update({
      candidateTargetId: candidateContext?.nominatedTargetId ?? undefined,
      nowMilliseconds: timestamp,
    });
    const lockedTargetId = VRSpike.parseModuleObjectTargetId(lock.lockedTargetId);
    // Re-resolve the soft lock even during aim-loss grace. The original
    // candidate may be absent while a natural melee swing crosses the target,
    // but the engine target remains authoritative for that grace window.
    const context = VRSpike.hooks?.getCombatContext?.(lockedTargetId) ?? null;
    if (lockedTargetId !== null && context?.nominatedTargetId === null) {
      // A target that was once valid has died, transitioned, or otherwise been
      // rejected by the engine. Do not retain an armed grenade aimed at an
      // impossible target, and do not leave the highlight lying about it.
      VRSpike.combatTargetLock.clear();
      context.onCombatTargetInvalidated?.();
    }
    if (!context) {
      VRSpike.combatCancelHeld = false;
      VRSpike.hiltTimerHost?.clear();
      VRSpike.weaponStanceHost?.clear();
      VRSpike.updateCombatTargetHighlight();
      return;
    }

    VRSpike.updateHiltTimer(
      context.weaponMode,
      context.tempoReadiness ?? 0,
      context.inCombat,
      context.stanceReadout,
    );
    VRSpike.updateCombatTargetHighlight();

    try {
      const actions = VRSpike.inputRouter.route(
        XRGamepadReader.read(Array.from(session.inputSources ?? [])),
        new Set(['combat', 'interaction', 'ui'])
      );
      const dominantHand = VRSpike.dominantHand;
      const offhandHand: XRHandRole = dominantHand === 'right' ? 'left' : 'right';
      const offhandGrip = actions.some((action) =>
        action.action === SemanticXRAction.Grab && action.hand === offhandHand && action.pressed
      );
      const weaponActionPressed = actions.some((action) =>
        action.action === SemanticXRAction.WeaponAction && action.hand === dominantHand && action.pressed
      );
      const offhandTriggerPressed = actions.some((action) =>
        action.action === SemanticXRAction.WeaponAction && action.hand === offhandHand && action.pressed
      );
      // An armed grenade always owns the off-hand trigger. Without one, an
      // off-hand blaster shoots exactly like the dominant one — round 8, T3:
      // "should also work with offhand when offhand ranged weapon is equipped".
      const offhandShotPressed = offhandTriggerPressed && context.offhandShotAvailable === true;
      if (offhandTriggerPressed && !VRSpike.offhandGrenadeTriggerHeld) {
        if (!offhandShotPressed) {
          context.onGrenadeTrigger?.();
        } else if (VRSpike.isPresentationShotAllowed(context)) {
          VRSpike.firePresentationShot(context, timestamp, offhandHand, () => context.playOffhandShotSound?.());
        }
      }
      VRSpike.offhandGrenadeTriggerHeld = offhandTriggerPressed;

      // Every pull of a blaster trigger shows a shot and plays its sound, even
      // though the engine resolves only one attack per round — reported in
      // round 6 as "the bolt animation and sound should happen on every
      // trigger pull, even though shots only count once per round". This is
      // presentation only: the pull still goes through the tempo gate below,
      // and the engine-derived bolt for the player is suppressed in
      // updateCombatVisuals so a counted shot does not draw twice.
      //
      // ...but only a pull that is a shot. The trigger is also Select, so the
      // same finger picks dialogue replies, opens containers and presses
      // prompts; round 7 reported "blaster fires on any trigger pull". A pull
      // shoots while the actor is in combat, or when it opens combat against
      // a nominated hostile. Anything else is the player using the world.
      const shotPressed = context.weaponMode === 'blaster' && weaponActionPressed;
      if (shotPressed && !VRSpike.dominantShotTriggerHeld &&
        VRSpike.isPresentationShotAllowed(context)) {
        VRSpike.firePresentationShot(context, timestamp);
      }
      VRSpike.dominantShotTriggerHeld = shotPressed;

      // Cancel is handled by processCombatCancel, which runs every gameplay
      // frame regardless of whether a world prompt consumed input first.
      if (!context.nominatedTargetId) return;

      if (VRSpike.processForceInput(timestamp, context)) {
        VRSpike.combatInputController.reset();
        return;
      }
      const events = VRSpike.combatInputController.process(inputFrame, {
        actorId: context.actorId,
        nominatedTargetId: context.nominatedTargetId,
        weaponMode: context.weaponMode,
        timestamp,
        offhandGrip,
        // Either blaster's pull completes the round; the controller latches
        // the combined press, so holding one trigger and pulling the other
        // is still one pull.
        weaponActionPressed: weaponActionPressed || offhandShotPressed,
        dominantHand,
        offhandHand,
        allowDominantTrigger: context.allowDominantTrigger === true,
      });
      for (const event of events) context.onCombatSwing(event);
    } catch (error) {
      if (!VRSpike.combatInputErrorReported) {
        VRSpike.combatInputErrorReported = true;
        console.error('[VRSpike] combat input rejected', error);
      }
    }
  }

  /** In combat, or opening it on a hostile the engine has nominated. */
  private static isPresentationShotAllowed(context: {
    readonly inCombat: boolean;
    readonly nominatedTargetId: string | null;
  }): boolean {
    return context.inCombat === true || context.nominatedTargetId !== null;
  }

  private static firePresentationShot(context: {
    readonly nominatedTargetAimPoint?: THREE.Vector3 | null;
    playShotSound?(): void;
  }, timestamp: number, hand: XRHandRole = VRSpike.dominantHand, playSound?: () => void): void {
    const worldScene = VRSpike.scene;
    const rayAnchor = VRSpike.controllerAnchorHost?.getRayAnchor(hand) ?? null;
    if (!worldScene || !rayAnchor) return;
    try {
      const from = rayAnchor.getWorldPosition(new THREE.Vector3());
      const aim = context.nominatedTargetAimPoint ?? null;
      const to = aim
        ? aim.clone()
        : from.clone().add(
          new THREE.Vector3(0, 0, -1)
            .applyQuaternion(rayAnchor.getWorldQuaternion(new THREE.Quaternion()))
            .multiplyScalar(PRESENTATION_SHOT_RANGE_METRES),
        );
      if (!VRSpike.blasterBoltHost) {
        VRSpike.blasterBoltHost = new VRBlasterBoltHost(worldScene);
      }
      // attackResult 1 (a plain hit colour); presentation never reports a roll.
      // Same clock as updateCombatVisuals, which advances and retires bolts.
      VRSpike.blasterBoltHost.fire({ from, to, attackResult: 1 }, timestamp);
      if (playSound) playSound();
      else context.playShotSound?.();
    } catch (error) {
      if (!VRSpike.combatVisualsErrorReported) {
        VRSpike.combatVisualsErrorReported = true;
        console.error('[VRSpike] presentation shot rejected', error);
      }
    }
  }

  private static updateHiltTimer(
    weaponMode: CombatWeaponMode,
    tempoReadiness: number,
    inCombat: boolean,
    stanceReadout = ''
  ): void {
    // The hilt timer is a diegetic ring on the weapon itself, so it belongs on
    // the grip anchor. The blaster laser is an *aiming* line and must use the
    // target-ray anchor instead — grip and target-ray orientations differ
    // substantially (grip follows the handle, target ray follows where the
    // controller points), and putting the laser on the grip is what made it
    // visibly diverge from the correctly-aimed menu pointer.
    const gripAnchor = VRSpike.controllerAnchorHost?.getAnchor(VRSpike.dominantHand) ?? null;
    const rayAnchor = VRSpike.controllerAnchorHost?.getRayAnchor(VRSpike.dominantHand) ?? null;
    if (!gripAnchor || weaponMode === 'unarmed') {
      VRSpike.hiltTimerHost?.clear();
      VRSpike.weaponStanceHost?.clear();
      VRSpike.blasterLaserHost?.clear();
      return;
    }
    if (!VRSpike.hiltTimerHost) {
      VRSpike.hiltTimerHost = new VRHiltTimerHost(gripAnchor);
    }
    VRSpike.hiltTimerHost.present(Number.isFinite(tempoReadiness)
      ? Math.min(1, Math.max(0, tempoReadiness))
      : 0);

    // Same grip anchor as the ring, so the upcoming player-selected action
    // belongs to the equipped weapon rather than a screen-space HUD.
    try {
      if (!VRSpike.weaponStanceHost) {
        VRSpike.weaponStanceHost = new VRWeaponStanceHost(gripAnchor);
      }
      VRSpike.weaponStanceHost.present(stanceReadout);
    } catch (error) {
      VRSpike.weaponStanceHost?.clear();
      if (!VRSpike.weaponStanceErrorReported) {
        VRSpike.weaponStanceErrorReported = true;
        console.error('[VRSpike] weapon stance readout rejected', error);
      }
    }

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

  private static processForceInput(
    timestamp: number,
    combatContext?: { onDirectionalForceGesture?(gesture: VRForceGesture): boolean },
  ): boolean {
    const inputFrame = VRSpike.latestInputFrame;
    const session = VRSpike.session;
    if (!inputFrame || !session) return false;
    const legacyContext = combatContext
      ? null
      : (VRSpike.hooks?.getForceContext?.(VRSpike.resolveAimedTargetIdForCombat()) ?? null);
    if (!combatContext?.onDirectionalForceGesture && !legacyContext) return false;
    try {
      const actions = VRSpike.inputRouter.route(
        XRGamepadReader.read(Array.from(session.inputSources ?? [])),
        new Set(['interaction'])
      );
      const gripModifierHeld = actions.some((action) =>
        action.action === SemanticXRAction.Grab && action.hand === VRSpike.dominantHand && action.pressed
      );
      const gesture = VRSpike.forceGestureController.process(
        inputFrame,
        gripModifierHeld,
        timestamp,
        VRSpike.dominantHand,
      );
      if (!gesture) return false;
      // A grip-held thrust looks exactly like a push flick. Only swallow the
      // frame's melee input when the gesture was actually spent on a queued
      // Push/Pull; otherwise the same motion must still land as a swing.
      if (combatContext?.onDirectionalForceGesture) {
        return combatContext.onDirectionalForceGesture(gesture) === true;
      }
      legacyContext?.onForceGesture(gesture);
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
      // No hand filter: the binding table already scopes radial-wheel Select to
      // 'either', and the wheel's ray follows whichever hand aims at it. Testing
      // for 'left' here re-imposed the very restriction the binding drops.
      const selectPressed = actions.some((action) =>
        action.action === SemanticXRAction.Select && action.pressed
      );
      let openingMenu: VRRadialMenuDefinition | null = null;
      if (menuPressed && !VRSpike.radialMenuPressedLastFrame && !wasOpen) {
        // Resolve aim ONCE and use the same value for both the menu and the
        // highlight. Calling resolveAimedTargetId() twice could return two
        // different objects if aim drifts between the calls, and the highlight
        // would then mark a creature the page does not act on.
        // The soft-locked hostile wins over this frame's ray. Reaching for the
        // menu button moves the controller, so the instantaneous aim at the
        // press was usually off a small target — the round-5 log shows the
        // wheel opening with `aimedTargetId=null` while a hostile was
        // selectable, which is "the wheel almost never shows available
        // attacks". The lock exists precisely so the target survives that.
        const lockedTargetId = VRSpike.parseModuleObjectTargetId(
          VRSpike.combatTargetLock.getSnapshot().lockedTargetId ?? null,
        );
        const aimedTargetId = lockedTargetId ?? VRSpike.resolveAimedTargetIdForCombat();
        openingMenu = VRSpike.hooks?.createActionWheel?.(aimedTargetId) ?? null;
        VRSpike.radialFrozenTargetId = openingMenu ? aimedTargetId : null;
      }
      VRSpike.radialMenuPressedLastFrame = menuPressed;

      const host = VRSpike.radialMenuHost;
      // Either hand may aim at the wheel. Binding the ray to one controller is
      // invisible to the player, so the other hand reads as a dead pointer.
      const rayResolution = wasOpen && host
        ? VRSpike.radialRayHand.resolve(inputFrame, (pose) => host.resolveRay(pose))
        : null;
      if (!rayResolution) VRSpike.radialRayHand.reset();
      const rayHit = rayResolution?.hit ?? null;
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
        VRSpike.radialFrozenTargetId = null;
      }
      VRSpike.updateCombatTargetHighlight();
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
    VRSpike.rigAnchorPending = true;
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

  /**
   * TEMPORARY (VR-PLAYTEST-FIX-PLAN.md issue 13): room visibility trace.
   *
   * `ModuleArea.updateRoomVisibility` hides every room then shows
   * `player.room` plus its linked rooms, and early-returns unless the player
   * changed room. That is camera-independent, so it should behave identically
   * in VR — unless VR locomotion leaves `player.room` stale or wrong, which
   * would hide whole rooms and every door and creature in them. Logs only on
   * change, so it is quiet while standing still.
   */
  private static lastRoomTrace = '';

  private static traceRoomVisibility(): void {
    try {
      const world = VRSpike.hooks?.getWorldContext?.();
      if (!world) return;
      const trace = `room=${world.room ?? 'none'} visible=${world.roomsVisible}/${world.roomsTotal}`;
      if (trace === VRSpike.lastRoomTrace) return;
      VRSpike.lastRoomTrace = trace;
      console.info(`[VR rooms] ${trace}`);
    } catch {
      // Diagnostics must never disturb the frame loop.
    }
  }

  private static reportWorldPromptStageOnce(message: string): void {
    if (VRSpike.reportedWorldPromptStages.has(message)) return;
    VRSpike.reportedWorldPromptStages.add(message);
    console.info(`[VR prompt stage] ${message}`);
  }

  /** Hoisted: this is read on the frame path and was rebuilt every frame. */
  private static readonly COMBAT_CONTEXT_ONLY: ReadonlySet<XRActionContext> = new Set<XRActionContext>(['combat']);

  private static captureWeaponActionLatch(): void {
    const session = VRSpike.session;
    if (!session) return;
    try {
      const actions = VRSpike.inputRouter.route(
        XRGamepadReader.read(Array.from(session.inputSources ?? [])),
        VRSpike.COMBAT_CONTEXT_ONLY,
      );
      const pressed = actions.some((action) =>
        action.action === SemanticXRAction.WeaponAction && action.hand === VRSpike.dominantHand && action.pressed
      );
      const offhandHand: XRHandRole = VRSpike.dominantHand === 'right' ? 'left' : 'right';
      const offhandPressed = actions.some((action) =>
        action.action === SemanticXRAction.WeaponAction && action.hand === offhandHand && action.pressed
      );
      VRSpike.combatInputController.synchronizeWeaponActionHeld(pressed);
      // The presentation shot keeps its own edge. Left stale, a trigger that
      // picked a reply or opened a container read as a fresh pull on the first
      // frame the world got input back, and fired a bolt nobody aimed.
      VRSpike.dominantShotTriggerHeld = pressed;
      VRSpike.offhandGrenadeTriggerHeld = offhandPressed;
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
        // 'global' carries Recenter, Pause and PartyCommand, which belong with
        // locomotion because this path already owns the rig's placement and
        // runs on every XR frame gameplay owns.
        allowGameplayActions
          ? new Set(['locomotion', 'gameplay', 'global'])
          : new Set(['locomotion', 'global'])
      );
      const move = routedActions.find((action) => action.action === SemanticXRAction.Move);
      const turn = routedActions.find((action) => action.action === SemanticXRAction.Turn);
      if (!move?.axes) return;

      const comfortSettings = VRSpike.hooks?.getComfortSettings?.() ?? DEFAULT_COMFORT_SETTINGS;


      // Recenter is a long press, matching how recentring works on the Meta
      // platform. The system's own recenter is a long press of the Meta button,
      // but that button is reserved by the OS for the universal menu and is
      // never delivered to WebXR — the right controller exposes only trigger,
      // squeeze, thumbstick, A, B, and thumbrest — so the gesture lives on the
      // dominant thumbstick click instead.
      //
      // The hold is not just convention here. That stick is also Turn, so a
      // press-triggered recenter would fire on any stray click mid-turn, and an
      // unwanted recenter is a genuine comfort event. Requiring the hold makes
      // that essentially impossible while keeping the control discoverable.
      //
      // It fires once when the threshold is crossed, not repeatedly while held:
      // recentring every frame would pin the head to the origin and fight the
      // player's real movement.
      const recenterPressed = routedActions.some((action) =>
        action.action === SemanticXRAction.Recenter && action.pressed
      );
      // Walk/run, on the offhand thumbstick click. The engine has carried walk
      // and run rates and an `isWalking()` flag all along — only the VR path had
      // no way to reach them, which is why this looked like it had nothing to
      // toggle. Edge-triggered so a held click does not oscillate every frame.
      const walkRunPressed = routedActions.some((action) =>
        action.action === SemanticXRAction.ToggleWalkRun && action.pressed
      );
      if (walkRunPressed && !VRSpike.walkRunToggleHeld) {
        try {
          VRSpike.hooks?.toggleWalkRun?.();
        } catch (error) {
          if (!VRSpike.walkRunToggleErrorReported) {
            VRSpike.walkRunToggleErrorReported = true;
            console.error('[VRSpike] walk/run toggle rejected', error);
          }
        }
      }
      VRSpike.walkRunToggleHeld = walkRunPressed;

      // Pause and PartyCommand are 'global' context, routed here alongside
      // Recenter for the same reason: this path already runs every XR frame
      // that gameplay owns. Both are edge-triggered.
      const pausePressed = routedActions.some((action) =>
        action.action === SemanticXRAction.Pause && action.pressed
      );
      if (pausePressed && !VRSpike.pauseToggleHeld) {
        try {
          VRSpike.hooks?.togglePause?.();
        } catch (error) {
          console.error('[VRSpike] pause toggle rejected', error);
        }
      }
      VRSpike.pauseToggleHeld = pausePressed;

      const partyPressed = routedActions.some((action) =>
        action.action === SemanticXRAction.PartyCommand && action.pressed
      );
      if (partyPressed && !VRSpike.partyCommandHeld) {
        try {
          VRSpike.hooks?.cyclePartyLeader?.();
        } catch (error) {
          console.error('[VRSpike] party leader cycle rejected', error);
        }
      }
      VRSpike.partyCommandHeld = partyPressed;

      if (VRSpike.recenterHoldGate.update(recenterPressed, timestamp)) {
        VRSpike.applyRecenter(
          viewerPose.transform.position,
          rig.quaternion.clone().multiply(
            new THREE.Quaternion(
              viewerPose.transform.orientation.x,
              viewerPose.transform.orientation.y,
              viewerPose.transform.orientation.z,
              viewerPose.transform.orientation.w
            ).normalize()
          )
        );
      }

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
    VRSpike.clearTeleportMarker();
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
    _headWorldOrientation: THREE.Quaternion
  ): void {
    const result = VRSpike.teleportController.process(rawMoveAxes);
    if (result.phase === 'idle') {
      VRSpike.clearTeleportMarker();
      return;
    }

    const feet = VRSpike.hooks?.getPlayerPosition() ?? null;
    const walkmesh = VRSpike.hooks?.getCurrentRoomWalkmesh?.() ?? null;
    const teleportPlayer = VRSpike.hooks?.teleportPlayer;
    const inputFrame = VRSpike.latestInputFrame;
    if (!feet || !walkmesh || !teleportPlayer || !inputFrame) {
      VRSpike.clearTeleportMarker();
      return;
    }

    // The destination comes from wherever a hand is pointing, not from the
    // stick bearing. The stick only gates the aim, so the player still holds to
    // aim and releases to go — but they now choose the distance by pointing,
    // and can see the spot before committing to it.
    const aimed = VRSpike.teleportAimHand.resolve(inputFrame, (pose) =>
      resolveVRTeleportAim({
        rayPose: pose,
        feet,
        maxDistanceMetres: VRSpike.teleportController.maxDistanceMetres,
      })
    );
    if (!aimed) {
      VRSpike.clearTeleportMarker();
      return;
    }

    const candidate = aimed.hit.point;
    const walkable = walkmesh.isPointWalkable(candidate);

    if (result.phase === 'aiming') {
      VRSpike.presentTeleportMarker(aimed.pose.position, candidate, walkable);
      return;
    }

    VRSpike.clearTeleportMarker();
    // A blocked aim still lands the player somewhere legal rather than
    // swallowing the input: silently doing nothing reads as a broken control.
    teleportPlayer(walkable ? candidate : walkmesh.getNearestWalkablePoint(candidate));
  }

  private static presentTeleportMarker(
    origin: THREE.Vector3,
    destination: THREE.Vector3,
    walkable: boolean,
  ): void {
    const scene = VRSpike.scene;
    if (!scene) return;
    if (!VRSpike.teleportMarkerHost) VRSpike.teleportMarkerHost = new VRTeleportMarkerHost(scene);
    VRSpike.teleportMarkerHost.present(new THREE.Vector3().copy(origin), destination, walkable);
  }

  private static clearTeleportMarker(): void {
    VRSpike.teleportMarkerHost?.clear();
    VRSpike.teleportAimHand.reset();
  }

  /**
   * Recenter: make the player's current physical forward the game's forward,
   * and put their head over the avatar's position.
   *
   * Deliberately stateless — it *sets* the yaw offset and origin offset from
   * the pose observed this frame rather than accumulating a correction, so
   * repeated recentres cannot drift. This is the opposite pivot to snap turn:
   * `applyTurnAroundHead` rotates the world while pinning the head where it is,
   * whereas recenter moves the head onto the rig origin.
   */
  private static applyRecenter(
    xrHeadPosition: DOMPointReadOnly,
    headWorldOrientation: THREE.Quaternion
  ): void {
    const rig = VRSpike.rig;
    if (!rig) return;

    // Refuse to recentre on a near-vertical head pose.
    //
    // The first attempt relied on `worldOrientationToCreatureFacing` throwing,
    // but that only fires when the forward vector is *exactly* vertical
    // (lengthSq < 1e-10). A real headset looking up is a few degrees off, which
    // leaves a horizontal component thousands of times larger, so the guard
    // never fired on device — reported from the second headset session as
    // "recenter still worked while looking straight up". Yaw read from a
    // near-vertical forward is dominated by tracking noise, and recentring on
    // it throws the player's whole world sideways.
    const headForward = new THREE.Vector3(0, 0, -1).applyQuaternion(headWorldOrientation);
    if (Math.hypot(headForward.x, headForward.y) < RECENTER_MIN_HORIZONTAL_FORWARD) {
      return;
    }

    let headFacing: number;
    let rigFacing: number;
    try {
      headFacing = LocomotionController.worldOrientationToCreatureFacing(headWorldOrientation);
      rigFacing = LocomotionController.worldOrientationToCreatureFacing(rig.quaternion);
    } catch {
      return;
    }

    const wrap = (radians: number): number =>
      Math.atan2(Math.sin(radians), Math.cos(radians));

    // Rotating the rig turns the head with it, so the head's yaw *relative to*
    // the rig cannot be changed here — aligning the head to the rig's current
    // forward is not achievable and not what recenter means. What we can do is
    // choose the rig yaw that puts the head's world forward onto the game's
    // natural forward, i.e. the rig's own bearing with this offset removed
    // (`facing + 90 degrees + turnYaw`). Deliberate in-game turning stays in
    // `turnYaw` and is preserved; only the physical offset is cancelled.
    //
    // `rigFacing` already carries the previous offset, so the correction
    // collapses to a direct assignment rather than an accumulation, which is
    // what makes repeat presses idempotent.
    // Recenter is also "measure me again": a player who sat down or stood up
    // since the session began gets the character's eye height back.
    VRSpike.headHeightBaselineMetres = null;
    VRSpike.headHeightSamples = [];
    const previousYawOffset = VRSpike.yawOffset;
    VRSpike.yawOffset = wrap(rigFacing - headFacing);
    const yawDelta = wrap(VRSpike.yawOffset - previousYawOffset);

    // Measure the head offset against the orientation `syncRig` will actually
    // build next frame, not the one standing now.
    const recenteredRigOrientation = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 0, 1), yawDelta)
      .multiply(rig.quaternion);
    const headOffset = new THREE.Vector3(
      xrHeadPosition.x,
      xrHeadPosition.y,
      xrHeadPosition.z
    ).applyQuaternion(recenteredRigOrientation);

    // Horizontal only. The rig's floor stays on the world floor and vertical
    // placement comes from the headset's own local-floor tracking, so moving
    // the rig in Z here would break the canonical eye height.
    VRSpike.turnOriginOffset.set(-headOffset.x, -headOffset.y, 0);
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

  /**
   * Bound the startup trace to its first frame.
   *
   * `completeStartupTrace` is the intended terminator, but it only runs on the
   * fully-successful update path. Entering VR from the main menu leaves the
   * engine in MOVIE/LEGAL mode, whose early return in `GameState.Update`
   * happens before that call is ever reached — so the "one-shot" trace kept
   * emitting two console lines per frame for the whole session (measured at
   * ~120 lines/second under the emulator). Console I/O at that rate is real
   * cost in the same submission loop Phase 0 spent its budget on.
   */
  private static beginStartupTraceFrame(): void {
    if (!VRSpike.traceXRStartup) return;
    if (VRSpike.traceXRStartupCallbacksSeen >= 1) {
      VRSpike.traceXRStartup = false;
      return;
    }
    VRSpike.traceXRStartupCallbacksSeen += 1;
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
  static render(
    worldCamera: THREE.Camera,
    frameTimestamp: number,
    // The player avatar, so the first-person submission can leave it out.
    // Passed in rather than read from GameState: this class deliberately does
    // not import the engine, and worldCamera already arrives the same way.
    playerBody?: THREE.Object3D | null,
  ): void {
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
    const theaterCutscene = !!cutsceneContext && cutsceneContext.presentation !== 'world';
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
      // ...but only once the rig has been placed at all. Entering VR while a
      // cutscene or movie is already up left the rig wherever the last session
      // did, or at the origin, and the theater and menu panels were then placed
      // from that head pose — logged as `[VRPanelHost] placed head=(0.00,0.00,
      // 0.00)` and reported as "menus and movies spawn in the floor any time
      // you enter VR while they are open". One sync puts the player where they
      // stand; skipping after that still keeps camera cuts from yanking them.
      if (!theaterCutscene || !VRSpike.rigSyncedThisSession) VRSpike.syncRig(worldCamera);
      VRSpike.refreshTrackedPresentationPose();
    }

    if (theaterCutscene) {
      VRSpike.clearWorldActionPrompt(false);
      VRSpike.renderCutscene(worldCamera, frameTimestamp);
      return;
    }
    // Nothing in the world path draws the theater, so nothing may leave it up.
    // A conversation that cuts from an authored shot to the player's own view
    // used to strand the screen where it was placed, showing its last frame —
    // black, after the fade that ends most shots. Round 8: "the first
    // interaction with Kreia rendered a black box", and at the end of the
    // Ebon Hawk intro the replies panel sat behind that same stale screen.
    // Movies render through renderMovie, never through here.
    VRSpike.movieHost?.clear();
    // A conversation shown in the world: no world prompts or target labels
    // compete with the dialogue panel, which renderPanel draws below.
    if (cutsceneContext) VRSpike.clearWorldActionPrompt(false);
    // Not (or no longer) in a cutscene: the next one's first shot must not
    // fade in against a stale camera reference from a previous, unrelated
    // cutscene.
    VRSpike.lastCutsceneCamera = null;
    VRSpike.cutsceneFadeHost?.setOpacity(0);

    VRSpike.traceRoomVisibility();
    VRSpike.renderKeyboard();
    VRSpike.renderPanel();
    VRSpike.renderInGameOverlay();
    if (!cutsceneContext) {
      VRSpike.renderWorldActionPrompt();
      VRSpike.renderWorldTargetLabel();
    }
    VRSpike.updateCombatVisuals(frameTimestamp);

    // The GUI texture pass restores the target it observed. Legacy engine
    // renders may already have reset that target, so make the XR target
    // authoritative once more immediately before stereo world submission.
    if (VRSpike.xrFrameRenderTarget) {
      renderer.setRenderTarget(VRSpike.xrFrameRenderTarget);
    }

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    // First person means the player does not see their own body. The rig is
    // welded to the avatar at eye height, so the model sits exactly where the
    // player is standing and was drawn straight into the face. Restored
    // immediately, so nothing else - cutscenes, the theater path, the
    // flatscreen camera, portraits - observes it hidden.
    const restoreBody = hidePlayerBodyForFirstPerson(playerBody);
    try {
      renderer.render(scene, VRSpike.camera);
    } finally {
      restoreBody();
    }
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
      //TEMPORARY (headset R4): see reportedMovieTheaterShapes.
      try {
        let visibleMeshes = 0;
        movieScene.traverse((object) => {
          if ((object as THREE.Mesh).isMesh && object.visible) visibleMeshes++;
        });
        const shape = `children=${movieScene.children.length} visibleMeshes=${visibleMeshes}`;
        // Report TRANSITIONS with how many composites were spent in the previous
        // state, not one line per distinct shape.
        //
        // The first version deduplicated by shape, which was the wrong
        // instrument: it proved the theater sometimes composites an empty
        // movie scene, but could not distinguish a two-frame race at movie
        // start from an entire movie drawn with nothing visible. Only the
        // latter would explain "the correct audio plays over the previous
        // movie's picture", so the duration is the whole question.
        if (shape !== VRSpike.lastMovieTheaterShape) {
          if (VRSpike.lastMovieTheaterShape !== null) {
            console.info(
              `[VR movie theater] ${VRSpike.lastMovieTheaterShape}` +
              ` held ${VRSpike.movieTheaterShapeFrames} composites -> ${shape}`
            );
          } else {
            console.info(`[VR movie theater] ${shape}`);
          }
          VRSpike.lastMovieTheaterShape = shape;
          VRSpike.movieTheaterShapeFrames = 0;
        }
        VRSpike.movieTheaterShapeFrames++;
      } catch {
        // Diagnostics must never disturb a movie.
      }
      VRSpike.movieHost.renderGui(renderer, movieScene, movieCamera);

      if (VRSpike.xrFrameRenderTarget) {
        renderer.setRenderTarget(VRSpike.xrFrameRenderTarget);
      }
      const previousAutoClear = renderer.autoClear;
      renderer.autoClear = true;
      // A prerendered movie is not something the player is standing inside, so
      // the world must not draw behind the theater. Rendering it did two
      // visible wrongs: the Peragus intro played on a screen floating in the
      // middle of the cargo bay, and the module is already loaded by then, so
      // the placeholder body was on show until T3-M4 spawned over it. Both
      // reported from a headset session.
      //
      // Flatscreen shows a movie fullscreen over black; hiding the world for
      // this one render is the VR equivalent and needs no change to when the
      // module loads. Authored cutscenes deliberately keep their surroundings
      // — there the player IS in the room the scene is reprojected from.
      const restoreWorld = hideWorldForTheater(worldScene, VRSpike.movieHost.object);
      try {
        renderer.render(worldScene, VRSpike.camera);
      } finally {
        restoreWorld();
      }
      VRSpike.perf.recordXRRender(frameTimestamp);
      renderer.autoClear = previousAutoClear;
    } catch (error) {
      VRSpike.movieHost?.clear();
      console.error('[VRSpike] movie theater presentation rejected', error);
    }
  }

  /**
   * Captures the authored dialogue camera and its authored caption/reply GUI
   * into one theater texture while leaving the headset camera under player
   * control. Keeping both layers on one surface prevents floating captions
   * and letterbox geometry from diverging from a camera cut.
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

    const captionContext = VRSpike.hooks?.getPanelContext?.();

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
        // Do not recursively capture a prior theater/panel surface. The
        // authored GUI below is rendered directly into movieHost's target.
        VRSpike.movieHost.object.visible = false;
        if (VRSpike.panelHost) VRSpike.panelHost.object.visible = false;
        const layers: LegacyPanelRenderLayer[] = [{
          scene: worldScene,
          camera: worldCamera,
        }];
        if (captionContext?.menu) {
          // Reapply the ray-derived legacy cursor immediately before the GUI
          // layer so an available reply remains visibly and semantically tied
          // to its row in the theater.
          captionContext.pointerSink.setPointerPosition(VRSpike.latestPanelPointerPosition);
          layers.push({
            scene: captionContext.guiScene,
            camera: captionContext.guiCamera,
            renderPass: captionContext.menu.getLegacyPanelRenderPass?.() ?? null,
          });
        } else {
          captionContext?.pointerSink.setPointerPosition(null);
        }
        //TEMPORARY (headset R4): the reported "cutscene shows only space" cases
        // are CUTSCENES, not movies — `[VR movie theater]` instruments
        // renderMovie and could never see them. A cutscene composites the world
        // through the authored camera into this same surface, so what matters
        // here is whether that camera has any visible geometry in front of it.
        // Reports transitions with how many composites each state held.
        try {
          let visibleMeshes = 0;
          worldScene.traverse((object) => {
            if ((object as THREE.Mesh).isMesh && object.visible) visibleMeshes++;
          });
          const shape = `visibleMeshes=${visibleMeshes} captions=${!!captionContext?.menu}` +
            ` cam=(${worldCamera.position.x.toFixed(1)},` +
            `${worldCamera.position.y.toFixed(1)},${worldCamera.position.z.toFixed(1)})`;
          if (shape !== VRSpike.lastCutsceneTheaterShape) {
            if (VRSpike.lastCutsceneTheaterShape !== null) {
              console.info(
                `[VR cutscene theater] ${VRSpike.lastCutsceneTheaterShape}` +
                ` held ${VRSpike.cutsceneTheaterShapeFrames} composites -> ${shape}`
              );
            } else {
              console.info(`[VR cutscene theater] ${shape}`);
            }
            VRSpike.lastCutsceneTheaterShape = shape;
            VRSpike.cutsceneTheaterShapeFrames = 0;
          }
          VRSpike.cutsceneTheaterShapeFrames++;
        } catch {
          // Diagnostics must never disturb an authored shot.
        }
        VRSpike.movieHost.renderGuiLayers(renderer, layers);
      } finally {
        VRSpike.movieHost.object.visible = movieVisible;
        if (VRSpike.panelHost) VRSpike.panelHost.object.visible = panelVisible;
      }
      // A previously-open generic panel must not remain as a second caption
      // plane beneath the theater. Its legacy menu state remains untouched;
      // only the duplicate VR presentation is released.
      VRSpike.panelHost?.clear();
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
    if (!VRSpike.keyboardDismissed) VRSpike.keyboardHost?.present(inputFrame.head);
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
    // Disabled by ROADMAP 4.8 — see INGAME_OVERLAY_PANEL_ENABLED.
    const context = VRSpike.INGAME_OVERLAY_PANEL_ENABLED
      ? (VRSpike.hooks?.getInGameOverlayContext?.() ?? null)
      : null;
    if (!renderer || !worldScene || !inputFrame || !context) {
      VRSpike.inGameOverlayHost?.clear();
      VRSpike.latestInGameOverlayPointerPosition = null;
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
      // GameState hides the legacy mouse cursor during ordinary XR play.
      // Reapply this frame's ray hit only for the GUI-to-texture pass, so the
      // overlay draws its own hover highlight under the VR pointer.
      context.pointerSink.setPointerPosition(VRSpike.latestInGameOverlayPointerPosition);
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

  /**
   * RE-ENABLED. Phase G assumed the engine overlay could replace this. It
   * cannot, and the assumption was wrong in a specific way worth recording.
   *
   * `InGameOverlay`'s action columns show only *authored* ActionMenu entries —
   * Security, Bash, Mine. Ordinary containers, consoles and placeables have
   * none (`rawActions=0`), and flatscreen opens those by clicking the object
   * in the 3D world, not by pressing a menu button. The columns supplement
   * object interaction; they do not provide it.
   *
   * So the overlay genuinely delivers the name plate, health, combat widgets
   * and authored actions — all confirmed working, `[VR targetUI] result=true` —
   * while this prompt supplies the primary "use the thing I am looking at"
   * route that has no overlay equivalent. Disabling it removed every
   * interaction with objects that have no authored actions, which is most of
   * them.
   *
   * Deleting this is blocked until VR has its own equivalent of the flatscreen
   * world click.
   */
  private static readonly BESPOKE_WORLD_PROMPT_ENABLED = true;

  /**
   * Phase G2/G3 reprojected the whole of `InGameOverlay` into VR as a panel.
   * Turned off by design decision 2026-08-23 (ROADMAP 4.8): the overlay is not
   * presented in VR at all.
   *
   * **Why.** Headset session 2 reported a full-size 2D UI appearing after any
   * interaction and then jumping to the position of whatever was interacted
   * with next. That is not a leak — it is this feature working as built:
   *
   * - `VRPanelHost.place()` runs only when the panel's owner changes, and the
   *   owner is the same `InGameOverlay` singleton every frame. So the panel is
   *   placed once, on the first frame the context is non-null, and world-locks
   *   there for the whole session.
   * - The panel material is `transparent`, so it is invisible until the GUI
   *   scene draws something. The target UI is gated on `_canShowTargetUI()`,
   *   which needs `CursorManager.selectedObject` — set only when VR aim lands
   *   on something interactable. Hence "appears after interacting".
   * - `InGameOverlay` lays its target UI out in **screen space**, at the
   *   projected 2D position of the selected object. Reprojected onto one fixed
   *   panel, that content lands wherever the object happened to project, so a
   *   new target makes the name plate and health bar jump.
   *
   * The overlay's own content is reachable without it: the action wheel's
   * `Menu` route opens `InGameOverlay` on its `BTN_CHAR` tab as a foreground
   * panel, and Cancel Combat is the wheel's `Clear Actions` wedge.
   *
   * Safe to disable because `BESPOKE_WORLD_PROMPT_ENABLED` is true — the
   * bespoke world prompt, not this overlay, is the live interaction surface.
   * If that flag is ever flipped off, this one must come back on first or VR
   * has no way to act on anything.
   */
  private static readonly INGAME_OVERLAY_PANEL_ENABLED = false;

  private static renderPanel(): void {
    const renderer = VRSpike.renderer;
    const worldScene = VRSpike.scene;
    const inputFrame = VRSpike.latestInputFrame;
    const context = VRSpike.hooks?.getPanelContext?.();
    if (VRSpike.hooks?.getKeyboardContext?.() && !VRSpike.keyboardDismissed) {
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
        context.viewportHeight,
        context.presentOptions ?? {}
      );
      // GameState deliberately hides the legacy mouse cursor during ordinary
      // XR play. Reapply the panel hit after simulation so the original cursor
      // is included only in this GUI-to-texture pass.
      context.pointerSink.setPointerPosition(VRSpike.latestPanelPointerPosition);
      // The composite is the expensive part of the panel, not its placement:
      // it draws the whole legacy GUI scene into a target up to 1536x1536, and
      // did so on every XR frame for as long as any menu stayed open. Placement
      // and the pointer sink above still run every frame — only the redraw is
      // gated. See VRPanelRepaintPolicy for what the gate can and cannot see.
      // Only this panel's own menu belongs in the composite. Restored in a
      // `finally` so a throwing render cannot leave the interface hidden.
      const restoreGuiRoots = hideGuiRootsForPanel(context.occludedGuiRoots);
      try {
        VRSpike.panelHost.renderGuiIfChanged(
          renderer,
          context.guiScene,
          context.guiCamera,
          context.menu.getLegacyPanelRenderPass?.() ?? null,
          VRSpike.latestPanelPointerPosition,
        );
      } finally {
        restoreGuiRoots();
      }
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

  /**
   * Marks the current combat target. While a wheel is open its frozen target
   * wins; otherwise this follows the soft-lock, including its aim-loss grace.
   */
  private static updateCombatTargetHighlight(): void {
    const worldScene = VRSpike.scene;
    const radialTargetId = VRSpike.radialMenuController.isOpen
      ? VRSpike.radialFrozenTargetId
      : null;
    const softLockTargetId = VRSpike.parseModuleObjectTargetId(
      VRSpike.combatTargetLock.getSnapshot().lockedTargetId ?? null,
    );
    const targetId = radialTargetId ?? softLockTargetId;
    if (!worldScene || targetId === null) {
      VRSpike.combatTargetHighlightHost?.clear();
      return;
    }
    try {
      const highlight = VRSpike.hooks?.getCombatTargetHighlight?.(targetId) ?? null;
      if (!highlight) {
        VRSpike.combatTargetHighlightHost?.clear();
        return;
      }
      if (!VRSpike.combatTargetHighlightHost) {
        VRSpike.combatTargetHighlightHost = new VRCombatTargetHighlightHost(worldScene);
      }
      VRSpike.combatTargetHighlightHost.present(highlight);
    } catch (error) {
      VRSpike.combatTargetHighlightHost?.clear();
      if (!VRSpike.combatTargetHighlightErrorReported) {
        VRSpike.combatTargetHighlightErrorReported = true;
        console.error('[VRSpike] combat target highlight rejected', error);
      }
    }
  }

  /**
   * Draws the blaster bolts and droid bursts the engine never produced.
   *
   * Driven from the render path rather than `processCombatInput`: a bolt in
   * flight and an expanding blast must keep animating and expire on time even
   * on frames where gameplay input is suspended (a cutscene starting, a module
   * transition), otherwise they freeze mid-air.
   */
  private static updateCombatVisuals(nowMs: number): void {
    const worldScene = VRSpike.scene;
    if (!worldScene) return;
    try {
      const context = VRSpike.hooks?.getCombatVisualSnapshots?.() ?? null;
      if (context) {
        for (const event of VRSpike.combatVisualObserver.observe(context.snapshots)) {
          if (event.kind === 'bolt') {
            if (!VRSpike.blasterBoltHost) {
              VRSpike.blasterBoltHost = new VRBlasterBoltHost(worldScene);
            }
            // The player's weapon is on their controller; their avatar - which
            // is where the engine thinks the weapon is - is hidden in first
            // person, so a bolt from there appears to come out of nowhere.
            // The player's own shots at a creature are drawn per trigger pull
            // instead (firePresentationShot), so a counted round must not add
            // a second. A Bash is the exception: its rounds against a door or
            // container resolve with no trigger to pull, so suppressing them
            // left the player seeing and hearing nothing while the lock took
            // damage — round 8: "bashing is a combat scene and requires the
            // sound and bolt animation".
            const isLocalShot = context.localActorId !== null && event.actorId === context.localActorId;
            if (VRSpike.session && isLocalShot && event.targetIsCreature) {
              continue;
            }
            let from = event.from;
            if (isLocalShot) {
              const rayAnchor = VRSpike.controllerAnchorHost?.getRayAnchor(VRSpike.dominantHand) ?? null;
              if (rayAnchor) from = rayAnchor.getWorldPosition(new THREE.Vector3());
            }
            VRSpike.blasterBoltHost.fire(
              { from, to: event.to, attackResult: event.attackResult },
              nowMs,
            );
            if (VRSpike.session && isLocalShot) context.playLocalShotSound?.();
          } else {
            if (!VRSpike.droidExplosionHost) {
              VRSpike.droidExplosionHost = new VRDroidExplosionHost(worldScene);
            }
            VRSpike.droidExplosionHost.detonate(event.at, nowMs);
          }
        }
      }
      VRSpike.blasterBoltHost?.update(nowMs);
      VRSpike.droidExplosionHost?.update(nowMs);
    } catch (error) {
      if (!VRSpike.combatVisualsErrorReported) {
        VRSpike.combatVisualsErrorReported = true;
        console.error('[VRSpike] combat visuals rejected', error);
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
      VRSpike.worldTargetLabelHost.update(
        indicator,
        VRSpike.latestInputFrame?.head?.position,
      );
    } catch (error) {
      VRSpike.worldTargetLabelHost?.clear();
      if (!VRSpike.worldTargetLabelErrorReported) {
        VRSpike.worldTargetLabelErrorReported = true;
        console.error('[VRSpike] world target label rejected', error);
      }
    }
  }

  private static renderWorldActionPrompt(): void {
    if (!VRSpike.BESPOKE_WORLD_PROMPT_ENABLED) {
      VRSpike.worldActionPromptHost?.clear();
      return;
    }
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

  private static sampleHeadHeight(frame: XRFrame, referenceSpace: XRReferenceSpace): void {
    if (VRSpike.headHeightBaselineMetres !== null) return;
    try {
      const y = frame.getViewerPose(referenceSpace)?.transform.position.y;
      // A head below 30 cm is tracking that has not settled, not a person.
      if (typeof y !== 'number' || !Number.isFinite(y) || y < 0.3 || y > 2.5) return;
      VRSpike.headHeightSamples.push(y);
      if (VRSpike.headHeightSamples.length < HEAD_HEIGHT_CALIBRATION_FRAMES) return;
      const sorted = [...VRSpike.headHeightSamples].sort((a, b) => a - b);
      VRSpike.headHeightBaselineMetres = sorted[Math.floor(sorted.length / 2)];
      VRSpike.headHeightSamples = [];
      const eye = VRSpike.hooks?.getEyeHeight?.() ?? null;
      console.info(
        `[VRSpike] head height calibrated: player ${VRSpike.headHeightBaselineMetres.toFixed(2)} m, ` +
        `character eye ${eye === null ? 'unknown' : eye.toFixed(2) + ' m'}`
      );
    } catch {
      // Calibration is best-effort; without it the rig keeps the raw floor.
    }
  }

  /**
   * How far to raise or lower the rig so the camera sits at the CHARACTER's
   * eye height rather than the player's own.
   *
   * The design fixes a canonical eye height per character. Relying on the
   * runtime's floor alone put the camera wherever the player's head happened to
   * be: the round-5 run measured 1.08 m above the play-space floor, which felt
   * right as T3-M4 — a metre-tall droid — and sat at the Exile's torso.
   * Movement relative to the calibrated baseline still passes straight through,
   * so crouching and leaning work, and a seated player gets the same view.
   */
  private static resolveEyeHeightOffset(): number {
    const baseline = VRSpike.headHeightBaselineMetres;
    if (baseline === null) return 0;
    const eye = VRSpike.hooks?.getEyeHeight?.() ?? null;
    if (eye === null || !Number.isFinite(eye)) return 0;
    return eye - baseline;
  }

  /**
   * Put the rig where the player is standing. Height comes from the floor, not
   * from the follower camera, which sits well above the head and pitched down.
   */
  private static syncRig(worldCamera: THREE.Camera): void {
    const rig = VRSpike.rig;
    if (!rig) return;

    const now = performance.now();
    const resumedAfterGap = now - VRSpike.lastRigSyncMs > VRSpike.RIG_RESUME_ANCHOR_MS;
    VRSpike.lastRigSyncMs = now;

    // Orientation first: the head's offset from the rig origin is measured
    // through this frame's rotation, so every correction below agrees with the
    // pose the headset will actually render from.
    // Z-up conversion first, then yaw about the world's up axis. Order matters
    // — yaw is applied in world space.
    const facing = VRSpike.hooks?.getFacing() ?? 0;
    XRCoordinateConverter.applyXRToGameBasis(rig);
    rig.rotateOnWorldAxis(
      new THREE.Vector3(0, 0, 1),
      // FollowerCamera.facing is the orbit bearing. KOTOR renders its camera
      // and drives forward creature movement at bearing + 90 degrees.
      facing + Math.PI / 2 + VRSpike.yawOffset + VRSpike.turnYaw
    );

    const feet = VRSpike.hooks?.getPlayerPosition() ?? null;
    const localHead = VRSpike.latestLocalHeadPosition;
    const headOffset = localHead ? localHead.clone().applyQuaternion(rig.quaternion) : null;
    if (headOffset && feet && (VRSpike.rigAnchorPending || resumedAfterGap)) {
      // Seat the head directly over the avatar, as a positional recenter does.
      // Whatever offset the player's place in the room built up belongs to the
      // spot they stood on before; after a load, a cutscene or a movie the
      // engine has usually put the avatar somewhere new.
      VRSpike.turnOriginOffset.set(-headOffset.x, -headOffset.y, 0);
      VRSpike.rigAnchorPending = false;
    } else if (headOffset && VRSpike.lastRigFacing !== null && facing !== VRSpike.lastRigFacing) {
      // The engine turned its follower camera — ModuleArea.loadScene aims it on
      // arrival, and conversation focus eases it — and the rig yaw follows.
      // Turning the rig about its origin swings a head that stands away from
      // that origin through an arc; turn about the head instead, exactly as
      // applyTurnAroundHead does for the player's own turning. Measured in the
      // emulator with the head 1.2 m off-centre: an unanswered 1.5 rad facing
      // change moved the view 1.64 m with no input at all, into the Ebon Hawk's
      // hull on the exterior walkway (round 7).
      const previousHeadOffset = localHead!.clone().applyQuaternion(
        new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(0, 0, 1), VRSpike.lastRigFacing - facing)
          .multiply(rig.quaternion)
      );
      VRSpike.turnOriginOffset.x += previousHeadOffset.x - headOffset.x;
      VRSpike.turnOriginOffset.y += previousHeadOffset.y - headOffset.y;
    }
    VRSpike.lastRigFacing = facing;

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
    rig.position.z += VRSpike.resolveEyeHeightOffset();
    VRSpike.rigSyncedThisSession = true;

    // Soft-block on wall intrusion (ROADMAP 2.4): the joystick-driven avatar
    // body is already walkmesh-collision-checked, but physical room-scale
    // head tracking is layered on top of the rig placed above and isn't —
    // the player's real footsteps can put their head past a wall the avatar
    // never reached. Nudge the rig back by exactly the delta needed.
    //
    // The head is taken at THIS frame's rig, not from `latestInputFrame`. That
    // one was built through last frame's rig, which already carried last
    // frame's correction, so the head looked inside the wall, no correction
    // was applied, the next frame it looked outside again, and so on: the view
    // alternated between two places every frame. Measured in the emulator at
    // 0.26 m per frame with the head 1.2 m off-centre and 1.07 m per frame at
    // 3.5 m — the uncontrollable shaking reported on the Ebon Hawk (round 7).
    if (headOffset && feet) {
      const probe = new THREE.Vector3(
        rig.position.x + headOffset.x,
        rig.position.y + headOffset.y,
        feet.z,
      );
      const floor = VRSpike.hooks?.getSoftBlockFloor?.(feet.z) ??
        VRSpike.hooks?.getCurrentRoomWalkmesh?.() ?? null;
      const correction = resolveWallSoftBlockCorrection(probe, floor);
      if (correction) {
        rig.position.x += correction.x;
        rig.position.y += correction.y;
      }
    }
  }

  static startInputRecording(metadata?: Partial<VRTraceMetadata>): void {
    VRSpike.inputRecorder.start(metadata, performance.now());
  }

  static stopInputRecording(): VRTraceRecording {
    return VRSpike.inputRecorder.stop(performance.now());
  }

  static playInputTrace(recording: VRTraceRecording, options?: VRPlayerOptions): void {
    VRSpike.tracePlayer.load(recording, options);
    VRSpike.tracePlayer.play(performance.now(), options);
  }

  static stopInputTracePlayback(): void {
    VRSpike.tracePlayer.stop();
  }

  static toggleInteractionGizmos(): boolean {
    if (VRSpike.scene && !VRSpike.interactionGizmoHost) {
      VRSpike.interactionGizmoHost = new VRInteractionGizmoHost(VRSpike.scene);
    }
    return VRSpike.interactionGizmoHost ? VRSpike.interactionGizmoHost.toggle() : false;
  }

  static setInteractionGizmosEnabled(enabled: boolean): void {
    if (VRSpike.scene && !VRSpike.interactionGizmoHost) {
      VRSpike.interactionGizmoHost = new VRInteractionGizmoHost(VRSpike.scene);
    }
    VRSpike.interactionGizmoHost?.setEnabled(enabled);
  }

  static isInteractionGizmosEnabled(): boolean {
    return VRSpike.interactionGizmoHost?.isEnabled() ?? false;
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
