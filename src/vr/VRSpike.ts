import { isUsableXRPose } from './runtime/XRTypes';
import * as THREE from "three";
import { XRCoordinateConverter } from "./runtime/XRCoordinateConverter";
import { HeadHeightCalibration } from './runtime/HeadHeightCalibration';
import { XRControllerAnchorHost } from "./runtime/XRControllerAnchorHost";
import type { HeldItemVisualDescriptor } from "./runtime/XRControllerAnchorHost";
import type { VRHandModelLoader } from "./runtime/hands/VRHandModel";
import { XRGamepadReader } from "./runtime/XRGamepadReader";
import { XRInputFrameBuilder } from "./runtime/XRInputFrameBuilder";
import { VRPointerPoseSmoother } from "./runtime/VRPointerPoseSmoother";
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
import { PerfLayerGate } from "@/vr/PerfLayerGate";
import { VRPanelPointerHost } from "./runtime/VRPanelPointerHost";
import { VRPointerHandResolver } from "./runtime/VRPointerHandResolver";
import { VRKeyboardHost } from "./runtime/VRKeyboardHost";
import { VRKeyboardInputController } from "./runtime/VRKeyboardInputController";
import { VR_KEYBOARD_DONE_KEY } from "./runtime/VRKeyboardLayout";
import { VRCombatInputController, VRCombatSwingEvent } from "./runtime/VRCombatInputController";
import { VRCombatTargetLock } from "./runtime/VRCombatTargetLock";
import { isVRWeaponHandOnTarget, VRForceGesture, VRForceGestureController } from "./runtime/VRForceGestureController";
import { VRForceCastGesture, VRForceCastGestureController } from "./runtime/VRForceCastGestureController";
import { VRConsumableUseGesture, VRConsumableUseGestureController } from "./runtime/VRConsumableUseGestureController";
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
import { hideWorldForTheater, revealVRInterfaceOverHiddenWorld } from "./runtime/VRTheaterWorldVisibility";
import { hidePlayerBodyForFirstPerson, isCameraInsideBody } from "./runtime/VRFirstPersonBody";
import { hideGuiRootsForPanel } from "./runtime/VRPanelSceneVisibility";
import { VRComfortSettingsHost, VRComfortSettingsRow } from "./runtime/VRComfortSettingsHost";
import { VRRecenterHoldGate } from "./runtime/VRRecenterHoldGate";
import { ActionApproachPolicy } from "@/engine/interaction/ActionApproachPolicy";
import { VRHiltTimerHost } from "./runtime/VRHiltTimerHost";
import { VRWeaponStanceHost } from "./runtime/VRWeaponStanceHost";
import { VRCombatTargetHighlightHost, type VRCombatTargetHighlight } from "./runtime/VRCombatTargetHighlightHost";
import { VRBlasterLaserHost } from "./runtime/VRBlasterLaserHost";
import {
  measureVRCombatAim,
  type VRCombatAimCandidate,
} from "./runtime/VRCombatAimResolver";
import {
  VRCombatVisualEventObserver,
  VRCombatAttackResultObserver,
  VR_MUZZLE_HEIGHT_METRES,
  type VRCombatActorSnapshot,
} from "./runtime/VRCombatVisualEvents";
import { BOLT_TRAVEL_MS, VRBlasterBoltHost } from "./runtime/VRBlasterBoltHost";
import { VRBladeSparkHost } from "./runtime/VRBladeSparkHost";
import { resolveVRCombatFeedback } from "./runtime/VRCombatFeedback";
import { VRPanelStickScroll } from "./runtime/VRPanelStickScroll";
import { VRControlsGuideHost } from "./runtime/VRControlsGuide";
import { VRCombatCueAudio, cueForVRCombatOutcome, type VRCombatCue, type VRCombatCueWeapon, type VRCombatCueSoundLoader, type VRCombatCuePlayOptions } from "./runtime/VRCombatCueAudio";
import { VRHealthPlateHost, type VRPlayerVitals } from "./runtime/VRHealthPlateHost";
import { VRDamageFeedbackTracker, type VRDamageEvent } from "./runtime/VRDamageFeedback";
import { VRDamageFlashHost } from "./runtime/VRDamageFlashHost";
import { VRHurtPresentationGate } from "./runtime/VRHurtPresentationGate";
import { shouldVoiceTargetPain, VRStrokeResultLedger, type VRCombatBarkKind, type VRStrokeShape } from "./runtime/VRCombatVoicing";
import { VRRefusalNoticeHost, describeVRRefusal } from "./runtime/VRRefusalNoticeHost";
import { VRPauseIndicatorHost } from "./runtime/VRPauseIndicatorHost";
import type { VRHapticPattern } from "./runtime/VRHapticFeedback";
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
import { VRDesktopMirror, readMirrorOptionsFromSearch } from './runtime/VRDesktopMirror';

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
/** How far an untargeted presentation shot travels. */
const PRESENTATION_SHOT_RANGE_METRES = 20;
/** ROADMAP 3.12 — light enough to sit under the combat feedback 3.13 will add. */
const ROUND_READY_HAPTIC = { durationMs: 25, amplitude: 0.25 } as const;
/** Engine `AttackResult.DEFLECTED`. */
const DEFLECTED_ATTACK_RESULT = 9;
const CRITICAL_ATTACK_RESULT = 2;
/** HIT_SUCCESSFUL, CRITICAL_HIT, AUTOMATIC_HIT. */
const HIT_ATTACK_RESULTS: ReadonlySet<number> = new Set([1, 2, 3]);
/** ROADMAP 3.14. Stronger than anything the player's own attacks produce, bar a critical. */
const DAMAGE_HAPTIC = { durationMs: 70, amplitude: 0.7 } as const;
const DAMAGE_CRITICAL_HAPTIC = { durationMs: 120, amplitude: 1 } as const;
const DAMAGE_UNATTRIBUTED_HAPTIC = { durationMs: 40, amplitude: 0.4 } as const;
/** How far along the weapon a clash or deflection is drawn, from the grip. */
const BLADE_CONTACT_DISTANCE_METRES = 0.55;
const DEFLECTION_REBOUND_METRES = 6;

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
  /**
   * Show the theater over black, as a movie is: the conversation moves the
   * player, so the room around them is about to change (round 15).
   */
  readonly hideWorld?: boolean;
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
  /** Unit wall normals the player touched in the last 600 ms (wall-slide steadying). */
  getRecentWallNormals?: () => readonly { x: number; y: number }[];
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
  /** Where combat cue sounds go: the engine's audio context and GUI channel. */
  getCombatCueAudioOutput?: () => { context: BaseAudioContext; destination: AudioNode; loadSound: VRCombatCueSoundLoader } | null;
  /** Every retail sound the combat cues may use, so the first of each is not late. */
  getCombatCuePreloadSounds?: () => string[];
  /** Why the player cannot act right now (stunned, knocked down, ...), or null. */
  getPlayerDisabledState?: () => string | null;
  /** TEMPORARY (round 18, issue 6): who the current dialogue shot frames, for the theater log. */
  describeCutsceneShot?: () => string;
  /** The attacker's own weaponsounds.2da sounds for a cue, and where it happened. */
  resolveCombatCueSounds?: (attackerId: string | number, targetId: string | number, cue: VRCombatCue, stroke?: VRStrokeShape) => VRCombatCuePlayOptions | null;
  /** A creature's own retail soundset line (Part D): the PC's in the head, anyone else's at them. */
  resolveCombatBark?: (creatureId: string | number, kind: VRCombatBarkKind) => VRCombatCuePlayOptions | null;
  /** The controlled character's HP and FP, for the wrist plate. */
  getPlayerVitals?: () => VRPlayerVitals | null;
  setComfortSettings?: (patch: Partial<VRComfortSettings>) => void;
  /**
   * Flips the player between the engine's walk and run rates. The rates and the
   * `walk` flag already exist on the creature and already feed
   * `getMovementSpeed()`; only VR had no way to reach them.
   */
  toggleWalkRun?: () => void;
  /** Toggles the engine's own pause, as the flatscreen pause control does. */
  togglePause?: () => void;
  /** ROADMAP 3.18 — true while the player has the game paused. */
  isPaused?: () => boolean;
  setPaused?: (paused: boolean) => void;
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
  /**
   * True while the player's real head height, not the session's calibrated
   * baseline, should place the eyes: a seated vehicle, where the eyes belong
   * at the rider's exactly, whatever posture the player entered VR in.
   */
  useLiveHeadHeight?: () => boolean;
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
  /** The id of the creature the player controls (party[0]); changes on a leader switch. */
  getControlledActorId?: () => number | null;
  /** True when the id is a dead creature (a corpse the interaction ray found). */
  isDeadCreature?: (id: number) => boolean;
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
    /** Anyone else's weapon report, at the shooter (Spark Finding 3: enemy fire was silent). */
    playShotSound?(actorId: number): void;
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
    /** T-B: attacks the running round still holds, drawn as pips on the hilt. */
    readonly roundAttackPips?: import('./runtime/VRRoundStrokeBudget').VRRoundAttackPips;
    /** Two melee weapons are held: the off hand's own strokes are watched. */
    readonly offhandStrokeAvailable?: boolean;
    /** T-B: a stroke of the off-hand weapon; it spends the round's off-hand attack. */
    onOffhandStroke?(event: VRCombatSwingEvent): void;
    /**
     * T-B: an off-hand blaster's trigger pull. 'spent' and 'absorbed' consume
     * the pull; 'pass' lets it count as a pull of either trigger, as before.
     */
    onOffhandShot?(): 'spent' | 'absorbed' | 'pass';
    /** Returns true only when the gesture was spent on a queued Push/Pull. */
    onDirectionalForceGesture?(gesture: VRForceGesture): boolean;
    /**
     * ROADMAP 3.19 — an open-palm off-hand thrust toward the locked target.
     * Returns true only when it released the queued Force power at the head.
     */
    onForceCastGesture?(gesture: VRForceCastGesture): boolean;
    /**
     * Part F: an input VR could not spend - a Force gesture with the weapon
     * hand off the target, a trigger pull with nothing locked. The host
     * decides whether it was meant for something queued (the refused tick).
     */
    onRefusedInput?(input: 'push' | 'pull' | 'cast' | 'idle-trigger'): void;
    /** ROADMAP 3.20 — true while a medpac, stim or repair kit is armed in the off hand. */
    readonly armedConsumable?: boolean;
    /** The armed consumable was held to the neck. Returns true when the engine spent it. */
    onConsumableUseGesture?(gesture: VRConsumableUseGesture): boolean;
    onGrenadeTrigger?(): void;
    /**
     * True when the off hand holds a ranged weapon and no grenade is armed, so
     * the off-hand trigger shoots instead of throwing.
     */
    readonly offhandShotAvailable?: boolean;
    /**
     * ROADMAP 3.16 — the capsule a melee swing must pass through to count.
     * Null without a target; absent keeps the speed-only rule.
     */
    readonly nominatedTargetVolume?: import('./runtime/VRCombatInputController').VRCombatTargetVolume | null;
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
  /**
   * Services the player's round once per frame (round 18: player-paced
   * rounds). `released` is true on the frame a silently held stroke landed;
   * `armed` while one is still held for the round a moment away.
   */
  serviceCombatSwingBuffer?: () => { readonly released: boolean; readonly armed: boolean } | null;
  /** Whether the game is paused for any reason, the VR Menu's own pause included. */
  isEnginePaused?: () => boolean;
  /**
   * The player picked an entry from a world prompt: which prompt (its
   * candidate id) and the entry's label. A swing bashes only a target the
   * player chose Bash on (Allen, 2026-09-26).
   */
  noteWorldPromptSelection?: (promptId: string | null, label: string) => void;
  /**
   * ROADMAP 3.17 — a locked door or container the weapon hand is aimed at and
   * the player has chosen Bash on, which a melee swing through `volume`, or a
   * blaster's trigger pull, bashes by the authored route.
   */
  getWeaponBashContext?: (aimedTargetId: number | null) => {
    readonly actorId: string;
    readonly targetId: string;
    readonly weaponMode: import('./runtime/XRTypes').CombatWeaponMode;
    readonly volume: import('./runtime/VRCombatInputController').VRCombatTargetVolume;
    bash(): boolean;
  } | null;
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
   * angle, the comfort vignette, and since 3.18 Damage Flash and Unpause on
   * Wheel Close. Opened from the action wheel; the panel lays out one to
   * `VR_COMFORT_SETTINGS_MAX_ROWS` rows.
   */
  getComfortSettingsPanelContext?: () => {
    readonly rows: readonly VRComfortSettingsRow[];
    /** The controls guide is open beside the panel. */
    readonly controlsGuide?: boolean;
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
  /** Hides the engine's cursor brackets on non-hostile creatures while in combat. */
  hideCombatNonHostileReticles?: () => void;
}

/** How long B must be held to cancel combat; a tap is Pause (round 15, PF4). */
const VR_COMBAT_CANCEL_HOLD_MS = 600;

/** Thumbstick deadzone for walking and smooth turning. */
const VR_STICK_DEADZONE = 0.15;
function applyStickDeadzone(magnitude: number): number {
  if (!Number.isFinite(magnitude) || magnitude <= VR_STICK_DEADZONE) return 0;
  return Math.min(1, (magnitude - VR_STICK_DEADZONE) / (1 - VR_STICK_DEADZONE));
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
   * the first steady frames of a session, again on every recenter, and raised
   * when the player stands up after it (see HeadHeightCalibration).
   */
  private static readonly headHeight = new HeadHeightCalibration();
  /** XR frames the cutscene theater has presented; even frames refresh it. */
  private static cutsceneTheaterFrame = 0;
  /**
   * The theater spans ~56 degrees at 2.25 m, about 1,100 headset pixels
   * across, so 1280 x 720 loses nothing visible against the 1536 default.
   */
  private static readonly THEATER_PANEL_OPTIONS = {
    distanceMetres: 2.25,
    widthMetres: 2.4,
    maximumTextureWidth: 1280,
    maximumTextureHeight: 720,
  };
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
  static miniGameInput: {
    update: (frame: XRInputFrame | null) => void;
    reset: () => void;
    /** Re-pins held hands against the vehicle as it is *after* this frame's engine tick. */
    refreshPins?: () => void;
  } | null = null;
  private static readonly inputRouter = new XRInputRouter();
  private static readonly pointerPoseSmoother = new VRPointerPoseSmoother();
  static readonly inputRecorder = new VRInputRecorder();
  static readonly tracePlayer = new VRTracePlayer();
  private static dominantHand: XRHandRole = 'right';
  /** The weapon hand the player chose (ROADMAP 3.15). */
  static get currentDominantHand(): XRHandRole { return VRSpike.dominantHand; }
  private static controlsGuideHost: VRControlsGuideHost | null = null;
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
  // The lock outlives a glance away for 2.5 s: at 0.5 s turning the head
  // dropped it, and the next cast thrust failed silently (critic run 12).
  private static readonly combatTargetLock = new VRCombatTargetLock({ switchDwellMilliseconds: 400, aimLossGraceMilliseconds: 2500 });
  private static offhandGrenadeTriggerHeld = false;
  private static steadiedFeet: THREE.Vector3 | null = null;
  private static lastControlledActorId: number | null | undefined = undefined;
  private static steadiedRawFeet: THREE.Vector3 | null = null;

  /**
   * Sliding along a wall the engine pushes the player into it and back out
   * every frame, and the camera copied it: a 15 Hz, 1-4 cm sideways buzz, and
   * 10 cm lurches at corners (critic runs 17-18). While a wall was touched in
   * the last 600 ms, the camera follows motion along the wall in full and
   * motion into or away from it at a quarter rate, never more than 8 cm
   * behind the player.
   */
  private static steadyFeetAtWalls(feet: THREE.Vector3, snap: boolean): THREE.Vector3 {
    const previous = VRSpike.steadiedFeet;
    const lastRaw = VRSpike.steadiedRawFeet;
    VRSpike.steadiedRawFeet = feet.clone();
    let normals: readonly { x: number; y: number }[] = [];
    try { normals = VRSpike.hooks?.getRecentWallNormals?.() ?? []; } catch { normals = []; }
    if (!previous || !lastRaw || snap || previous.distanceTo(feet) > 0.5) {
      VRSpike.steadiedFeet = feet.clone();
      return VRSpike.steadiedFeet;
    }
    // The player's own step this frame, always taken in full along the wall.
    const delta = feet.clone().sub(lastRaw);
    for (const n of normals) {
      const along = delta.x * n.x + delta.y * n.y;
      delta.x -= n.x * along * 0.75;
      delta.y -= n.y * along * 0.75;
    }
    const next = previous.clone().add(delta);
    // Any lag left from the wall eases out: a quarter per frame at a wall,
    // faster once off it.
    const ease = normals.length ? 0.1 : 0.35;
    next.x += (feet.x - next.x) * ease;
    next.y += (feet.y - next.y) * ease;
    next.z = feet.z;
    const lag = Math.hypot(feet.x - next.x, feet.y - next.y);
    if (lag < 0.002) {
      next.x = feet.x; next.y = feet.y;
    } else if (lag > 0.08) {
      const k = 0.08 / lag;
      next.x = feet.x + (next.x - feet.x) * k;
      next.y = feet.y + (next.y - feet.y) * k;
    }
    VRSpike.steadiedFeet = next;
    return next;
  }
  private static pausedUseNoticeAt = Number.NEGATIVE_INFINITY;
  /** The off hand was last at the neck (a medpac): no palm cast just after. */
  private static offhandBusyAt = Number.NEGATIVE_INFINITY;
  /** Follows the off hand for a few seconds after a grenade trigger, as the projectile's launch point. */
  private static readonly throwHandAnchor = new THREE.Object3D();
  private static throwHandAnchorUntil = Number.NEGATIVE_INFINITY;
  private static throwHandRole: XRHandRole | null = null;

  /** The off-hand anchor while a throw is in flight, else null. */
  static resolveThrowHandAnchor(): THREE.Object3D | null {
    if (!VRSpike.isPresenting || performance.now() > VRSpike.throwHandAnchorUntil) return null;
    return VRSpike.throwHandAnchor;
  }

  private static updateThrowHandAnchor(inputFrame: XRInputFrame | null): void {
    if (!VRSpike.throwHandRole || performance.now() > VRSpike.throwHandAnchorUntil) return;
    const pose = inputFrame?.hands?.[VRSpike.throwHandRole]?.pose;
    if (!pose?.position) return;
    VRSpike.throwHandAnchor.position.copy(pose.position);
    VRSpike.throwHandAnchor.updateMatrixWorld(true);
  }
  private static dominantShotTriggerHeld = false;
  /** The weapon trigger was down on the last frame with nothing locked (Part F refused tick). */
  private static idleTriggerHeld = false;
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
  private static readonly attackResultObserver = new VRCombatAttackResultObserver();
  private static bladeSparkHost: VRBladeSparkHost | null = null;
  private static readonly damageTracker = new VRDamageFeedbackTracker();
  /** Part D1: a hit on the player is shown when the blow lands, not at the roll. */
  private static readonly hurtGate = new VRHurtPresentationGate({ boltTravelMs: BOLT_TRAVEL_MS });
  /** The hit points the player is shown while a hit is held (null: live). */
  private static shownHitPoints: number | null = null;
  private static damageFlashHost: VRDamageFlashHost | null = null;
  private static combatCueAudio: VRCombatCueAudio | null = null;
  private static readonly panelStickScroll = new VRPanelStickScroll();
  private static panelStickScrollAt: number | null = null;
  private static combatCueAudioErrorReported = false;
  private static healthPlateHost: VRHealthPlateHost | null = null;
  private static pauseIndicatorHost: VRPauseIndicatorHost | null = null;
  /** The wheel was open during a player pause, for the unpause-on-close option. */
  private static radialOpenWhilePaused = false;
  private static combatVisualsErrorReported = false;
  private static cutsceneFadeHost: VRCutsceneFadeHost | null = null;
  private static readonly cutsceneFadeEnvelope = new VRCutsceneFadeEnvelope();
  /** A leader switch's fade back from black, in ms (Anchor run 2, option C1). */
  static LEADER_SWITCH_FADE_MS = 150;
  private static leaderSwitchFade: VRCutsceneFadeEnvelope | null = null;
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

  /**
   * A haptic pulse on one hand, for gameplay that has no session of its own -
   * the swoop's bumps and boosts. Safe outside a session: it does nothing.
   */
  static pulseHand(hand: XRHandRole, pattern: { durationMs: number; amplitude: number }): void {
    const session = VRSpike.session;
    if (!session) return;
    void VRSpike.haptics.pulse(session, hand, pattern);
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
  // Two fast samples within 120 ms: one-frame pops and wrist snaps are not swings (critic runs 13-15).
  private static readonly combatInputController = new VRCombatInputController({ minimumFastSamples: 2 });
  /** T-B: the off hand's own strokes, watched only while two melee weapons are held. */
  private static readonly offhandCombatInputController = new VRCombatInputController({ minimumFastSamples: 2 });
  /** An off-hand blaster pull already taken by the off-hand attack, until it is released. */
  private static offhandPullTaken = false;

  private static resetCombatStrokeDetectors(): void {
    VRSpike.combatInputController.reset();
    VRSpike.offhandCombatInputController.reset();
  }
  private static readonly forceGestureController = new VRForceGestureController();
  private static readonly forceCastGestureController = new VRForceCastGestureController();
  private static readonly consumableUseGestureController = new VRConsumableUseGestureController();
  private static readonly radialMenuController = new VRRadialMenuController();
  private static readonly haptics = new VRHapticFeedback();
  private static radialMenuHost: VRRadialMenuHost | null = null;
  private static readonly radialRayHand = new VRPointerHandResolver();
  /** The hand whose menu button opened the wheel; its ray owns the hover. */
  private static radialOpenerHand: XRHandRole | null = null;
  private static radialOpeningHeadPose: XRWorldPose | null = null;
  private static radialMenuPressedLastFrame = false;
  private static comfortSettingsHost: VRComfortSettingsHost | null = null;
  private static comfortSettingsPointerHost: VRPanelPointerHost | null = null;
  private static readonly comfortSettingsPointerHand = new VRPointerHandResolver();
  private static comfortSettingsSelectHeld = false;
  /** When B went down this press, for tap (Pause) versus hold (cancel combat). */
  private static pauseDownAt: number | null = null;
  /** This B press was used by a panel (closing the VR Menu) and must not pause. */
  private static pausePressConsumed = false;
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

    // Perf bisect (?perflayer=l0..l5): URL-only, absent means layer 5, the
    // normal game. The engine switch points read PerfLayerGate.
    PerfLayerGate.configure(typeof window !== 'undefined' ? window.location.search : '');
    if (PerfLayerGate.active()) {
      console.log(`[VRSpike] perf layer: l${PerfLayerGate.layer}`);
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
    btn.textContent = supported ? 'Enter VR' : unavailableText;
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
    if (update.changed) VRSpike.reportControllerHapticsOnce(sources);
  };

  private static reportedHapticsTopologies = new Set<string>();

  /**
   * TEMPORARY (round 12, C2): no haptics were felt and every pulse found no
   * actuator. Names, once per controller set, exactly what each gamepad
   * exposes so the next round's log says which API this runtime offers.
   * Remove once haptics are confirmed in the headset.
   */
  private static reportControllerHapticsOnce(sources: readonly XRInputSource[]): void {
    try {
      const rows = sources.map((source) => {
        const gamepad = source.gamepad as (Gamepad & {
          hapticActuators?: readonly unknown[];
          vibrationActuator?: { type?: string; effects?: readonly string[]; playEffect?: unknown; pulse?: unknown } | null;
        }) | undefined;
        const actuators = gamepad?.hapticActuators;
        const vibration = gamepad?.vibrationActuator;
        return `${source.handedness}: profiles=${[...source.profiles].join(',')} ` +
          `hapticActuators=${actuators ? actuators.length : 'none'}` +
          `${actuators && actuators[0] ? ` pulse=${typeof (actuators[0] as { pulse?: unknown }).pulse}` : ''} ` +
          `vibrationActuator=${vibration ? `type=${vibration.type ?? '?'} effects=${(vibration.effects ?? []).join('|')} ` +
            `playEffect=${typeof vibration.playEffect} pulse=${typeof vibration.pulse}` : 'none'}`;
      });
      const key = rows.join(' ; ');
      if (VRSpike.reportedHapticsTopologies.has(key)) return;
      VRSpike.reportedHapticsTopologies.add(key);
      console.info(`[VRSpike] TEMPORARY controller haptics: ${key}`);
    } catch {
      // Diagnostics must never break input handling.
    }
  }

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
    VRSpike.pointerPoseSmoother.reset();
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
    VRSpike.resetCombatStrokeDetectors();
    VRSpike.combatTargetLock.clear();
    VRSpike.offhandGrenadeTriggerHeld = false;
    VRSpike.hooks?.resetCombatInteraction?.();
    VRSpike.forceGestureController.reset();
    VRSpike.forceCastGestureController.reset();
    VRSpike.consumableUseGestureController.reset();
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
    VRSpike.headHeight.reset();
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
    VRSpike.resetCombatStrokeDetectors();
    VRSpike.forceGestureController.reset();
    VRSpike.forceCastGestureController.reset();
    VRSpike.consumableUseGestureController.reset();
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
    VRSpike.attackResultObserver.reset();
    VRSpike.bladeSparkHost?.dispose();
    VRSpike.bladeSparkHost = null;
    VRSpike.damageTracker.reset();
    VRSpike.hurtGate.reset();
    VRSpike.shownHitPoints = null;
    VRSpike.damageFlashHost?.dispose();
    VRSpike.damageFlashHost = null;
    VRSpike.healthPlateHost?.dispose();
    VRSpike.healthPlateHost = null;
    VRSpike.pauseIndicatorHost?.dispose();
    VRSpike.pauseIndicatorHost = null;
    VRSpike.refusalNoticeHost?.dispose();
    VRSpike.refusalNoticeHost = null;
    VRSpike.radialOpenWhilePaused = false;
    VRSpike.cutsceneFadeHost?.dispose();
    VRSpike.cutsceneFadeHost = null;
    VRSpike.cutsceneFadeEnvelope.reset();
    VRSpike.lastCutsceneCamera = null;

    const btn = document.getElementById('vr-spike-button');
    if (btn) btn.textContent = 'Enter VR';

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
    if (foregroundSurfaceOwnsInput || radialOwnsInput || lifecycleSuspendsGameplayInput) {
      VRSpike.holdCombatCancelOutsideWorld();
    }
    if (!foregroundSurfaceOwnsInput) {
      VRSpike.processLocomotionInput(timestamp, frame, !radialOwnsInput);
      if (radialOwnsInput) {
        VRSpike.captureWeaponActionLatch();
        VRSpike.interactionTargetSet.clear();
        VRSpike.interactionSystem.cancelTransientState();
        if (!lifecycleSuspendsGameplayInput) VRSpike.serviceHeldSwingBehindWheel();
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
    VRSpike.updatePauseState(foregroundSurfaceOwnsInput, radialOwnsInput);
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

  /**
   * The headset view on the desktop window, for OBS window capture and for
   * `tools/vr-emulator/screenshot.js`. Options come from the page URL
   * (`?mirror=off`, `?mirrorFps=30`, `?mirrorEye=right`, `?mirrorZoom=1.2`) and
   * can be changed live with `tools/vr-emulator/mirror.js`.
   */
  static readonly desktopMirror = (() => {
    const mirror = new VRDesktopMirror();
    if (typeof location !== 'undefined') Object.assign(mirror, readMirrorOptionsFromSearch(location.search));
    return mirror;
  })();


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
      const recordedPointerPose = inputFrame !== null;

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
      VRSpike.updateThrowHandAnchor(inputFrame);
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
      // Recorded frames already contain the filtered ray; avoid filtering a
      // replay a second time and changing its authored interaction targets.
      const pointerFrame = inputFrame && !recordedPointerPose
        ? VRSpike.pointerPoseSmoother.smoothFrame(inputFrame, rig)
        : inputFrame;
      const aimedFrame = (presentationOwnsView || !pointerFrame)
        ? pointerFrame
        : VRSpike.alignRaysToHeldWeapons(pointerFrame, VRSpike.controllerAnchorHost);
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
    VRSpike.pointerPoseSmoother.reset();
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
    VRSpike.forceCastGestureController.reset();
    VRSpike.consumableUseGestureController.reset();
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
      // ROADMAP 3.15: the pointer follows the dominant-hand setting.
      const dominantHand = VRSpike.latestInputFrame.hands[VRSpike.dominantHand];
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
      // The pointer hand's stick scrolls the list under the pointer.
      if (pointerHit && dominantHand) {
        const now = performance.now();
        const deltaSeconds = VRSpike.panelStickScrollAt === null ? 0 : (now - VRSpike.panelStickScrollAt) / 1000;
        VRSpike.panelStickScrollAt = now;
        const axes = dominantHand.axes ?? [];
        const stickY = Number.isFinite(axes[3]) ? axes[3] : (axes[1] ?? 0);
        const rows = VRSpike.panelStickScroll.update(stickY, deltaSeconds);
        if (rows !== 0) context.pointerSink.scrollPointer?.(rows);
      } else {
        VRSpike.panelStickScroll.reset();
        VRSpike.panelStickScrollAt = null;
      }
      const owned = VRSpike.panelInputController.process(
        menu,
        actions,
        pointerHit?.guiPosition ?? null,
        context.pointerSink,
        VRSpike.latestXRFrameTimestamp
      );
      // B pressed Back on a menu: the same press must not also toggle Pause
      // when it is released over the game (critic run 13: closing the
      // Character screen with B left the game paused).
      // Only when the menu has a Back for B; otherwise the press did nothing
      // and swallowed the next pause (critic run 14).
      if (VRSpike.panelInputController.takeActivatedButton() === 'b' && (menu as any)?._button_b) VRSpike.pausePressConsumed = true;
      return owned;
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
      const hand = inputFrame.hands[VRSpike.dominantHand];
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
      const rayPose = inputFrame.hands[VRSpike.dominantHand]?.targetRayPose;
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
      // Held while closed: the trigger press that opens the panel from the
      // wheel must be released before the panel takes a click. It clicked the
      // row under the ray in the same press (critic run 11: Dominant Hand
      // switched to Left on opening).
      VRSpike.comfortSettingsSelectHeld = true;
      VRSpike.comfortSettingsCancelHeld = true;
      return false;
    }
    try {
      if (!VRSpike.comfortSettingsHost) VRSpike.comfortSettingsHost = new VRComfortSettingsHost(scene);
      VRSpike.comfortSettingsHost.setCloseButton(VRSpike.dominantHand === 'left' ? 'Y' : 'B');
      VRSpike.comfortSettingsHost.present(inputFrame.head, context.rows);
      // The combat update doesn't run while the panel owns input, so the
      // hilt's queued-power text stayed over a row (critic runs 18-19).
      VRSpike.weaponStanceHost?.clear();

      // 'radial-wheel' adds the either-hand trigger Select: the ray follows
      // whichever hand points, so either trigger clicks. Menu Select alone is
      // the dominant trigger, and a left-hander's ray drew from the right hand
      // that could not click (critic run 12).
      const actions = VRSpike.inputRouter.route(
        XRGamepadReader.read(Array.from(session.inputSources ?? [])),
        new Set(['ui', 'interaction', 'radial-wheel'])
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
      const pressedHand = actions.find((action) =>
        (action.action === SemanticXRAction.Select || action.action === SemanticXRAction.Use) && action.pressed
      )?.hand ?? null;
      // Only the hand that owns the highlight clicks: with both rays on the
      // panel, the off hand's trigger changed its own, unhighlighted row
      // (critic run 17). A hand pointing alone owns the highlight anyway.
      const highlightHand = VRSpike.comfortSettingsPointerHand.pointingHand;
      // Run 18: nulling the hand only moved the click to the other ray's row.
      // A press by the hand that doesn't own the highlight does nothing.
      const offHandPress = !!(pressedHand && highlightHand && pressedHand !== highlightHand);
      const selectingHand = offHandPress ? null : pressedHand;
      const resolution = VRSpike.comfortSettingsPointerHand.resolve(
        inputFrame,
        (pose) => VRSpike.comfortSettingsHost?.rowAtRay(pose) ?? null,
        selectingHand === 'left' || selectingHand === 'right' ? selectingHand : null,
        VRSpike.dominantHand,
      );
      VRSpike.drawComfortSettingsPointer(scene, panel, resolution?.pose ?? VRSpike.anyTrackedRay(inputFrame));
      VRSpike.comfortSettingsHost.setHighlightedRow(resolution?.hit ?? null);
      if (context.controlsGuide) {
        if (!VRSpike.controlsGuideHost) VRSpike.controlsGuideHost = new VRControlsGuideHost(scene);
        VRSpike.controlsGuideHost.present(panel, VRSpike.dominantHand);
      } else {
        VRSpike.controlsGuideHost?.clear();
      }

      if (selectPressed && !offHandPress && !VRSpike.comfortSettingsSelectHeld && resolution) {
        context.activateRow(resolution.hit);
      }
      VRSpike.comfortSettingsSelectHeld = selectPressed;

      if (cancelPressed && !VRSpike.comfortSettingsCancelHeld) {
        context.close();
        // B closed the panel; the same press must not also pause the game.
        VRSpike.pausePressConsumed = true;
      }
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
      if (isUsableXRPose(pose)) return pose;
    }
    return null;
  }

  /** Tears down the comfort panel and its pointer together. */
  private static clearComfortSettingsPointer(): void {
    VRSpike.comfortSettingsHost?.clear();
    VRSpike.controlsGuideHost?.clear();
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
      // ROADMAP 3.15: combat nominates from the weapon hand, so the interaction
      // aim that combat consults first must come from the same hand.
      const dominantPreview = VRSpike.dominantHand === 'left' ? leftPreview : rightPreview;
      VRSpike.interactionAimedTargetId = VRSpike.parseModuleObjectTargetId(dominantPreview?.id ?? null);

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
    if (!handFrame || !isUsableXRPose(handFrame.targetRayPose)) return null;
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
    return isUsableXRPose(pose) ? host.resolveRay(hand, pose) : null;
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
        const promptId = VRSpike.worldPromptCandidateId;
        VRSpike.clearWorldActionPrompt(false);
        try {
          VRSpike.hooks?.noteWorldPromptSelection?.(promptId, action.label);
        } catch (error) {
          console.error('[VRSpike] world prompt selection note rejected', error);
        }
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
    VRSpike.combatAimOffsetsDegrees.clear();
    const rayPose = VRSpike.latestInputFrame?.hands[VRSpike.dominantHand]?.targetRayPose;
    if (!rayPose || !isUsableXRPose(rayPose)) return null;
    try {
      const context = VRSpike.hooks?.getCombatAimCandidates?.() ?? null;
      if (!context || !context.candidates.length) return null;
      const aim = measureVRCombatAim({
        rayPose,
        actorPosition: context.actorPosition,
        candidates: context.candidates,
        maxRangeMetres: context.maxRangeMetres,
        aimAssistRadiusMetres: VRSpike.COMBAT_AIM_ASSIST_RADIUS_METRES,
      });
      for (const [id, offset] of aim.offsetsDegrees) VRSpike.combatAimOffsetsDegrees.set(String(id), offset);
      return aim.targetId;
    } catch {
      // Aim resolution must never break the frame loop; no target is the
      // honest outcome and the player can step closer.
      return null;
    }
  }

  /** The barrel's angle to each in-range hostile, from the last combat aim. */
  private static readonly combatAimOffsetsDegrees = new Map<string, number>();

  /**
   * A hostile under the barrel first, then the interaction ray.
   *
   * The interaction ray used to win whenever it hit anything alive, so the
   * Remote or a companion a metre in front took the aim from the trooper
   * behind: the lock stayed on the old target, every shot went there, and a
   * queued power could not be cast (Bolt, round 17). Corpses did the same
   * (critic run 19). A hostile in combat range under the barrel now outranks
   * any non-hostile hit; a door or companion still answers when no hostile is.
   */
  private static resolveAimedTargetIdForCombat(): number | null {
    const aimed = VRSpike.resolveAimedTargetId();
    const hostile = VRSpike.resolveAimedCombatTargetId();
    if (hostile !== null) return hostile;
    return aimed;
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
      const buttonDown = VRSpike.readCombatCancelButton(session);
      // B is also Pause. A tap pauses or resumes and nothing else; cancelling
      // combat needs B held for VR_COMBAT_CANCEL_HOLD_MS, never while paused.
      // A tap used to cancel too, clearing the actions just queued in the
      // pause (round 15, PF4). A press that began paused never cancels, and
      // the VR Menu's pause counts: holding B to close it cancelled combat
      // and cleared the queue (round 17, R4).
      const now = performance.now();
      if (!buttonDown) {
        VRSpike.combatCancelDownSince = null;
      } else if (VRSpike.isPlayerPaused() || VRSpike.isEnginePaused()) {
        VRSpike.combatCancelDownSince = Number.POSITIVE_INFINITY;
      } else if (VRSpike.combatCancelDownSince === null) {
        VRSpike.combatCancelDownSince = now;
      }
      const cancelPressed = buttonDown && VRSpike.combatCancelDownSince !== null &&
        now - VRSpike.combatCancelDownSince >= VR_COMBAT_CANCEL_HOLD_MS;
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
        // Holding B stopped combat with nothing to say so (critic run 20).
        if (context?.cancel) VRSpike.showNotice('Combat stopped', 1500, 'info');
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

  /**
   * The action wheel does not stop the game, so a held swing's round can open
   * behind it. The swing must still release at that opening or drop within
   * 0.5 s of it (round 17, locked); unserviced, it waited for the wheel to
   * close and released a second or more late (Telos probe: a 4.3 s gap).
   */
  private static serviceHeldSwingBehindWheel(): void {
    try {
      VRSpike.hooks?.serviceCombatSwingBuffer?.();
    } catch (error) {
      if (!VRSpike.combatInputErrorReported) {
        VRSpike.combatInputErrorReported = true;
        console.error('[VRSpike] combat swing buffer rejected', error);
      }
    }
  }

  private static readCombatCancelButton(session: XRSession): boolean {
    const actions = VRSpike.inputRouter.route(
      XRGamepadReader.read(Array.from(session.inputSources ?? [])),
      new Set(['combat', 'interaction', 'ui'])
    );
    return actions.some((action) =>
      action.action === SemanticXRAction.Cancel && action.hand === VRSpike.dominantHand && action.pressed
    );
  }

  /**
   * A frame on which a panel, the VR Menu, the wheel or a cutscene owned
   * input, so processCombatCancel did not run. A B press held now began
   * outside the world and must never become a combat cancel: closing the VR
   * Menu with a held B cancelled combat once the menu had gone (round 17, R4).
   */
  private static holdCombatCancelOutsideWorld(): void {
    const session = VRSpike.session;
    VRSpike.combatCancelHeld = false;
    let buttonDown = false;
    try {
      buttonDown = !!session && VRSpike.readCombatCancelButton(session);
    } catch { /* treat as released */ }
    VRSpike.combatCancelDownSince = buttonDown ? Number.POSITIVE_INFINITY : null;
  }

  /** Any pause of the game, the player's own or the VR Menu's. */
  private static isEnginePaused(): boolean {
    try {
      return VRSpike.hooks?.isEnginePaused?.() === true;
    } catch {
      return false;
    }
  }

  private static pendingCancelTraceFrames = 0;
  /** When B went down this press; +Infinity if it went down while paused or outside the world. */
  private static combatCancelDownSince: number | null = null;
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
      aimOffsetsDegrees: VRSpike.combatAimOffsetsDegrees,
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
      VRSpike.roundReadyLatched = false;
      VRSpike.hiltTimerHost?.clear();
      VRSpike.weaponStanceHost?.clear();
      VRSpike.updateCombatTargetHighlight();
      return;
    }

    // ROADMAP 3.18. While the player has the game paused, swings, trigger
    // pulls, Force flicks and grenade throws do nothing: a pause is for
    // planning. The target ring and the queue on the hilt stay up, so the
    // plan can be read. Latching the triggers now means a trigger held through
    // the pause does not fire the moment it ends.
    if (VRSpike.isPlayerPaused()) {
      // A medpac held to the neck while paused did nothing and said nothing
      // (critic run 18). It still waits for the pause to end; now it says so.
      try {
        const frame = VRSpike.latestInputFrame;
        if (frame && (context as any).armedConsumable === true) {
          const hand: XRHandRole = VRSpike.dominantHand === 'right' ? 'left' : 'right';
          VRSpike.consumableUseGestureController.process(frame, { hand, armed: true, timestamp });
          if (VRSpike.consumableUseGestureController.isInZone && timestamp - VRSpike.pausedUseNoticeAt > 3000) {
            VRSpike.pausedUseNoticeAt = timestamp;
            VRSpike.showNotice('Paused: tap B to resume, then use it', 2500, 'info');
          }
        }
      } catch { /* notice only */ }
      // A stroke held for the next round survives the pause, unseen (round
      // 18: the hold is silent). Paused, it neither ages nor fires.
      VRSpike.updateHiltTimer(context.weaponMode, context.tempoReadiness ?? 0, context.inCombat, context.stanceReadout,
        context.roundAttackPips ?? null);
      VRSpike.updateCombatTargetHighlight();
      VRSpike.roundReadyLatched = false;
      VRSpike.resetCombatStrokeDetectors();
      VRSpike.forceGestureController.reset();
      VRSpike.forceCastGestureController.reset();
      VRSpike.consumableUseGestureController.reset();
      VRSpike.captureWeaponActionLatch();
      return;
    }

    let swingBuffer: { readonly released: boolean; readonly armed: boolean } | null = null;
    try {
      swingBuffer = VRSpike.hooks?.serviceCombatSwingBuffer?.() ?? null;
    } catch (error) {
      if (!VRSpike.combatInputErrorReported) {
        VRSpike.combatInputErrorReported = true;
        console.error('[VRSpike] combat swing buffer rejected', error);
      }
    }
    VRSpike.pulseRoundReady(session, context, swingBuffer?.released === true);
    VRSpike.updateHiltTimer(
      context.weaponMode,
      context.tempoReadiness ?? 0,
      context.inCombat,
      context.stanceReadout,
      context.roundAttackPips ?? null,
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
      // ROADMAP 3.20 — a medpac or stim armed in the off hand is used by
      // holding that hand to the neck. Checked first: the frame it is used
      // is not also a throw, a shot or a swing.
      if (VRSpike.processConsumableUseInput(context, inputFrame, timestamp, offhandHand)) {
        VRSpike.offhandGrenadeTriggerHeld = offhandTriggerPressed;
        VRSpike.dominantShotTriggerHeld = context.weaponMode === 'blaster' && weaponActionPressed;
        return;
      }

      // An armed grenade always owns the off-hand trigger. Without one, an
      // off-hand blaster shoots exactly like the dominant one — round 8, T3:
      // "should also work with offhand when offhand ranged weapon is equipped".
      const offhandShotPressed = offhandTriggerPressed && context.offhandShotAvailable === true;
      if (offhandTriggerPressed && !VRSpike.offhandGrenadeTriggerHeld) {
        if (!offhandShotPressed) {
          // The throw leaves from this hand: the cast plays its conjure
          // (about a second) before the projectile flies.
          VRSpike.throwHandRole = offhandHand;
          VRSpike.throwHandAnchorUntil = performance.now() + 4000;
          VRSpike.updateThrowHandAnchor(inputFrame);
          context.onGrenadeTrigger?.();
        } else {
          if (VRSpike.isPresentationShotAllowed(context)) {
            VRSpike.firePresentationShot(context, timestamp, offhandHand, () => context.playOffhandShotSound?.());
          }
          // T-B: inside a round, the off-hand blaster's pull spends the
          // off-hand attack and nothing else.
          const offhandShot = context.onOffhandShot?.() ?? 'pass';
          VRSpike.offhandPullTaken = offhandShot !== 'pass';
        }
      }
      if (!offhandTriggerPressed) VRSpike.offhandPullTaken = false;
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
      if (!context.nominatedTargetId) {
        const triggerEdge = weaponActionPressed && !VRSpike.idleTriggerHeld;
        VRSpike.idleTriggerHeld = weaponActionPressed;
        // A blaster shot at the door or container Bash was picked on bashes it.
        const triggerBashed = VRSpike.processWeaponBash(inputFrame, timestamp, offhandGrip, dominantHand, offhandHand, triggerEdge);
        // A pull at nothing in a fight did nothing, silently (Tempo run 2):
        // the host ticks it when it was meant as a shot or a cast.
        if (triggerEdge && !triggerBashed) context.onRefusedInput?.('idle-trigger');
        return;
      }
      VRSpike.idleTriggerHeld = weaponActionPressed;

      if (VRSpike.processForceInput(timestamp, context)) {
        VRSpike.resetCombatStrokeDetectors();
        return;
      }
      // ROADMAP 3.19 — the off hand's open-palm thrust releases the queued
      // Force power. Checked before the swing detector so a two-handed swing
      // never doubles as a cast: with the off-hand grip held the palm is not
      // open and the thrust is ignored here.
      if (VRSpike.processForceCastInput(context, inputFrame, timestamp, offhandHand,
        !offhandGrip && !offhandTriggerPressed)) {
        VRSpike.resetCombatStrokeDetectors();
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
        // is still one pull. A pull the off-hand attack took is not also one.
        weaponActionPressed: weaponActionPressed || (offhandShotPressed && !VRSpike.offhandPullTaken),
        dominantHand,
        offhandHand,
        allowDominantTrigger: context.allowDominantTrigger === true,
        nominatedTargetVolume: context.nominatedTargetVolume ?? null,
      });
      VRSpike.reportSwingMisses();
      for (const event of events) context.onCombatSwing(event);
      VRSpike.voiceStrokes(events, timestamp);
      // T-B: with two melee weapons the off hand strokes for itself. Not while
      // it holds the hilt two-handed or works a trigger.
      if (context.offhandStrokeAvailable === true && !offhandGrip && !offhandTriggerPressed) {
        const offhandEvents = VRSpike.offhandCombatInputController.process(inputFrame, {
          actorId: context.actorId,
          nominatedTargetId: context.nominatedTargetId,
          weaponMode: 'melee-one-handed',
          timestamp,
          offhandGrip: false,
          weaponActionPressed: false,
          dominantHand: offhandHand,
          offhandHand: dominantHand,
          allowDominantTrigger: false,
          nominatedTargetVolume: context.nominatedTargetVolume ?? null,
        });
        VRSpike.offhandCombatInputController.drainMisses();
        for (const event of offhandEvents) context.onOffhandStroke?.(event);
        VRSpike.voiceStrokes(offhandEvents, timestamp);
      } else {
        VRSpike.offhandCombatInputController.reset();
      }
    } catch (error) {
      if (!VRSpike.combatInputErrorReported) {
        VRSpike.combatInputErrorReported = true;
        console.error('[VRSpike] combat input rejected', error);
      }
    }
  }

  /**
   * ROADMAP 3.17 — with no hostile locked, a melee swing through a locked door
   * or container the player has chosen Bash on starts its authored Bash. Uses
   * the same swing detector, so the same contact rule (3.16) applies. Bash
   * persists (round 18): every later swing, or with a blaster every trigger
   * pull aimed at it, bashes again. Returns whether the trigger edge was
   * taken as a Bash shot.
   */
  private static processWeaponBash(
    inputFrame: XRInputFrame,
    timestamp: number,
    offhandGrip: boolean,
    dominantHand: XRHandRole,
    offhandHand: XRHandRole,
    triggerEdge = false,
  ): boolean {
    const bash = VRSpike.hooks?.getWeaponBashContext?.(VRSpike.resolveAimedTargetId()) ?? null;
    if (!bash) return false;
    if (bash.weaponMode === 'blaster') {
      if (!triggerEdge) return false;
      bash.bash();
      return true;
    }
    const events = VRSpike.combatInputController.process(inputFrame, {
      actorId: bash.actorId,
      nominatedTargetId: bash.targetId,
      weaponMode: bash.weaponMode,
      timestamp,
      offhandGrip,
      weaponActionPressed: false,
      dominantHand,
      offhandHand,
      allowDominantTrigger: false,
      nominatedTargetVolume: bash.volume,
    });
    VRSpike.reportSwingMisses();
    if (events.some((event) => event.input === 'dominant-swing')) bash.bash();
    return false;
  }

  private static isPlayerPaused(): boolean {
    try {
      return VRSpike.hooks?.isPaused?.() === true;
    } catch {
      return false;
    }
  }

  /**
   * ROADMAP 3.18 — shows the pause, and resumes it when the wheel closes if
   * the player turned that option on. Never pauses anything by itself.
   */
  private static updatePauseState(foregroundSurfaceOwnsInput: boolean, radialOwnsInput: boolean): void {
    const paused = VRSpike.isPlayerPaused();
    if (paused && radialOwnsInput) {
      VRSpike.radialOpenWhilePaused = true;
    } else if (!radialOwnsInput && VRSpike.radialOpenWhilePaused) {
      VRSpike.radialOpenWhilePaused = false;
      // A wheel entry that opened a menu or the comfort panel leaves the game
      // paused behind it: the player is still planning.
      const comfort = VRSpike.hooks?.getComfortSettings?.() ?? DEFAULT_COMFORT_SETTINGS;
      if (paused && !foregroundSurfaceOwnsInput && comfort.unpauseOnWheelClose === true) {
        try {
          VRSpike.hooks?.setPaused?.(false);
        } catch (error) {
          console.error('[VRSpike] unpause on wheel close rejected', error);
        }
      }
    }
    // Once per session, the first time there is a player to control: how to
    // reach the wheel and the Controls Guide. Nothing pointed a first-time
    // player at either (critic runs 12-13).
    if (!VRSpike.controlsHintShown && !foregroundSurfaceOwnsInput && VRSpike.hooks?.getPlayerPosition?.()) {
      VRSpike.controlsHintShown = true;
      const wheelButton = VRSpike.dominantHand === 'left' ? 'A' : 'X';
      VRSpike.showNotice(`Hold ${wheelButton}: action wheel  ·  VR Menu > Controls Guide`, 8000, 'info');
    }
    VRSpike.refusalNoticeHost?.update(performance.now());
    if (!paused && !VRSpike.pauseIndicatorHost) return;
    if (!VRSpike.camera) return;
    try {
      if (!VRSpike.pauseIndicatorHost) VRSpike.pauseIndicatorHost = new VRPauseIndicatorHost(VRSpike.camera);
      VRSpike.pauseIndicatorHost.present(VRSpike.isPlayerPaused());
    } catch (error) {
      if (!VRSpike.pauseIndicatorErrorReported) {
        VRSpike.pauseIndicatorErrorReported = true;
        console.error('[VRSpike] pause indicator rejected', error);
      }
    }
  }

  private static pauseIndicatorErrorReported = false;

  private static reportedSwingMisses = 0;

  /**
   * TEMPORARY (ROADMAP 3.16): the contact slack is a guess until it is tuned
   * from real play. The first few fast swings that never reached the target
   * are logged with how close they came, so a headset session shows whether
   * genuine swings are being refused. Remove once tuned.
   */
  private static reportSwingMisses(): void {
    for (const miss of VRSpike.combatInputController.drainMisses()) {
      if (VRSpike.reportedSwingMisses >= 12) return;
      VRSpike.reportedSwingMisses += 1;
      console.info(
        `[VR combat swing] TEMPORARY missed target volume by ${miss.closestMetres.toFixed(2)} m ` +
        `(slack 0.75) weapon=${miss.weaponMode}`,
      );
    }
  }

  private static roundReadyLatched = false;

  /**
   * ROADMAP 3.12 — a soft tick on the weapon hand as the round opens, so the
   * player knows when a swing will count without looking at the hilt. A
   * buffered swing released this frame counts as the opening too: the round
   * restarts in the same frame, so readiness alone would never rise.
   * Only in combat; aiming at a hostile outside a fight is not a round.
   */
  private static pulseRoundReady(
    session: XRSession,
    context: { readonly inCombat: boolean; readonly tempoReadiness?: number; readonly roundOpen?: boolean },
    bufferedSwingReleased: boolean,
  ): void {
    // roundOpen follows the player's round alone. Readiness also reads 1 when
    // the aim leaves every target, which ticked with no round boundary
    // (critic run 4); it remains the fallback for hosts that do not report it.
    const roundOpen = context.roundOpen ?? ((context.tempoReadiness ?? 0) >= 1);
    const open = context.inCombat === true && (roundOpen || bufferedSwingReleased);
    if (open && !VRSpike.roundReadyLatched) {
      void VRSpike.haptics.pulse(session, VRSpike.dominantHand, ROUND_READY_HAPTIC);
      VRSpike.playCombatCue('ready');
    }
    VRSpike.roundReadyLatched = open;
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
    stanceReadout = '',
    roundAttackPips: import('./runtime/VRRoundStrokeBudget').VRRoundAttackPips | null = null,
  ): void {
    VRSpike.lastCombatWeaponMode = weaponMode;
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
    // Round 18: a quiet glow while the next round is ready in a fight, not a
    // clock to wait on - a stroke begins the round.
    VRSpike.hiltTimerHost.present(inCombat === true && Number.isFinite(tempoReadiness) && tempoReadiness >= 1, roundAttackPips);

    // Same grip anchor as the ring, so the upcoming player-selected action
    // belongs to the equipped weapon rather than a screen-space HUD.
    try {
      if (!VRSpike.weaponStanceHost) {
        VRSpike.weaponStanceHost = new VRWeaponStanceHost(gripAnchor);
      }
      // Not over an open VR Menu: "STUN DROID" hid a row's value (critic run 18).
      let panelOpen = false;
      try { panelOpen = !!VRSpike.hooks?.getComfortSettingsPanelContext?.(); } catch { /* treat as closed */ }
      VRSpike.weaponStanceHost.present(panelOpen ? '' : stanceReadout);
      VRSpike.weaponStanceHost.faceViewer(VRSpike.camera);
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
    combatContext?: {
      onDirectionalForceGesture?(gesture: VRForceGesture): boolean;
      onRefusedInput?(input: 'push' | 'pull' | 'cast' | 'idle-trigger'): void;
      readonly nominatedTargetAimPoint?: THREE.Vector3 | null;
    },
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
        // The weapon hand must be on the locked target (locked by Allen,
        // 2026-10-13); a flick with the hand turned away is a swing, not a push.
        if (!VRSpike.isWeaponHandOnLockedTarget(inputFrame, combatContext.nominatedTargetAimPoint)) {
          combatContext.onRefusedInput?.(gesture.kind);
          return false;
        }
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

  /** The weapon hand's ray within the Force cone of the locked target's aim point. */
  private static isWeaponHandOnLockedTarget(
    inputFrame: XRInputFrame,
    targetPoint: THREE.Vector3 | null | undefined,
  ): boolean {
    const onTarget = isVRWeaponHandOnTarget(inputFrame.hands[VRSpike.dominantHand]?.targetRayPose, targetPoint);
    if (!onTarget) console.info('[VR force] gesture refused: weapon hand off the locked target');
    return onTarget;
  }

  /**
   * ROADMAP 3.19 — one generic Force cast. An open-palm thrust of the off
   * hand toward the locked target releases whatever non-Push/Pull Force power
   * heads the queue. Returns true only when the engine spent the gesture, so
   * an idle thrust with nothing queued still falls through to the swing
   * detector unchanged.
   */
  private static processForceCastInput(
    context: {
      onForceCastGesture?(gesture: VRForceCastGesture): boolean;
      onRefusedInput?(input: 'push' | 'pull' | 'cast' | 'idle-trigger'): void;
      readonly nominatedTargetAimPoint?: THREE.Vector3 | null;
    },
    inputFrame: XRInputFrame,
    timestamp: number,
    offhandHand: XRHandRole,
    palmOpen: boolean,
  ): boolean {
    if (!context.onForceCastGesture) return false;
    try {
      const gesture = VRSpike.forceCastGestureController.process(inputFrame, {
        hand: offhandHand,
        palmOpen,
        targetPoint: context.nominatedTargetAimPoint ?? null,
        timestamp,
      });
      if (!gesture) return false;
      // Bringing the hand down from the neck after a medpac read as a palm
      // thrust at the target and cast the queued power (critic run 19).
      if (timestamp - VRSpike.offhandBusyAt < 1200) {
        VRSpike.forceCastGestureController.reset();
        return false;
      }
      // F14: the lock outlives the aim by 2.5 s, and a thrust with the sword
      // at the floor cast on it. The weapon hand must be on the target.
      if (!VRSpike.isWeaponHandOnLockedTarget(inputFrame, context.nominatedTargetAimPoint)) {
        context.onRefusedInput?.('cast');
        return false;
      }
      return context.onForceCastGesture(gesture) === true;
    } catch (error) {
      if (!VRSpike.forceGestureErrorReported) {
        VRSpike.forceGestureErrorReported = true;
        console.error('[VRSpike] Force cast gesture rejected', error);
      }
      return false;
    }
  }

  /**
   * ROADMAP 3.20 — the armed consumable's hold-to-the-neck. Runs the zone
   * detector only while something is armed, so an empty off hand at the face
   * (adjusting the headset) costs nothing and does nothing.
   */
  private static processConsumableUseInput(
    context: { readonly armedConsumable?: boolean; onConsumableUseGesture?(gesture: VRConsumableUseGesture): boolean },
    inputFrame: XRInputFrame,
    timestamp: number,
    offhandHand: XRHandRole,
  ): boolean {
    const armed = context.armedConsumable === true && typeof context.onConsumableUseGesture === 'function';
    try {
      const wasInZone = VRSpike.consumableUseGestureController.isInZone;
      const gesture = VRSpike.consumableUseGestureController.process(inputFrame, {
        hand: offhandHand,
        armed,
        timestamp,
      });
      // Entering the zone clicks, so the player knows to hold it there
      // (critic run 5: nothing said you were in it).
      // Once per stay: a refused use restarts the dwell, and the chime
      // repeated every second while the item rested there (critic run 15),
      // then every 3 s (critic run 17). Entering the zone chimes; staying in
      // it through refusals does not.
      if (!wasInZone && VRSpike.consumableUseGestureController.isInZone && timestamp - VRSpike.neckZoneChimedAt > 1000) {
        VRSpike.neckZoneChimedAt = timestamp;
        VRSpike.playCombatCue('neck-zone', 0, true);
      }
      if (VRSpike.consumableUseGestureController.isInZone) VRSpike.offhandBusyAt = timestamp;
      if (!gesture || !armed) return false;
      return context.onConsumableUseGesture!(gesture) === true;
    } catch (error) {
      if (!VRSpike.combatInputErrorReported) {
        VRSpike.combatInputErrorReported = true;
        console.error('[VRSpike] consumable use gesture rejected', error);
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
      const menuAction = actions.find((action) =>
        action.action === SemanticXRAction.Menu && action.hand !== VRSpike.dominantHand && action.pressed
      );
      const menuPressed = menuAction !== undefined;
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
        if (openingMenu && (menuAction?.hand === 'left' || menuAction?.hand === 'right')) {
          VRSpike.radialOpenerHand = menuAction.hand;
        }
      }
      VRSpike.radialMenuPressedLastFrame = menuPressed;

      const host = VRSpike.radialMenuHost;
      // Either hand may aim at the wheel. Binding the ray to one controller is
      // invisible to the player, so the other hand reads as a dead pointer.
      // But with both rays on it, the hand that opened it owns the hover, and
      // whichever trigger is pulled picks what is highlighted: the weapon ray
      // passing through the wheel took the highlight while the opener's
      // trigger picked another wedge (Bolt and Anchor, round 17).
      const opener: XRHandRole = VRSpike.radialOpenerHand ?? (VRSpike.dominantHand === 'right' ? 'left' : 'right');
      const rayResolution = wasOpen && host
        ? VRSpike.radialRayHand.resolve(inputFrame, (pose) => host.resolveRay(pose), null, opener)
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
    return isUsableXRPose(targetRayPose)
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
  /**
   * Teleport the view to wherever the controlled character now stands, and
   * place the dialogue panel again in front of the head. Called when a
   * cutscene has finished moving the character (VRCutsceneMoveHold).
   */
  static requestRigReanchor(): void {
    VRSpike.rigAnchorPending = true;
    VRSpike.panelHost?.clear();
  }

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
        action.action === SemanticXRAction.Menu && action.hand !== VRSpike.dominantHand && action.pressed
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
      // B is Pause and, held, Cancel combat. Pause toggles when a short press
      // is RELEASED: toggling on the press paused the game at once, and the
      // combat cancel (which never fires while paused) could never be reached
      // by holding B (critic run 11). A press a panel used (closing the VR
      // Menu) does not pause either.
      const pausePressed = routedActions.some((action) =>
        action.action === SemanticXRAction.Pause && action.pressed
      );
      const pauseNow = performance.now();
      if (pausePressed && !VRSpike.pauseToggleHeld) {
        VRSpike.pauseDownAt = pauseNow;
      }
      if (!pausePressed && VRSpike.pauseToggleHeld) {
        const tap = !VRSpike.pausePressConsumed && VRSpike.pauseDownAt !== null &&
          pauseNow - VRSpike.pauseDownAt < VR_COMBAT_CANCEL_HOLD_MS;
        if (tap) {
          try {
            VRSpike.hooks?.togglePause?.();
          } catch (error) {
            console.error('[VRSpike] pause toggle rejected', error);
          }
        }
        VRSpike.pauseDownAt = null;
        VRSpike.pausePressConsumed = false;
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
      // A stick resting a little off centre moved the player; rescaled so
      // movement starts from zero past the deadzone (critic run 13).
      const inputMagnitude = applyStickDeadzone(Math.min(1, inputDirection.length()));
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
      // Deadzoned: a drifting stick turned the world at 3.5 deg/s from a 0.03
      // deflection, and flickered the vignette (critic run 13).
      const rawTurn = -(turn?.axes?.[0] ?? 0);
      const turnAxisValue = Math.sign(rawTurn) * applyStickDeadzone(Math.abs(rawTurn));
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
        VRSpike.updateComfortVignette(0, deltaSeconds);
      } else {
        VRSpike.teleportController.reset();
    VRSpike.clearTeleportMarker();
        applyLocomotion(resolvedLocomotion);
        // Discrete comfort modes (snap turn) don't need the vignette — it's
        // a mitigation for continuous vection, not instant reorientation.
        // Smooth turning is vection too (critic run 12: the vignette stayed
        // off for a whole smooth turn); a snap turn is not.
        const smoothTurning = useSnapTurn ? 0 : Math.min(1, Math.abs(turnAxisValue));
        // How fast the player actually moves, not how far the stick is
        // pushed: against a wall the view darkened fully with no movement
        // (critic run 14). Full strength at a run (about 4 m/s).
        const position = VRSpike.hooks?.getPlayerPosition?.() ?? null;
        let movedSpeed = 0;
        if (position && VRSpike.vignetteLastPosition && deltaSeconds > 0) {
          movedSpeed = Math.hypot(position.x - VRSpike.vignetteLastPosition.x, position.y - VRSpike.vignetteLastPosition.y) / deltaSeconds;
        }
        VRSpike.vignetteLastPosition = position ? { x: position.x, y: position.y } : null;
        const moving = resolvedLocomotion.magnitude > 0 ? Math.min(1, movedSpeed / 4) : 0;
        VRSpike.updateComfortVignette(
          comfortSettings.vignetteEnabled ? Math.max(moving, smoothTurning) : 0,
          deltaSeconds,
        );
      }
    } catch (error) {
      if (!VRSpike.locomotionInputErrorReported) {
        VRSpike.locomotionInputErrorReported = true;
        console.error('[VRSpike] controller locomotion input rejected', error);
      }
    }
  }

  /** The vignette eases in and out over ~150 ms; it snapped in one frame (critic run 12). */
  private static comfortVignetteLevel = 0;
  private static vignetteLastPosition: { x: number; y: number } | null = null;
  private static updateComfortVignette(intensity: number, deltaSeconds = 1 / 72): void {
    if (!VRSpike.camera) return;
    const target = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0;
    const step = Math.min(1, Math.max(0, deltaSeconds) / 0.15);
    VRSpike.comfortVignetteLevel += (target - VRSpike.comfortVignetteLevel) * step;
    if (VRSpike.comfortVignetteLevel < 0.01 && target === 0) VRSpike.comfortVignetteLevel = 0;
    if (VRSpike.comfortVignetteLevel <= 0 && !VRSpike.comfortVignetteHost) return;
    if (!VRSpike.comfortVignetteHost) {
      VRSpike.comfortVignetteHost = new VRComfortVignetteHost(VRSpike.camera);
    }
    VRSpike.comfortVignetteHost.setIntensity(VRSpike.comfortVignetteLevel);
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
    VRSpike.headHeight.reset();
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
   * Where the player's ears are while presenting: the headset, in world space.
   *
   * The engine placed the audio listener on `GameState.currentCamera`, the
   * flatscreen follow camera, which no headset movement drives. Measured in a
   * presenting emulator session it sat 3.3 m from the head and facing the
   * camera's way, and it stays wherever the player entered VR, so positional
   * sounds such as doors (50 m range, 10-20% volume by 5-10 m) and mines were
   * heard from the wrong place or not at all (round 11, G2).
   *
   * Fills `position`/`forward` and returns true only while presenting.
   */
  static getListenerPose(position: THREE.Vector3, forward: THREE.Vector3): boolean {
    const renderer = VRSpike.renderer;
    if (!VRSpike.isPresenting || !renderer || !VRSpike.camera || typeof renderer.xr.getCamera !== 'function') return false;
    const rig = VRSpike.rig;
    const xrCamera = (renderer.xr.getCamera as unknown as (sourceCamera: THREE.Camera) => THREE.Camera)(VRSpike.camera);
    if (!rig || !xrCamera) return false;
    // The XR camera holds the head pose in tracking space and has no parent,
    // so its own getWorldPosition() returns that raw pose (measured: 0, 1.6, 0).
    // The rig is what places tracking space in the world.
    rig.updateWorldMatrix(true, false);
    position.copy(xrCamera.position).applyMatrix4(rig.matrixWorld);
    rig.getWorldQuaternion(VRSpike.listenerRigQuaternion);
    forward.set(0, 0, -1).applyQuaternion(VRSpike.listenerRigQuaternion.multiply(xrCamera.quaternion));
    return true;
  }

  private static readonly listenerRigQuaternion = new THREE.Quaternion();

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
    // Off unless this frame's world submission turns it on: a theater frame
    // returns early and used to inherit it (critic run 7).
    VRSpike.ensureCombatCueAudio();
    VRSpike.watchPlayerDisabled();

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
    VRSpike.theaterHidesWorld = theaterCutscene && cutsceneContext?.hideWorld === true;
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
      // A hand held on the swoop's handle is pinned in world space, and the
      // pin was taken before this frame's engine tick moved the bike - at
      // race speed that is two units a frame, so the hand was drawn two units
      // behind the rider and read as having vanished. Re-pin against the bike
      // where it is now, and re-place the anchors against the rig where it is
      // now, which is the frame the headset is about to render.
      VRSpike.miniGameInput?.refreshPins?.();
      VRSpike.controllerAnchorHost?.refreshPinnedAnchors();
    }

    if (theaterCutscene) {
      VRSpike.clearWorldActionPrompt(false);
      VRSpike.renderCutscene(worldCamera, frameTimestamp, playerBody);
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
    VRSpike.applyLeaderSwitchFade();

    VRSpike.traceRoomVisibility();
    if (PerfLayerGate.playLayer()) VRSpike.renderKeyboard();
    if (PerfLayerGate.playLayer()) VRSpike.renderPanel();
    if (PerfLayerGate.playLayer()) VRSpike.renderInGameOverlay();
    if (!cutsceneContext && PerfLayerGate.playLayer()) {
      VRSpike.renderWorldActionPrompt();
      VRSpike.renderWorldTargetLabel();
    }
    if (PerfLayerGate.playLayer()) VRSpike.updateCombatVisuals(frameTimestamp);

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
    // While a module loads the engine hides the world scene, panel and all;
    // draw the loading screen over the dark instead. No floor is drawn: the
    // blue disc critic run 6 asked for confused the headset player (round 15).
    const restoreHiddenWorld = revealVRInterfaceOverHiddenWorld(scene);
    try {
      // Perf bisect: L0 submits an empty clear instead of the world, so the
      // harness can measure the XR loop with nothing drawn. One submission
      // site, so a GPU timer can wrap whichever branch runs.
      if (PerfLayerGate.rendersWorld()) {
        renderer.render(scene, VRSpike.camera);
      } else {
        renderer.clear();
      }
      if (PerfLayerGate.playLayer()) VRSpike.desktopMirror.render(renderer, scene);
    } finally {
      restoreHiddenWorld();
      restoreBody();
    }
    VRSpike.perf.recordXRRender(frameTimestamp);
    renderer.autoClear = prevAutoClear;
  }

  /**
   * The theater shows a whole movie or world frame, never a cut-out. World
   * pixels carry their texture's alpha, which on heads and bodies is the
   * envmap mask, not coverage: blended, the room behind the theater showed
   * through faces in the security-camera feeds (round 15, F16).
   */
  private static makeTheaterOpaque(host: VRPanelHost): void {
    const material = host.object.material as THREE.Material;
    material.transparent = false;
    material.needsUpdate = true;
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
        VRSpike.makeTheaterOpaque(VRSpike.movieHost);
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
        VRSpike.desktopMirror.render(renderer, worldScene);
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
  private static renderCutscene(worldCamera: THREE.Camera, frameTimestamp: number, playerBody?: THREE.Object3D | null): void {
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
    const cameraCut = VRSpike.lastCutsceneCamera !== worldCamera;
    if (VRSpike.lastCutsceneCamera !== null && cameraCut) {
      VRSpike.cutsceneFadeEnvelope.trigger(frameTimestamp);
    }
    VRSpike.lastCutsceneCamera = worldCamera;
    // The theater is a second full render of the world, through the authored
    // camera. Refreshing it every other XR frame (36 Hz at 72) and on every
    // cut halves that cost; cutscenes are authored around 30 fps, and the
    // render target keeps the last composite in between (headset round P1).
    VRSpike.cutsceneTheaterFrame++;
    const refreshTheater = cameraCut || VRSpike.cutsceneTheaterFrame % 2 === 0;
    if (!VRSpike.cutsceneFadeHost) {
      VRSpike.cutsceneFadeHost = new VRCutsceneFadeHost(VRSpike.camera);
    }
    VRSpike.cutsceneFadeHost.setOpacity(VRSpike.cutsceneFadeEnvelope.sample(frameTimestamp));

    const captionContext = VRSpike.hooks?.getPanelContext?.();

    try {
      if (!VRSpike.movieHost) {
        VRSpike.movieHost = new VRPanelHost(worldScene, VRSpike.THEATER_PANEL_OPTIONS);
        VRSpike.makeTheaterOpaque(VRSpike.movieHost);
      }
      VRSpike.movieHost.present(
        VRSpike.cutsceneOwner,
        inputFrame.head,
        Math.max(1, Math.round((VRSpike.renderer?.domElement?.width ?? 1280))),
        Math.max(1, Math.round((VRSpike.renderer?.domElement?.height ?? 720)))
      );
      if (refreshTheater) {
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
          // One line per authored shot: which camera, and whether captions ride
          // along. This replaced a per-frame walk of the whole scene graph that
          // counted visible meshes for the round-4 "only space" investigation.
          if (cameraCut) {
            console.info(
              `[VR cutscene theater] shot captions=${!!captionContext?.menu}` +
              ` cam=(${worldCamera.position.x.toFixed(1)},` +
              `${worldCamera.position.y.toFixed(1)},${worldCamera.position.z.toFixed(1)})`
            );
          }
          // The body belongs in a theater shot unless the camera is inside it.
          const cameraPosition = worldCamera.getWorldPosition(new THREE.Vector3());
          const feet = playerBody ? playerBody.getWorldPosition(new THREE.Vector3()) : null;
          const restoreBody = playerBody && feet && isCameraInsideBody(cameraPosition, feet)
            ? hidePlayerBodyForFirstPerson(playerBody)
            : () => {};
          try {
            VRSpike.movieHost.renderGuiLayers(renderer, layers);
          } finally {
            restoreBody();
          }
          // Sampled a few refreshes into the shot: the cut frame itself can
          // precede the room pass for the new camera.
          if (cameraCut) VRSpike.theaterSampleCountdownTemp = 6;
          if (VRSpike.theaterSampleCountdownTemp > 0 && --VRSpike.theaterSampleCountdownTemp === 0) {
            VRSpike.logTheaterShotTemp(renderer, worldCamera);
          }
        } finally {
          VRSpike.movieHost.object.visible = movieVisible;
          if (VRSpike.panelHost) VRSpike.panelHost.object.visible = panelVisible;
        }
      }
      // A previously-open generic panel must not remain as a second caption
      // plane beneath the theater. Its legacy menu state remains untouched;
      // only the duplicate VR presentation is released.
      VRSpike.panelHost?.clear();
      if (VRSpike.xrFrameRenderTarget) renderer.setRenderTarget(VRSpike.xrFrameRenderTarget);
      const previousAutoClear = renderer.autoClear;
      renderer.autoClear = true;
      const restoreWorld = VRSpike.theaterHidesWorld
        ? hideWorldForTheater(worldScene, VRSpike.movieHost.object)
        : () => {};
      // The room around the theater is drawn from the player's own eyes, so
      // the player's own body goes, as in the world path: its hair drew
      // across the view in the Peragus holorecord (critic runs 15-16).
      const restoreOwnBody = hidePlayerBodyForFirstPerson(playerBody);
      try {
        renderer.render(worldScene, VRSpike.camera);
        VRSpike.desktopMirror.render(renderer, worldScene);
      } finally {
        restoreOwnBody();
        restoreWorld();
      }
      VRSpike.perf.recordXRRender(frameTimestamp);
      renderer.autoClear = previousAutoClear;
    } catch (error) {
      VRSpike.movieHost?.clear();
      console.error('[VRSpike] cutscene theater presentation rejected', error);
    }
  }

  /**
   * TEMPORARY (round 18, issue 6): the T3-M4 comm video at the Peragus
   * administration computer showed as a black box in the headset and rendered
   * correctly under the emulator. One line per shot says what the theater
   * frame actually held (how dark a 5x5 sample of it is) and who the shot was
   * framing, so the next headset run can tell an empty frame from a camera in
   * the wrong place. Remove once that is settled.
   */
  private static theaterSampleCountdownTemp = 0;
  private static logTheaterShotTemp(renderer: THREE.WebGLRenderer, worldCamera: THREE.Camera): void {
    try {
      const target = VRSpike.movieHost?.renderTarget;
      if (!target || target.width < 5 || target.height < 5) return;
      const pixel = new Uint8Array(4);
      let dark = 0;
      let lumSum = 0;
      for (let ix = 1; ix <= 5; ix++) {
        for (let iy = 1; iy <= 5; iy++) {
          renderer.readRenderTargetPixels(target,
            Math.floor(target.width * ix / 6), Math.floor(target.height * iy / 6), 1, 1, pixel);
          const lum = 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2];
          lumSum += lum;
          if (lum < 8) dark++;
        }
      }
      const p = worldCamera.getWorldPosition(new THREE.Vector3());
      console.info(`[VR theater TEMP r18] cam=(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})` +
        ` dark=${dark}/25 meanLum=${(lumSum / 25).toFixed(0)} target=${target.width}x${target.height}` +
        ` ${VRSpike.hooks?.describeCutsceneShot?.() ?? ''}`);
    } catch (error) {
      console.warn('[VR theater TEMP r18] sample failed', error);
    }
  }

  /** This frame's theater is shown over black (VRCutsceneInputContext.hideWorld). */
  private static theaterHidesWorld = false;

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
      VRSpike.reportPanelPresentation(context.menu, context.presentOptions ?? {});
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

  private static lastReportedPanelShape: string | null = null;
  private static reportedPanelShapes = 0;

  /**
   * TEMPORARY (headset round 18, "large, empty black boxes before and after
   * interactions"): names each panel the player is shown, with its size and
   * backing, so a box seen in the headset can be matched to its menu. One
   * line per change of shape, at most 60 a session.
   */
  private static reportPanelPresentation(menu: object, options: { readonly backingOpacity?: number, readonly region?: unknown }): void {
    try {
      const object = VRSpike.panelHost?.object;
      if (!object) return;
      const name = (menu as any)?.constructor?.name ?? 'menu';
      const shape = `${name} ${object.scale.x.toFixed(2)}x${object.scale.y.toFixed(2)}m backing=${options.backingOpacity ?? 0}`;
      if (shape === VRSpike.lastReportedPanelShape || VRSpike.reportedPanelShapes >= 60) return;
      VRSpike.lastReportedPanelShape = shape;
      VRSpike.reportedPanelShapes++;
      console.info(`[VR panel] TEMPORARY shown ${shape}`);
    } catch {
      // Diagnostics only.
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
            // ROADMAP 3.13: a bolt the player deflected meets their blade and
            // rebounds from it, instead of flying into their chest.
            const bladePoint = VRSpike.session && event.attackResult === DEFLECTED_ATTACK_RESULT &&
              context.localActorId !== null && event.targetId === context.localActorId
              ? VRSpike.resolveBladeContactPoint()
              : null;
            VRSpike.blasterBoltHost.fire(
              { from, to: bladePoint ?? event.to, attackResult: event.attackResult },
              nowMs,
            );
            if (bladePoint) {
              VRSpike.blasterBoltHost.fire({
                from: bladePoint,
                to: VRSpike.resolveDeflectionReboundPoint(bladePoint, from),
                attackResult: event.attackResult,
                delayMs: BOLT_TRAVEL_MS,
              }, nowMs);
              VRSpike.ensureBladeSparkHost(worldScene).spark(bladePoint, nowMs, BOLT_TRAVEL_MS);
            }
            if (VRSpike.session && isLocalShot) context.playLocalShotSound?.();
            else if (VRSpike.session) context.playShotSound?.(event.actorId);
          } else {
            if (!VRSpike.droidExplosionHost) {
              VRSpike.droidExplosionHost = new VRDroidExplosionHost(worldScene);
            }
            VRSpike.droidExplosionHost.detonate(event.at, nowMs);
          }
        }
        VRSpike.presentAttackResultFeedback(context.snapshots, context.localActorId, worldScene, nowMs);
      }
      VRSpike.blasterBoltHost?.update(nowMs);
      VRSpike.bladeSparkHost?.update(nowMs);
      VRSpike.damageFlashHost?.update(nowMs);
      VRSpike.droidExplosionHost?.update(nowMs);
      VRSpike.presentHealthPlate();
    } catch (error) {
      if (!VRSpike.combatVisualsErrorReported) {
        VRSpike.combatVisualsErrorReported = true;
        console.error('[VRSpike] combat visuals rejected', error);
      }
    }
  }

  /**
   * ROADMAP 3.13 — the player feels every roll that involves them: their own
   * attacks, and their blade parrying or deflecting someone else's. The engine
   * has already decided each result; this only presents it.
   */
  private static presentAttackResultFeedback(
    snapshots: Parameters<VRCombatAttackResultObserver['observe']>[0],
    localActorId: number | null,
    worldScene: THREE.Object3D,
    nowMs: number,
  ): void {
    const events = VRSpike.attackResultObserver.observe(snapshots);
    VRSpike.lastLocalActorId = localActorId;
    const session = VRSpike.session;
    if (!session) return;
    for (const event of events) {
      // Part D1: a hit on the player is held until the attacker's blade
      // lands (its Hit event) or its bolt arrives; the HP the engine took at
      // the roll is shown then, with the hurt cue and the red edge.
      if (localActorId !== null && event.targetId === localActorId && HIT_ATTACK_RESULTS.has(event.attackResult)) {
        const attacker = snapshots.find((snapshot) => snapshot.id === event.attackerId);
        VRSpike.hurtGate.recordHit({
          attackerId: event.attackerId,
          critical: event.attackResult === CRITICAL_ATTACK_RESULT,
          ranged: attacker?.attackIsRanged === true,
          nowMs,
        });
      }
      const feedback = resolveVRCombatFeedback({
        attackerId: event.attackerId,
        targetId: event.targetId,
        attackResult: event.attackResult,
        localActorId,
      });
      if (!feedback) continue;
      // A deflection is felt when the bolt reaches the blade, not when it leaves the gun.
      const delayMs = feedback.effect === 'deflect' ? BOLT_TRAVEL_MS : 0;
      VRSpike.playHapticSequence(session, VRSpike.dominantHand, feedback.pulses, feedback.gapMs, delayMs);
      // Heard and seen as well as felt: round 12 felt no haptics at all.
      const cue = cueForVRCombatOutcome(feedback.outcome);
      // Each stroke's whoosh voices the result of the attack it bought, even
      // a held swing resolving at the next opening: a miss is then the absence
      // of an impact, with the ready tick, not a second whoosh (Part F,
      // decision 4; Spark run 2: a held miss sounded like a phantom swing).
      const meleeAttack = feedback.role === 'attacker' &&
        snapshots.find((snapshot) => snapshot.id === event.attackerId)?.attackIsRanged !== true;
      let meleeMissAfterStroke = false;
      if (meleeAttack && cue === 'miss') meleeMissAfterStroke = VRSpike.strokeResults.coversMiss(performance.now());
      else if (meleeAttack && cue) VRSpike.strokeResults.noteResult(performance.now());
      if (cue && !meleeMissAfterStroke) {
        const placed = VRSpike.hooks?.resolveCombatCueSounds?.(event.attackerId, event.targetId, cue) ?? null;
        VRSpike.playCombatCue(cue, delayMs, false, placed);
      }
      // Part D: a blow that lands gets the struck creature's own pain bark
      // (on some hits), and a critical the PC's critical-hit line.
      if (feedback.role === 'attacker' && (feedback.outcome === 'hit' || feedback.outcome === 'critical')) {
        if (feedback.outcome === 'critical') VRSpike.playBark(event.attackerId, 'critical');
        if (shouldVoiceTargetPain(feedback.outcome === 'critical')) VRSpike.playBark(event.targetId, 'pain');
      }
      if (feedback.role === 'attacker' && (feedback.outcome === 'hit' || feedback.outcome === 'critical')) {
        const attacker = snapshots.find((snapshot) => snapshot.id === event.attackerId);
        const struck = attacker?.attackTargetAimPoint
          ?? (attacker?.attackTargetPosition
            ? attacker.attackTargetPosition.clone().setZ(attacker.attackTargetPosition.z + VR_MUZZLE_HEIGHT_METRES)
            : null);
        if (struck) {
          const sparks = VRSpike.ensureBladeSparkHost(worldScene);
          if (feedback.outcome === 'critical') {
            sparks.spark(struck, nowMs, 0, 1.8);
            sparks.spark(struck, nowMs, 90, 2.2);
          } else {
            sparks.spark(struck, nowMs);
          }
        }
      }
      if (feedback.effect === 'clash') {
        const bladePoint = VRSpike.resolveBladeContactPoint();
        if (bladePoint) VRSpike.ensureBladeSparkHost(worldScene).spark(bladePoint, nowMs);
      }
    }

    const local = localActorId === null ? undefined : snapshots.find((snapshot) => snapshot.id === localActorId);
    const head = VRSpike.latestInputFrame?.head;
    const gated = VRSpike.hurtGate.update(typeof local?.hitPoints === 'number' ? local.hitPoints : null, nowMs,
      typeof local?.maxHitPoints === 'number' ? local.maxHitPoints : null);
    VRSpike.shownHitPoints = VRSpike.hurtGate.holding ? gated.displayedHitPoints : null;
    for (const landed of gated.released) {
      const attacker = snapshots.find((snapshot) => snapshot.id === landed.attackerId);
      if (landed.amount > 0) {
        // ROADMAP 3.14: who landed it, so the drop is shown on their side.
        VRSpike.lastAttackOnPlayer = { attackerId: landed.attackerId, targetId: localActorId as number };
        if (attacker?.position) {
          VRSpike.damageTracker.recordAttack({ attackerPosition: attacker.position, critical: landed.critical, timestampMs: nowMs });
        }
      } else {
        // A blow a shield absorbed: no HP drop to voice it, so it sounds here.
        VRSpike.playHurtCue(landed.attackerId, localActorId as number, landed.critical);
      }
    }
    const damage = VRSpike.damageTracker.observe({
      actorId: local ? localActorId : null,
      hitPoints: gated.displayedHitPoints,
      playerPosition: local?.position ?? null,
      headForward: head ? new THREE.Vector3(0, 0, -1).applyQuaternion(head.orientation) : null,
      nowMs,
    });
    // Already down before this drop: no hurt sound, haptics or flash over
    // the defeat screen (critic run 14: two hurt cues after death).
    const hp = gated.displayedHitPoints;
    const wasDown = VRSpike.lastLocalHitPoints !== null && VRSpike.lastLocalHitPoints <= 0;
    // Below a quarter of the pool, once per drop: only the wrist number said
    // so (critic run 20). A notice and a pulse in both hands.
    const maxHp = typeof (local as any)?.maxHitPoints === 'number' ? (local as any).maxHitPoints : null;
    if (hp !== null && maxHp && hp > 0) {
      const low = hp <= maxHp * 0.25;
      if (low && !VRSpike.lowHealthWarned) {
        VRSpike.lowHealthWarned = true;
        VRSpike.showNotice(`Low health: ${hp} / ${maxHp}`, 2500);
        // Its sound: the PC's own low-health line (Spark Finding 7).
        VRSpike.playBark(localActorId as number, 'low-health');
        try {
          VRSpike.pulseHand('left', { durationMs: 160, amplitude: 0.8 });
          VRSpike.pulseHand('right', { durationMs: 160, amplitude: 0.8 });
        } catch { /* haptics optional */ }
      } else if (!low && hp > maxHp * 0.35) {
        VRSpike.lowHealthWarned = false;
      }
    }
    VRSpike.lastLocalHitPoints = hp;
    if (damage && !wasDown) VRSpike.presentDamage(session, damage, nowMs);
  }

  /**
   * ROADMAP 3.14 — a red edge on the side the hit came from, and a pulse in
   * that side's hand. Front, behind and unattributed hits use both.
   */
  private static lastLocalHitPoints: number | null = null;
  private static lowHealthWarned = false;
  private static neckZoneChimedAt = Number.NEGATIVE_INFINITY;

  private static presentDamage(session: XRSession, damage: VRDamageEvent, nowMs: number): void {
    const pattern = damage.side === 'unknown'
      ? DAMAGE_UNATTRIBUTED_HAPTIC
      : damage.critical ? DAMAGE_CRITICAL_HAPTIC : DAMAGE_HAPTIC;
    const hands: XRHandRole[] = damage.side === 'left' ? ['left'] : damage.side === 'right' ? ['right'] : ['left', 'right'];
    for (const hand of hands) void VRSpike.haptics.pulse(session, hand, pattern);
    // The hurt sound plays with the red edge, on the HP drop, whatever did
    // the damage (a blaster, a grenade, a Force power, poison). Voicing it
    // from the attacker's Hit event left every ranged hit silent: retail
    // ranged attack animations have no Hit event (critic run 10).
    const hurtCue = damage.critical ? 'hurt-critical' : 'hurt';
    const lastHit = VRSpike.lastAttackOnPlayer;
    // Spent: a later drop with no blow behind it (a grenade) is not theirs.
    VRSpike.lastAttackOnPlayer = null;
    VRSpike.playCombatCue(hurtCue, 0, false,
      lastHit ? VRSpike.hooks?.resolveCombatCueSounds?.(lastHit.attackerId, lastHit.targetId, hurtCue) ?? null : null);
    // Part D: the PC's own pain grunt, in the head - never the sound of
    // the player's own hits (Spark Finding 1).
    if (VRSpike.lastLocalActorId !== null) VRSpike.playBark(VRSpike.lastLocalActorId, 'pain');

    const comfort = VRSpike.hooks?.getComfortSettings?.() ?? DEFAULT_COMFORT_SETTINGS;
    if (comfort.damageFlashEnabled === false || !VRSpike.camera) return;
    try {
      if (!VRSpike.damageFlashHost) VRSpike.damageFlashHost = new VRDamageFlashHost(VRSpike.camera);
      VRSpike.damageFlashHost.flash(damage.side, damage.critical, nowMs);
    } catch (error) {
      if (!VRSpike.combatVisualsErrorReported) {
        VRSpike.combatVisualsErrorReported = true;
        console.error('[VRSpike] damage flash rejected', error);
      }
    }
  }

  /**
   * Round 14: "Force powers didn't seem to work at all." They cast (the log
   * shows Force Valor's script running), but a power's effects play on the
   * player's own body, which is hidden in first person, so nothing told the
   * player it went off. A rising tone and a blue burst at the casting hand.
   */
  static presentLocalForceCast(): void {
    VRSpike.playCombatCue('force');
    const scene = VRSpike.scene;
    const hand = VRSpike.controllerAnchorHost?.getAnchor(VRSpike.dominantHand === 'right' ? 'left' : 'right')
      ?? VRSpike.controllerAnchorHost?.getAnchor(VRSpike.dominantHand) ?? null;
    if (!scene || !hand) return;
    const at = hand.getWorldPosition(new THREE.Vector3());
    const sparks = VRSpike.ensureBladeSparkHost(scene);
    const now = performance.now();
    sparks.spark(at, now, 0, 1.6, 0x6fc8ff);
    sparks.spark(at, now, 120, 2.4, 0x9fe0ff);
  }

  /** A refused request (grenade out of range, no target, save refused). */
  /**
   * Refusals and saves are interface feedback, not combat sounds: they play
   * with Combat Sounds off, since a refusal heard by nobody is silent again
   * (critic run 4).
   */
  static playRefusedCue(): void {
    VRSpike.playCombatCue('refused', 0, true);
  }

  /**
   * The retail error sound and, in view, why (critic runs 4-5: one sound
   * for every refusal, nothing for a player who cannot hear it).
   */
  static signalRefusal(shape: string): void {
    VRSpike.playRefusedCue();
    const text = describeVRRefusal(shape);
    if (!text || !VRSpike.camera) return;
    try {
      if (!VRSpike.refusalNoticeHost) VRSpike.refusalNoticeHost = new VRRefusalNoticeHost(VRSpike.camera);
      VRSpike.refusalNoticeHost.show(text, performance.now());
    } catch (error) {
      console.error('[VRSpike] refusal notice rejected', error);
    }
  }

  private static refusalNoticeHost: VRRefusalNoticeHost | null = null;
  private static controlsHintShown = false;


  /**
   * Creates the cue player as the session's frames begin and preloads every
   * retail sound it may use (critic run 7: created on the first cue, and only
   * the defaults were preloaded).
   */
  private static ensureCombatCueAudio(): void {
    if (VRSpike.combatCueAudio) return;
    try {
      const output = VRSpike.hooks?.getCombatCueAudioOutput?.();
      if (!output) return;
      VRSpike.combatCueAudio = new VRCombatCueAudio(output.context, output.destination, output.loadSound);
      void VRSpike.combatCueAudio.preload([
        ...VRCombatCueAudio.defaultSounds(),
        ...(VRSpike.hooks?.getCombatCuePreloadSounds?.() ?? []),
      ]);
    } catch (error) {
      console.error('[VRSpike] combat cue audio setup rejected', error);
    }
  }

  /** Shown for as long as the effect holds the player (critic run 7: 1.8 s of a 6 s stun, feat stuns only). */
  private static lastDisabledState: string | null = null;
  private static watchPlayerDisabled(): void {
    let state: string | null = null;
    try { state = VRSpike.hooks?.getPlayerDisabledState?.() ?? null; } catch { state = null; }
    if (state) VRSpike.showNotice(state, 600);
    VRSpike.lastDisabledState = state;
  }

  /** A short line low in view, without the error sound (a status, not a refusal). */
  static showNotice(text: string, holdMs?: number, tone: 'refusal' | 'info' = 'refusal'): void {
    if (!text || !VRSpike.camera) return;
    try {
      if (!VRSpike.refusalNoticeHost) VRSpike.refusalNoticeHost = new VRRefusalNoticeHost(VRSpike.camera);
      VRSpike.refusalNoticeHost.show(text, performance.now(), holdMs, tone);
    } catch (error) {
      console.error('[VRSpike] notice rejected', error);
    }
  }

  static playSavedCue(): void {
    VRSpike.playCombatCue('saved', 0, true);
  }

  /** The weapon family whose retail sounds the combat cues use. */
  private static lastCombatWeaponMode: CombatWeaponMode = 'unarmed';
  private static combatCueWeapon(): VRCombatCueWeapon {
    const mode = VRSpike.lastCombatWeaponMode;
    if (mode === 'blaster') return 'ranged';
    if (mode === 'unarmed') return 'unarmed';
    return 'melee';
  }

  /** A combat result you can hear, unless Combat Sounds is off. */
  /** An attack animation's Hit event: a held hit on the player from that attacker lands (Part D1). */
  static noteBlowLanded(attackerId: string | number): void {
    VRSpike.hurtGate.noteBlowLanded(attackerId);
  }

  /** A blow on the player: the attacker's weapon on the player's material. */
  static playHurtCue(attackerId: string | number, targetId: string | number, critical: boolean): void {
    const cue = critical ? 'hurt-critical' : 'hurt';
    VRSpike.playCombatCue(cue, 0, false, VRSpike.hooks?.resolveCombatCueSounds?.(attackerId, targetId, cue) ?? null);
    VRSpike.playBark(targetId, 'pain');
  }

  /**
   * You are in another body (Y, the wheel, or a knockout handing you a
   * standing companion): the view comes back from black over 150 ms, the
   * label names the body, and it says its retail select line. The jump used
   * to land with no transition, up to 8 m (Anchor, run 2).
   */
  static presentLeaderSwitch(text: string, actorId: number | null): void {
    if (!VRSpike.isPresenting) return;
    const half = Math.max(1, VRSpike.LEADER_SWITCH_FADE_MS);
    VRSpike.leaderSwitchFade = new VRCutsceneFadeEnvelope({ totalDurationMilliseconds: 2 * half });
    // Triggered half an envelope ago: black now, clear in `half` ms.
    VRSpike.leaderSwitchFade.trigger(performance.now() - half);
    VRSpike.showNotice(text, 1500, 'info');
    if (actorId !== null) VRSpike.playBark(actorId, 'select');
  }

  /** The leader-switch fade shares the cutscene fade's quad; 0 when idle. */
  private static applyLeaderSwitchFade(): void {
    const opacity = VRSpike.leaderSwitchFade?.sample(performance.now()) ?? 0;
    if (opacity <= 0) VRSpike.leaderSwitchFade = null;
    if (opacity > 0 && !VRSpike.cutsceneFadeHost && VRSpike.camera) {
      VRSpike.cutsceneFadeHost = new VRCutsceneFadeHost(VRSpike.camera);
    }
    VRSpike.cutsceneFadeHost?.setOpacity(opacity);
  }

  /** A creature's own retail soundset line, when it has one (Part D). */
  private static playBark(creatureId: string | number, kind: VRCombatBarkKind): void {
    const own = creatureId === VRSpike.lastLocalActorId;
    // Two blows landing together are one grunt, not two on top of each other.
    const now = performance.now();
    if (own && kind === 'pain' && now - VRSpike.lastOwnPainAt < 150) return;
    const placed = VRSpike.hooks?.resolveCombatBark?.(creatureId, kind) ?? null;
    if (!placed?.sounds?.length) return;
    if (own && kind === 'pain') VRSpike.lastOwnPainAt = now;
    VRSpike.playCombatCue(own && kind === 'pain' ? 'pain' : 'bark', 0, false, placed);
  }

  private static lastOwnPainAt = Number.NEGATIVE_INFINITY;

  /** The controlled creature's id, for the PC's own barks. */
  private static lastLocalActorId: number | null = null;
  /** Strokes whose whoosh still stands for their attack's result (Part F). */
  private static readonly strokeResults = new VRStrokeResultLedger();

  /**
   * One whoosh per physical stroke, at the hand, in the weapon's own retail
   * swing sound: the hidden body's whooshes no longer play (Spark Finding 4),
   * so a hit is whoosh-then-impact, as in retail.
   */
  private static voiceStrokes(events: readonly VRCombatSwingEvent[], timestamp: number): void {
    for (const event of events) {
      if (event.input !== 'dominant-swing' || event.weaponMode === 'blaster') continue;
      // The weapon's own swing takes, rotated by the stroke's speed and grip
      // (Part F, decision 4): one sample on every stroke read as a loop.
      const placed = VRSpike.hooks?.resolveCombatCueSounds?.(event.actorId, event.actorId, 'whoosh', {
        speedMetresPerSecond: event.speedMetresPerSecond,
        twoHanded: event.weaponMode === 'melee-two-handed',
      }) ?? null;
      const hand = VRSpike.controllerAnchorHost?.getAnchor(event.hand) ?? null;
      const at = hand ? hand.getWorldPosition(new THREE.Vector3()) : null;
      VRSpike.playCombatCue('whoosh', 0, false, { sounds: placed?.sounds, position: at });
      VRSpike.strokeResults.noteStroke(performance.now());
    }
  }

  /** Who last attacked the player, so the hurt cue uses their weapon. */
  private static lastAttackOnPlayer: { attackerId: string | number; targetId: string | number } | null = null;

  private static playCombatCue(cue: VRCombatCue, delayMs = 0, always = false, options: VRCombatCuePlayOptions | null = null): void {
    const comfort = VRSpike.hooks?.getComfortSettings?.() ?? DEFAULT_COMFORT_SETTINGS;
    if (!always && comfort.combatSoundsEnabled === false) return;
    try {
      if (!VRSpike.combatCueAudio) {
        const output = VRSpike.hooks?.getCombatCueAudioOutput?.();
        if (!output) return;
        VRSpike.combatCueAudio = new VRCombatCueAudio(output.context, output.destination, output.loadSound);
        void VRSpike.combatCueAudio.preload(VRCombatCueAudio.defaultSounds());
      }
      void VRSpike.combatCueAudio.play(cue, delayMs, VRSpike.combatCueWeapon(), options ?? {});
    } catch (error) {
      if (!VRSpike.combatCueAudioErrorReported) {
        VRSpike.combatCueAudioErrorReported = true;
        console.error('[VRSpike] combat cue sound rejected', error);
      }
    }
  }

  /**
   * HP and FP on the off-hand wrist, shown when the player glances at it: the
   * left wrist, or the right when Dominant Hand is Left (the weapon hand never
   * wears the watch).
   */
  private static presentHealthPlate(): void {
    const comfort = VRSpike.hooks?.getComfortSettings?.() ?? DEFAULT_COMFORT_SETTINGS;
    const offHand: XRHandRole = VRSpike.dominantHand === 'right' ? 'left' : 'right';
    const anchor = VRSpike.controllerAnchorHost?.getAnchor(offHand) ?? null;
    if (comfort.healthPlateEnabled === false || !anchor || !VRSpike.camera) {
      VRSpike.healthPlateHost?.clear();
      return;
    }
    if (!VRSpike.healthPlateHost || VRSpike.healthPlateHost.object.parent !== anchor) {
      VRSpike.healthPlateHost?.dispose();
      VRSpike.healthPlateHost = new VRHealthPlateHost(anchor, offHand);
    }
    const head = VRSpike.camera.getWorldPosition(new THREE.Vector3());
    const vitals = VRSpike.hooks?.getPlayerVitals?.() ?? null;
    // While a hit is held (Part D1) the wrist shows HP from before it.
    VRSpike.healthPlateHost.present(vitals && VRSpike.shownHitPoints !== null
      ? { ...vitals, hitPoints: VRSpike.shownHitPoints } : vitals, head);
  }

  private static ensureBladeSparkHost(worldScene: THREE.Object3D): VRBladeSparkHost {
    if (!VRSpike.bladeSparkHost) VRSpike.bladeSparkHost = new VRBladeSparkHost(worldScene);
    return VRSpike.bladeSparkHost;
  }

  /**
   * Where on the player's weapon a blade or bolt meets it: part way along the
   * direction the weapon hand points, from the grip. Null without tracking.
   */
  private static resolveBladeContactPoint(): THREE.Vector3 | null {
    const grip = VRSpike.controllerAnchorHost?.getAnchor(VRSpike.dominantHand) ?? null;
    const ray = VRSpike.controllerAnchorHost?.getRayAnchor(VRSpike.dominantHand) ?? null;
    if (!grip || !ray) return null;
    const forward = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(ray.getWorldQuaternion(new THREE.Quaternion()));
    return grip.getWorldPosition(new THREE.Vector3()).addScaledVector(forward, BLADE_CONTACT_DISTANCE_METRES);
  }

  /** Back roughly the way the bolt came, scattered so rebounds do not all retrace one line. */
  private static resolveDeflectionReboundPoint(bladePoint: THREE.Vector3, shooter: THREE.Vector3): THREE.Vector3 {
    const back = shooter.clone().sub(bladePoint);
    if (back.lengthSq() < 1e-6) back.set(1, 0, 0);
    back.normalize();
    const scatter = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, (Math.random() - 0.5) * 0.4);
    return bladePoint.clone().addScaledVector(back.add(scatter.multiplyScalar(0.9)).normalize(),
      DEFLECTION_REBOUND_METRES);
  }

  /** Plays `pulses` in order, `gapMs` apart, starting `delayMs` from now. */
  private static playHapticSequence(
    session: XRSession,
    hand: XRHandRole,
    pulses: readonly VRHapticPattern[],
    gapMs: number,
    delayMs: number,
  ): void {
    let at = Math.max(0, delayMs);
    for (const pattern of pulses) {
      if (at <= 0) {
        void VRSpike.haptics.pulse(session, hand, pattern);
      } else {
        setTimeout(() => {
          if (VRSpike.session === session) void VRSpike.haptics.pulse(session, hand, pattern);
        }, at);
      }
      at += pattern.durationMs + gapMs;
    }
  }

  private static renderWorldTargetLabel(): void {
    try { VRSpike.hooks?.hideCombatNonHostileReticles?.(); } catch { /* presentation only */ }
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
    try {
      const y = frame.getViewerPose(referenceSpace)?.transform.position.y;
      if (typeof y !== 'number') return;
      const event = VRSpike.headHeight.sample(y, performance.now());
      if (!event) return;
      const eye = VRSpike.hooks?.getEyeHeight?.() ?? null;
      const character = `character eye ${eye === null ? 'unknown' : eye.toFixed(2) + ' m'}`;
      console.info(event.kind === 'calibrated'
        ? `[VRSpike] head height calibrated: player ${event.baselineMetres.toFixed(2)} m, ${character}`
        : `[VRSpike] head height raised (player stood up): ${event.previousMetres.toFixed(2)} -> ${event.baselineMetres.toFixed(2)} m, ${character}`);
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
  private static liveHeadHeightLastFrame = false;

  private static resolveEyeHeightOffset(): number {
    // On the swoop the eyes go exactly where the rider's are, measured from
    // the head as it is now rather than the calibrated baseline: a player who
    // calibrated standing and then sat down for the race was put a head lower
    // in the cockpit than the rider and could not see the track. And when the
    // race ends the baseline is dropped so it is taken again in whatever
    // posture they are in now - calibrated seated, standing up afterwards put
    // them a head too tall in the next module.
    const live = VRSpike.hooks?.useLiveHeadHeight?.() === true;
    if (live !== VRSpike.liveHeadHeightLastFrame) {
      VRSpike.liveHeadHeightLastFrame = live;
      if (!live) {
        VRSpike.headHeight.reset();
      }
    }
    const eye = VRSpike.hooks?.getEyeHeight?.() ?? null;
    if (eye === null || !Number.isFinite(eye)) return 0;
    const head = VRSpike.latestLocalHeadPosition?.y ?? null;
    if (live) {
      return head === null ? 0 : eye - head;
    }
    return VRSpike.clampedEyeHeightOffset(eye, VRSpike.headHeight.baselineMetres, head);
  }

  /**
   * Outside the swoop the view is never above the character's eyes, whatever
   * the player's real posture (Allen, 2026-09-26: "too high" is for the swoop
   * only). Lower is allowed, so crouching still crouches. Before calibration
   * has a baseline the head is only ever pulled down, never pushed up.
   *
   * Without the cap, standing up after a seated or headset-on-the-desk
   * calibration put the camera ~0.6 m above every character until the
   * baseline caught up (headset round P1).
   */
  static clampedEyeHeightOffset(eye: number, baseline: number | null, head: number | null): number {
    if (head === null || !Number.isFinite(head)) {
      return baseline === null ? 0 : eye - baseline;
    }
    if (baseline === null) return Math.min(0, eye - head);
    return eye - Math.max(baseline, head);
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

    // A leader switch (Y) puts the player in another body: seat the head over
    // it. The rig stayed where the old leader stood, beside the new one, whose
    // hood and braids filled the view until the stick moved (critic run 19).
    let controlledId: number | null = null;
    try { controlledId = VRSpike.hooks?.getControlledActorId?.() ?? null; } catch { controlledId = null; }
    if (controlledId !== VRSpike.lastControlledActorId) {
      if (VRSpike.lastControlledActorId !== undefined) {
        VRSpike.rigAnchorPending = true;
        VRSpike.steadiedFeet = null;
      }
      VRSpike.lastControlledActorId = controlledId;
    }
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
      rig.position.copy(VRSpike.steadyFeetAtWalls(feet, resumedAfterGap));
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
