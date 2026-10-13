import type { VRCombatCuePlayOptions } from "@/vr/runtime/VRCombatCueAudio";
import { impactResRef, resolveVRImpactMaterialFor } from "@/engine/rules/ImpactMaterial";
import { describeVRCombatVoicingSounds, describeVRPlayerBarks, pickVRBark, resolveVRCriticalImpact, VRStrokeWhooshPicker, type VRCombatBarkKind, type VRStrokeShape } from "@/vr/runtime/VRCombatVoicing";
import { SSFType } from "@/enums/resource/SSFType";
import * as THREE from "three";
import {
  AppearanceManager, AutoPauseManager, TLKManager, CharGenManager, CheatConsoleManager, CameraShakeManager, ConfigManager, CursorManager, DialogMessageManager,
  FadeOverlayManager, FeedbackMessageManager, GlobalVariableManager, InventoryManager, JournalManager, LightManager, WindManager, MenuManager, ModuleObjectManager, PartyManager,
  ResolutionManager, ShaderManager, TwoDAManager, FactionManager,
  VideoEffectManager, VideoManager, PazaakManager, UINotificationManager, CutsceneManager, LegalScreenManager, EventManager
} from "@/managers";

import type { SWRuleSet } from "@/engine/rules/SWRuleSet";

import type { TalentObject, TalentFeat, TalentSkill, TalentSpell } from "@/talents";
import type { ModuleObject, ModuleCreature, Module, ModuleDoor, ModuleItem, ModuleRoom } from "@/module";
import type { NWScript } from "@/nwscript/NWScript";
import type { SaveGame } from "@/engine/SaveGame";
import type { GameEffectFactory } from "@/effects/GameEffectFactory";
import type { GameEventFactory } from "@/events/GameEventFactory";

import type { ActionMenuManager } from "@/engine/menu/ActionMenuManager";
import type { ActionFactory } from "@/actions/ActionFactory";
import type { Action } from "@/actions/Action";

import { IngameControls } from "@/controls/IngameControls";
import { Mouse } from "@/controls/Mouse";

import { INIConfig } from "@/engine/INIConfig";

// import { OdysseyObject3D } from "@/three/odyssey";
import { AudioEngine, AudioEmitter } from "@/audio";
import { AudioLoader } from "@/audio/AudioLoader";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { TGAObject } from "@/resource/TGAObject";

import { IGameStateGroups } from "@/interface/engine/IGameStateGroups";
import { ITextureLoaderQueuedRef } from "@/interface/loaders/ITextureLoaderQueuedRef";

import { AudioEngineChannel } from "@/enums/audio/AudioEngineChannel";
import { AudioPriorityGroup } from "@/enums/audio/AudioPriorityGroup";
import { EngineState, EngineMode, GameEngineType, GameEngineEnv, EngineDebugType } from "@/enums/engine";
import { TextureType } from "@/enums/loaders/TextureType";

import { EngineContext } from "@/engine/EngineContext";

import { ConfigClient } from "@/utility/ConfigClient";
import { GameFileSystem } from "@/utility/GameFileSystem";
import { FollowerCamera } from "@/engine/FollowerCamera";
import { OdysseyShaderPass } from "@/shaders/pass/OdysseyShaderPass";
import { ResourceLoader, TextureLoader } from "@/loaders";
import { VRSpike } from "@/vr/VRSpike";
import { AutoSaveManager } from "@/engine/AutoSaveManager";
import { classifyVRForcePower } from "@/vr/runtime/VRForcePowerClassification";
import { measureVRSaberGripCentre } from "@/vr/runtime/VRHeldSaberGrip";
import { resolveVRMenuRegion } from "@/vr/runtime/VRMenuRegion";
import { CutsceneMode } from "@/enums/dialog/CutsceneMode";
import { EngineFrameSource, shouldProcessEngineFrame } from "@/vr/XRFrameCadence";
import { clampFrameDelta } from "@/engine/FrameDeltaRules";
import { CreatureLocomotionAdapter } from "@/vr/runtime/CreatureLocomotionAdapter";
import type { VRCombatAimCandidate } from "@/vr/runtime/VRCombatAimResolver";
import type { VRCombatActorSnapshot } from "@/vr/runtime/VRCombatVisualEvents";
import { TURN_SPEED_FAST } from "@/engine/TurnSpeeds";
import {
  LegacyGUIVRPointerAdapter,
  LegacyGUIVRPointerCoordinates,
  LegacyGUIVRPointerControl,
  LegacyGUIVRPointerSemanticTarget,
} from "@/vr/runtime/LegacyGUIVRPointerAdapter";
import { getLegacyGUIVRPointerSemanticTargets as discoverLegacyGUIVRPointerSemanticTargets } from "@/vr/runtime/LegacyGUIVRPointerDiscovery";
import {
  describeDirectVRWorldUse,
  getVRInteractionRange,
} from "@/vr/runtime/VRWorldUseAdapter";
import { createFloorWalkableQuery } from "@/vr/runtime/VRWallSoftBlock";
import {
  resolveVRCutscenePresentation,
  type VRCutscenePresentation,
} from "@/vr/runtime/VRCutscenePresentationPolicy";
import { CameraMode } from "@/enums/dialog/CameraMode";
import { DLGConversationType } from "@/enums/dialog/DLGConversationType";
import {
  EngineInteractableObject,
  resolveVRInteractionAnchor,
} from "@/vr/runtime/ModuleObjectInteractionTarget";
import {
  VRWorldActionPromptModel,
  VRWorldPromptAction,
  VRWorldPromptCandidate,
  buildVRWorldPromptPages,
} from "@/vr/runtime/VRWorldActionPromptModel";
import { resolveDisplayName } from "@/vr/runtime/resolveDisplayName";
import {
  describeVRCreaturePromptAction,
  hasCreatureWorldPromptAction,
  isVRCombatNamePlateHidden,
  readVRCreaturePromptState,
} from "@/vr/runtime/VRCreaturePromptRules";
import {
  VRCombatIntentQueue,
  type VRCombatIntent,
  type VRCombatRequiredInput,
} from "@/vr/runtime/VRCombatIntentQueue";
import { formatVRCombatQueueReadout } from "@/vr/runtime/VRWeaponStanceHost";
import { VRCombatIntentDispatcher } from "@/vr/runtime/VRCombatIntentDispatcher";
import { VRMiniGameInputController } from "@/vr/runtime/VRMiniGameInputController";
import {
  attachSwoopGrips, detachSwoopGrips, SWOOP_GRIP_GROUP_NAME,
} from "@/vr/runtime/VRMiniGameGripHost";

/** The bike the swoop grips are currently attached to, so it is done once. */
let vrSwoopGripsAttachedTo: THREE.Object3D | null = null;
/** How each moment of a swoop ride feels, before scaling by how hard it hit. */
const SWOOP_RIDE_HAPTICS: Record<SwoopRideEventType, { durationMs: number; amplitude: number }> = {
  obstacle: { durationMs: 220, amplitude: 1.0 },
  mine: { durationMs: 260, amplitude: 1.0 },
  wall: { durationMs: 90, amplitude: 0.7 },
  pad: { durationMs: 120, amplitude: 0.5 },
  jump: { durationMs: 40, amplitude: 0.35 },
  land: { durationMs: 70, amplitude: 0.55 },
};

/** Scratch for the grip poses, which are read every frame while riding. */
const vrSwoopGripPoses: Record<'left' | 'right', {
  position: THREE.Vector3; orientation: THREE.Quaternion;
  linearVelocity: null; angularVelocity: null; trackingState: 'tracked';
}> = {
  left: {
    position: new THREE.Vector3(), orientation: new THREE.Quaternion(),
    linearVelocity: null, angularVelocity: null, trackingState: 'tracked',
  },
  right: {
    position: new THREE.Vector3(), orientation: new THREE.Quaternion(),
    linearVelocity: null, angularVelocity: null, trackingState: 'tracked',
  },
};

/**
 * World poses of the swoop's handlebar grips, so a hand that has taken hold of
 * one can be drawn on it. Null until the grips exist.
 */
function readSwoopGripPoses(container: THREE.Object3D | null | undefined) {
  if(!container){ return null; }
  const grips = container.getObjectByName(SWOOP_GRIP_GROUP_NAME);
  if(!grips || grips.children.length < 2){ return null; }
  const roles = ['left', 'right'] as const;
  for(let i = 0; i < roles.length; i++){
    const grip = grips.children[i];
    if(!grip){ return null; }
    grip.updateWorldMatrix(true, false);
    grip.getWorldPosition(vrSwoopGripPoses[roles[i]].position);
    grip.getWorldQuaternion(vrSwoopGripPoses[roles[i]].orientation);
  }
  return vrSwoopGripPoses;
}
import { VRCombatTempoGate, type VRCombatTempoGateReason } from "@/vr/runtime/VRCombatTempoGate";
import { addSwoopRideListener, type SwoopRideEventType } from "@/module/minigame/SwoopRideEvents";
import { VRCombatSwingBuffer, VRHeldSwingLifetime, isVRCombatSwingBufferable, isVRFightOngoing } from "@/vr/runtime/VRCombatSwingBuffer";
import { VRRecentForcePowers } from "@/vr/runtime/VRForcePowerWheelRules";
import { AttackBarkGate, SPARSE_ATTACK_BARK_POLICY, type AttackBarkPolicy } from "@/engine/rules/AttackBarkGate";
import type { MeleeCrowdPolicy } from "@/engine/rules/MeleeCrowdRules";
import { VRRefusalTickThrottle, isVRRefusedInputMeaningful, type VRRefusalTickReason } from "@/vr/runtime/VRRefusalTick";
import { VRArmedGrenadeState, type VRArmedGrenadeDescriptor } from "@/vr/runtime/VRArmedGrenadeState";
import { resolveVRArmedGrenadeCommitEligibility } from "@/vr/runtime/VRArmedGrenadeCommitPolicy";
import type { CombatWeaponMode, VRComfortSettings } from "@/vr/runtime/XRTypes";
import type { HeldItemClassFallbackTransform, HeldItemVisualDescriptor } from "@/vr/runtime/XRControllerAnchorHost";
import { loadGenericHandModel } from "@/vr/runtime/hands/GenericHandLoader";
import { BaseItemType } from "@/enums/combat/BaseItemType";
import { ModuleItemProperty } from "@/enums/module/ModuleItemProperty";
import { CombatActionType } from "@/enums/combat/CombatActionType";
import { CombatRoundAction } from "@/combat/CombatRoundAction";
import { CombatRound } from "@/combat/CombatRound";
import { resolveVRRoundStroke, resolveVRPlayerRoundUntilReadyMs, shouldTakeOverVRPlayerRound, normalizeVRRoundAttackPips, NO_VR_ROUND_ATTACK_PIPS, VR_SILENT_HOLD_MAX_MILLISECONDS, type VRRoundAttackPips, type VRStrokeHand } from "@/vr/runtime/VRRoundStrokeBudget";
import type { VRComfortSettingsRow } from "@/vr/runtime/VRComfortSettingsHost";
import {
  buildVRActionWheel,
  createVRActionSourceKey,
} from "@/vr/runtime/VRActionWheelModelBuilder";
import { findCullingBoundsAnomalies, describeCullingBoundsAnomalies } from "@/module/CullingBoundsAudit";
import type { BoundsSample } from "@/module/CullingBoundsAudit";
import type {
  VRActionMenuEntry,
  VRActionWheelPartyMember,
  VRActionWheelDirectAction,
} from "@/vr/runtime/VRActionWheelModelBuilder";
import {
  snapshotVRActionMenuPanelEntries,
} from "@/vr/runtime/VRActionMenuEngineBridge";
import { VR_POINTER_HIT_PADDING, setPointerHitPadding } from "@/gui/PointerHitPadding";
import type { GameMenu } from "@/gui/GameMenu";
import type {
  VRActionMenuBridgeDependencies,
  VRActionMenuPanel,
  VRActionMenuPanelLists,
} from "@/vr/runtime/VRActionMenuEngineBridge";
import EngineLocation from "@/engine/EngineLocation";

//THREE.js imports
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass";
import { SSAARenderPass } from "three/examples/jsm/postprocessing/SSAARenderPass";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass";
import { BloomPass } from "three/examples/jsm/postprocessing/BloomPass";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass";
import { ColorCorrectionShader } from "three/examples/jsm/shaders/ColorCorrectionShader";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader";
import Stats from 'three/examples/jsm/libs/stats.module'
// import { BitWise } from "@/utility/BitWise";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ActionType } from "@/enums/actions/ActionType";
import { ModuleTriggerType } from "@/enums/module/ModuleTriggerType";
import { SkillType } from "@/enums/nwscript/SkillType";
import { AudioEmitterType } from "@/enums/audio/AudioEmitterType";
// import { GUIControlTypeMask } from "@/enums/gui/GUIControlTypeMask";

// import { ModuleTriggerType } from "@/enums";
import { Planetary } from "@/engine/Planetary";
import { Debugger } from "@/engine/Debugger";
import { DebuggerState } from "@/enums/server/DebuggerState";
import type { IPCMessage } from "@/server/ipc/IPCMessage";
import { IPCMessageType } from "@/enums/server/ipc/IPCMessageType";
import { IPCMessageTypeDebug } from "@/enums/server/ipc/IPCMessageTypeDebug";
import { PerformanceMonitor } from "@/utility/PerformanceMonitor";
import {
  parseRendererContextMode,
  parseRendererDepthMode,
  RendererContextMode,
  RendererDepthMode,
} from "@/utility/RendererOptions";
import { canAttemptSecurityUnlock } from "@/engine/interaction/ObjectLockRules";

import { buildPartySwitchEntries, nextPartyCycleEntry } from "@/vr/runtime/VRPartySwitchRules";
import { decideVRKnockoutControl } from "@/vr/runtime/VRKnockoutControlRules";
import { VRCutsceneMoveHold } from "@/vr/runtime/VRCutsceneMoveHold";
export interface GameStateInitializeOptions {
  Game: GameEngineType,
  GameDirectory: string, //path to the local game install directory
  Env: GameEngineEnv,
};

const namedGroup = (name: string = 'na'): THREE.Group => {
  const group = new THREE.Group();
  group.name = name;
  return group;
}

/**
 * In-place skill actions, by the parameter that holds their target. These are
 * short jobs done where the player already stands — VR never walks them there —
 * so a stick nudge while one runs should not throw it away.
 */
const VR_IN_PLACE_SKILL_ACTION_TARGET_PARAMETER: ReadonlyMap<number, number> = new Map([
  [ActionType.ActionUnlockObject, 0],
  [ActionType.ActionDisarmMine, 0],
  [ActionType.ActionRecoverMine, 0],
  [ActionType.ActionFlagMine, 0],
  [ActionType.ActionExamineMine, 0],
  [ActionType.ActionSetMine, 1],
]);

/** How far past its use range the player may drift before walking away cancels the job. */
const VR_IN_PLACE_SKILL_ACTION_LEASH_METRES = 1.0;

/**
 * Whether moving the controlled actor should leave its queue alone: only when
 * everything queued is an in-place skill action and the actor is still within
 * reach of each target. Walking off cancels exactly as it does on desktop, and
 * any other queued action (a walk, an attack, a conversation) keeps the desktop
 * rule of cancelling on movement.
 *
 * Found in a headset session (round 7): pressing Security on a Low Security
 * Door and nudging the stick during the 1.5 s pick cleared the unlock with no
 * sound, no failure and the door still locked — repeated a dozen times. Proved
 * in the emulator: a 0.2 s stick deflection 0.6 s into the pick emptied the
 * queue through CreatureLocomotionAdapter.apply.
 */
const VR_COMBAT_ACTIONS_KEPT_WHILE_MOVING: ReadonlySet<number> = new Set<number>([
  ActionType.ActionCombat,
  ActionType.ActionPhysicalAttacks,
  ActionType.ActionItemCastSpell,
  ActionType.ActionCastSpell,
]);

function retainVRInPlaceSkillActionsWhileMoving(actor: ModuleCreature): boolean {
  const queue = actor.actionQueue;
  if (!queue || queue.length === 0) return false;
  for (const action of Array.from(queue) as Action[]) {
    // Fighting is done standing and strafing in VR: an attack round or a
    // scheduled cast (a medpac at the neck, a grenade, a Force power) must
    // survive the player moving. The desktop rule cleared them, so a medpac
    // used while sidestepping vanished from the hand unused (critic run 3).
    // The engine's own approach walk is suppressed in VR, so keeping these
    // cannot drag the player.
    if (VR_COMBAT_ACTIONS_KEPT_WHILE_MOVING.has(action?.type)) continue;
    const targetParameter = VR_IN_PLACE_SKILL_ACTION_TARGET_PARAMETER.get(action?.type);
    if (targetParameter === undefined) return false;
    const target = action.getParameter<ModuleObject>(targetParameter);
    if (!target?.position || !actor.position) return false;
    const reach = getVRInteractionRange(target.objectType) + VR_IN_PLACE_SKILL_ACTION_LEASH_METRES;
    if (distance2D(actor.position, target.position) > reach) return false;
  }
  return true;
}

/**
 * The conversation that has already put a shot on the theater, so its later
 * placed-camera shots stay there. Compared by identity; a new DLG resets it.
 */
let vrTheaterConversation: object | null = null;

/**
 * A conversation that walks the controlled character somewhere plays the walk
 * on the theater and then teleports the view (Allen, 2026-09-26). See
 * VRCutsceneMoveHold.
 */
const vrCutsceneMoveHold = new VRCutsceneMoveHold();

/**
 * The conversation that has moved the player, if any. The rest of it stays in
 * the theater, over black like a movie: round 15's lift scene ran the player
 * out of the lift and pulled the view after it, in the open room.
 */
let vrMovedConversation: object | null = null;

/**
 * Advances the hold once per XR frame. Called from getCutsceneContext, which
 * runs every frame: syncRig does not, since it deliberately skips theater
 * frames, and the walk being watched is on the theater.
 */
function observeVRCutsceneMove(): void {
  const active = VRSpike.isPresenting && GameState.Mode !== EngineMode.MINIGAME && !!GameState.CutsceneManager?.active;
  const state = vrCutsceneMoveHold.update(active, GameState.getCurrentPlayer()?.position ?? null, performance.now());
  if (!active) vrMovedConversation = null;
  else if (state.moving) vrMovedConversation = (GameState.CutsceneManager.dialog ?? null) as object | null;
  if (state.arrived) {
    console.info('[VR cutscene move] arrived; teleporting the view and re-placing the dialogue');
    VRSpike.requestRigReanchor();
  }
}

/** The rig's standing point: the character, or where it stood before a cutscene moved it. */
function resolveVRRigStandingPoint(position: THREE.Vector3 | null): THREE.Vector3 | null {
  const held = vrCutsceneMoveHold.heldPosition;
  return held ? new THREE.Vector3(held.x, held.y, held.z) : position;
}

/**
 * Where the current conversation shot belongs in VR. See
 * resolveVRCutscenePresentation for the rule and why.
 */
function resolveCurrentVRCutscenePresentation(): VRCutscenePresentation {
  // The character is being walked somewhere: show the walk on the theater
  // rather than dragging the wearer along with it.
  if (vrCutsceneMoveHold.isMoving) return 'theater';
  const cutscene = GameState.CutsceneManager;
  const dialog = (cutscene.dialog ?? null) as object | null;
  if (dialog && vrMovedConversation === dialog) return 'theater';
  if (vrTheaterConversation !== dialog) vrTheaterConversation = null;
  const player = GameState.getCurrentPlayer();
  const cameraState = cutscene.cameraState;
  const cameraKind = cameraState?.mode === CameraMode.ANIMATED
    ? 'animated'
    : cameraState?.mode === CameraMode.PLACEABLE ? 'placeable' : 'dialog';
  const camera = GameState.currentCamera;
  // The animated camera is the current camera while it plays; the policy needs
  // its position to tell a move around the player from a remote shot.
  const cameraPosition = cameraKind !== 'dialog' && camera
    ? camera.getWorldPosition(new THREE.Vector3())
    : null;
  const participantPositions: THREE.Vector3[] = [];
  const creatureParticipantPositions: THREE.Vector3[] = [];
  for (const participant of [cameraState?.speaker?.participant, cameraState?.listener?.participant]) {
    if (!participant || participant === player || !participant.position) continue;
    participantPositions.push(participant.position);
    if ((((participant as any).objectType ?? 0) & ModuleObjectType.ModuleCreature) === ModuleObjectType.ModuleCreature) {
      creatureParticipantPositions.push(participant.position);
    }
  }
  const playerRoom = player?.room ?? null;
  const presentation = resolveVRCutscenePresentation({
    animatedCutscene: cutscene.cutsceneMode === CutsceneMode.ANIMATED,
    cameraKind,
    cameraPosition,
    participantPositions,
    creatureParticipantPositions,
    playerPosition: player?.position ?? null,
    isOverPlayerRoom: playerRoom
      ? (point) => {
        const room = findVRRoomUnderPoint(point);
        return room ? room === playerRoom : null;
      }
      : null,
    theaterAlreadyShown: dialog !== null && vrTheaterConversation === dialog,
  });
  if (presentation === 'theater' && dialog) vrTheaterConversation = dialog;
  return presentation;
}

let vrRoomUnderPointCache: { area: unknown; x: number; y: number; z: number; room: ModuleRoom | null } | null = null;

/**
 * The room whose walkable floor lies under a point, nearest below it; null when
 * no floor is under it (a camera outside the hull, say). A room's bounding box
 * cannot stand in for this — see VRCutsceneShot.isOverPlayerRoom. Cached for
 * the last point asked about, since a placed camera holds still for its shot
 * and this is asked several times a frame.
 */
function findVRRoomUnderPoint(point: THREE.Vector3): ModuleRoom | null {
  const area = GameState.module?.area ?? null;
  const cached = vrRoomUnderPointCache;
  if (cached && cached.area === area && cached.x === point.x && cached.y === point.y && cached.z === point.z) {
    return cached.room;
  }
  let found: ModuleRoom | null = null;
  let nearestGap = Number.POSITIVE_INFINITY;
  const onFloor = new THREE.Vector3();
  for (const room of (area?.rooms ?? []) as ModuleRoom[]) {
    const faces = room?.collisionManager?.walkmesh?.walkableFaces;
    if (!faces) continue;
    for (let i = 0, len = faces.length; i < len; i++) {
      const triangle = faces[i]?.triangle;
      if (!triangle || !triangle.containsPoint(point)) continue;
      triangle.closestPointToPoint(point, onFloor);
      // A floor above the point is a different deck, not what it stands over.
      const gap = point.z - onFloor.z;
      if (gap < -0.25 || gap >= nearestGap) continue;
      nearestGap = gap;
      found = room;
    }
  }
  vrRoomUnderPointCache = { area, x: point.x, y: point.y, z: point.z, room: found };
  return found;
}

/** A spoken conversation (not a computer terminal) being held in the world. */
function isVRWorldDialogue(menu: unknown): boolean {
  return !!menu && menu === GameState.MenuManager.InGameDialog &&
    GameState.CutsceneManager.active && VRSpike.isPresenting &&
    GameState.CutsceneManager.dialog?.getConversationType() !== DLGConversationType.COMPUTER &&
    resolveCurrentVRCutscenePresentation() === 'world';
}

/**
 * Menus shown whole: the main menu's layout is placed by its own vertical
 * offset in VRPanelHost and draws the animated scene behind it.
 */
const VR_UNTRIMMED_MENU_RESREFS = new Set(['mainmenu8x6_p', 'mainmenu16x12']);

/** Below the eyeline: the top of the dialogue sits a little under straight ahead. */
const VR_WORLD_DIALOGUE_VERTICAL_OFFSET_METRES = -0.35;

const vrCreatureLocomotionAdapter = new CreatureLocomotionAdapter<ModuleCreature>(
  TURN_SPEED_FAST,
  retainVRInPlaceSkillActionsWhileMoving,
);
let vrCombatIssuedTargetId: number | null = null;
/**
 * Player-paced rounds (round 18): when the player's own last round began, in
 * game time (GameState.time, which stops while the game is paused), and the
 * round action that began it. The next round is available 3 s after it.
 */
let vrOwnRound: { actorId: number; beganAtMs: number; action: unknown } | null = null;
/** Phase G1: the object id VR last selected through CursorManager, if any. */
let vrCursorSelectedTargetId: number | null = null;
let vrCursorSelectionErrorReported = false;

/**
 * Persists across the VR session (ROADMAP 2.5/2.6). Smooth movement and
 * smooth turn are the written default; teleport, snap turn, and the comfort
 * vignette are opt-in alternatives a player switches on, not the other way
 * around.
 */
type MutableVRComfortSettings = {
  -readonly [Property in keyof VRComfortSettings]: VRComfortSettings[Property];
};

const vrComfortSettings: MutableVRComfortSettings = {
  locomotionMode: 'smooth',
  turnMode: 'smooth',
  snapTurnDegrees: 45,
  vignetteEnabled: false,
  damageFlashEnabled: true,
  unpauseOnWheelClose: false,
  combatSoundsEnabled: true,
  healthPlateEnabled: true,
  dialogueTextScale: 1,
};

/**
 * Comfort settings and the weapon hand survive a restart, in the game's own
 * options store (ConfigClient, IndexedDB). They lived only in memory, so a
 * left-handed player re-chose the hand, and a low-vision player the text
 * size, every launch (critic run 7).
 */
const VR_COMFORT_CONFIG_KEY = 'vr_comfort';
let vrComfortSettingsLoaded = false;
const VR_COMFORT_FILE = 'vr-comfort.json';
/**
 * Emulator runs share the user folder with real play; they neither read the
 * player's settings (a left-handed file would change what a check tests) nor
 * write theirs over the player's. Same rule as autosave.
 */
function vrComfortStoreDisabled(): boolean {
  const w: any = typeof window !== 'undefined' ? window : undefined;
  return !!(w && w.__xrHarness && !w.__xrHarnessAllowComfortStore);
}
function loadVRComfortSettingsOnce(): void {
  if (vrComfortSettingsLoaded) return;
  vrComfortSettingsLoaded = true;
  if (vrComfortStoreDisabled()) return;
  // The browser store first (instant), then the file in the user folder,
  // which survives the launcher's fresh browser profile (critic run 8).
  applyStoredVRComfortSettings(ConfigClient.get(VR_COMFORT_CONFIG_KEY));
  void GameFileSystem.readFile(VR_COMFORT_FILE).then((bytes: Uint8Array) => {
    if (!bytes || !bytes.length) return;
    applyStoredVRComfortSettings(JSON.parse(new TextDecoder().decode(bytes)));
  }).catch(() => { /* no file yet */ });
}
function applyStoredVRComfortSettings(stored: any): void {
  try {
    if (!stored || typeof stored !== 'object') return;
    if (stored.locomotionMode === 'smooth' || stored.locomotionMode === 'blink') vrComfortSettings.locomotionMode = stored.locomotionMode;
    if (stored.turnMode === 'smooth' || stored.turnMode === 'snap') vrComfortSettings.turnMode = stored.turnMode;
    if ([30, 45, 60, 90].includes(Number(stored.snapTurnDegrees))) vrComfortSettings.snapTurnDegrees = Number(stored.snapTurnDegrees);
    for (const key of ['vignetteEnabled', 'damageFlashEnabled', 'unpauseOnWheelClose', 'combatSoundsEnabled', 'healthPlateEnabled'] as const) {
      if (typeof stored[key] === 'boolean') (vrComfortSettings as any)[key] = stored[key];
    }
    // The current sizes, and the round-14 sizes mapped onto them: Large and
    // Largest reset to Normal on every launch once the sizes changed (critic run 16).
    {
      const storedScale = Number(stored.dialogueTextScale);
      const migrated = storedScale === 1.25 ? VR_DIALOGUE_TEXT_SCALES[1] : storedScale === 1.45 ? VR_DIALOGUE_TEXT_SCALES[2] : storedScale;
      if ((VR_DIALOGUE_TEXT_SCALES as readonly number[]).includes(migrated)) vrComfortSettings.dialogueTextScale = migrated;
    }
    if (stored.dominantHand === 'left' || stored.dominantHand === 'right') VRSpike.setDominantHand(stored.dominantHand);
  } catch (error) {
    console.warn('[VR comfort] stored settings could not be read', error);
  }
}
function saveVRComfortSettings(): void {
  if (vrComfortStoreDisabled()) return;
  const stored = { ...vrComfortSettings, dominantHand: VRSpike.currentDominantHand };
  try {
    ConfigClient.set(VR_COMFORT_CONFIG_KEY, stored);
  } catch (error) {
    console.warn('[VR comfort] settings could not be saved to the browser store', error);
  }
  void GameFileSystem.writeFile(VR_COMFORT_FILE, new TextEncoder().encode(JSON.stringify(stored, null, 2)))
    .catch((error: unknown) => console.warn('[VR comfort] settings could not be saved to disk', error));
}

// Round 15: Large and Largest were too large and blurred; halfway back
// toward Normal.
const VR_DIALOGUE_TEXT_SCALES = [1, 1.125, 1.225] as const;
const VR_DIALOGUE_TEXT_LABELS = ['Normal', 'Large', 'Largest'] as const;
let vrComfortSettingsPanelOpen = false;
/** The VR Menu paused a running game, so closing it resumes (critic runs 16-17: fights went on behind it). */
let vrComfortSettingsPausedGame = false;
let vrControlsGuideOpen = false;
let vrComfortSettingsPausedByVR = false;

/**
 * Only a live hostile *creature* may be attacked.
 *
 * The creature-type gate is load-bearing, not belt-and-braces. `isHostile`
 * resolves through `FactionManager.GetReputation`, which returns 0 — read as
 * hostile, since `IsHostile` tests `<= 10` — on its type-check failure path.
 * Without this gate a console, container, or door could qualify as a combat
 * target, which is what made the right trigger attack whatever the aim ray
 * happened to be resting on. Bashing a door stays available through its
 * authored ActionMenu route, where the engine owns the rules.
 */
function isVRCombatTarget(actor: ModuleCreature, candidate: ModuleObject | null | undefined): candidate is ModuleObject {
  return !!candidate && candidate !== actor &&
    Number.isInteger(candidate.objectType) &&
    (candidate.objectType & ModuleObjectType.ModuleCreature) !== 0 &&
    typeof candidate.isDead === 'function' && !candidate.isDead() &&
    typeof candidate.isHostile === 'function' && candidate.isHostile(actor);
}

/**
 * TEMPORARY diagnostic for headset R6: "the wheel brings up Attacks on the
 * first try, but the tab does not appear in subsequent tries".
 *
 * The Attacks wedge exists only when createActionWheel resolves a combat
 * target. The builder-side diagnostic could never see this case: it fires only
 * once a target is hostile, and on the failing opens there was no target at
 * all. This reports which of isVRCombatTarget's conditions failed, plus whether
 * a valid hostile was selectable at that moment — which separates "the aim
 * missed" from "the droid stopped qualifying". Once per distinct shape. Remove
 * once the cause is settled.
 */
const reportedVRWheelTargetMisses = new Set<string>();
function reportVRWheelTargetMissOnce(
  actor: ModuleCreature,
  aimedTargetId: number | null,
  candidate: ModuleObject | null,
): void {
  let reason: string;
  if (aimedTargetId === null) reason = 'nothing aimed';
  else if (!candidate) reason = 'aimed id not among playerSelectableObjects';
  else if ((candidate.objectType & ModuleObjectType.ModuleCreature) === 0) reason = 'aimed object is not a creature';
  else if (candidate === actor) reason = 'aimed at the controlled actor';
  else if (typeof candidate.isDead === 'function' && candidate.isDead()) reason = 'aimed creature is dead';
  else if (typeof candidate.isHostile === 'function' && !candidate.isHostile(actor)) {
    reason = 'aimed creature is not hostile to the controlled actor';
  } else reason = 'unknown';
  const selectableHostiles = GameState.ModuleObjectManager.playerSelectableObjects
    .filter((object) => isVRCombatTarget(actor, object)).length;
  const key = `${reason}|${selectableHostiles > 0}`;
  if (reportedVRWheelTargetMisses.has(key)) return;
  reportedVRWheelTargetMisses.add(key);
  console.warn(
    `[VRActionWheel] TEMPORARY: wheel opened with no combat target — ${reason}` +
    ` (aimedTargetId=${aimedTargetId}, candidate=${candidate?.getName?.() ?? 'none'},` +
    ` selectableHostiles=${selectableHostiles}, actor=${actor.getTag?.()},` +
    ` party0=${GameState.PartyManager.party[0]?.getTag?.() ?? 'none'})`
  );
}

/**
 * Resolves VRSpike's live right-hand aim into the actual engine object, from
 * the same set the engine already filters to range/LOS/usability
 * (`playerSelectableObjects`). Combat and Force gesture targeting must use
 * this, not `CursorManager.hoveredObject`/`selectedObject` — those are only
 * ever written by flatscreen mouse handlers and freeze at whatever was last
 * hovered before a WebXR session began.
 */
interface VRKeyboardCapableControl {
  editable?: unknown;
  onKeyDown: (event: { readonly which: number; readonly shiftKey: boolean }) => void;
  children?: unknown;
  menu?: { triggerControllerBPress?: () => void };
}

function isVRKeyboardCapableControl(control: unknown): control is VRKeyboardCapableControl {
  const candidate = control as VRKeyboardCapableControl | null | undefined;
  return !!candidate && candidate.editable === true && typeof candidate.onKeyDown === 'function';
}

/**
 * Depth-first search for the foreground menu's editable text field. Used as
 * the VR keyboard's focus fallback — see `getKeyboardContext` for why relying
 * on `activeGUIElement` alone leaves character creation untypeable in VR.
 */
function findVREditableControl(menu: unknown): VRKeyboardCapableControl | null {
  const root = (menu as { tGuiPanel?: unknown } | null | undefined)?.tGuiPanel;
  if (!root) return null;
  const queue: unknown[] = [root];
  while (queue.length) {
    const control = queue.shift();
    if (isVRKeyboardCapableControl(control)) return control;
    const children = (control as { children?: unknown } | null | undefined)?.children;
    if (Array.isArray(children)) queue.push(...children);
  }
  return null;
}

/**
 * The distance within which a VR attack may actually be issued. Deliberately
 * identical to `ActionPhysicalAttacks.update()`'s own range check (2.0 melee /
 * 15.0 ranged) — that action walks the actor toward anything further away and
 * calls `resetExcitedDuration()` every frame while doing so, which in VR reads
 * as being dragged across the map into walls with battle music that never
 * stops. Refusing to nominate an out-of-range target keeps the engine out of
 * that walk-to branch entirely rather than trying to interrupt it afterwards.
 */
function resolveVRCombatRange(actor: ModuleCreature): number {
  // Melee carries half a metre of VR allowance over the engine's 2.0. The
  // engine measures centre to centre from an avatar the player cannot see;
  // the player measures from their own hand, which reaches past that centre,
  // and an enemy that shuffles as it fights crosses a hard 2.0 line constantly.
  // TalentFeat.inRange already allows 2.25 for the same reason. The approach
  // walk the note above guards against is suppressed for the VR player, so the
  // allowance cannot drag anyone.
  //
  // Ranged uses the flatscreen targeting distance rather than the 15 m walk-to
  // threshold: flatscreen can target anything selectable and walks into 15 m,
  // and VR does not walk the player, so 15 m read as "the range is too short,
  // it needs to target from the same range as the flat version" (round 6).
  return actor.isRangedEquipped() ? GameState.maxSelectableDistance : VR_MELEE_REACH_METRES;
}

const VR_MELEE_REACH_METRES = 2.5;

/**
 * How far away a hostile may be soft-locked, whatever is in the player's hand.
 *
 * Locking and attacking are different questions. The weapon reach above used
 * to answer both, so with a Vibroblade nothing more than 2 m away could be
 * locked at all, a lock was dropped the instant a droid stepped across that
 * line — the ring flicked between grouped enemies as each crossed it — and a
 * grenade or Force power aimed at anything further could never be committed.
 * The lock now follows what the player points at; reach is checked only when a
 * swing or shot is actually dispatched.
 */
// Getter, not a constant: GameState is not initialised when this module loads.
// It matches the engine's selectable distance, so anything the player can
// point at and select can be locked.
function vrCombatLockRangeMetres(): number {
  return GameState.maxSelectableDistance;
}

function distanceVRCombat2D(actor: ModuleCreature, target: ModuleObject): number {
  return Math.hypot(
    actor.position.x - target.position.x,
    actor.position.y - target.position.y
  );
}

function isWithinVRCombatRange(actor: ModuleCreature, target: ModuleObject): boolean {
  return distanceVRCombat2D(actor, target) <= resolveVRCombatRange(actor);
}

function isWithinVRCombatLockRange(actor: ModuleCreature, target: ModuleObject): boolean {
  return distanceVRCombat2D(actor, target) <= vrCombatLockRangeMetres();
}

/** A live hostile the player may hold a lock on — no weapon-reach test. */
function resolveVRLockedHostile(actor: ModuleCreature, targetId: string | null): ModuleObject | null {
  const parsedId = targetId === null ? Number.NaN : Number(targetId);
  if (!Number.isSafeInteger(parsedId)) return null;
  const target = resolveVRAimedObject(parsedId);
  return isVRCombatTarget(actor, target) && isWithinVRCombatLockRange(actor, target) ? target : null;
}

function resolveVRAimedObject(aimedTargetId: number | null): ModuleObject | null {
  if (aimedTargetId === null) return null;
  return GameState.ModuleObjectManager.playerSelectableObjects.find(
    (object) => object.id === aimedTargetId
  ) ?? null;
}

/**
 * A Force power on the wheel shows its cost for this character: powers that
 * cost 25 FP against a 15 FP maximum were offered like any other, with no
 * cost shown (critic run 12). A cast the pool can't pay is refused, with a cue.
 */
function withVRForcePowerCost(label: string, entry: VRActionMenuEntry): string {
  const talent: any = entry?.talent;
  const actor: any = GameState.getCurrentPlayer();
  if (!talent || typeof talent.getForcePointCostFor !== 'function' || !actor || typeof actor.getFP !== 'function') return label;
  try {
    const cost = Number(talent.getForcePointCostFor(actor));
    if (!(cost > 0)) return label;
    // The cost only, never the pool: the label is part of the wheel item's
    // identity, and must not change as Force points regenerate.
    return `${label} · ${cost} FP`;
  } catch {
    return label;
  }
}

function getVRActionLabel(entry: VRActionMenuEntry, target: ModuleObject | null): string {
  // Planting a mine is identified by its action type, not by its icon. The
  // entry ActionMenuManager builds for it carries neither a talent nor an
  // item, and the icon is the mine item's own inventory icon, whose resref
  // does not contain "mine" — so every icon heuristic below falls through and
  // the authored route rendered as the meaningless label "Action". The action
  // type is the one unambiguous signal available here.
  if (entry.action?.type === ActionType.ActionSetMine) return 'Mine';

  // The game's own name for a power or feat ("Stun Droid"), from dialog.tlk;
  // the 2DA label read "Force Power Droid Stun" (critic run 11).
  const talentStrRef = Number(entry.talent?.name);
  if (Number.isInteger(talentStrRef) && talentStrRef >= 0) {
    const tlkName = stripTLKSortPrefix(String(GameState.TLKManager?.GetStringById?.(talentStrRef)?.Value ?? ''));
    if (tlkName) return tlkName;
  }
  const talentLabel = entry.talent?.label ?? entry.talent?.name;
  if (typeof talentLabel === 'string' && talentLabel.trim()) return toPlayerFacingActionLabel(talentLabel);
  const itemName = entry.item?.getName?.();
  if (typeof itemName === 'string' && itemName.trim()) return toPlayerFacingActionLabel(stripTLKSortPrefix(itemName));
  const icon = typeof entry.icon === 'string' ? entry.icon.toLowerCase() : '';
  // ActionMenuManager represents an authored Bash on either a locked door or
  // a locked placeable as `ActionPhysicalAttacks` with the same attack icon.
  // It is a destruction interaction in both cases, not combat against a
  // creature; presenting the placeable form as "Attack" made a required
  // container Bash indistinguishable from ordinary combat in VR.
  if (icon.includes('attack')) {
    const bashTargetTypes = ModuleObjectType.ModuleDoor | ModuleObjectType.ModulePlaceable;
    return ((target?.objectType ?? 0) & bashTargetTypes) !== 0 ? 'Bash' : 'Attack';
  }
  if (icon.includes('security') || icon.includes('unlock') || /(^|_)sec/.test(icon)) return 'Security';
  if (icon.includes('dismine')) return 'Disarm';
  if (icon.includes('recmine')) return 'Recover';
  if (icon.includes('mine')) return 'Mine';
  return 'Action';
}

/** dialog.tlk names some entries with a sort prefix, "{05}Vibroblade"; never shown in game. */
export function stripTLKSortPrefix(text: string): string {
  return text.replace(/^\s*\{\d+\}\s*/, '').trim();
}

function toPlayerFacingActionLabel(label: string): string {
  const trimmed = label.trim();
  if (!/^[A-Z0-9_]+$/.test(trimmed)) return trimmed;
  return trimmed
    .split('_')
    .filter((part) => part !== 'ITEM' && part !== 'ACTION')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ') || 'Action';
}

function getVRActionIcon(entry: VRActionMenuEntry): string | undefined {
  return typeof entry.icon === 'string' && entry.icon.trim() ? entry.icon : undefined;
}

const vrCombatIntentQueue = new VRCombatIntentQueue();
const vrCombatTempoGate = new VRCombatTempoGate();
/** Round 18 — the one stroke silently held for a round a moment away. */
const vrCombatSwingBuffer = new VRCombatSwingBuffer();
/** The held stroke lands within a frame or two, or drops silently. Game time, so a pause keeps it. */
const vrHeldSwingLifetime = new VRHeldSwingLifetime(VR_SILENT_HOLD_MAX_MILLISECONDS);
/** The grenade last scheduled into a round, re-armed if the round rejects it. */
let vrLastThrownGrenade: { actorId: number; sourceKey: string; itemId: unknown } | null = null;
const vrArmedGrenadeState = new VRArmedGrenadeState();
/**
 * ROADMAP 3.20 — the one medpac, stim or repair kit armed in the off hand,
 * used by holding that hand to the neck. Same lifecycle as a grenade: arming
 * never touches the inventory; the commit revalidates the item first.
 */
const vrArmedConsumableState = new VRArmedGrenadeState();
/** Scratch vectors for the headset audio listener, reused every frame. */
const vrAudioListenerPosition = new THREE.Vector3();
const vrAudioListenerForward = new THREE.Vector3();
let vrCombatIntentDispatchInProgress = false;
let vrCombatQueueActorId: number | null = null;
let vrCombatQueueWeaponSignature: string | null = null;
const vrGrenadeInventoryIdentities = new WeakMap<object, number>();
let nextVRGrenadeInventoryIdentity = 1;

interface VRGrenadeInventoryEntry {
  readonly descriptor: VRArmedGrenadeDescriptor;
  readonly item: ModuleItem;
  readonly spellId: number;
}

const VR_GRENADE_BASE_ITEM_IDS = new Set<number>([
  BaseItemType.FRAGMENTATION_GRENADES,
  BaseItemType.STUN_GRENADES,
  BaseItemType.THERMAL_DETONATOR,
  BaseItemType.POISON_GRENADE,
  BaseItemType.FLASH_GRENADE,
  BaseItemType.SONIC_GRENADE,
  BaseItemType.ADHESIVE_GRENADE,
  BaseItemType.CRYOBAN_GRENADE,
  BaseItemType.FIRE_GRENADE,
  BaseItemType.ION_GRENADE,
]);

/** Held to the neck or mouth to use (3.20): stims, medpacs and droid repair kits. */
const VR_CONSUMABLE_BASE_ITEM_IDS = new Set<number>([
  BaseItemType.ADRENALINE,
  BaseItemType.COMBAT_SHOTS,
  BaseItemType.MEDICAL_EQUIPMENT,
  BaseItemType.DROID_REPAIR_EQUIPMENT,
]);

/**
 * `racialtypes.2da` row for droids.
 *
 * Measured from the live game rather than inferred: row 5 is Droid and row 6 is
 * Human (HK-50 and the astromech both report 5; a human NPC reports 6). Worth
 * stating because TSL's equipment screen gates on `getRace() == 6`, which reads
 * like a droid check and is in fact a *human* check — using it here would have
 * exploded every person and no droid.
 */
const VR_RACE_DROID = 5;

/** Melee and ranged attack-mode feat categories in `feat.2da`. */
const VR_MELEE_ATTACK_FEAT_CATEGORY = 0x1104;
const VR_RANGED_ATTACK_FEAT_CATEGORY = 0x1111;

function isVRAttackModeFeat(talent: unknown): talent is TalentFeat {
  const category = (talent as { category?: unknown } | null)?.category;
  return category === VR_MELEE_ATTACK_FEAT_CATEGORY ||
    category === VR_RANGED_ATTACK_FEAT_CATEGORY;
}

/**
 * Plays the equipped blaster's shot sound, as named by `ammunitiontypes.2da`
 * (`shotsound0` — "cb_sh_blast1" for an ordinary blaster). The engine has no
 * working weapon-fire sound at all (`ModuleItem.castAmmunitionAtTarget` is an
 * empty stub), so this is the only place a shot is heard.
 */
function playVRBlasterShotSound(actor: ModuleCreature, slot?: 'LEFTHAND'): void {
  try {
    const weapon = slot === 'LEFTHAND'
      ? actor.equipment?.LEFTHAND
      : actor.equipment?.RIGHTHAND ?? actor.equipment?.LEFTHAND;
    const ammunitionType = weapon?.baseItem?.ammunitionType ?? -1;
    if (ammunitionType < 1) return;
    const row = GameState.TwoDAManager.datatables.get('ammunitiontypes')?.rows?.[ammunitionType];
    const resref = typeof row?.shotsound0 === 'string' ? row.shotsound0 : '';
    if (!resref || resref === '****') return;
    actor.audioEmitter?.playSoundFireAndForget(resref);
  } catch {
    // A missing sound must never interrupt combat input.
  }
}

/**
 * The centre of a door's or placeable's bounds, where a Bash bolt should land.
 * Creature bolts aim at chest height, which clears a footlocker entirely.
 */
function resolveVRStructureAimPoint(target: ModuleObject): THREE.Vector3 | null {
  try {
    const box = target.box;
    if (box && !box.isEmpty()) {
      const centre = box.getCenter(new THREE.Vector3());
      if (Number.isFinite(centre.x) && Number.isFinite(centre.y) && Number.isFinite(centre.z)) return centre;
    }
  } catch {
    // Fall through to the origin estimate.
  }
  return target.position ? target.position.clone().setZ(target.position.z + 0.5) : null;
}

function resolveVRCombatWeaponSignature(actor: ModuleCreature): string {
  switch (resolveVRCombatWeaponMode(actor)) {
    case 'blaster': return 'ranged:blaster';
    case 'melee-one-handed': return 'melee:one-handed';
    case 'melee-double-bladed': return 'melee:double-bladed';
    case 'melee-dual-wield': return 'melee:dual-wield';
    default: return 'unarmed';
  }
}

function resetVREmbodiedCombatState(): void {
  vrCombatIntentQueue.clear();
  vrCombatSwingBuffer.clear();
  vrArmedGrenadeState.cancel();
  vrArmedConsumableState.cancel();
  vrCombatQueueActorId = null;
  vrCombatQueueWeaponSignature = null;
  vrCombatIssuedTargetId = null;
  vrOwnRound = null;
}

function observeVREmbodiedCombatActor(actor: ModuleCreature): void {
  const weaponSignature = resolveVRCombatWeaponSignature(actor);
  if (vrCombatQueueActorId !== actor.id || vrCombatQueueWeaponSignature !== weaponSignature) {
    // A queued weapon feat is legal only for the weapon that supplied it. The
    // inventory and Force queues are separate, so a weapon swap never spends
    // or disarms a selected grenade.
    vrCombatIntentQueue.clearForWeaponChange();
    vrCombatQueueActorId = actor.id;
    vrCombatQueueWeaponSignature = weaponSignature;
  }
}

function getVRGrenadeInventoryIdentity(item: ModuleItem): number {
  const cached = vrGrenadeInventoryIdentities.get(item);
  if (cached !== undefined) return cached;
  const identity = nextVRGrenadeInventoryIdentity++;
  vrGrenadeInventoryIdentities.set(item, identity);
  return identity;
}

function getVRCombatInventory(actor: ModuleCreature): readonly ModuleItem[] {
  const party = GameState.PartyManager?.party;
  if (Array.isArray(party) && party.includes(actor)) {
    return Array.isArray(GameState.InventoryManager?.inventory)
      ? GameState.InventoryManager.inventory
      : [];
  }
  return Array.isArray(actor.inventory) ? actor.inventory : [];
}

function getVRGrenadeLabel(item: ModuleItem): string {
  try {
    const name = item.getName?.();
    if (typeof name === 'string' && name.trim()) return name.trim();
  } catch {
    // Inventory data can be incomplete during a module transition. The icon
    // and source validation below still determine whether we expose an entry.
  }
  return 'Grenade';
}

function getVRGrenadeIcon(item: ModuleItem): string {
  try {
    const icon = item.getIcon?.();
    if (typeof icon === 'string' && icon.trim()) return icon.trim();
  } catch {
    // The generic radial item glyph is intentionally a safe fallback.
  }
  return 'i_grenade';
}

/** "Medpac ×3": the wheel showed no counts (critic runs 15-17). Display only; the id carries no count. */
function withVRStackCount(label: string, item: any): string {
  let count = 1;
  try { count = Number(item?.getStackSize?.()) || 1; } catch { /* one */ }
  return count > 1 ? `${label} ×${count}` : label;
}

function describeVRGrenadeInventory(actor: ModuleCreature): readonly VRGrenadeInventoryEntry[] {
  const descriptions: VRGrenadeInventoryEntry[] = [];
  for (const item of getVRCombatInventory(actor)) {
    if (!item || !VR_GRENADE_BASE_ITEM_IDS.has(item.getBaseItemId?.())) continue;
    const properties = Array.isArray(item.properties) ? item.properties : [];
    for (let propertyIndex = 0; propertyIndex < properties.length; propertyIndex += 1) {
      const property = properties[propertyIndex];
      try {
        if (!property?.isUseable?.() || !property.is(ModuleItemProperty.CastSpell)) continue;
        const spellId = property.getCastSpellId();
        if (!Number.isSafeInteger(spellId) || spellId < 0) continue;
        const itemIdentity = getVRGrenadeInventoryIdentity(item);
        descriptions.push({
          descriptor: {
            sourceKey: `grenade:${itemIdentity}:${propertyIndex}:${spellId}`,
            itemObjectId: itemIdentity,
            label: getVRGrenadeLabel(item),
            icon: getVRGrenadeIcon(item),
          },
          item,
          spellId,
        });
      } catch {
        // Omit a malformed inventory property rather than making the whole
        // radial wheel unavailable during combat.
      }
    }
  }
  return descriptions;
}

function findVRArmedGrenade(actor: ModuleCreature, sourceKey: string): VRGrenadeInventoryEntry | undefined {
  return describeVRGrenadeInventory(actor).find((entry) => entry.descriptor.sourceKey === sourceKey);
}

/**
 * ROADMAP 3.20 — the consumables a hand can hold to the neck. Same shape as
 * the grenade list: one entry per useable CastSpell property, keyed so the
 * commit can find the very item that was armed.
 */
function describeVRConsumableInventory(actor: ModuleCreature): readonly VRGrenadeInventoryEntry[] {
  const descriptions: VRGrenadeInventoryEntry[] = [];
  // Droids use repair kits and nothing else from this list; everyone else
  // uses everything but repair kits. The wheel offered T3 medpacs and the
  // Exile droid repair kits (critic run 3).
  const isDroid = typeof actor.getRace === 'function' && actor.getRace() === VR_RACE_DROID;
  for (const item of getVRCombatInventory(actor)) {
    if (!item || !VR_CONSUMABLE_BASE_ITEM_IDS.has(item.getBaseItemId?.())) continue;
    const repairKit = item.getBaseItemId?.() === BaseItemType.DROID_REPAIR_EQUIPMENT;
    if (repairKit !== isDroid) continue;
    const properties = Array.isArray(item.properties) ? item.properties : [];
    for (let propertyIndex = 0; propertyIndex < properties.length; propertyIndex += 1) {
      const property = properties[propertyIndex];
      try {
        if (!property?.isUseable?.() || !property.is(ModuleItemProperty.CastSpell)) continue;
        const spellId = property.getCastSpellId();
        if (!Number.isSafeInteger(spellId) || spellId < 0) continue;
        const itemIdentity = getVRGrenadeInventoryIdentity(item);
        let icon = 'i_medpac';
        try { icon = item.getIcon?.()?.trim() || icon; } catch { /* keep the fallback */ }
        let label = 'Medpac';
        try { label = item.getName?.()?.trim() || label; } catch { /* keep the fallback */ }
        descriptions.push({
          descriptor: {
            sourceKey: `consumable:${itemIdentity}:${propertyIndex}:${spellId}`,
            itemObjectId: itemIdentity,
            label,
            icon,
          },
          item,
          spellId,
        });
      } catch {
        // A malformed property must not take the Items page down with it.
      }
    }
  }
  return descriptions;
}

function findVRArmedConsumable(actor: ModuleCreature, sourceKey: string): VRGrenadeInventoryEntry | undefined {
  return describeVRConsumableInventory(actor).find((entry) => entry.descriptor.sourceKey === sourceKey);
}

/** TEMPORARY (3.20): names the first few consumable outcomes for the headset. */
let vrConsumableOutcomesReported = 0;
/**
 * A refused grenade, Force cast, medpac or quick save was a console line and
 * nothing in the headset (critic run 3): the player did not know the throw was
 * out of range or the save refused. Every refusal now also sounds.
 */
/** Names of items the actor has scheduled into its combat round, not yet used. */
function resolveVRScheduledItemLabels(actor: ModuleCreature): string[] {
  try {
    const list = actor.combatRound?.scheduledActionList;
    if (!Array.isArray(list)) return [];
    return list
      .filter((action: any) => action?.actionType === CombatActionType.ITEM_CAST_SPELL && action.item)
      .map((action: any) => String(action.item.getName?.() ?? 'Item'));
  } catch {
    return [];
  }
}

/**
 * A combat cue in the attacker's own weapon sounds (weaponsounds.2da), for
 * the struck material, placed at the target's chest (critic run 6: every cue
 * was one flesh sample in the head). Null keeps the cue's defaults.
 */
const vrStrokeWhooshPicker = new VRStrokeWhooshPicker();
/** Force powers picked lately, most recent first: they lead the wheel's Force page (Part F). */
const vrRecentForcePowers = new VRRecentForcePowers();

function resolveVRCombatCueSounds(attackerId: string | number, targetId: string | number, cue: string, stroke?: VRStrokeShape): VRCombatCuePlayOptions | null {
  try {
    const attacker: any = GameState.ModuleObjectManager.GetObjectById?.(Number(attackerId));
    const target: any = GameState.ModuleObjectManager.GetObjectById?.(Number(targetId));
    if (!target?.position) return null;
    const chest = (o: any) => ({ x: o.position.x, y: o.position.y, z: o.position.z + 1.0 });
    // A miss is the attacker's own whoosh, heard at the attacker; a parry is
    // the defender's blade, at the defender (critic run 7).
    const weapon: any = resolveVRAttackWeapon(attacker);
    // A melee miss is the attacker's whoosh, at the attacker; a missed bolt
    // strikes past the target, so it is heard there (critic run 8).
    let position = cue === 'miss' && attacker?.position && !weapon?.baseItem?.rangedWeapon ? chest(attacker) : chest(target);
    // A blow on the player is heard where it came from (Part D, Spark
    // Finding 1): a melee impact at the attacker, a bolt's 1 m from the
    // player toward the shooter. The PC's pain grunt is the in-head part.
    if ((cue === 'hurt' || cue === 'hurt-critical') && attacker?.position) {
      if (!weapon?.baseItem?.rangedWeapon) position = chest(attacker);
      else {
        const dx = attacker.position.x - target.position.x, dy = attacker.position.y - target.position.y;
        const len = Math.hypot(dx, dy) || 1;
        position = { x: target.position.x + dx / len, y: target.position.y + dy / len, z: target.position.z + 1.0 };
      }
    }
    // A missed bolt strikes past the target: 1.5 m beyond it along the shot.
    if (cue === 'miss' && weapon?.baseItem?.rangedWeapon && attacker?.position) {
      const dx = target.position.x - attacker.position.x, dy = target.position.y - attacker.position.y;
      const len = Math.hypot(dx, dy) || 1;
      position = { x: target.position.x + dx / len * 1.5, y: target.position.y + dy / len * 1.5, z: target.position.z + 1.0 };
    }
    const material = resolveVRImpactMaterialFor(target);
    const impactCue = cue === 'hit' || cue === 'hurt' || cue === 'critical' || cue === 'hurt-critical';
    const critical = cue === 'critical' || cue === 'hurt-critical';
    // A blaster has no weaponsounds row; retail's bolt impacts are named by
    // material (cb_ht_blast*, medbl*, hvybl*).
    if (weapon?.baseItem?.rangedWeapon && impactCue) {
      const bolt = resolveVRBoltImpact(weapon, material);
      return bolt ? { position, sounds: [critical ? { resref: bolt, at: 0, gain: 1.35, rate: 0.85 } : { resref: bolt, at: 0, gain: 1 }] } : { position };
    }
    // No weapon in hand fights with the Unarmed row (weaponsounds.2da row 0).
    const sounds: any = weapon ? weapon.weaponSound : GameState.SWRuleSet?.weaponSounds?.[0];
    const parrySounds: any = cue === 'parried' ? (resolveVRAttackWeapon(target)?.weaponSound ?? sounds) : sounds;
    if (!sounds) return { position };
    // A physical stroke rotates the weapon's own swing takes (Part F).
    if (cue === 'whoosh' && stroke) {
      const picked = vrStrokeWhooshPicker.pick(sounds, stroke);
      if (picked) return { position, sounds: [{ resref: picked.resref, at: 0, gain: 1, rate: picked.rate }] };
    }
    let resrefs: string[] = [];
    if (cue === 'hit' || cue === 'hurt') resrefs = [impactResRef(sounds, material, Math.random() < 0.5 ? 0 : 1)];
    // Both impact variants together: heavier than a hit, and nothing to do
    // with the parry clang (critic run 7: a crit sounded like a parry).
    else if (critical) resrefs = [impactResRef(sounds, material, 0)];
    else if (cue === 'miss' || cue === 'whoosh') resrefs = [String(sounds.swingShort0 || '')];
    else if (cue === 'parried') resrefs = [String(parrySounds?.parry0 || '')];
    resrefs = resrefs.filter(Boolean);
    if (!resrefs.length) return { position };
    // A saber critical is retail's heavy saber impact, not the hit re-pitched (Part D).
    const saberCritical = cue === 'critical' ? resolveVRCriticalImpact(resrefs[0]) : null;
    if (saberCritical) return { position, sounds: [{ resref: saberCritical, at: 0, gain: 1.15 }] };
    return {
      position,
      // A critical: louder and pitched down, one sample (critic run 8).
      sounds: resrefs.map((resref) => critical ? { resref, at: 0, gain: 1.35, rate: 0.85 } : { resref, at: 0, gain: 1 }),
    };
  } catch {
    return null;
  }
}

/**
 * A creature's own retail soundset line for a combat moment (Part D): its
 * SSF's PAIN_1/PAIN_2, LOW_HEALTH or CRITICAL_HIT. The controlled creature is
 * heard in the head; a PC with no SSF (retail TSL has none) uses the PC
 * soundset's lines from dialog.tlk, by gender. Anyone else is heard at them.
 */
function resolveVRCombatBark(creatureId: string | number, kind: VRCombatBarkKind): VRCombatCuePlayOptions | null {
  try {
    const creature: any = GameState.ModuleObjectManager.GetObjectById?.(Number(creatureId));
    if (!creature?.position) return null;
    const isPlayer = creature === GameState.getCurrentPlayer();
    let resref = '';
    if (creature.ssf && typeof creature.ssf.GetSoundResRef === 'function') {
      const types = kind === 'pain' ? [SSFType.PAIN_1, SSFType.PAIN_2]
        : kind === 'select' ? [SSFType.SELECT_1, SSFType.SELECT_2, SSFType.SELECT_3]
        : [kind === 'low-health' ? SSFType.LOW_HEALTH : SSFType.CRITICAL_HIT];
      resref = pickVRBark(types.map((t) => String(creature.ssf.GetSoundResRef(t) ?? '').replace(/\0.*$/g, '')));
    } else if (isPlayer) {
      resref = pickVRBark(describeVRPlayerBarks(kind, Number(creature.getGender?.() ?? 0)));
    }
    if (!resref) return null;
    return {
      position: isPlayer ? null : { x: creature.position.x, y: creature.position.y, z: creature.position.z + 1.0 },
      sounds: [{ resref, at: 0, gain: 1 }],
    };
  } catch {
    return null;
  }
}

/** The weapon an attack is made with: right hand, then left, then a creature weapon. */
function resolveVRAttackWeapon(attacker: any): any {
  const e = attacker?.equipment;
  return e?.RIGHTHAND ?? e?.LEFTHAND ?? e?.CLAW1 ?? e?.CLAW2 ?? e?.CLAW3 ?? undefined;
}

/** Retail bolt impact by blaster family and struck material (chitin.key cb_ht_*). */
/**
 * A bolt's impact as retail picks it: baseitems.2da `ammunitiontype` names an
 * ammunitiontypes.2da row, whose `impactsound0` is the sound (Blaster
 * cb_ht_blastleth1, Ion medblleth1, Disruptor and Sonic hvyblleth1), the same
 * whatever is struck. Choosing by grip played ion impacts for a Blaster Rifle
 * (critic run 8, read from the retail tables).
 */
function resolveVRBoltImpact(weapon: any, material: string): string {
  const row = GameState.TwoDAManager?.datatables?.get('ammunitiontypes')?.rows?.[Number(weapon?.baseItem?.ammunitionType)];
  const base = String(row?.impactsound0 ?? '');
  // Retail plays the ammunition row's one impact whatever is struck: the
  // tables and the executable's strings show no per-material bolt lookup
  // (critic run 10, checked against the retail files; run 9's material
  // variant is reverted).
  return base && base !== '****' ? base : 'cb_ht_blastleth1';
}

/**
 * Why the player cannot act, if an effect holds them: stunned, knocked down,
 * paralysed, choked, held, frightened, asleep. Any source - Force Stun, a
 * stun grenade, Horror, a feat - not only the feat stun (critic run 7).
 */
function resolveVRPlayerDisabledState(): string | null {
  const player: any = GameState.getCurrentPlayer();
  if (!player || !Array.isArray(player.effects)) return null;
  // Cutscene holds use the same states (EffectCutSceneParalyze on Peragus's
  // T3 hand-over): no plate over a scene (critic run 8).
  if (GameState.Mode === EngineMode.DIALOG || GameState.CutsceneManager?.active || player.cutsceneMode) return null;
  for (const effect of player.effects) {
    if (!effect) continue;
    if (effect.type === GameEffectType.EffectKnockdown) return 'Knocked down';
    if (effect.type === GameEffectType.EffectSetState) {
      switch (Number(effect.getInt?.(0))) {
        case 1: return 'Confused';
        case 2: return 'Frightened';
        case 3: case 4: return 'Stunned';
        case 5: return 'Paralysed';
        case 6: return 'Asleep';
        case 7: return 'Choked';
        case 8: return 'Horrified';
        case 9: return 'Knocked back';
        case 10: return 'Held';
      }
    }
  }
  return null;
}

/** Every sound the player's own fights can use now, for preloading. */
function resolveVRCombatPreloadSounds(): string[] {
  const out = new Set<string>();
  const rows: any[] = Object.values(GameState.SWRuleSet?.weaponSounds ?? {});
  for (const row of rows) {
    for (const key of ['leather0', 'leather1', 'metal0', 'metal1', 'armor0', 'armor1', 'cloth0', 'cloth1', 'parry0',
      'swingShort0', 'swingShort1', 'swingShort2', 'swingLong0', 'swingLong1', 'swingLong2']) {
      if (row?.[key]) out.add(String(row[key]));
    }
  }
  for (const resref of describeVRCombatVoicingSounds()) out.add(resref);
  for (const family of ['blast', 'medbl', 'hvybl']) {
    for (const suffix of ['leth1', 'metal', 'arm1', 'clth1']) out.add(`cb_ht_${family}${suffix}`);
  }
  return [...out];
}

function signalVRRefusal(shape: string): void {
  // A cancellation is a refusal the player did not ask for (the armed item
  // left the bag), so it blips too (critic run 4).
  if (!shape.startsWith('refused') && !shape.startsWith('cancelled')) return;
  try { VRSpike.signalRefusal(shape); } catch { /* feedback is best effort */ }
}

const vrRefusalTickThrottle = new VRRefusalTickThrottle();
const reportedVRRefusalTicks = new Set<VRRefusalTickReason>();

/**
 * Part F (decision 2 of 2026-10-13): a refused gesture or input plays the
 * soft refused tick only - no text - throttled so it never spams.
 */
function tickVRRefusal(reason: VRRefusalTickReason): void {
  if (!vrRefusalTickThrottle.allow(reason, performance.now())) return;
  try { VRSpike.playRefusedCue(); } catch { /* feedback is best effort */ }
  if (!reportedVRRefusalTicks.has(reason)) {
    reportedVRRefusalTicks.add(reason);
    console.info(`[VR combat] refused tick: ${reason}`);
  }
}

function reportVRConsumableOutcome(shape: string, detail = ''): void {
  signalVRRefusal(shape);
  if (vrConsumableOutcomesReported >= 12) return;
  vrConsumableOutcomesReported += 1;
  console.info(`[VR consumable] TEMPORARY ${shape}${detail ? ' || ' + detail : ''}`);
}

/**
 * ROADMAP 3.20 — the armed consumable was held to the neck: use it on the
 * actor by the route retail uses. In a fight that is a CombatRound
 * ITEM_CAST_SPELL on self, which spends the round's action exactly as a
 * grenade throw does; out of one it is the inventory screen's own
 * `useItemOnObject`, an authored ActionItemCastSpell, so a medpac between
 * fights never drags the actor into combat state. Either way the item's
 * spell, and the charge or stack it costs, are the engine's.
 */
let vrFullHealthRefusedUntil = 0;
function commitVRArmedConsumable(actor: ModuleCreature): boolean {
  const request = vrArmedConsumableState.requestCommit();
  if (request.state !== 'armed') return false;
  const source = findVRArmedConsumable(actor, request.grenade.sourceKey);
  if (!source) {
    reportVRConsumableOutcome('cancelled: armed item no longer in the inventory', request.grenade.label);
    vrArmedConsumableState.cancel();
    return false;
  }
  if (typeof actor.isDead === 'function' && actor.isDead()) return false;
  // A medpac at full health would be wasted: an accidental brush of the
  // neck used one at 36/36 HP (critic run 13). It stays armed.
  if (Number((source.item as any).baseItemId) === 55 && actor.getHP() >= actor.getMaxHP()) {
    vrArmedConsumableState.completeCommit({ sourceKey: source.descriptor.sourceKey, engineAccepted: false });
    // Once per touch: held at the neck it refused every 1.3 s (critic run 14).
    const now = performance.now();
    if (now >= vrFullHealthRefusedUntil) reportVRConsumableOutcome('refused: already at full health', source.descriptor.label);
    vrFullHealthRefusedUntil = now + 3000;
    return false;
  }
  try {
    const inCombat = actor.combatData?.combatState === true ||
      actor.actionQueue.actionTypeExists(ActionType.ActionCombat);
    if (inCombat) {
      const action = new CombatRoundAction(actor);
      action.actionType = CombatActionType.ITEM_CAST_SPELL;
      action.target = actor;
      action.item = source.item;
      action.setSpell(new GameState.TalentSpell(source.spellId));
      action.isUserAction = true;
      actor.combatRound.addAction(action);
      if (!actor.actionQueue.actionTypeExists(ActionType.ActionCombat)) {
        actor.actionQueue.add(new GameState.ActionFactory.ActionCombat(0xFFFF));
      }
    } else {
      source.item.useItemOnObject(actor, actor);
    }
    vrArmedConsumableState.completeCommit({ sourceKey: source.descriptor.sourceKey, engineAccepted: true });
    reportVRConsumableOutcome(inCombat ? 'used: scheduled into the combat round' : 'used: queued as an item cast',
      `item=${source.descriptor.label} spell=${source.spellId}`);
    return true;
  } catch (error) {
    reportVRConsumableOutcome('refused: use threw', String(error));
    vrArmedConsumableState.cancel();
    return false;
  }
}

function getVREmbodiedTempoResult(
  actor: ModuleCreature,
  target: ModuleObject | null,
  // Grenades and Force powers are range-checked by their own spell, not by the
  // weapon in hand; only a swing or shot needs the target inside weapon reach.
  reach: 'weapon' | 'lock' = 'weapon',
) {
  const round = actor.combatRound;
  const withinReach = !!target && (reach === 'weapon'
    ? isWithinVRCombatRange(actor, target)
    : isWithinVRCombatLockRange(actor, target));
  return vrCombatTempoGate.evaluate({
    actorCanAct: typeof actor.isDead === 'function' && !actor.isDead(),
    hasLiveTarget: !!target && isVRCombatTarget(actor, target) && withinReach,
    combatRound: round ? {
      roundStarted: round.roundStarted === true,
      roundPaused: round.roundPaused === true,
      scheduledActionCount: Array.isArray(round.scheduledActionList) ? round.scheduledActionList.length : 0,
      playerActionCommitted: round.action !== undefined,
      // A round's later attacks are spent by resolveVRPlayerStroke
      // before the gate is asked; the gate never opens for them, so a held
      // extra can never also take the intent queue's head.
      additionalActionWindowOpen: false,
    } : undefined,
  });
}

function resolveVRLiveCombatTarget(actor: ModuleCreature, targetId: string | null): ModuleObject | null {
  const parsedId = targetId === null ? Number.NaN : Number(targetId);
  if (!Number.isSafeInteger(parsedId)) return null;
  const target = resolveVRAimedObject(parsedId);
  return isVRCombatTarget(actor, target) && isWithinVRCombatRange(actor, target) ? target : null;
}

/**
 * TEMPORARY diagnostic for headset round 5: "rounds failed several times and
 * did not register a swing", "choosing Critical Strike resulted in a frozen
 * queue", "queued but never used".
 *
 * Driven through the real wheel route on the live page, the queue dispatched
 * Critical Strike on the next swing and consumed it — so the queue itself is
 * sound, and the failures sit in whatever stopped a physical swing reaching it.
 * Every rejected or deferred swing now names its reason — out of weapon reach
 * (with the distance), which tempo gate was shut, or which dispatcher state the
 * queue head produced. Once per distinct shape so a fight cannot flood the
 * console. Remove once the next headset run has settled it.
 */
const reportedVRSwingOutcomes = new Set<string>();

function reportVRSwingOutcomeOnce(shape: string, detail: string): void {
  if (reportedVRSwingOutcomes.has(shape)) return;
  reportedVRSwingOutcomes.add(shape);
  console.info(`[VR combat swing] TEMPORARY ${shape} || ${detail}`);
}

function dispatchVREmbodiedCombatInput(
  actor: ModuleCreature,
  targetId: string | null,
  input: VRCombatRequiredInput,
  fromHold = false,
): boolean {
  const head = vrCombatIntentQueue.getHead();
  // A trigger pull with a trigger-cast Force power at the head casts it,
  // checked against the power's own range and the lock - not the melee
  // weapon's 2.5 m reach, which refused Droid Stun at 4.9 m (round 15, N7).
  if (input === 'dominant-trigger' && head?.kind === 'force-power' && head.requiredInput === 'dominant-trigger') {
    return dispatchVRForceCastGesture(actor, targetId);
  }
  // Player-paced rounds (round 18): an idle player's stroke begins the round
  // at once. Inside a running round a stroke spends the round's next held
  // attack (T-B: Flurry / Rapid Shot's extra, a second blade) or only
  // whooshes; one made a moment before the next round is ready is held for
  // it, silently. Nothing about a stroke that does nothing is shown.
  const decision = resolveVRPlayerStroke(actor, targetId, 'main');
  if (decision === 'spent') return true;
  if (decision === 'whoosh') return false;
  const initialTarget = resolveVRLiveCombatTarget(actor, targetId);
  const headLabel = head ? `${head.label}(${head.requiredInput},${head.weaponSignature})` : 'none';
  if (decision === 'hold') {
    if (initialTarget && (input === 'dominant-swing' || input === 'dominant-trigger')) {
      vrCombatSwingBuffer.hold({
        actorId: String(actor.id),
        targetId: String(initialTarget.id),
        input,
        weaponSignature: resolveVRCombatWeaponSignature(actor),
      });
      vrHeldSwingLifetime.restart();
      reportVRRoundStrokeOnce('held', 'the next round is a moment away');
    }
    return false;
  }
  // A duel partner's attack begins the player's round too and holds it for
  // half a round. The player's 3 s are up, so the stroke ends that borrowed
  // round and begins the player's own - but only for a stroke that can land.
  if (initialTarget) takeOverVRPlayerRoundIfBorrowed(actor);
  const tempo = getVREmbodiedTempoResult(actor, initialTarget);
  if (!tempo.eligible) {
    let distance = 'n/a';
    try {
      const locked = resolveVRLockedHostile(actor, targetId);
      if (locked) distance = distanceVRCombat2D(actor, locked).toFixed(1);
    } catch { /* diagnostic only */ }
    // Out of reach: the soft refused tick, no text (round 18: "Too far: step
    // in" was a notice for a stroke that does nothing). A held stroke that
    // finds its target gone says nothing at all.
    if (!fromHold && (input === 'dominant-swing' || input === 'dominant-trigger') && distance !== 'n/a' &&
      Number(distance) > Number(resolveVRCombatRange(actor))) {
      tickVRRefusal('stroke-out-of-reach');
    }
    reportVRSwingOutcomeOnce(
      `refused input=${input} reason=${tempo.reason} head=${head ? head.label : 'none'}`,
      `target=${targetId} distance=${distance} reach=${resolveVRCombatRange(actor)} weapon=${resolveVRCombatWeaponSignature(actor)} head=${headLabel}`,
    );
    return false;
  }

  const dispatcher = new VRCombatIntentDispatcher<ModuleObject, VRCombatIntent>(vrCombatIntentQueue, {
    resolveLiveTarget: () => resolveVRLiveCombatTarget(actor, targetId) ?? undefined,
    resolveIntent: (intent) => intent,
    dispatchIntent: (intent, target) => dispatchVRCombatIntent(actor, target, intent),
    dispatchBasic: (target) => {
      try {
        actor.attackCreature(target);
        return true;
      } catch {
        return false;
      }
    },
  });
  const result = dispatcher.dispatch({
    currentWeaponSignature: resolveVRCombatWeaponSignature(actor),
    input,
  });
  // The head waits for another input (Force Push needs a flick): the pull
  // still attacks, and the tick says the queued action did not take it
  // (Tempo run 2, finding 3: "refused in silence").
  if (input === 'dominant-trigger' && (result.state === 'deferred-input-mismatch' || result.state === 'deferred-weapon-mismatch')) {
    tickVRRefusal('trigger-cannot-serve-head');
  }
  reportVRSwingOutcomeOnce(
    `dispatch input=${input} state=${result.state}${'reason' in result ? ' reason=' + result.reason : ''} head=${head ? head.label : 'none'}`,
    `target=${targetId} weapon=${resolveVRCombatWeaponSignature(actor)} head=${headLabel} queueAfter=${vrCombatIntentQueue.getSnapshot().entries.length}`,
  );
  if (result.state === 'basic-dispatched' || result.state === 'intent-dispatched' ||
    result.state === 'intent-skipped-invalid' || result.state === 'deferred-input-mismatch' ||
    result.state === 'deferred-weapon-mismatch') {
    vrCombatIssuedTargetId = initialTarget.id;
    return true;
  }
  return false;
}

const reportedVRRoundStrokes = new Set<string>();

function vrGameNowMs(): number {
  const seconds = Number(GameState.time);
  return Number.isFinite(seconds) ? seconds * 1000 : 0;
}

/**
 * Notes when the player's own round began. Run every VR combat frame: a round
 * the player began runs on the player's own pause (an attack, a Force power,
 * a grenade or a medpac), with a new round action each time.
 */
function observeVRPlayerRound(actor: ModuleCreature): void {
  const round = actor.combatRound;
  if (!round) return;
  if (vrOwnRound && vrOwnRound.actorId !== actor.id) vrOwnRound = null;
  if (round.roundStarted === true && round.roundPaused === true && round.roundPausedBy === actor &&
    round.action !== undefined && round.action !== vrOwnRound?.action) {
    const into = Number(round.pauseLength) - Number(round.pauseTimer);
    vrOwnRound = {
      actorId: actor.id,
      beganAtMs: vrGameNowMs() - (Number.isFinite(into) && into > 0 ? into : 0),
      action: round.action,
    };
  }
}

interface VRPlayerRoundState {
  /** How long until the player may begin the next round; 0 is now. */
  readonly untilReadyMs: number;
  /** Something of the player's own is committed for the coming round, not yet begun. */
  readonly openingPending: boolean;
  /** The engine round is running on the player's own pause. */
  readonly pausedBySelf: boolean;
}

function resolveVRPlayerRoundState(actor: ModuleCreature): VRPlayerRoundState {
  observeVRPlayerRound(actor);
  const round = actor.combatRound;
  if (!round) return { untilReadyMs: 0, openingPending: false, pausedBySelf: false };
  const pausedBySelf = round.roundStarted === true && round.roundPaused === true && round.roundPausedBy === actor;
  const scheduled = Array.isArray(round.scheduledActionList) ? round.scheduledActionList.length : 0;
  return {
    untilReadyMs: resolveVRPlayerRoundUntilReadyMs({
      ownPauseRemainingMs: pausedBySelf ? Number(round.pauseTimer) : null,
      sinceOwnRoundBeganMs: vrOwnRound && vrOwnRound.actorId === actor.id ? vrGameNowMs() - vrOwnRound.beganAtMs : null,
    }),
    openingPending: scheduled > 0 || (round.roundStarted !== true && round.action !== undefined),
    pausedBySelf,
  };
}

/**
 * Ends a round a duel partner began on the player (ActionPhysicalAttacks'
 * dueling branch holds it for half a round) once the player's own 3 s are
 * up, so the player's next action begins at once instead of waiting it out.
 * The player's own round is never cut short. Ending it runs no script for the
 * controlled character (ModuleCreature.onCombatRoundEnd).
 */
function takeOverVRPlayerRoundIfBorrowed(actor: ModuleCreature): boolean {
  const round = actor.combatRound;
  if (!round) return false;
  const state = resolveVRPlayerRoundState(actor);
  if (!shouldTakeOverVRPlayerRound({ roundStarted: round.roundStarted === true, pausedBySelf: state.pausedBySelf, untilReadyMs: state.untilReadyMs })) {
    return false;
  }
  const by: any = round.roundPausedBy;
  reportVRRoundStrokeOnce('took over a borrowed round', `paused by ${by?.getTag?.() ?? 'nobody'} left=${Math.round(Number(round.pauseTimer))} ms`);
  round.endCombatRound();
  return true;
}

/**
 * Player-paced rounds (round 18) and T-B (locked decision 2): the stroke
 * opens the player's round when it is ready; inside a running round it
 * spends the next held attack its hand can make (CombatRound.holdsLaterAttacks,
 * at the round's own target) or does nothing; a moment before the next round
 * it is held for it.
 */
function resolveVRPlayerStroke(
  actor: ModuleCreature,
  targetId: string | null,
  hand: VRStrokeHand,
): 'spent' | 'whoosh' | 'hold' | 'open' {
  const round = actor.combatRound;
  if (!round) return hand === 'off' ? 'whoosh' : 'open';
  const target = resolveVRLiveCombatTarget(actor, targetId);
  const atRoundTarget = !!target && round.action?.target === target;
  const state = resolveVRPlayerRoundState(actor);
  const decision = resolveVRRoundStroke({
    hand,
    heldAttacks: atRoundTarget && typeof round.heldAttackCount === 'function' ? round.heldAttackCount(hand) : 0,
    untilReadyMs: state.untilReadyMs,
    openingPending: state.openingPending,
  });
  reportVRNearReadyStroke(hand, decision, state.untilReadyMs);
  if (decision === 'spend') {
    const result = round.resolveHeldAttack(actor, hand);
    reportVRRoundStrokeOnce(`spent hand=${hand}`, `result=${result} left main=${round.heldAttackCount('main')} off=${round.heldAttackCount('off')}`);
    return result === undefined ? 'whoosh' : 'spent';
  }
  if (decision === 'whoosh') {
    reportVRRoundStrokeOnce(`whoosh hand=${hand}`, state.openingPending
      ? 'the coming round has its action'
      : `round has no attack left for this hand; ready in ${Math.round(state.untilReadyMs)} ms`);
    return 'whoosh';
  }
  return decision;
}

/**
 * TEMPORARY (headset round 18, the silent hold): every weapon-hand stroke
 * that comes within 800 ms of the next round being ready, with how early it
 * was and what it did, so the headset's own timing can settle
 * VR_SILENT_HOLD_MILLISECONDS (tuned on emulator strokes: 48-280 ms early).
 * At most 40 a session.
 */
let vrNearReadyStrokesReported = 0;
function reportVRNearReadyStroke(hand: VRStrokeHand, decision: string, untilReadyMs: number): void {
  if (hand !== 'main' || !(untilReadyMs > 0) || untilReadyMs > 800 || vrNearReadyStrokesReported >= 40) return;
  vrNearReadyStrokesReported += 1;
  console.info(`[VR combat stroke] TEMPORARY near-ready ${decision} early=${Math.round(untilReadyMs)} ms`);
}

function reportVRRoundStrokeOnce(shape: string, detail: string): void {
  if (reportedVRRoundStrokes.has(shape)) return;
  reportedVRRoundStrokes.add(shape);
  console.info(`[VR combat stroke] ${shape} || ${detail}`);
}

/**
 * An off-hand stroke (two melee weapons) or off-hand trigger pull (two
 * blasters). It spends the round's off-hand attack and nothing else; it never
 * opens a round. A blaster pull with no round running still opens one, as
 * either trigger always has ('pass').
 */
function dispatchVROffhandCombatInput(actor: ModuleCreature, targetId: string | null, input: 'stroke' | 'trigger'): 'spent' | 'absorbed' | 'pass' {
  const round = actor.combatRound;
  const target = resolveVRLiveCombatTarget(actor, targetId);
  const offHeld = !!round && !!target && round.action?.target === target ? round.heldAttackCount('off') : 0;
  if (input === 'stroke' || offHeld > 0) return resolveVRPlayerStroke(actor, targetId, 'off') === 'spent' ? 'spent' : 'absorbed';
  // A pull with no off-hand attack to spend: either trigger opens a round,
  // or is held a moment for the next one, as the weapon hand's would be -
  // but never takes an attack the round holds for the weapon hand.
  if (round && round.heldAttackCount('main') > 0) return 'absorbed';
  const state = resolveVRPlayerRoundState(actor);
  const asWeaponHand = resolveVRRoundStroke({
    hand: 'main',
    heldAttacks: 0,
    untilReadyMs: state.untilReadyMs,
    openingPending: state.openingPending,
  });
  return asWeaponHand === 'whoosh' ? 'absorbed' : 'pass';
}

/** The round's held attacks at its own, still-live target, for the hilt pips. */
function resolveVRRoundAttackPips(actor: ModuleCreature): VRRoundAttackPips {
  const round = actor.combatRound;
  if (!round || round.roundStarted !== true || typeof round.heldAttackCount !== 'function') return NO_VR_ROUND_ATTACK_PIPS;
  return normalizeVRRoundAttackPips({ main: round.heldAttackCount('main'), off: round.heldAttackCount('off') });
}

/**
 * T-B: in VR the current player rolls a round's first attack when the round
 * opens and each later one with a stroke of its own. Everyone else, and the
 * player outside VR, rolls the whole round at once (retail).
 */
CombatRound.holdsLaterAttacks = (owner) => VRSpike.isPresenting === true && owner === GameState.getCurrentPlayer();

/**
 * ROADMAP 3.16 — the space a melee swing must pass through to count: a
 * vertical capsule on the target's feet. The radius is the appearance's
 * personal space, the same number the engine keeps creatures apart by.
 */
function resolveVRCombatTargetVolume(target: ModuleObject | null) {
  if (!target?.position) return null;
  const creature = target as ModuleCreature;
  const personalSpace = typeof creature.getPersonalSpace === 'function' ? Number(creature.getPersonalSpace()) : NaN;
  return {
    base: target.position.clone(),
    heightMetres: VR_COMBAT_TARGET_HEIGHT_METRES,
    radiusMetres: Number.isFinite(personalSpace) && personalSpace > 0
      ? Math.max(personalSpace, VR_COMBAT_TARGET_MIN_RADIUS_METRES)
      : VR_COMBAT_TARGET_DEFAULT_RADIUS_METRES,
  };
}

/**
 * ROADMAP 3.17 — a locked door or container the weapon hand is pointing at,
 * and the space a swing must pass through to bash it. Cheap enough for every
 * frame: it does not touch ActionMenuManager. Whether Bash is actually on
 * offer is settled at dispatch, by the authored route itself.
 */
function resolveVRWeaponBashTarget(actor: ModuleCreature, targetId: number | null) {
  if (targetId === null || !Number.isSafeInteger(targetId)) return null;
  const mode = resolveVRCombatWeaponMode(actor);
  if (mode === 'blaster' || mode === 'grenade' || mode === 'force') return null;
  const target = GameState.ModuleObjectManager.playerSelectableObjects.find((object) => object.id === targetId);
  if (!target) return null;
  const bashTargetTypes = ModuleObjectType.ModuleDoor | ModuleObjectType.ModulePlaceable;
  if (((target.objectType ?? 0) & bashTargetTypes) === 0) return null;
  const lockable = target as ModuleObject & { isLocked?: () => boolean };
  if (typeof lockable.isLocked !== 'function' || !lockable.isLocked()) return null;
  const centre = resolveVRStructureAimPoint(target);
  if (!centre) return null;
  return {
    target,
    volume: {
      base: centre.clone().setZ(centre.z - VR_BASH_VOLUME_HEIGHT_METRES / 2),
      heightMetres: VR_BASH_VOLUME_HEIGHT_METRES,
      radiusMetres: VR_BASH_VOLUME_RADIUS_METRES,
    },
  };
}

/**
 * The object the player last chose Bash on from its world prompt. A swing
 * bashes only this target: swing-to-bash used to fire on any locked door or
 * container the weapon hand pointed at, which bashed things while the player
 * was reaching for other prompt options (Allen, 2026-09-26). Picking any
 * other prompt entry disarms it.
 */
let vrArmedBashTargetId: number | null = null;

/** Arms Bash for the prompt's object when the entry picked was Bash. */
export function resolveArmedBashTargetId(promptId: string | null, label: string): number | null {
  const match = /^module-object:(\d+)$/.exec(promptId ?? '');
  return label === 'Bash' && match ? Number(match[1]) : null;
}

const reportedVRWeaponBashRefusals = new Set<number>();
function reportVRWeaponBashRefusalOnce(target: ModuleObject, reason: string): void {
  if (reportedVRWeaponBashRefusals.has(target.id)) return;
  reportedVRWeaponBashRefusals.add(target.id);
  console.info(`[VR combat swing] weapon Bash refused target=${target.getTag?.() ?? target.id}: ${reason}`);
}

const VR_BASH_VOLUME_HEIGHT_METRES = 1.6;
const VR_BASH_VOLUME_RADIUS_METRES = 0.6;

/**
 * Starts the same authored Bash the world prompt offers, so retail's Bash
 * rules, plot flags and lock gates stay the engine's. A swing while the actor
 * is already bashing this object does nothing: the engine keeps its Bash
 * rounds going on its own, and re-activating would restart the action the way
 * re-pressing Security used to (headset round 3).
 */
function dispatchVRWeaponBash(actor: ModuleCreature, targetId: number): boolean {
  const resolved = resolveVRWeaponBashTarget(actor, targetId);
  if (!resolved) return false;
  const { target } = resolved;
  const alreadyBashing = actor.combatData?.combatState === true &&
    (actor.combatRound?.action?.target === target || actor.combatData?.lastAttackTarget === target);
  if (alreadyBashing) return false;
  const prompt = buildVRWorldActionPrompt(`module-object:${target.id}`);
  const entries = prompt?.pages.flatMap((page) => page.entries) ?? [];
  const bash = entries
    .find((entry): entry is VRWorldPromptAction => entry.kind === 'action' && entry.label === 'Bash');
  if (!bash || !bash.revalidate()) {
    reportVRWeaponBashRefusalOnce(target,
      !prompt ? 'no prompt' : !bash ? `no Bash among [${entries.map((entry) => entry.label).join(', ')}]` : 'Bash revalidated false');
    return false;
  }
  bash.activate();
  console.info(`[VR combat swing] weapon Bash started target=${target.id}`);
  return true;
}

const VR_COMBAT_TARGET_HEIGHT_METRES = 1.9;
const VR_COMBAT_TARGET_MIN_RADIUS_METRES = 0.3;
const VR_COMBAT_TARGET_DEFAULT_RADIUS_METRES = 0.5;

/** Once per drop reason, so a fight cannot flood the console. */
const reportedVRSwingBufferDrops = new Set<string>();

/**
 * Run once per VR frame. Notes the player's round, starts an action the
 * player committed (a Force power, grenade or medpac) that waits behind a
 * duel partner's borrowed pause once the player's 3 s are up, and lands a
 * silently held stroke the moment the player's next round is ready. Returns
 * whether a stroke was released this frame (the headset pulses for it) and
 * whether one is still held.
 *
 * Round 18 (player-paced rounds + silent hold): a held stroke is never shown
 * and never announced. If it cannot land - its target died or was lost, the
 * fight ended, the round did not become ready - it is dropped without a word.
 * A pause - the B tap or the VR Menu's - keeps it.
 */
function serviceVRCombatSwingBuffer(actor: ModuleCreature): { released: boolean; armed: boolean } {
  observeVRPlayerRound(actor);
  // Paused, nothing ages and nothing fires: a stroke made before pausing is
  // intent, as a retail queued action is.
  if (GameState.State === EngineState.PAUSED) return { released: false, armed: vrCombatSwingBuffer.hasPending };
  const round = actor.combatRound;
  if (round && Array.isArray(round.scheduledActionList) && round.scheduledActionList.length > 0) {
    takeOverVRPlayerRoundIfBorrowed(actor);
  }
  if (!vrCombatSwingBuffer.hasPending) return { released: false, armed: false };
  const pendingBefore = vrCombatSwingBuffer.peek();
  const lockedTargetLive = (targetId: string) => resolveVRLockedHostile(actor, targetId) !== null;
  const context = {
    actorId: String(actor.id),
    weaponSignature: resolveVRCombatWeaponSignature(actor),
    // The fight decides, not the player's own flag: in a group fight it drops
    // between the player's rounds while hostiles shoot the companions (round
    // 17, Tempo exp9).
    inCombat: isVRFightOngoing({
      actorInCombat: actor.combatData?.combatState === true,
      lockedTargetLive: !!pendingBefore && lockedTargetLive(pendingBefore.targetId),
      hostileEngagedWithParty: isVRHostileEngagedWithParty(actor),
    }),
    // Alive and still locked, not "inside weapon reach this frame".
    isTargetLive: lockedTargetLive,
  };
  const dropped = vrCombatSwingBuffer.invalidate(context);
  if (dropped) {
    reportVRSwingBufferDropOnce(dropped);
    return { released: false, armed: false };
  }
  const state = resolveVRPlayerRoundState(actor);
  if (state.untilReadyMs <= 0 && !state.openingPending) {
    const release = vrCombatSwingBuffer.release(context);
    if (release.state !== 'released') return { released: false, armed: false };
    const released = dispatchVREmbodiedCombatInput(actor, release.swing.targetId, release.swing.input, true);
    if (!released) reportVRSwingBufferDropOnce('could not land');
    return { released, armed: vrCombatSwingBuffer.hasPending };
  }
  if (vrHeldSwingLifetime.advance(Number(GameState.delta))) {
    vrCombatSwingBuffer.clear();
    reportVRSwingBufferDropOnce('held too long');
    return { released: false, armed: false };
  }
  return { released: false, armed: true };
}

function reportVRSwingBufferDropOnce(reason: string): void {
  if (reportedVRSwingBufferDrops.has(reason)) return;
  reportedVRSwingBufferDrops.add(reason);
  console.info(`[VR combat swing] held stroke dropped silently: ${reason}`);
}

/**
 * A live hostile inside lock range that is fighting a party member: attacking
 * one, or attacked by one. Keeps a held swing alive between the player's own
 * rounds in a group fight (see isVRFightOngoing).
 */
function isVRHostileEngagedWithParty(actor: ModuleCreature): boolean {
  const party: readonly unknown[] = Array.isArray(GameState.PartyManager?.party) ? GameState.PartyManager.party : [];
  const creatures: readonly ModuleCreature[] = GameState.module?.area?.creatures ?? [];
  for (const creature of creatures) {
    if (!isVRCombatTarget(actor, creature) || !isWithinVRCombatLockRange(actor, creature)) continue;
    const combat = creature.combatData;
    if (!combat || combat.combatState !== true) continue;
    if (party.includes(combat.lastAttackTarget) || party.includes(combat.lastAttacker)) return true;
  }
  return false;
}

/** The hostile the VR lock last named to getCombatContext; read by isVRFightOnFor. */
let vrCombatLockTargetId: number | null = null;
let vrFightOnMemo: { actor: ModuleCreature | null; at: number; value: boolean } = { actor: null, at: Number.NEGATIVE_INFINITY, value: false };
/** Prompts ask once per candidate per frame; the answer holds for one frame's worth. */
const VR_FIGHT_ON_MEMO_MS = 30;

/**
 * Part F (decision 1 of 2026-10-13): one "fight is on" for every piece of
 * combat-only VR presentation - prompts, plates and brackets, the hilt ring
 * and the round-ready tick, and whether a friendly power queues or casts at
 * once. Part B's test, as the held-swing buffer uses it: the player's own
 * flag, the locked hostile still fighting, or a hostile in lock range fighting
 * a party member. The flag alone dropped between rounds while troopers shot
 * the companions (companion AI's CancelCombat), so plates came back in 28 of
 * 30 samples (Anchor run 2) and the ring read "ready" on 9 of 23 pulls (Tempo
 * run 2). A hostile merely aimed at outside a fight does not count: it is not
 * fighting.
 */
function isVRFightOnFor(actor: ModuleCreature | null | undefined): boolean {
  if (!actor) return false;
  const now = performance.now();
  if (vrFightOnMemo.actor === actor && now - vrFightOnMemo.at >= 0 && now - vrFightOnMemo.at < VR_FIGHT_ON_MEMO_MS) {
    return vrFightOnMemo.value;
  }
  let value = actor.combatData?.combatState === true;
  try {
    if (!value) {
      const locked = resolveVRLockedHostile(actor, vrCombatLockTargetId === null ? null : String(vrCombatLockTargetId)) as ModuleCreature | null;
      value = isVRFightOngoing({
        actorInCombat: false,
        lockedTargetLive: !!locked && locked.combatData?.combatState === true,
        hostileEngagedWithParty: isVRHostileEngagedWithParty(actor),
      });
    }
  } catch { /* the flag alone */ }
  vrFightOnMemo = { actor, at: now, value };
  return value;
}

/**
 * Who VR controls across knockouts and leader switches (Part H). See
 * VRKnockoutControlRules: control leaves a downed member for the nearest
 * standing one, and comes back to the Exile when she is up and the fight is
 * over. Every change of body, by Y, the wheel or a knockout, fades through
 * black, names the new body and plays its retail select line.
 */
const vrLeaderControl = {
  actor: null as ModuleCreature | null,
  module: null as unknown,
  downSeconds: 0,
  knockoutSwitched: false,
  seatPending: false,
};

function updateVRLeaderControl(delta: number): void {
  const actor = GameState.getCurrentPlayer() as ModuleCreature | undefined;
  if (!VRSpike.isPresenting || !actor || GameState.Mode !== EngineMode.INGAME) {
    vrLeaderControl.actor = actor ?? null;
    vrLeaderControl.module = GameState.module;
    vrLeaderControl.downSeconds = 0;
    return;
  }
  if (actor !== vrLeaderControl.actor) {
    // A module load builds a new player object too: that is not a switch.
    const switched = !!vrLeaderControl.actor && vrLeaderControl.module === GameState.module;
    vrLeaderControl.actor = actor;
    vrLeaderControl.module = GameState.module;
    vrLeaderControl.downSeconds = 0;
    if (actor.isPlayer) vrLeaderControl.knockoutSwitched = false;
    if (switched) {
      presentVRLeaderSwitch(actor);
      vrLeaderControl.seatPending = true;
    }
  }
  if (vrLeaderControl.seatPending && actor.model) {
    vrLeaderControl.seatPending = false;
    seatVRLeaderClear(actor);
  }
  if (GameState.State === EngineState.PAUSED) return;
  const downed = (creature: ModuleCreature) => typeof creature.isDead === 'function' && creature.isDead();
  vrLeaderControl.downSeconds = downed(actor) ? vrLeaderControl.downSeconds + Math.max(0, Number(delta) || 0) : 0;
  const member = (creature: ModuleCreature) => ({
    npcId: creature.isPlayer ? -1 : (Number.isInteger(creature.npcId) ? creature.npcId : -2),
    isExile: !!creature.isPlayer,
    downed: downed(creature),
    distance: Math.hypot(creature.position.x - actor.position.x, creature.position.y - actor.position.y),
  });
  const others = GameState.PartyManager.party
    .filter((creature) => creature && creature !== actor && creature.position && creature.area === actor.area)
    .map(member)
    .filter((entry) => entry.npcId >= -1);
  const decision = decideVRKnockoutControl({
    controlled: member(actor),
    others,
    fightOn: isVRFightOnFor(actor),
    knockoutSwitched: vrLeaderControl.knockoutSwitched,
    controlledDownSeconds: vrLeaderControl.downSeconds,
  });
  try {
    if (decision.kind === 'switch') {
      console.info(`[VR party] ${actor.getName()} is down: control passes to NPC ${decision.npcId}`);
      GameState.PartyManager.SwitchPlayerCharacter(decision.npcId, true);
      vrLeaderControl.knockoutSwitched = decision.npcId !== -1;
    } else if (decision.kind === 'return') {
      console.info('[VR party] the fight is over: control returns to the Exile');
      GameState.PartyManager.SwitchPlayerCharacter(-1, true);
      vrLeaderControl.knockoutSwitched = false;
    }
  } catch (error) {
    console.error('[VR party] knockout control switch rejected', error);
  }
}

function presentVRLeaderSwitch(actor: ModuleCreature): void {
  const name = actor.isPlayer ? (GameState.PartyManager.ActualPlayerName || actor.getName()) : actor.getName();
  VRSpike.presentLeaderSwitch(`Now: ${String(name || '').trim() || 'party member'}`, Number.isFinite(actor.id) ? actor.id : null);
}

/**
 * Anchor's option C1: the head lands at least 0.5 m clear of other bodies.
 * The body taken over is where it stood, so this only moves it when another
 * body is closer than that (a duplicate, or a companion pressed against it).
 */
function seatVRLeaderClear(actor: ModuleCreature): void {
  const clearance = 0.5;
  const bodies: ModuleCreature[] = (GameState.module?.area?.creatures ?? []).concat(GameState.PartyManager.party);
  let nearest: ModuleCreature | null = null;
  let nearestDistance = Infinity;
  for (const body of bodies) {
    if (!body || body === actor || body.destroyed || !body.position || body.area !== actor.area) continue;
    const distance = Math.hypot(body.position.x - actor.position.x, body.position.y - actor.position.y);
    if (distance < nearestDistance) { nearest = body; nearestDistance = distance; }
  }
  if (!nearest || nearestDistance >= clearance) return;
  const away = actor.position.clone().sub(nearest.position);
  away.z = 0;
  if (away.lengthSq() < 1e-6) away.set(1, 0, 0);
  away.normalize().multiplyScalar(clearance - nearestDistance + 0.05);
  const wanted = actor.position.clone().add(away);
  const seat = actor.area?.getNearestWalkablePoint?.(wanted, actor.getHitDistance?.() ?? 0.4) ?? null;
  if (!seat || Math.hypot(seat.x - nearest.position.x, seat.y - nearest.position.y) < clearance) return;
  actor.position.set(seat.x, seat.y, seat.z);
  console.info(`[VR party] seated ${actor.getName()} ${clearance} m clear of ${nearest.getName()}`);
}

function dispatchVRDirectionalForceGesture(
  actor: ModuleCreature,
  targetId: string | null,
  gestureKind: 'push' | 'pull',
): boolean {
  const intent = vrCombatIntentQueue.getHead();
  if (!intent || intent.requiredInput !== 'directional-force-gesture' ||
    !new RegExp(`\\b${gestureKind}\\b`, 'i').test(intent.label)) {
    return false;
  }
  const target = resolveVRLockedHostile(actor, targetId);
  if (!target) {
    reportVRForceCastOutcome('refused: no locked hostile', `head=${intent.label} targetId=${targetId}`);
    return false;
  }
  if (!isVRForceCastSchedulable(getVREmbodiedTempoResult(actor, target, 'lock'))) {
    reportVRForceCastOutcome('refused: actor cannot act', `head=${intent.label}`);
    return false;
  }
  if (!isVRCombatIntentInRange(actor, target, intent)) {
    reportVRForceCastOutcome('refused: out of Force range', `head=${intent.label}`);
    return false;
  }
  if (isVRCombatIntentUnaffordable(actor, target, intent)) {
    // Dropped, not held: a power the pool can't pay stayed on the hilt at
    // 0 FP and blocked everything queued behind it (critic run 18).
    vrCombatIntentQueue.consumeHead();
    reportVRForceCastOutcome('refused: not enough Force points', `head=${intent.label}`);
    return false;
  }
  if (!dispatchVRCombatIntent(actor, target, intent)) return false;
  vrCombatIntentQueue.consumeHead();
  vrCombatIssuedTargetId = target.id;
  return true;
}

/** TEMPORARY (3.19): names the first few cast outcomes so the headset can tune the thrust. */
let vrForceCastOutcomesReported = 0;
function reportVRForceCastOutcome(shape: string, detail = ''): void {
  signalVRRefusal(shape);
  if (vrForceCastOutcomesReported >= 12) return;
  vrForceCastOutcomesReported += 1;
  console.info(`[VR force cast] TEMPORARY ${shape}${detail ? ' || ' + detail : ''}`);
}

/**
 * A Force power goes through the action menu exactly as a flatscreen click
 * does, and the engine schedules it at the next round opening. Requiring the
 * round to be open at the instant of the gesture refused nearly every cast in
 * a fight (critic run 4), the same mistake grenades had. A round that is
 * merely busy now schedules; only an actor that cannot act refuses.
 */
function isVRForceCastSchedulable(tempo: { readonly eligible: boolean; readonly reason: VRCombatTempoGateReason }): boolean {
  return tempo.eligible || isVRCombatSwingBufferable(tempo.reason);
}

/**
 * ROADMAP 3.19 — the generic cast gesture releases the queued Force power at
 * the head, when that power is one the trigger would otherwise commit. Push
 * and Pull keep their directional flick and are deliberately not released
 * here, so the gesture set stays at three. With nothing queued, or an attack
 * feat at the head, the thrust is ignored and the frame falls through.
 */
function dispatchVRForceCastGesture(actor: ModuleCreature, targetId: string | null): boolean {
  const intent = vrCombatIntentQueue.getHead();
  if (!intent) return false;
  if (intent.kind !== 'force-power' || intent.requiredInput !== 'dominant-trigger') {
    // A power queued behind an attack: say why the thrust did nothing. It
    // was silent (critic runs 11-12). Queue order is the player's own.
    const powerBehind = vrCombatIntentQueue.getSnapshot().entries.some((entry: any) =>
      entry?.kind === 'force-power' && entry?.requiredInput === 'dominant-trigger');
    reportVRForceCastOutcome(powerBehind ? 'refused: an attack is queued before the power' : 'ignored: head is not a trigger-cast power', `head=${intent.label}`);
    return false;
  }
  const target = resolveVRLockedHostile(actor, targetId);
  if (!target) {
    reportVRForceCastOutcome('refused: no locked hostile', `head=${intent.label} targetId=${targetId}`);
    return false;
  }
  if (!isVRForceCastSchedulable(getVREmbodiedTempoResult(actor, target, 'lock'))) {
    reportVRForceCastOutcome('refused: actor cannot act', `head=${intent.label}`);
    return false;
  }
  // The power's own range, as grenades check theirs: the lock reaches 20 m,
  // Medium powers 15 m and Small 10 m. Casting beyond it failed silently in
  // the engine and used the power up (critic run 5). It stays queued.
  if (!isVRCombatIntentInRange(actor, target, intent)) {
    reportVRForceCastOutcome('refused: out of Force range', `head=${intent.label}`);
    return false;
  }
  if (isVRCombatIntentUnaffordable(actor, target, intent)) {
    // Dropped, not held: a power the pool can't pay stayed on the hilt at
    // 0 FP and blocked everything queued behind it (critic run 18).
    vrCombatIntentQueue.consumeHead();
    reportVRForceCastOutcome('refused: not enough Force points', `head=${intent.label}`);
    return false;
  }
  if (!dispatchVRCombatIntent(actor, target, intent)) {
    reportVRForceCastOutcome('refused: engine did not take the action', `head=${intent.label}`);
    return false;
  }
  vrCombatIntentQueue.consumeHead();
  vrCombatIssuedTargetId = target.id;
  reportVRForceCastOutcome('released', `power=${intent.label} target=${target.getTag?.() ?? target.id}`);
  return true;
}

/** TEMPORARY (round 6): "grenades are still entirely broken". Names each refusal once. */
const reportedVRGrenadeOutcomes = new Set<string>();
function reportVRGrenadeOutcomeOnce(shape: string, detail = ''): void {
  signalVRRefusal(shape);
  if (reportedVRGrenadeOutcomes.has(shape)) return;
  reportedVRGrenadeOutcomes.add(shape);
  console.info(`[VR grenade] TEMPORARY ${shape}${detail ? ' || ' + detail : ''}`);
}

/** Retail grenade scripts' blast reach as measured in play (hit at 3.8 m, not at 4.4 m; critic run 17). */
const VR_GRENADE_SELF_BLAST_METRES = 4;
const VR_GRENADE_CONFIRM_MS = 3000;
let vrGrenadeTooCloseWarnedAt = -Infinity;

function commitVRArmedGrenade(actor: ModuleCreature, targetId: string | null): boolean {
  const request = vrArmedGrenadeState.requestCommit();
  if (request.state !== 'armed') {
    reportVRGrenadeOutcomeOnce('trigger with nothing armed');
    return false;
  }
  const source = findVRArmedGrenade(actor, request.grenade.sourceKey);
  // The lock, not weapon reach: holding a Vibroblade used to cap every throw
  // at 2 m, so a grenade armed at a droid across the room could never leave
  // the hand. The spell's own inRange check below decides the throw distance.
  // The lock, or else the nearest hostile in view within throwing range: the
  // lock follows the weapon hand's aim, and a grenade thrown from the other
  // hand at a droid that was already attacking said "No target" (critic run
  // 15).
  let target = resolveVRLockedHostile(actor, targetId);
  if (target === null && source !== undefined) {
    try {
      const spell = new GameState.TalentSpell(source.spellId);
      let best: ModuleObject | null = null;
      let bestDistance = Infinity;
      for (const candidate of GameState.ModuleObjectManager.playerSelectableObjects) {
        if (!isVRCombatTarget(actor, candidate) || !spell.inRange(candidate, actor)) continue;
        const d = distanceVRCombat2D(actor, candidate);
        if (d < bestDistance) { bestDistance = d; best = candidate; }
      }
      target = best;
    } catch { /* no fallback */ }
  }
  // A trigger pulled at empty space is a miss-aim, not an invalid target: keep
  // the grenade armed. A locked target that became invalid is cancelled by
  // onCombatTargetInvalidated instead. `resolveVRLiveCombatTarget` returns
  // null (never undefined), so this must be an explicit null check — the
  // earlier `!== undefined` treated "no target" as available.
  if (source !== undefined && target === null) {
    reportVRGrenadeOutcomeOnce('refused: no locked hostile', `targetId=${targetId}`);
    return false;
  }
  // Out of throw range also keeps it armed. In VR the engine may not walk the
  // player into range (ActionApproachPolicy), so committing now would only
  // spend the arm on a cast ActionItemCastSpell is bound to reject.
  if (source !== undefined && target !== null) {
    try {
      if (!new GameState.TalentSpell(source.spellId).inRange(target, actor)) {
        reportVRGrenadeOutcomeOnce('refused: out of throw range',
          `spell=${source.spellId} distance=${distanceVRCombat2D(actor, target).toFixed(1)}`);
        return false;
      }
    } catch (error) {
      reportVRGrenadeOutcomeOnce('refused: range check threw', String(error));
      return false;
    }
  }
  // Retail grenades hit everyone in the blast, the thrower included; at the
  // range droids fight from, a frag took 20 of 29 HP without a word (critic
  // run 17, all three critics). The first pull inside the blast warns and keeps
  // the grenade armed; a second pull within 3 s throws anyway.
  if (source !== undefined && target !== null) {
    const distance = distanceVRCombat2D(actor, target);
    const now = performance.now();
    // Companions too (critic run 18: a frag from 6 m at a droid 1.5 m from
    // Atton took him from 24 to 5 without a word).
    const caughtNames: string[] = [];
    try {
      for (const member of GameState.PartyManager.party) {
        if (!member || member === actor || (member.isDead && member.isDead())) continue;
        if (distanceVRCombat2D(member, target) < VR_GRENADE_SELF_BLAST_METRES) {
          caughtNames.push(resolveVRWorldPromptName(member as ModuleObject) || 'a companion');
        }
      }
    } catch { /* party unreadable: warn for the thrower only */ }
    // Every companion in it, not the first (critic run 20: Kreia went unnamed).
    const caught = caughtNames.length ? caughtNames.join(' and ') : null;
    const self = distance < VR_GRENADE_SELF_BLAST_METRES;
    if ((self || caught) && now - vrGrenadeTooCloseWarnedAt > VR_GRENADE_CONFIRM_MS) {
      vrGrenadeTooCloseWarnedAt = now;
      const who = self ? 'you’re' : `${caught} ${caughtNames.length > 1 ? 'are' : 'is'}`;
      try { VRSpike.showNotice(`Too close: ${who} in the blast. Pull again to throw`, 3000); } catch { /* notice only */ }
      reportVRGrenadeOutcomeOnce('warned: party inside blast', `distance=${distance.toFixed(1)} self=${self}`);
      return false;
    }
    vrGrenadeTooCloseWarnedAt = -Infinity;
  }
  const eligibility = resolveVRArmedGrenadeCommitEligibility({
    sourceAvailable: source !== undefined,
    targetAvailable: target !== null,
    // A throw is scheduled into the combat round like flatscreen's, and the
    // engine plays it at the next opening. Requiring the round to be idle at
    // the instant of the trigger pull dropped the throw silently whenever a
    // round was running — which in a fight is almost always.
    tempoEligible: source !== undefined && target !== null,
  });
  if (eligibility !== 'commit') {
    reportVRGrenadeOutcomeOnce(`refused: ${eligibility}`, `sourceAvailable=${source !== undefined}`);
  }
  if (eligibility === 'cancel-invalid') {
    vrArmedGrenadeState.cancel();
    return false;
  }
  if (eligibility === 'defer-tempo') {
    vrArmedGrenadeState.completeCommit({ sourceKey: request.grenade.sourceKey, engineAccepted: false });
    return false;
  }

  try {
    const action = new CombatRoundAction(actor);
    action.actionType = CombatActionType.ITEM_CAST_SPELL;
    action.target = target;
    action.item = source.item;
    action.setSpell(new GameState.TalentSpell(source.spellId));
    action.isUserAction = true;
    actor.combatRound.addAction(action);
    if (!actor.actionQueue.actionTypeExists(ActionType.ActionCombat)) {
      actor.actionQueue.add(new GameState.ActionFactory.ActionCombat(0xFFFF));
    }
    vrArmedGrenadeState.completeCommit({ sourceKey: source.descriptor.sourceKey, engineAccepted: true });
    vrLastThrownGrenade = { actorId: actor.id, sourceKey: source.descriptor.sourceKey, itemId: source.item?.id };
    vrCombatIssuedTargetId = target.id;
    reportVRGrenadeOutcomeOnce('thrown: scheduled into the combat round', `spell=${source.spellId}`);
    return true;
  } catch (error) {
    reportVRGrenadeOutcomeOnce('refused: scheduling threw', String(error));
    // A construction failure is not a timing deferral. The still-visible item
    // could never be thrown from this trigger, so remove the stale off-hand
    // presentation rather than leaving a dead armed state behind.
    vrArmedGrenadeState.cancel();
    return false;
  }
}

function consumeVRCombatIntentSelection(panelIndex: number, kind: 'target' | 'self'): boolean {
  const actor = GameState.getCurrentPlayer();
  if (!actor) return false;
  const target = GameState.ActionMenuManager.oTarget as ModuleObject | null;
  if (kind === 'target' && !isVRCombatTarget(actor, target)) return false;
  // A power the pool can't pay for is refused when picked, in or out of
  // combat, with the cue: picking Burst of Speed (25 FP) at 15 FP did
  // nothing at all, silently (critic run 13).
  if (panelIndex === 1) {
    try {
      const picked = (kind === 'target'
        ? GameState.ActionMenuManager.ActionPanels.targetPanels[1]
        : GameState.ActionMenuManager.ActionPanels.selfPanels[1])?.getSelectedAction();
      const talent: any = picked?.talent;
      if (talent && typeof talent.getForcePointCostFor === 'function' && talent.getForcePointCostFor(actor) > actor.getFP()) {
        reportVRForceCastOutcome('refused: not enough Force points', `power=${getVRActionLabel(picked, target)}`);
        return true;
      }
    } catch { /* fall through to the normal path */ }
  }
  // Friendly powers outside combat (a heal after the fight, a buff before it)
  // have no hostile target to spend a tempo window on, so the intent queue
  // could never dispatch them. Let the engine cast them immediately.
  // "In combat" is the fight, not the player's flag (Part F, decision 1): a
  // heal picked while the flag had dropped mid-fight cast at once instead of
  // waiting its turn in the queue.
  if (kind === 'self' && !isVRFightOnFor(actor)) {
    if (panelIndex === 1) {
      try {
        vrRecentForcePowers.note((GameState.ActionMenuManager.ActionPanels.selfPanels[1]?.getSelectedAction() as any)?.talent?.id);
      } catch { /* ordering only */ }
    }
    return false;
  }
  if (panelIndex !== 0 && panelIndex !== 1) return false;

  let selected: VRActionMenuEntry | undefined;
  try {
    selected = (kind === 'target'
      ? GameState.ActionMenuManager.ActionPanels.targetPanels[panelIndex]
      : GameState.ActionMenuManager.ActionPanels.selfPanels[panelIndex]
    )?.getSelectedAction();
  } catch {
    return false;
  }
  if (!selected) return false;

  const label = getVRActionLabel(selected, target);
  if (panelIndex === 0 && !isVRAttackModeFeat(selected.talent)) {
    // Plain Attack is already the automatic fallback. Selecting it is a
    // harmless acknowledgement, not an engine click or a queue entry.
    return true;
  }
  if (panelIndex === 1 && !selected.talent) return false;

  const normalizedEntry: VRActionMenuEntry = {
    ...selected,
    playerFacingLabel: label,
  };
  const isDirectionalForce = panelIndex === 1 && /\b(push|pull)\b/i.test(label);
  const intent: VRCombatIntent = {
    sourceKey: createVRActionSourceKey(kind, panelIndex, normalizedEntry),
    label,
    icon: getVRActionIcon(selected) ?? (panelIndex === 0 ? 'i_attack' : 'lbl_icn_abi2'),
    kind: panelIndex === 0 ? 'attack-feat' : 'force-power',
    requiredInput: isDirectionalForce
      ? 'directional-force-gesture'
      : panelIndex === 0 && resolveVRCombatWeaponMode(actor) !== 'blaster'
        ? 'dominant-swing'
        : 'dominant-trigger',
    weaponSignature: panelIndex === 0 ? resolveVRCombatWeaponSignature(actor) : 'any',
  };
  // A full queue is feedback-only: never fall through to immediate authored
  // activation, which would violate the player's explicitly selected order.
  // Every pick queues, the same Force power or feat several times in a row
  // included, as in retail (Allen, 2026-10-03). The run-18 stale-entry
  // complaint is answered by dropping a head the pool can't pay, not by
  // refusing repeats.
  if (!vrCombatIntentQueue.enqueue(intent).accepted) tickVRRefusal('queue-full');
  // A power picked now leads the wheel's Force page next time (Part F).
  else if (panelIndex === 1) vrRecentForcePowers.note((selected.talent as any)?.id);
  return true;
}

/**
 * Whether a queued power can reach `target` from here: the entry's own
 * TalentSpell range. Anything without a spell (a feat) is not range-gated.
 */
function isVRCombatIntentInRange(actor: ModuleCreature, target: ModuleObject, intent: VRCombatIntent): boolean {
  const entry = resolveVRCombatIntentEntry(actor, target, intent);
  const talent: any = entry?.talent;
  if (!talent || typeof talent.inRange !== 'function') return true;
  try {
    return talent.inRange(target, actor) !== false;
  } catch {
    return true;
  }
}

/** The queued Force power costs more than the caster has (critic run 11: powers were free). */
function isVRCombatIntentUnaffordable(actor: ModuleCreature, target: ModuleObject, intent: VRCombatIntent): boolean {
  if (intent.kind !== 'force-power') return false;
  const talent: any = resolveVRCombatIntentEntry(actor, target, intent)?.talent;
  if (!talent || typeof talent.getForcePointCostFor !== 'function' || typeof (actor as any).getFP !== 'function') return false;
  try {
    return talent.getForcePointCostFor(actor) > (actor as any).getFP();
  } catch {
    return false;
  }
}

function resolveVRCombatIntentEntry(actor: ModuleCreature, target: ModuleObject, intent: VRCombatIntent): VRActionMenuEntry | null {
  const source = parseVRCombatIntentSourceKey(intent.sourceKey);
  if (!source) return null;
  try {
    GameState.ActionMenuManager.SetPC(actor);
    GameState.ActionMenuManager.SetTarget(target);
    GameState.ActionMenuManager.UpdateMenuActions();
    const panels = source.kind === 'target'
      ? GameState.ActionMenuManager.ActionPanels.targetPanels
      : GameState.ActionMenuManager.ActionPanels.selfPanels;
    const panel = panels[source.panelIndex];
    if (!panel || !Array.isArray(panel.actions)) return null;
    return panel.actions.find((entry: VRActionMenuEntry) =>
      createVRActionSourceKey(source.kind, source.panelIndex, {
        ...entry,
        playerFacingLabel: getVRActionLabel(entry, target),
      }) === intent.sourceKey
    ) ?? null;
  } catch {
    return null;
  }
}

function dispatchVRCombatIntent(actor: ModuleCreature, target: ModuleObject, intent: VRCombatIntent): boolean {
  const source = parseVRCombatIntentSourceKey(intent.sourceKey);
  if (!source) return false;
  try {
    GameState.ActionMenuManager.SetPC(actor);
    GameState.ActionMenuManager.SetTarget(target);
    GameState.ActionMenuManager.UpdateMenuActions();
    const panels = source.kind === 'target'
      ? GameState.ActionMenuManager.ActionPanels.targetPanels
      : GameState.ActionMenuManager.ActionPanels.selfPanels;
    const panel = panels[source.panelIndex];
    if (!panel || !Array.isArray(panel.actions)) return false;
    const actionIndex = panel.actions.findIndex((entry: VRActionMenuEntry) =>
      createVRActionSourceKey(source.kind, source.panelIndex, {
        ...entry,
        playerFacingLabel: getVRActionLabel(entry, target),
      }) === intent.sourceKey
    );
    if (actionIndex < 0) return false;
    panel.selectedIndex = actionIndex;
    vrCombatIntentDispatchInProgress = true;
    if (source.kind === 'target') GameState.ActionMenuManager.onTargetMenuAction(source.panelIndex);
    else GameState.ActionMenuManager.onSelfMenuAction(source.panelIndex);
    return true;
  } catch {
    return false;
  } finally {
    vrCombatIntentDispatchInProgress = false;
  }
}

function parseVRCombatIntentSourceKey(sourceKey: string): { kind: 'target' | 'self'; panelIndex: number } | null {
  try {
    const value = JSON.parse(sourceKey) as unknown;
    if (!Array.isArray(value) || (value[0] !== 'target' && value[0] !== 'self') || !Number.isInteger(value[1])) return null;
    return { kind: value[0], panelIndex: value[1] };
  } catch {
    return null;
  }
}

const vrActionMenuBridgeDependencies: VRActionMenuBridgeDependencies<ModuleCreature, ModuleObject> = {
  getCurrentActor: () => GameState.getCurrentPlayer() ?? null,
  isTargetAvailable: (actor, target) =>
    GameState.ModuleObjectManager.playerSelectableObjects.includes(target) &&
    isVRCombatTarget(actor, target),
  refreshPanels: (actor, target): VRActionMenuPanelLists => {
    GameState.ActionMenuManager.SetPC(actor);
    if (target) GameState.ActionMenuManager.SetTarget(target);
    GameState.ActionMenuManager.UpdateMenuActions();
    return GameState.ActionMenuManager.ActionPanels as VRActionMenuPanelLists;
  },
  getPlayerFacingLabel: (entry, target) => withVRForcePowerCost(getVRActionLabel(entry, target), entry),
  getIcon: (entry) => getVRActionIcon(entry),
  // Critic runs 15-17: a 25 FP power at 15 FP was drawn like any other.
  isEntryUnavailable: (actor, entry) => {
    const talent: any = entry?.talent;
    if (!talent || typeof talent.getForcePointCostFor !== 'function' || typeof (actor as any)?.getFP !== 'function') return false;
    try { return Number(talent.getForcePointCostFor(actor)) > Number((actor as any).getFP()); } catch { return false; }
  },
  logger: console,
  onTargetMenuAction: (panelIndex) => {
    if (!vrCombatIntentDispatchInProgress && VRSpike.isPresenting && consumeVRCombatIntentSelection(panelIndex, 'target')) return;
    GameState.ActionMenuManager.onTargetMenuAction(panelIndex);
  },
  onSelfMenuAction: (panelIndex) => {
    if (!vrCombatIntentDispatchInProgress && VRSpike.isPresenting && consumeVRCombatIntentSelection(panelIndex, 'self')) return;
    GameState.ActionMenuManager.onSelfMenuAction(panelIndex);
  },
};

const vrWorldPromptActionMenuBridgeDependencies: VRActionMenuBridgeDependencies<ModuleCreature, ModuleObject> = {
  getCurrentActor: () => GameState.getCurrentPlayer() ?? null,
  isTargetAvailable: (actor, target) => isLiveVRWorldPromptTarget(actor, target),
  refreshPanels: (actor, target): VRActionMenuPanelLists | null => {
    if (!target || !isLiveVRWorldPromptTarget(actor, target)) return null;
    GameState.ActionMenuManager.SetPC(actor);
    GameState.ActionMenuManager.SetTarget(target);
    GameState.ActionMenuManager.UpdateMenuActions();
    return GameState.ActionMenuManager.ActionPanels as VRActionMenuPanelLists;
  },
  getPlayerFacingLabel: (entry, target) => getVRActionLabel(entry, target),
  getIcon: (entry) => getVRActionIcon(entry),
  logger: console,
  onTargetMenuAction: (panelIndex) => GameState.ActionMenuManager.onTargetMenuAction(panelIndex),
  onSelfMenuAction: (panelIndex) => GameState.ActionMenuManager.onSelfMenuAction(panelIndex),
};

const vrWorldPromptObjectIdentities = new WeakMap<object, number>();
let nextVRWorldPromptObjectIdentity = 1;

/**
 * Builds cheap, immutable prompt candidates from the engine's live
 * LOS/usability list. Discovery never refreshes ActionMenuManager and never
 * creates action closures; the winning candidate is resolved lazily.
 */
export function buildVRWorldPromptCandidates(
  actor: ModuleCreature | null | undefined,
  objects: readonly ModuleObject[],
): readonly VRWorldPromptCandidate[] {
  if (!actor || !Array.isArray(objects)) return [];
  const actorActionState = readVRWorldPromptActorActionState(actor);
  const candidates: VRWorldPromptCandidate[] = [];
  for (const target of objects) {
    const candidate = describeVRWorldPromptCandidate(actor, target, actorActionState);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

/** Resolves and snapshots one exact live object for proactive prompt display. */
export function buildVRWorldActionPrompt(
  source: string | VRWorldPromptCandidate,
): VRWorldActionPromptModel | null {
  const targetId = typeof source === 'string' ? source : source?.id;
  const match = typeof targetId === 'string' ? /^module-object:(\d+)$/.exec(targetId) : null;
  if (!match) return null;
  const actor = GameState.getCurrentPlayer() ?? null;
  if (!actor) return null;
  const numericTargetId = Number(match[1]);
  const target = GameState.ModuleObjectManager.playerSelectableObjects.find(
    (candidate) => candidate.id === numericTargetId,
  );
  if (!target) return null;
  const candidate = typeof source === 'string'
    ? describeVRWorldPromptCandidate(actor, target)
    : source;
  return candidate ? buildVRWorldActionPromptFor(actor, target, candidate) : null;
}

function buildVRWorldActionPromptFor(
  actor: ModuleCreature,
  target: ModuleObject,
  candidate: VRWorldPromptCandidate,
): VRWorldActionPromptModel | null {
  if (!isLiveVRWorldPromptCandidate(actor, target, candidate)) return null;
  const panels = refreshVRWorldPromptPanels(actor, target);
  if (!panels) return null;
  const authoredActionCount = countVRWorldPromptTargetActions(panels.targetPanels);
  reportVRWorldPromptPanelsOnce(target, panels.targetPanels);
  const authoredActions = snapshotVRActionMenuPanelEntries(
    {
      actor,
      target,
      kind: 'target',
      panels: panels.targetPanels,
    },
    vrWorldPromptActionMenuBridgeDependencies,
  ).map((descriptor): VRWorldPromptAction => ({
    kind: 'action',
    id: descriptor.id,
    label: descriptor.label,
    icon: descriptor.icon,
    revalidate: () => isLiveVRWorldPromptCandidate(actor, target, candidate) && descriptor.revalidate(),
    activate: () => {
      if (!isLiveVRWorldPromptCandidate(actor, target, candidate)) return;
      descriptor.activate();
    },
  }));

  const actions = [...authoredActions];
  // Creatures route through onClick rather than the container direct-use path.
  // ActionMenuManager only builds entries for *hostile* creatures, so without
  // this a friendly NPC produced zero actions and the prompt was suppressed for
  // having no pages — which is what made 3C-FD and the medbay dummy inert.
  if ((target.objectType & ModuleObjectType.ModuleCreature) !== 0) {
    const creatureDescriptor = describeVRCreaturePromptAction(
      readVRCreaturePromptState(actor, target, isVRFightOnFor(actor)),
      target.id,
      candidate.name,
    );
    if (creatureDescriptor) {
      actions.push({
        kind: 'action',
        id: creatureDescriptor.id,
        label: creatureDescriptor.label,
        revalidate: () => isLiveVRWorldPromptCandidate(actor, target, candidate),
        activate: () => {
          if (!isLiveVRWorldPromptCandidate(actor, target, candidate)) return;
          try {
            (target as ModuleObject & { onClick?: (actor: ModuleCreature) => void })
              .onClick?.(actor);
          } catch (error) {
            console.error(`[VR interaction] creature onClick failed target=${target.id}`, error);
          }
        },
      });
    }
  }
  if (isDirectVRWorldUseTarget(target)) {
    const descriptor = describeDirectVRWorldUse(actor, target, console, {
      authoredActionCount,
      getLiveAuthoredActionCount: () => {
        if (!isLiveVRWorldPromptCandidate(actor, target, candidate)) return 1;
        const livePanels = refreshVRWorldPromptPanels(actor, target);
        return livePanels ? countVRWorldPromptTargetActions(livePanels.targetPanels) : 1;
      },
      // Resolved the same way the engine resolves it in
      // `ModulePlaceable.attemptUnlockWithKey` — by tag, against the party
      // inventory — and re-read at each boundary, so a key spent or dropped
      // between opening the prompt and pressing it refuses again.
      actorHoldsRequiredKey: () => {
        const keyName = (target as { keyName?: unknown }).keyName;
        if (typeof keyName !== 'string' || !keyName.length) return false;
        return !!GameState.InventoryManager.getItemByTag(keyName);
      },
    });
    if (descriptor) {
      actions.push({
        kind: 'action',
        id: descriptor.id,
        label: descriptor.label,
        revalidate: () => isLiveVRWorldPromptCandidate(actor, target, candidate) && descriptor.revalidate(),
        activate: () => {
          if (!isLiveVRWorldPromptCandidate(actor, target, candidate)) return;
          descriptor.activate();
        },
      });
    }
  }

  const pages = buildVRWorldPromptPages(actions);
  if (pages.length === 0) return null;
  return {
    id: `world-prompt:${target.id}:${candidate.stateKey}:${actions.map((action) => action.id).join('|')}`,
    name: candidate.name,
    anchor: candidate.position,
    pages,
  };
}

function isLiveVRWorldPromptTarget(actor: ModuleCreature, target: ModuleObject): boolean {
  return GameState.getCurrentPlayer() === actor &&
    GameState.ModuleObjectManager.playerSelectableObjects.includes(target) &&
    isStructurallyValidVRWorldPromptTarget(actor, target) &&
    distance2D(actor.position, target.position) <= getVRInteractionRange(target.objectType);
}

function isLiveVRWorldPromptCandidate(
  actor: ModuleCreature,
  target: ModuleObject,
  snapshot: VRWorldPromptCandidate,
): boolean {
  if (!isLiveVRWorldPromptTarget(actor, target)) return false;
  const live = describeVRWorldPromptCandidate(actor, target);
  return live !== null && live.id === snapshot.id && live.name === snapshot.name &&
    live.stateKey === snapshot.stateKey && live.inRange === snapshot.inRange &&
    live.hasActions === snapshot.hasActions && live.position.equals(snapshot.position);
}

function describeVRWorldPromptCandidate(
  actor: ModuleCreature,
  target: ModuleObject,
  actorActionState: VRWorldPromptActorActionState = readVRWorldPromptActorActionState(actor),
): VRWorldPromptCandidate | null {
  if (!isStructurallyValidVRWorldPromptTarget(actor, target)) return null;
  try {
    const actorDistanceMetres = distance2D(actor.position, target.position);
    if (!Number.isFinite(actorDistanceMetres)) return null;
    const position = resolveVRInteractionAnchor(
      target as EngineInteractableObject,
      new THREE.Vector3(),
    );
    if (![position.x, position.y, position.z].every(Number.isFinite)) return null;
    const inRange = actorDistanceMetres <= getVRInteractionRange(target.objectType);
    const hasActions = hasPotentialVRWorldPromptActions(actor, actorActionState, target);
    const name = resolveVRWorldPromptName(target);
    reportVRWorldPromptCandidacyOnce(target, name, actorDistanceMetres, inRange, hasActions);
    return {
      id: `module-object:${target.id}`,
      name,
      position,
      actorDistanceMetres,
      hasActions,
      inRange,
      stateKey: buildVRWorldPromptStateKey(
        actor,
        actorActionState,
        target,
        name,
        position,
        hasActions,
      ),
    };
  } catch {
    // A malformed object that is being destroyed must not suppress every
    // other usable object in the engine-maintained selectable list.
    return null;
  }
}

/**
 * One-shot-per-object diagnostic for why a door/placeable did or did not become
 * a prompt candidate. Doors and containers work flatscreen but not in VR, and
 * the VR path fails silently — nothing throws, so nothing reaches the console.
 * Logs every input the candidacy decision actually reads so a single headset
 * pass identifies the rejecting condition instead of another guess.
 *
 * TEMPORARY: remove once VR-PLAYTEST-FIX-PLAN.md H1 is closed.
 */
const reportedVRWorldPromptCandidacy = new Set<string>();

function reportVRWorldPromptCandidacyOnce(
  target: ModuleObject,
  name: string,
  actorDistanceMetres: number,
  inRange: boolean,
  hasActions: boolean,
): void {
  try {
    const isDoorOrPlaceable = (target.objectType & (
      ModuleObjectType.ModuleDoor | ModuleObjectType.ModulePlaceable
    )) !== 0;
    if (!isDoorOrPlaceable) return;

    const probe = target as ModuleObject & {
      isLocked?: () => boolean;
      lockable?: unknown;
      keyRequired?: unknown;
      notBlastable?: unknown;
      plot?: unknown;
      use?: unknown;
      scripts?: Readonly<Record<string, unknown>>;
    };
    const locked = typeof probe.isLocked === 'function' ? probe.isLocked() : 'no-isLocked-fn';
    const key = `${target.id}:${String(locked)}:${hasActions}:${inRange}`;
    if (reportedVRWorldPromptCandidacy.has(key)) return;
    reportedVRWorldPromptCandidacy.add(key);

    console.info(
      `[VR prompt candidacy] id=${target.id} name='${name}'` +
      ` type=${(target.objectType & ModuleObjectType.ModuleDoor) !== 0 ? 'door' : 'placeable'}` +
      ` distance=${actorDistanceMetres.toFixed(2)} range=${getVRInteractionRange(target.objectType)}` +
      ` inRange=${inRange} hasActions=${hasActions}` +
      ` locked=${String(locked)} hasUse=${typeof probe.use === 'function'}` +
      ` plot=${JSON.stringify(probe.plot)} keyRequired=${JSON.stringify(probe.keyRequired)}` +
      ` notBlastable=${JSON.stringify(probe.notBlastable)} lockable=${JSON.stringify(probe.lockable)}` +
      ` onFailToOpen=${JSON.stringify(probe.scripts?.onFailToOpen ?? null)}`
    );
  } catch {
    // Diagnostics must never suppress a candidate.
  }
}

/**
 * Dumps the raw ActionMenuManager target panels the engine produced for one
 * object. Doors currently surface only "Bash" in VR; this separates "the engine
 * offered exactly one action" from "we built more and then dropped them",
 * which the absence of bridge malformed-source warnings alone cannot settle.
 *
 * TEMPORARY: remove once VR-PLAYTEST-FIX-PLAN.md door actions are resolved.
 */
const reportedVRWorldPromptPanels = new Set<string>();

function reportVRWorldPromptPanelsOnce(
  target: ModuleObject,
  targetPanels: readonly { readonly actions?: readonly unknown[] }[],
): void {
  try {
    const entries: string[] = [];
    targetPanels.forEach((panel, panelIndex) => {
      const actions = Array.isArray(panel?.actions) ? panel.actions : [];
      actions.forEach((raw: any, actionIndex: number) => {
        entries.push(
          `${panelIndex}:${actionIndex}` +
          ` icon=${JSON.stringify(raw?.icon ?? null)}` +
          ` actionType=${JSON.stringify(raw?.action?.type ?? null)}` +
          ` talent=${JSON.stringify(raw?.talent?.label ?? raw?.talent?.name ?? null)}` +
          ` item=${JSON.stringify(raw?.item?.getName?.() ?? raw?.item?.id ?? null)}`
        );
      });
    });
    const key = `${target.id}:${entries.length}:${entries.join('|')}`;
    if (reportedVRWorldPromptPanels.has(key)) return;
    reportedVRWorldPromptPanels.add(key);
    // canAttemptSecurityUnlock = locked && !keyRequired. If that is
    // false, ActionMenuManager emits neither Security nor tunnelers and only
    // i_attack survives. Dump its exact inputs, whether the template even
    // carried a Lockable field, and the actor-side requirements alongside.
    const probe = target as any;
    const actor = GameState.getCurrentPlayer() as any;
    const hasLockableField = (() => {
      try { return !!probe?.template?.RootNode?.hasField?.('Lockable'); } catch { return 'unknown'; }
    })();
    const rawLockable = (() => {
      try { return probe?.template?.getFieldByLabel?.('Lockable')?.getValue?.() ?? null; } catch { return 'unreadable'; }
    })();
    const inventory = (() => {
      try { return actor?.getInventory?.() ?? []; } catch { return []; }
    })();
    const countBase = (id: number) => inventory.filter((i: any) => i?.baseItemId === id).length;

    console.info(
      `[VR prompt panels] id=${target.id} name='${resolveVRWorldPromptName(target)}'` +
      ` panels=${targetPanels.length} rawActions=${entries.length}` +
      ` || lockGate: locked=${JSON.stringify(probe?.isLocked?.())}` +
      ` lockable=${JSON.stringify(probe?.lockable)} keyRequired=${JSON.stringify(probe?.keyRequired)}` +
      ` templateHasLockable=${hasLockableField} templateLockable=${JSON.stringify(rawLockable)}` +
      ` openLockDC=${JSON.stringify(probe?.openLockDC)}` +
      ` || actor: securitySkill=${JSON.stringify(actor?.getSkillLevel?.(SkillType.SECURITY))}` +
      ` tunnelers(base59)=${countBase(59)} mines(base58)=${countBase(58)}` +
      (entries.length ? ` :: ${entries.join(' || ')}` : ' :: (engine offered none)')
    );
  } catch {
    // Diagnostics must never break prompt assembly.
  }
}

function refreshVRWorldPromptPanels(
  actor: ModuleCreature,
  target: ModuleObject,
): VRActionMenuPanelLists | null {
  if (!isLiveVRWorldPromptTarget(actor, target)) return null;
  GameState.ActionMenuManager.SetPC(actor);
  GameState.ActionMenuManager.SetTarget(target);
  GameState.ActionMenuManager.UpdateMenuActions();
  return GameState.ActionMenuManager.ActionPanels as VRActionMenuPanelLists;
}

/**
 * Counts authored actions that would make a generic direct `use()` redundant.
 *
 * Attack/Bash entries are deliberately excluded. This count feeds
 * `classifySafeDirectVRWorldUse`, whose job is to stop the generic route from
 * duplicating or pre-empting an authored one — but bashing a door is not an
 * attempt to open it. Counting it suppressed the "Use" route on every locked
 * bashable door, so the prompt offered Bash as the *only* option and the player
 * could never simply try the door, which flatscreen allows.
 */
function countVRWorldPromptTargetActions(panels: readonly VRActionMenuPanel[]): number {
  return panels.reduce((count, panel) => {
    if (!panel || !Array.isArray(panel.actions)) return count;
    return count + panel.actions.filter((entry) => !isVRAttackActionEntry(entry)).length;
  }, 0);
}

function isVRAttackActionEntry(entry: VRActionMenuEntry | undefined): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const icon = typeof entry.icon === 'string' ? entry.icon.trim().toLowerCase() : '';
  return icon.includes('attack');
}

function isStructurallyValidVRWorldPromptTarget(actor: ModuleCreature, target: ModuleObject): boolean {
  try {
    // Creatures belong here too. Without them no creature could ever become a
    // prompt candidate, so 3C-FD and the medbay dummy showed a reticle and a
    // name label but never a prompt. Which creatures actually offer one is
    // decided by hasCreatureWorldPromptAction, not by this mask.
    const supportedType = (target.objectType & (
      ModuleObjectType.ModuleDoor |
      ModuleObjectType.ModulePlaceable |
      ModuleObjectType.ModuleTrigger |
      ModuleObjectType.ModuleCreature
    )) !== 0;
    return !!target && target !== actor && supportedType &&
      Number.isInteger(target.id) && target.id >= 0 &&
      target.position instanceof THREE.Vector3 &&
      [target.position.x, target.position.y, target.position.z].every(Number.isFinite) &&
      actor.position instanceof THREE.Vector3 &&
      [actor.position.x, actor.position.y, actor.position.z].every(Number.isFinite) &&
      Number.isInteger(target.objectType) &&
      target.destroyed !== true && target.willDestroy !== true &&
      typeof target.isUseable === 'function' && target.isUseable();
  } catch {
    return false;
  }
}

function isDirectVRWorldUseTarget(target: ModuleObject): target is ModuleObject & {
  onClick(actor: ModuleCreature): void;
} {
  const supportedType = (target.objectType & (ModuleObjectType.ModuleDoor | ModuleObjectType.ModulePlaceable)) !== 0;
  return supportedType && typeof (target as unknown as { onClick?: unknown }).onClick === 'function';
}

interface VRWorldPromptActorActionState {
  readonly securitySkill: number;
  readonly securityActionIcon: string;
  readonly demolitionsSkill: number;
  readonly mineCount: number;
  readonly securityTunnelerCount: number;
  readonly authoredInventorySourceKey: string;
}

/**
 * Whether the party is actually carrying the key a locked object demands.
 *
 * Resolved by tag against the party inventory, exactly as the engine resolves
 * it in `ModulePlaceable.attemptUnlockWithKey` and as the direct-use safety
 * gate already does — so candidacy and activation cannot disagree about
 * whether the key is in hand.
 */
function actorHoldsVRWorldPromptKey(target: { keyName?: unknown }): boolean {
  try {
    const keyName = target.keyName;
    if (typeof keyName !== 'string' || !keyName.length) return false;
    return !!GameState.InventoryManager.getItemByTag(keyName);
  } catch {
    return false;
  }
}

function hasPotentialVRWorldPromptActions(
  actor: ModuleCreature,
  actorState: VRWorldPromptActorActionState,
  target: ModuleObject,
): boolean {
  if ((target.objectType & ModuleObjectType.ModuleCreature) !== 0) {
    return hasCreatureWorldPromptAction(readVRCreaturePromptState(actor, target, isVRFightOnFor(actor)));
  }
  if ((target.objectType & (ModuleObjectType.ModuleDoor | ModuleObjectType.ModulePlaceable)) !== 0) {
    const lockTarget = target as ModuleObject & {
      isLocked?: () => boolean;
      lockable?: unknown;
      keyRequired?: unknown;
      notBlastable?: unknown;
    };
    if (typeof lockTarget.isLocked !== 'function') return false;
    if (!lockTarget.isLocked()) {
      // Candidacy asks only "could this object plausibly offer an action?".
      // It must NOT apply direct-use safety here: those rules exist to stop the
      // generic use() fallback from stealing ownership from locks, keys, and
      // story state, but a plot-owned or story-scripted container still exposes
      // authored ActionMenu routes that the object itself owns and gates.
      // Applying them at candidacy dropped every such container before its
      // authored actions were ever counted, which is why ordinary containers
      // and doors showed a name label but never a prompt. Safety is re-applied
      // by classifySafeDirectVRWorldUse when the prompt is actually built —
      // that is where the real authored action count exists.
      return isDirectVRWorldUseTarget(target);
    }
    if (!Boolean(lockTarget.notBlastable)) return true;
    // A key-required lock is refused by Security (`canAttemptSecurityUnlock` is
    // `locked && !keyRequired`) and, when NotBlastable, by Bash as well. So for
    // a player who is actually holding the key, this branch is the only thing
    // between them and the container — and returning false here drops the
    // object from candidacy before any prompt is built, which reads in the
    // headset as a locker offering no options whatsoever. Reported for the
    // cargo-bay locker after taking the key from Kreia's body; the console
    // recorded `hasActions=false locked=1 keyRequired=1 notBlastable=true`.
    if (actorHoldsVRWorldPromptKey(lockTarget)) return true;
    // Use the shared rule, not a local copy. This branch previously inlined
    // `lockable && !keyRequired`, which survived the ObjectLockRules fix and
    // kept vetoing on `lockable` — a field that means "can be re-locked" in
    // Odyssey, not "can be picked". Because the branch is only reached when
    // notBlastable is true, it stayed hidden on a save where the doors were
    // blastable and then dropped every locked door out of candidacy on a new
    // game: no menu, no hover, no interaction at all.
    const securityAllowed = canAttemptSecurityUnlock({
      locked: true,
      lockable: Boolean(lockTarget.lockable),
      keyRequired: Boolean(lockTarget.keyRequired),
    });
    return securityAllowed && (
      actorState.securitySkill >= 1 || actorState.securityTunnelerCount > 0
    );
  }
  if ((target.objectType & ModuleObjectType.ModuleTrigger) !== 0) {
    const trigger = target as ModuleObject & { type?: unknown };
    return trigger.type === ModuleTriggerType.TRAP &&
      actorState.demolitionsSkill >= 1;
  }
  return false;
}

function buildVRWorldPromptStateKey(
  actor: ModuleCreature,
  actorState: VRWorldPromptActorActionState,
  target: ModuleObject,
  name: string,
  anchor: THREE.Vector3,
  hasActions: boolean,
): string {
  const state = target as ModuleObject & {
    isLocked?: () => boolean;
    lockable?: unknown;
    keyRequired?: unknown;
    plot?: unknown;
    notBlastable?: unknown;
    trapDisarmable?: unknown;
    type?: unknown;
    scripts?: unknown;
    tag?: unknown;
    templateResRef?: unknown;
    getTag?: () => unknown;
    getTemplateResRef?: () => unknown;
  };
  return JSON.stringify([
    getVRWorldPromptObjectIdentity(actor),
    getVRWorldPromptObjectIdentity(target),
    target.id,
    target.objectType,
    name,
    anchor.x,
    anchor.y,
    anchor.z,
    hasActions,
    readBooleanState(state.isLocked, state),
    state.lockable,
    state.keyRequired,
    state.plot,
    state.notBlastable,
    state.type,
    state.trapDisarmable,
    readIdentityState(state.getTag, state.tag, state),
    readIdentityState(state.getTemplateResRef, state.templateResRef, state),
    readScriptIdentityState(state.scripts),
    actorState.securitySkill,
    actorState.securityActionIcon,
    actorState.demolitionsSkill,
    actorState.mineCount,
    actorState.securityTunnelerCount,
    actorState.authoredInventorySourceKey,
  ]);
}

function getVRWorldPromptObjectIdentity(value: object): number {
  const existing = vrWorldPromptObjectIdentities.get(value);
  if (existing !== undefined) return existing;
  const identity = nextVRWorldPromptObjectIdentity;
  nextVRWorldPromptObjectIdentity += 1;
  vrWorldPromptObjectIdentities.set(value, identity);
  return identity;
}

function readBooleanState(getter: (() => boolean) | undefined, receiver: object): boolean | null {
  try {
    return typeof getter === 'function' ? getter.call(receiver) === true : null;
  } catch {
    return null;
  }
}

function readIdentityState(
  getter: (() => unknown) | undefined,
  property: unknown,
  receiver: object,
): string {
  try {
    const value = typeof getter === 'function' ? getter.call(receiver) : property;
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  } catch {
    return '';
  }
}

function readScriptIdentityState(scripts: unknown): string {
  if (!scripts || typeof scripts !== 'object') return '';
  return Object.entries(scripts as Readonly<Record<string, unknown>>)
    .map(([key, value]) => {
      const name = value && typeof value === 'object' && 'name' in value
        ? (value as { readonly name?: unknown }).name
        : value;
      return `${key.toLowerCase()}:${typeof name === 'string' ? name.toLowerCase() : Boolean(name)}`;
    })
    .sort()
    .join('|');
}

function readVRWorldPromptActorActionState(
  actor: ModuleCreature,
): VRWorldPromptActorActionState {
  // Trained ranks, matching the action menu's Security gate: a tunneler's
  // temporary bonus must neither expose a bare Security entry nor rebuild the
  // prompt when it is applied and again when it expires.
  const securitySkill = readVRActorTrainedSkillRank(actor, SkillType.SECURITY);
  const securityActionIcon = readVRActorSecurityActionIcon(actor);
  const demolitionsSkill = readVRActorSkill(actor, SkillType.DEMOLITIONS);
  try {
    const inventory = actor.getInventory();
    if (!Array.isArray(inventory)) {
      return {
        securitySkill,
        securityActionIcon,
        demolitionsSkill,
        mineCount: 0,
        securityTunnelerCount: 0,
        authoredInventorySourceKey: '',
      };
    }
    const authoredItems = inventory.filter((item) =>
      item?.baseItemId === 58 || item?.baseItemId === 59
    );
    return {
      securitySkill,
      securityActionIcon,
      demolitionsSkill,
      mineCount: authoredItems.filter((item) => item.baseItemId === 58).length,
      securityTunnelerCount: authoredItems.filter((item) => item.baseItemId === 59).length,
      authoredInventorySourceKey: JSON.stringify(authoredItems.map((item) => [
        getVRWorldPromptObjectIdentity(item),
        item.id,
        item.baseItemId,
        // The stack size too: 3 tunnelers becoming 2 must rebuild the prompt.
        typeof item.getStackSize === 'function' ? item.getStackSize() : null,
        readCallableString(item.getName, item),
        readCallableString(item.getIcon, item),
      ])),
    };
  } catch {
    return {
      securitySkill,
      securityActionIcon,
      demolitionsSkill,
      mineCount: 0,
      securityTunnelerCount: 0,
      authoredInventorySourceKey: '',
    };
  }
}

function readVRActorSecurityActionIcon(actor: ModuleCreature): string {
  const skill = actor.skills?.[SkillType.SECURITY];
  return skill ? readCallableString(skill.getIcon, skill) : '';
}

function readVRActorSkill(actor: ModuleCreature, skill: SkillType): number {
  try {
    const value = actor.getSkillLevel(skill);
    return Number.isFinite(value) ? value : -1;
  } catch {
    return -1;
  }
}

function readVRActorTrainedSkillRank(actor: ModuleCreature, skill: SkillType): number {
  try {
    const value = actor.skills?.[skill]?.rank;
    return typeof value === 'number' && Number.isFinite(value) ? value : -1;
  } catch {
    return -1;
  }
}

function readCallableString(getter: (() => unknown) | undefined, receiver: object): string {
  try {
    const value = typeof getter === 'function' ? getter.call(receiver) : '';
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

function resolveVRWorldPromptName(target: ModuleObject): string {
  try {
    return resolveDisplayName(target.getName?.()) || 'Object';
  } catch {
    return 'Object';
  }
}

function distance2D(first: THREE.Vector3, second: THREE.Vector3): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

/** Decision 5 of 2026-10-13: a party member takes at most this many melee attackers at once in VR. */
const VR_MELEE_ATTACKERS_PER_PARTY_MEMBER = 3;
/** Where a melee attacker waiting for room stands, metres from its target. */
const VR_MELEE_CROWD_HOLD_METRES = 3;

function buildVRPartySwitchEntries() {
  const candidates = GameState.PartyManager.party.map((member) => ({
    id: String(member.id),
    name: member.getName(),
    npcId: Number.isInteger(member.npcId) ? member.npcId : -1,
    isPlayer: !!member.isPlayer,
    portrait: member.getPortraitResRef() || undefined,
    downed: typeof member.isDead === 'function' && member.isDead(),
  }));
  return buildPartySwitchEntries(candidates, GameState.PartyManager.ActualPlayerName, GameState.PartyManager.ActualPlayerPortrait || undefined);
}

function snapshotVRPartyMembers(): readonly VRActionWheelPartyMember[] {
  // Picking a member possesses them (SwitchPlayerCharacter), which is what
  // retail's leader switch is; reordering the follow order left the Exile as
  // every conversation's speaker. See VRPartySwitchRules.
  const entries = buildVRPartySwitchEntries();
  return entries.map((entry, index) => ({
    id: entry.id,
    label: entry.label,
    icon: entry.icon,
    // The wheel treats a positive index as "switchable"; the entry's place in
    // this list serves, since possession takes an NPC id, not an index.
    resolveCurrentIndex: () => (entries.some((e) => e.id === entry.id) ? index + 1 : -1),
    switchLeader: () => { GameState.PartyManager.SwitchPlayerCharacter(entry.npcId, true); },
  }));
}

/**
 * ROADMAP 3.21 — "Party → Attack My Target". Every living companion other
 * than the controlled actor drops what it is doing and opens a combat round
 * on the pointed hostile, the same `attackCreature` route a flatscreen click
 * on an enemy takes. The order only schedules the round; the henchman AI's
 * own OnEndRound script resumes afterwards, so the stats and the 3-second
 * round are untouched. Null when there is no one to order or nothing hostile
 * to point at, so the wheel omits the entry rather than offering a no-op.
 */
function buildVRPartyAttackOrder(actor: ModuleCreature, target: ModuleObject): VRActionWheelDirectAction | null {
  const companions = () => GameState.PartyManager.party.filter((member) =>
    member !== actor && typeof member.isDead === 'function' && !member.isDead());
  if (companions().length === 0) return null;
  return {
    id: 'party:attack-my-target',
    label: 'Attack My Target',
    icon: 'i_attack',
    revalidate: () => isVRCombatTarget(actor, target) && companions().length > 0,
    activate: () => {
      if (!isVRCombatTarget(actor, target)) return;
      let ordered = 0;
      for (const member of companions()) {
        try {
          // ClearAllActions before ActionAttack, as the henchman scripts do,
          // so the order runs ahead of a follow or a half-queued attack.
          member.clearAllActions(true);
          member.attackCreature(target, undefined);
          ordered += 1;
        } catch (error) {
          console.warn('[VR party] attack order rejected', member.getTag?.() ?? member.id, error);
        }
      }
      console.info(`[VR party] Attack My Target: ${ordered} companion(s) -> ${target.getTag?.() ?? target.id}`);
    },
  };
}

function resolveVRCombatWeaponMode(actor: ModuleCreature): CombatWeaponMode {
  switch (actor.getCombatAnimationWeaponType()) {
    case 1:
    case 2:
      return 'melee-one-handed';
    case 3:
      return 'melee-double-bladed';
    case 4:
      return 'melee-dual-wield';
    case 5:
    case 6:
    case 7:
    case 9:
      return 'blaster';
    default:
      return 'unarmed';
  }
}

/**
 * Models for armed items shown in the off hand, loaded once per item object.
 * Presentation only: the item's own `model` is never written.
 */
const vrArmedItemModels = new WeakMap<object, THREE.Object3D | 'loading' | 'none'>();
function resolveVRArmedItemVisual(item: ModuleItem | null): VREquippedHeldItem | null {
  if (!item) return null;
  const cached = vrArmedItemModels.get(item);
  if (cached instanceof THREE.Object3D) {
    return { model: cached, baseItem: item.baseItem as any, baseItemId: item.baseItemId };
  }
  if (!cached && typeof (item as any).loadHeldPresentationModel === 'function') {
    vrArmedItemModels.set(item, 'loading');
    (item as any).loadHeldPresentationModel()
      .then((model: THREE.Object3D | null) => vrArmedItemModels.set(item, model ?? 'none'))
      .catch(() => vrArmedItemModels.set(item, 'none'));
  }
  // The hand stays empty for the frame or two the load takes.
  return null;
}

export interface VREquippedHeldItem {
  readonly model?: unknown;
  readonly baseItemId?: unknown;
  readonly baseItem?: {
    readonly itemClass?: unknown;
    readonly rangedWeapon?: unknown;
  };
}

/** The engine equipment slots consumed by the VR held-item presentation bridge. */
export interface VRHeldItemEquipment {
  readonly LEFTHAND?: VREquippedHeldItem | null;
  readonly RIGHTHAND?: VREquippedHeldItem | null;
}

/**
 * How an engine weapon model sits in a WebXR grip space.
 *
 * One transform for every weapon class, because every weapon is authored in the
 * same frame: the creature's hand bone. Measured live on retail models, not
 * assumed — a Vibroblade (`w_vbroshort_001`) and a Short Sword run their handle
 * along -Z and their blade out to +0.88 m along +Z with the flat across Y, and a
 * Blaster Pistol (`w_blstrpstl_001`) and T3's Hold-Out Blaster run the barrel
 * along +Y with the handle on Z. Both sit at world scale 1: Odyssey models are
 * authored in metres.
 *
 * WebXR grip space runs a held rod along -Z toward the thumb, and the hand
 * poser closes the fist around a rod through the grip origin. A half turn about
 * X therefore puts the handle in the fist, the blade out past the thumb and the
 * barrel along -Y, the direction the knuckles face.
 *
 * The previous per-class fallbacks scaled every model by 0.01 — a one-metre
 * blade drawn one centimetre long — which is why no weapon was ever visible in
 * the headset ("the weapon model never showed for any character").
 */
/**
 * Eye height above the feet for the character the player drives.
 *
 * Measured on live models rather than tabled: the Exile's `headhook` sits
 * 1.52 m above the feet with the head top at 1.78 m, and eyes sit roughly
 * 12 cm above the hook. T3-M4 and the mining droids have no headhook and a top
 * at 0.90 m; the droid view reads right with the camera just above that dome —
 * the 1.08 m the player reported as "T3 camera height is correct". Cached per
 * model, because the bounds walk is not free and a model's height does not
 * change while it is the same model.
 */
const vrEyeHeightByModel = new WeakMap<object, number>();

function resolveVRCharacterEyeHeight(actor: ModuleCreature | null | undefined): number | null {
  const model = actor?.model as (THREE.Object3D & { headhook?: THREE.Object3D | null }) | undefined;
  if (!actor?.position || !model) return null;
  const cached = vrEyeHeightByModel.get(model);
  if (cached !== undefined) return cached;
  try {
    model.updateMatrixWorld(true);
    let eye: number | null = null;
    if (model.headhook) {
      eye = model.headhook.getWorldPosition(new THREE.Vector3()).z - actor.position.z + 0.12;
    } else {
      let top = -Infinity;
      const box = new THREE.Box3();
      model.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        if (!mesh.geometry.boundingBox) return;
        box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
        top = Math.max(top, box.max.z);
      });
      // No head bone: estimate from the top of the mesh. A droid's eyes sit
      // at its dome (T3-M4's 1.08 m was confirmed in the headset), but a
      // humanoid's crown is well above its eyes, and more so in a helmet:
      // the Exile's Peragus space suit (spacesuit01) has no head nodes at all,
      // and "top + 0.15" put the camera at 2.06 m against Atton's 1.63.
      if (Number.isFinite(top)) {
        const droid = typeof actor.getRace === 'function' && actor.getRace() === VR_RACE_DROID;
        eye = top - actor.position.z + (droid ? 0.15 : -0.22);
      }
    }
    if (eye === null || !Number.isFinite(eye) || eye < 0.5 || eye > 2.4) return null;
    vrEyeHeightByModel.set(model, eye);
    return eye;
  } catch {
    return null;
  }
}

/** The longest side a held medpac or stim is drawn at: palm-sized. */
const VR_HELD_CONSUMABLE_MAX_METRES = 0.11;
/** Measured once per model: this runs every frame for the held hand. */
const vrHeldConsumableFit = new WeakMap<THREE.Object3D, HeldItemClassFallbackTransform>();

/** Measured once per lightsaber model; null for a model with no saber blade. */
const vrHeldSaberFit = new WeakMap<THREE.Object3D, HeldItemClassFallbackTransform | null>();

function resolveHeldItemClassFallback(item: VREquippedHeldItem): HeldItemClassFallbackTransform {
  const rotation = new THREE.Euler(Math.PI, 0, 0);
  const itemClass = typeof item.baseItem?.itemClass === 'string' ? item.baseItem.itemClass.trim().toLowerCase() : '';
  const model = item.model;
  // Medpacs and stims (i_* item classes) are modelled for the ground, not the
  // hand: about 30 cm tall with their origin at the base, so the armed medpac
  // stood 20 cm above the palm and hid the target (critic run 11). Centre it
  // in the palm and keep it palm-sized. Weapons and grenades keep theirs.
  // Grenades too: the armed frag was bigger than the hand (critic run 13).
  if ((itemClass.startsWith('i_') || /gren/.test(itemClass)) && model instanceof THREE.Object3D) {
    const cached = vrHeldConsumableFit.get(model);
    if (cached) return cached;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const longest = Math.max(size.x, size.y, size.z);
      const scale = longest > VR_HELD_CONSUMABLE_MAX_METRES ? VR_HELD_CONSUMABLE_MAX_METRES / longest : 1;
      const centre = box.getCenter(new THREE.Vector3());
      const position = centre.multiplyScalar(-scale).applyEuler(rotation);
      const fit = { position, rotation, scale };
      vrHeldConsumableFit.set(model, fit);
      return fit;
    }
  }
  // Lightsabers: the hand closes on the grip above the pommel, not under the
  // emitter where the creature's hand bone holds it. The half turn maps model
  // +Z to grip -Z, so the model's grip point lands on the grip origin with
  // the model moved +centre along grip Z. See VRHeldSaberGrip.
  if (model instanceof THREE.Object3D) {
    let saberFit = vrHeldSaberFit.get(model);
    if (saberFit === undefined) {
      const centre = measureVRSaberGripCentre(model);
      saberFit = centre === null ? null : { position: new THREE.Vector3(0, 0, centre), rotation, scale: 1 };
      vrHeldSaberFit.set(model, saberFit);
    }
    if (saberFit) return saberFit;
  }
  return {
    position: new THREE.Vector3(0, 0, 0),
    rotation,
    scale: 1,
  };
}

function findHeldItemGripNode(model: THREE.Object3D): THREE.Object3D | null {
  let match: THREE.Object3D | null = null;
  model.traverse((node) => {
    if (match) return;
    const name = node.name.trim().toLocaleLowerCase();
    if (name === 'grip' || name === 'grip_hook' || name === 'weapon_grip') match = node;
  });
  return match;
}

function describeHeldItemVisual(item: VREquippedHeldItem | null | undefined): HeldItemVisualDescriptor | null {
  const model = item?.model;
  if (!(model instanceof THREE.Object3D)) return null;
  const baseItemClass = typeof item.baseItem?.itemClass === 'string' && item.baseItem.itemClass.trim()
    ? item.baseItem.itemClass.trim()
    : typeof item.baseItemId === 'number' ? `base-item-${item.baseItemId}` : 'unknown';
  return {
    model,
    baseItemClass,
    authoredGripNode: findHeldItemGripNode(model),
    classFallback: resolveHeldItemClassFallback(item),
    // Blasters and rifles; grenades are not ranged weapons in baseitems.2da.
    aimsAlongBarrel: item.baseItem?.rangedWeapon === true,
  };
}

/**
 * Builds presentation descriptors without mutating engine equipment or models.
 * Keeping the slots explicit prevents item models from crossing controller
 * hands when a party member uses an unusual weapon class.
 */
export function describeVRHeldItemVisuals(
  equipment: VRHeldItemEquipment | null | undefined
): Readonly<{ left: HeldItemVisualDescriptor | null; right: HeldItemVisualDescriptor | null }> {
  return {
    left: describeHeldItemVisual(equipment?.LEFTHAND),
    right: describeHeldItemVisual(equipment?.RIGHTHAND),
  };
}

/**
 * Every visible GUI root except the one the VR panel is presenting.
 *
 * The panel composites the whole legacy GUI scene, so without this a menu
 * opened over the in-game HUD arrived in the headset with the entire 2D
 * interface drawn behind it. Collected from the menu manager rather than by
 * walking the scene, so non-menu children — the cursor and the GUI ambient
 * light — are never candidates for hiding.
 */
function getOccludedGuiRoots(keep: GameMenu): readonly THREE.Object3D[] {
  const roots: THREE.Object3D[] = [];
  const seen = new Set<GameMenu>();
  const collect = (menus: readonly GameMenu[] | undefined) => {
    if (!Array.isArray(menus)) return;
    for (const menu of menus) {
      if (!menu || menu === keep || seen.has(menu)) continue;
      seen.add(menu);
      if (!menu.bVisible) continue;
      const root = menu.tGuiPanel?.getControl?.();
      if (root) roots.push(root);
    }
  };
  collect(GameState.MenuManager.activeMenus as unknown as GameMenu[]);
  collect(GameState.MenuManager.activeModals as unknown as GameMenu[]);
  const overlay = GameState.MenuManager.InGameOverlay;
  if (overlay && overlay !== keep && overlay.bVisible && !seen.has(overlay)) {
    const root = overlay.tGuiPanel?.getControl?.();
    if (root) roots.push(root);
  }
  return roots;
}

function getLegacyGUIVRPointerSemanticTargets(): readonly LegacyGUIVRPointerSemanticTarget[] {
  return discoverLegacyGUIVRPointerSemanticTargets(
    () => GameState.controls?.MenuGetActiveUIElements() ?? [],
  );
}

const vrLegacyGUIPointerAdapter = new LegacyGUIVRPointerAdapter({
  getViewportSize: () => ({
    width: GameState.ResolutionManager.getViewportWidth(),
    height: GameState.ResolutionManager.getViewportHeight(),
  }),
  getControlsAtPointer: () => GameState.controls?.MenuGetActiveUIElements() ?? [],
  getSemanticTargetsAtPointer: getLegacyGUIVRPointerSemanticTargets,
  setPointerVisible: (visible: boolean) => {
    if (GameState.scene_cursor_holder) GameState.scene_cursor_holder.visible = visible;
  },
  applyPointerCoordinates: (coordinates: LegacyGUIVRPointerCoordinates) => {
    Mouse.positionUI.copy(coordinates.ui);
    Mouse.Vector.copy(coordinates.ui);
    Mouse.positionViewport.copy(coordinates.viewport);
    Mouse.positionWindow.copy(coordinates.viewport);
    Mouse.position.copy(coordinates.normalized);
  },
  beforeControlActivation: (control: LegacyGUIVRPointerControl) => {
    GameState.MenuManager.activeGUIElement = control as any;
  },
  afterControlActivation: (control: LegacyGUIVRPointerControl) => {
    GameState.guiAudioEmitter?.playSoundFireAndForget('gui_click');
    const menuName = (control as any).menu?.constructor?.name ?? 'UnknownMenu';
    EventManager.FireEvent('menu.click', { name: control.name, menu: menuName });
  },
  // Round 14 (S2): the thumbstick scrolls the list under the pointer, as the
  // mouse wheel does on a flat screen (IngameControls' wheel handler). The
  // hovered element is often a row or the scrollbar, so climb to its list.
  scrollListAtPointer: (rows: number) => {
    let element: any = GameState.MenuManager.hoveredGUIElement;
    for (let depth = 0; element && depth < 8; depth++) {
      if (element.list && typeof element.list.scrollDown === 'function') { element = element.list; break; }
      if (typeof element.scrollDown === 'function' && typeof element.maxScroll === 'number') break;
      element = element.parent;
    }
    if (!element || typeof element.scrollDown !== 'function') return false;
    for (let i = 0; i < Math.abs(rows); i++) {
      if (rows > 0) element.scrollDown(); else element.scrollUp();
    }
    return true;
  },
});

export class GameState implements EngineContext {

  /**
   * While WebXR owns the player, physical input explicitly creates each
   * CombatRound action. The desktop simulation retains its authored automatic
   * basic-attack behaviour as soon as the XR session ends.
   */
  static get isVREmbodiedCombatInputActive(): boolean {
    return VRSpike.isPresenting;
  }

  static eventListeners: any = {
    "init": [],
    "start": [],
    "ready": [],

    "beforeRender": [],
    "afterRender": [],
    // "mgPazaakStart": []
  };

  static PerformanceMonitor: typeof PerformanceMonitor;
  static AppearanceManager: typeof AppearanceManager;
  static AutoPauseManager: typeof AutoPauseManager;
  static CameraShakeManager: typeof CameraShakeManager;
  static CharGenManager: typeof CharGenManager;
  static CheatConsoleManager: typeof CheatConsoleManager;
  static ConfigManager: typeof ConfigManager;
  static CursorManager: typeof CursorManager;
  static DialogMessageManager: typeof DialogMessageManager;
  static FactionManager: typeof FactionManager;
  static FadeOverlayManager: typeof FadeOverlayManager;
  static FeedbackMessageManager: typeof FeedbackMessageManager;
  static GlobalVariableManager: typeof GlobalVariableManager;
  static InventoryManager: typeof InventoryManager;
  static JournalManager: typeof JournalManager;
  static LightManager: typeof LightManager;
  static WindManager: typeof WindManager;
  static MenuManager: typeof MenuManager;
  static ModuleObjectManager: typeof ModuleObjectManager;
  static PartyManager: typeof PartyManager;
  static ResolutionManager: typeof ResolutionManager;
  static ShaderManager: typeof ShaderManager;
  static TLKManager: typeof TLKManager;
  static TwoDAManager: typeof TwoDAManager;
  static PazaakManager: typeof PazaakManager;
  static UINotificationManager: typeof UINotificationManager;
  static CutsceneManager: typeof CutsceneManager;
  static LegalScreenManager: typeof LegalScreenManager;
  static lastGameplayThumb?: OffscreenCanvas;
  static lastGameplayThumbCtx?: OffscreenCanvasRenderingContext2D;
  static lastGameplayThumbRT?: THREE.WebGLRenderTarget;

  static FollowerCamera: typeof FollowerCamera = FollowerCamera;


  static SWRuleSet: typeof SWRuleSet;

  static Module: typeof Module;
  static NWScript: typeof NWScript;

  static TalentObject: typeof TalentObject;
  static TalentFeat: typeof TalentFeat;
  static TalentSkill: typeof TalentSkill;
  static TalentSpell: typeof TalentSpell;
  static ActionMenuManager: typeof ActionMenuManager;

  static ActionFactory: typeof ActionFactory;
  static GameEffectFactory: typeof GameEffectFactory;
  static GameEventFactory: typeof GameEventFactory;
  static VideoEffectManager: typeof VideoEffectManager;
  static VideoManager: typeof VideoManager;

  static Planetary: typeof Planetary = Planetary;

  static Debugger: typeof Debugger = Debugger;

  static GameKey: GameEngineType = GameEngineType.KOTOR;
  static iniConfig: INIConfig;
  
  static Ready = false;
  
  static CameraDebugZoom = 1;
  
  static raycaster = new THREE.Raycaster();
  static mouse = new THREE.Vector2();
  static mouseUI = new THREE.Vector2();
  static screenCenter = new THREE.Vector3();
  
  static SOLOMODE = false;
  static isLoadingSave = false;
  
  static Flags = {
    EnableAreaVIS: false,
    LogScripts: false,
    EnableOverride: false,
    WalkmeshVisible: false,
    CombatEnabled: false
  }
  static debugMode = false;
  static debug: {[key in EngineDebugType]: boolean} = {
    CONTROLS: false,
    SELECTED_OBJECT: false,
    OBJECT_LABELS: false,
    PATH_FINDING: false,

    ROOM_WALKMESH: false,
    DOOR_WALKMESH: false,
    PLACEABLE_WALKMESH: false,
    COLLISION_HELPERS: false,

    LIGHT_HELPERS: false,
    SHADOW_LIGHTS: false,
  };
  
  static IsPaused = false;
  
  static Mode: EngineMode = EngineMode.GUI;
  static holdWorldFadeInForDialog = false;
  //TSL's SetDisableTransit (opcode 860). Blocks player-initiated area
  //transitions - transition triggers and transition doors - while a scripted
  //sequence is in progress. Scripted transitions (StartNewModule), save
  //loading and chargen deliberately bypass it.
  static disableTransit = false;
  static autoRun = false;
  static AlphaTest = 0.5;
  static noClickTimer = 0;
  static maxSelectableDistance = 20;
  /**
   * True while VR shows a conversation in the world rather than on the
   * theater; the dialogue menu drops its letterbox bars so the panel reads as
   * clean subtitles.
   */
  static vrDialogWorldPresentation = false;
  static maxSelectableDistanceSquared = GameState.maxSelectableDistance * GameState.maxSelectableDistance;

  /** DisableHealthRegen: stops vitality regeneration for everyone. */
  static healthRegenDisabled: boolean = false;
  /** DisableMap: hides the map on the in-game overlay and the map screen. */
  static mapDisabled: boolean = false;
  /** SetKeepStealthInDialog: stealth survives a conversation instead of dropping. */
  static keepStealthInDialog: boolean = false;
  static delta: number = 0;

  static SaveGame: SaveGame;

  /**
   * A spell was just cast (ModuleArea.attachSpellInstance). In VR, the
   * player's own Force power gets a sound and a burst at the hand: its
   * effects play on a body first person hides (round 14).
   */
  static onSpellCast: ((caster: unknown, spell: unknown) => void) | null = (caster, spell) => {
    if (!VRSpike.isPresenting || caster !== GameState.getCurrentPlayer()) return;
    if (classifyVRForcePower(spell) !== true) return;
    VRSpike.presentLocalForceCast();
  };

  /**
   * How many melee attackers one defender takes at once (ActionPhysicalAttacks,
   * MeleeCrowdRules); undefined: no cap, every attacker takes an open spot.
   * In VR four or five troopers crowded one party member at arm's length and
   * filled the view (Anchor, Hive run 2): at most 3 melee attackers per party
   * member; the rest switch to the least crowded member or wait 3 m off
   * (decision 5 of 2026-10-13). Positioning only: rolls and ranged attackers
   * are untouched.
   */
  static meleeCrowdPolicy: ((attacker: unknown, defender: unknown) => MeleeCrowdPolicy | undefined) | null = (attacker, defender) => {
    if (!VRSpike.isPresenting) return undefined;
    const party: unknown[] = GameState.PartyManager?.party ?? [];
    if (!party.includes(defender) || party.includes(attacker)) return undefined;
    return { maxAttackers: VR_MELEE_ATTACKERS_PER_PARTY_MEMBER, holdDistance: VR_MELEE_CROWD_HOLD_METRES, alternatives: party };
  };

  /** Decides whether an attack voices its soundset line (ActionPhysicalAttacks). */
  static attackBarkGate = new AttackBarkGate();
  /** The policy for one attacker's lines; null or undefined plays one on every attack. */
  static attackBarkPolicy: ((attacker: unknown) => AttackBarkPolicy | undefined) | null = (attacker) => {
    // In VR an enemy's battle cry played on every shot (30 of 30) and buried
    // the shot, impact and pain cues (Spark, Bolt, run 2). About one attack in
    // three, never within 4 s per creature (Part F, decision 7 of
    // 2026-10-13). Outside VR, and for the party, every attack still voices.
    if (!VRSpike.isPresenting) return undefined;
    try {
      const player = GameState.getCurrentPlayer() as any;
      if (!player || attacker === player || !(attacker as any)?.isHostile?.(player)) return undefined;
    } catch {
      return undefined;
    }
    return SPARSE_ATTACK_BARK_POLICY;
  };

  /** In VR, the player's own blows and blows on the player are voiced by the VR cue (critic run 7). */
  static vrVoicesCombatImpact: ((attacker: unknown, target: unknown) => boolean) | null = (attacker, target) => {
    if (!VRSpike.isPresenting) return false;
    // With Combat Sounds off the VR cues are silent, so the engine's own
    // retail sounds must play (critic run 8: the fight went silent).
    if (vrComfortSettings.combatSoundsEnabled === false) return false;
    const player = GameState.getCurrentPlayer();
    return !!player && (attacker === player || target === player);
  };

  /** A blow landed (the attack animation's Hit): a blow on the VR player is voiced now (critic run 9). */
  /**
   * A blow landed (an attack animation's Hit event). The VR hurt sound no
   * longer comes from here: ranged attacks have no Hit event, so it follows
   * the HP drop instead (critic run 10). Kept as the landing hook for checks.
   */
  /**
   * Quit on the main menu in a browser. In the headset it ends the VR session
   * and leaves the game on its main menu on the desktop: the browser's
   * blocking "close this tab" alert froze the headset (round 15). Returns
   * true when handled.
   */
  static onMenuQuit: (() => boolean) | null = () => {
    if (!VRSpike.isPresenting) return false;
    VRSpike.exit();
    return true;
  };

  /** A save is being loaded: VR combat state (queue, armed items) belongs to the old game. */
  static onSaveLoadStarted: (() => void) | null = () => resetVREmbodiedCombatState();

  static onBlowLanded: ((attacker: unknown, target: unknown, critical: boolean) => void) | null = (attacker, target) => {
    // Part D1: a hit on the VR player is shown when the blade lands.
    if (!VRSpike.isPresenting || target !== GameState.getCurrentPlayer()) return;
    const id = (attacker as { id?: unknown } | null)?.id;
    if (typeof id === 'number') VRSpike.noteBlowLanded(id);
  };

  /** The player was stunned or knocked down: say so in VR (critic run 6). */
  static onPlayerDisabled: ((target: unknown, what: string, seconds: number) => void) | null = (target, what) => {
    if (!VRSpike.isPresenting || target !== GameState.getCurrentPlayer()) return;
    try { VRSpike.showNotice(what); } catch { /* feedback only */ }
  };

  /** A scheduled item cast was rejected at release; the player hears the refusal in VR (critic run 4). */
  /** The VR throwing hand, for a projectile the player just threw (see SpellCastInstance). */
  static resolveVRProjectileHook: ((owner: unknown) => THREE.Object3D | null) | null = (owner) =>
    owner && owner === GameState.getCurrentPlayer() ? VRSpike.resolveThrowHandAnchor() : null;

  /** Spell or item name for a log line, "" when unknown. */
  static describeSpellForLog(spellId: number): string {
    try {
      const strref = Number((GameState.SWRuleSet as any)?.spells?.[spellId]?.name);
      if (!(strref >= 0)) return '';
      const name = stripTLKSortPrefix(String(GameState.TLKManager.GetStringById(strref)?.Value ?? ''));
      // spells.2da names grenades "Grenade: Frag"; the item is "Frag Grenade".
      return name.replace(/^Grenade:\s*(.+)$/i, '$1 Grenade');
    } catch { return ''; }
  }

  /** Combat log: a scripted hit ("Atton damaged for 20 (Frag Grenade)"). */
  static onScriptedDamage: ((target: unknown, source: unknown, amount: number, spellId: number) => void) | null = (target, source, amount, spellId) => {
    if (!(amount > 0)) return;
    const name = (target as any)?.getName?.();
    if (!name) return;
    const what = GameState.describeSpellForLog(spellId);
    const by = source && source !== target ? (source as any)?.getName?.() : '';
    // Retail's lines (dialog.tlk 1403 / 1402): "<source> damages <target> for <n> damage", or "<target> damaged: <n>".
    GameState.FeedbackMessageManager.AddLine(by
      ? `${by} damages ${name} for ${amount} damage${what ? ` (${what})` : ''}`
      : `${name} damaged: ${amount}${what ? ` (${what})` : ''}`);
    // In VR there are no floating numbers: say when the player's own throw or
    // power hurts the player or a companion (critic run 18).
    if (!VRSpike.isPresenting) return;
    const player = GameState.getCurrentPlayer();
    if (!player || source !== player) return;
    const party = GameState.PartyManager.party as unknown[];
    if (target === player) {
      // Harm, so the warning colour (critic run 19: teal read as neutral).
      try { VRSpike.showNotice(`You took ${amount}${what ? ` (your ${what})` : ''}`, 2500); } catch { /* notice only */ }
    } else if (party.includes(target)) {
      try { VRSpike.showNotice(`${name} took ${amount} from your ${what || 'attack'}`, 2500, 'info'); } catch { /* notice only */ }
    }
  };

  /** Combat log: every save against a power or grenade, with the roll ("Atton: Reflex 17 vs DC 15, saved"). */
  static onSavingThrowRolled: ((saver: unknown, versus: unknown, kind: string, roll: number, total: number, dc: number) => void) | null = (saver, versus, kind, roll, total, dc) => {
    if (!versus) return; // scripted checks with no opponent are not combat
    if ((saver as any)?.isDead?.() === true) return;
    const name = (saver as any)?.getName?.();
    if (!name) return;
    // Retail's Combat line (dialog.tlk 1406): "<who> <save>. <result>! <total> (roll <d20><bonus>) vs. DC <n>".
    const bonus = total - roll;
    GameState.FeedbackMessageManager.AddLine(
      `${name} ${kind} Save. ${total >= dc ? 'Success' : 'Failure'}! ${total} (roll ${roll} ${bonus < 0 ? '-' : '+'} ${Math.abs(bonus)}) vs. DC ${dc}`);
  };

  /** A creature made its save against the player's power: say so in VR. */
  static onSavingThrowMade: ((saver: unknown, versus: unknown) => void) | null = (saver, versus) => {
    if (!VRSpike.isPresenting) return;
    // A corpse in the blast "saved" (critic run 19).
    if ((saver as any)?.isDead?.() === true) return;
    const player = GameState.getCurrentPlayer();
    if (!player) return;
    // Whatever the source, the player's own grenade included (critic run 17).
    if (saver === player && versus) { VRSpike.showNotice('You saved', 2000, 'info'); return; }
    if (saver === player || versus !== player) return;
    VRSpike.showNotice(`${resolveVRWorldPromptName(saver as ModuleObject) || 'The target'} saved`, 2000, 'info');
  };

  /** A Force power was resisted: tell the VR player who cast it or resisted it. */
  static onForceResisted: ((target: unknown, caster: unknown) => void) | null = (target, caster) => {
    if (!VRSpike.isPresenting) return;
    const player = GameState.getCurrentPlayer();
    // A script-applied effect may carry no creator; a resisted power on someone
    // else is then most likely the player's own.
    const casterIsPlayer = !!player && target !== player && (caster == null || caster === player || Number(caster) === (player as any).id || (caster as any)?.id === (player as any).id);
    // Retail applies the resisted marker after a successful save too; that
    // case is announced as "saved" (onSavingThrowMade). Only a real Force
    // resistance says "resisted" (critic run 15).
    const reallyResisted = Date.now() - (Number((target as any)?.lastForceResistedAt) || 0) < 2000;
    if (casterIsPlayer && !reallyResisted) return;
    if (casterIsPlayer) VRSpike.showNotice(`${(target ? resolveVRWorldPromptName(target as ModuleObject) : '') || 'The target'} resisted the Force`, 2500, 'info');
    // Same for the player: a save against an enemy power is "saved", not
    // "resisted" (critic run 16).
    else if (target === player && reallyResisted) VRSpike.showNotice('You resisted the Force', 2500, 'info');
  };

  static onItemCastRejected: ((owner: unknown, item?: unknown, reason?: string) => void) | null = (owner, item, reason) => {
    if (!VRSpike.isPresenting || owner !== GameState.getCurrentPlayer()) return;
    // The real reason, not always "out of range" (critic run 6).
    signalVRRefusal(`refused: ${reason || 'item cast rejected'}`);
    // A grenade that could not be thrown goes back to the off hand, still
    // armed, rather than being lost with only a sound (critic run 5).
    const thrown = vrLastThrownGrenade;
    const actor = owner as ModuleCreature;
    if (thrown && item && thrown.actorId === actor.id && (item as any).id === thrown.itemId) {
      vrLastThrownGrenade = null;
      // Only into an empty off hand: a stim armed since the throw stays
      // (critic run 6).
      const handBusy = vrArmedGrenadeState.getSnapshot().armed !== undefined ||
        vrArmedConsumableState.getSnapshot().armed !== undefined;
      const entry = findVRArmedGrenade(actor, thrown.sourceKey);
      if (entry && !handBusy) vrArmedGrenadeState.arm(entry.descriptor);
    }
  };
  
  static currentGamepad: Gamepad;
  static videoEffect: number = -1;
  static onScreenShot?: Function;
  static time: number = 0;
  static deltaTime: number = 0;
  static deltaTimeFixed: number = 0;

  static canvas: HTMLCanvasElement;
  static context: WebGLRenderingContext | WebGL2RenderingContext;
  /** Which WebGL version the context was actually created at. */
  static rendererContextMode: RendererContextMode;
  static rendererUpscaleFactor: number;
  /** Which depth path the renderer was built with; startup-only. */
  static rendererDepthMode: RendererDepthMode;
  static renderer: THREE.WebGLRenderer;
  static depthTarget: THREE.WebGLRenderTarget;
  static clock: THREE.Clock;
  static stats: Stats;

  static lightManager: LightManager;
  static windManager: WindManager;

  static visible: boolean;

  static scene: THREE.Scene;
  static scene_gui: THREE.Scene;
  static scene_movie: THREE.Scene;

  //Camera properties
  static frustumMat4: THREE.Matrix4;
  static camera: THREE.PerspectiveCamera;
  static currentCamera: THREE.Camera;
  static followerCamera: THREE.PerspectiveCamera;
  static camera_dialog: THREE.PerspectiveCamera;
  static camera_animated: THREE.PerspectiveCamera;
  static camera_gui: THREE.OrthographicCamera;
  static currentCameraPosition: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  static staticCameras: THREE.PerspectiveCamera[];
  static staticCameraIndex: number;
  static animatedCameraIndex: number;
  static viewportFrustum: THREE.Frustum;
  static viewportProjectionMatrix: THREE.Matrix4;

  //GameState properties
  static globalLight: THREE.AmbientLight;
  static currentLeader: ModuleCreature;
  static playerFeetOffset: THREE.Vector3;
  static collisionList: any[];
  static walkmeshList: any[];

  static group: IGameStateGroups = {
    creatures: new THREE.Group,
    doors: new THREE.Group,
    placeables: new THREE.Group,
    rooms: new THREE.Group,
    grass: new THREE.Group,
    sounds: new THREE.Group,
    triggers: new THREE.Group,
    waypoints: new THREE.Group,
    party: new THREE.Group,
    lights: new THREE.Group,
    light_helpers: new THREE.Group,
    shadow_lights: new THREE.Group,
    path_helpers: new THREE.Group,
    emitters: new THREE.Group,
    effects: new THREE.Group,
    stunt: new THREE.Group,
    weather_effects: new THREE.Group,
    room_walkmeshes: new THREE.Group,
    spell_instances: new THREE.Group,
    debug: new THREE.Group,
    collision_helpers: new THREE.Group,
  };
  
  static interactableObjects: any[];

  static scene_cursor_holder: THREE.Group;
  static controls: IngameControls;

  //Render pass properties
  static composer: EffectComposer;
  static renderPass: RenderPass;
  static renderPassAA: SSAARenderPass;
  static odysseyShaderPass: OdysseyShaderPass;
  static copyPass: ShaderPass;
  static renderPassGUI: RenderPass;
  static bloomPass: BloomPass;
  static bokehPass: BokehPass;
  
  static module: Module;
  static loadingModule: boolean = false;
  static TutorialWindowTracker: number[];
  static audioEmitter: AudioEmitter;
  static guiAudioEmitter: AudioEmitter;
  static State: EngineState;
  static inMenu: boolean;
  static OnReadyCalled: boolean;
  
  static loadingTextures: boolean;
  private static textureDrainErrorReported = false;

  static preloadTextures: string[] = ['fx_tex_01', 'fx_tex_02', 'fx_tex_03', 'fx_tex_04', 'fx_tex_05', 'fx_tex_06', 'fx_tex_07', 'fx_tex_08',
    'fx_tex_09', 'fx_tex_10', 'fx_tex_11', 'fx_tex_12', 'fx_tex_13', 'fx_tex_14', 'fx_tex_15', 'fx_tex_16',
    'fx_tex_17', 'fx_tex_18', 'fx_tex_19', 'fx_tex_20', 'fx_tex_21', 'fx_tex_22', 'fx_tex_23', 'fx_tex_24',
    'fx_tex_25', 'fx_tex_26', 'fx_tex_stealth'];

  static domElement: HTMLElement;

  static GetDebugState(type: EngineDebugType){
    return !!this.debug[type];
  }

  static ToggleDebugState(type: EngineDebugType){
    GameState.SetDebugState(type, !this.debug[type]);
  }

  static SetDebugState(type: EngineDebugType, enabled: boolean){
    this.debug[type] = enabled;
    console.log('SetDebugState', type, enabled);
    switch(type){
      case EngineDebugType.PATH_FINDING:
        if(!GameState?.module?.area?.path)
          return;

        GameState.module.area.path.setPathHelpersVisibility(enabled);

        for(let i = 0; i < GameState.module.area.creatures.length; i++){
          const creature = GameState.module.area.creatures[i]
          if(!creature.getComputedPath()?.helperMesh){
            continue;
          }
          creature.getComputedPath().helperMesh.visible = enabled;
        }

        for(let i = 0; i < GameState.PartyManager.party.length; i++){
          const creature = GameState.PartyManager.party[i]
          if(!creature.getComputedPath()?.helperMesh){
            continue;
          }
          creature.getComputedPath().helperMesh.visible = enabled;
        }
      break;
      case EngineDebugType.OBJECT_LABELS:
        if(!GameState?.module?.area)
          return;

        for(let i = 0; i < GameState.module.area.creatures.length; i++){
          const creature = GameState.module.area.creatures[i]
          if(!creature.debugLabel){
            continue;
          }
          creature.debugLabel.container.visible = enabled;
        }

        for(let i = 0; i < GameState.PartyManager.party.length; i++){
          const creature = GameState.PartyManager.party[i]
          if(!creature.debugLabel){
            continue;
          }
          creature.debugLabel.container.visible = enabled;
        }

        // for(let i = 0; i < GameState.module.area.doors.length; i++){
        //   const creature = GameState.module.area.doors[i]
        //   if(!creature.debugLabel){
        //     continue;
        //   }
        //   creature.debugLabel.container.visible = enabled;
        // }

        // for(let i = 0; i < GameState.module.area.placeables.length; i++){
        //   const creature = GameState.module.area.placeables[i]
        //   if(!creature.debugLabel){
        //     continue;
        //   }
        //   creature.debugLabel.container.visible = enabled;
        // }

        // for(let i = 0; i < GameState.module.area.triggers.length; i++){
        //   const creature = GameState.module.area.triggers[i]
        //   if(!creature.debugLabel){
        //     continue;
        //   }
        //   creature.debugLabel.container.visible = enabled;
        // }
      break;
      case EngineDebugType.ROOM_WALKMESH:
      case EngineDebugType.DOOR_WALKMESH:
      case EngineDebugType.PLACEABLE_WALKMESH:
        {
          const areWalkmeshesVisible = GameState.debug[EngineDebugType.ROOM_WALKMESH] || GameState.debug[EngineDebugType.DOOR_WALKMESH] || GameState.debug[EngineDebugType.PLACEABLE_WALKMESH];
          GameState.group.room_walkmeshes.visible = areWalkmeshesVisible;
          for(let i = 0; i < GameState.module.area.rooms.length; i++){
            const room = GameState.module.area.rooms[i];
            if(room.collisionManager.walkmesh){
              room.collisionManager.walkmesh.mesh.visible = GameState.debug[EngineDebugType.ROOM_WALKMESH];
            }
          }
          for(let i = 0; i < GameState.module.area.doors.length; i++){
            const door = GameState.module.area.doors[i];
            if(door.collisionManager.walkmesh){
              door.collisionManager.walkmesh.mesh.visible = GameState.debug[EngineDebugType.DOOR_WALKMESH];
            }
          }
          for(let i = 0; i < GameState.module.area.placeables.length; i++){
            const placeable = GameState.module.area.placeables[i];
            if(placeable.collisionManager.walkmesh){
              placeable.collisionManager.walkmesh.mesh.visible = GameState.debug[EngineDebugType.PLACEABLE_WALKMESH];
            }
          }
        }
      break;
      case EngineDebugType.COLLISION_HELPERS:
        GameState.group.collision_helpers.visible = enabled;
      break;
      case EngineDebugType.LIGHT_HELPERS:
        GameState.group.light_helpers.visible = enabled;
      break;
      case EngineDebugType.SHADOW_LIGHTS:
        GameState.group.shadow_lights.visible = enabled;
      break;
    }
  }

  static addEventListener(event: string, callback: Function){
    if(GameState.eventListeners.hasOwnProperty(event)){
      const callbacks: any[] = GameState.eventListeners[event];
      if(callbacks){
        callbacks.push(callback);
      }
    }
  }

  static processEventListener(event: string, args: any[] = []){
    if(GameState.eventListeners.hasOwnProperty(event)){
      const callbacks = GameState.eventListeners[event];
      if(callbacks && callbacks.length){
        for(let i = 0, len = callbacks.length; i < len; i++){
          const cb = callbacks[i];
          if(typeof cb === 'function')
            cb(...args);
        }
      }
    }
  }

  static setDOMElement(element: HTMLElement){
    GameState.domElement = element;
  }

  /**
   * Initialize the GameState
   */
  static async Init(){
    GameState.Debugger.addEventListener('open', () => {
      console.log('Debugger: Open');
      GameState.debugMode = true;
    }); 
    GameState.Debugger.addEventListener('close', () => {
      console.log('Debugger: Close');
      GameState.debugMode = false;
    });
    GameState.Debugger.addEventListener('message', (msg: IPCMessage) => {
      if(msg.type == IPCMessageType.SetScriptBreakpoint){
        const instanceUUID = msg.getParam(0).getString();
        const address = msg.getParam(1).getInt32();
        const instance = GameState.NWScript.NWScriptInstanceMap.get(instanceUUID);
        if(instance){
          console.log("Setting breakpoint", address, "on instance", instanceUUID);
          instance.setBreakpoint(address);
        }
      }else if(msg.type == IPCMessageType.RemoveScriptBreakpoint){
        const instanceUUID = msg.getParam(0).getString();
        const address = msg.getParam(1).getInt32();
        const instance = GameState.NWScript.NWScriptInstanceMap.get(instanceUUID);
        if(instance){
          console.log("Removing breakpoint", address, "on instance", instanceUUID);
          instance.removeBreakpoint(address);
        }
      }else if(msg.type == IPCMessageType.ContinueScript){
        if(GameState.Debugger.currentScript && GameState.Debugger.currentInstruction){
          const instruction = GameState.Debugger.currentInstruction;
          const seek = instruction.address;
          GameState.Debugger.currentInstruction = undefined;
          GameState.Debugger.state = DebuggerState.Idle;
          GameState.Debugger.currentScript.seekTo(seek);
          GameState.Debugger.currentScript.runScript(true);
        }
      }else if(msg.type == IPCMessageType.StepOverInstruction){
        if(GameState.Debugger.currentScript && GameState.Debugger.currentInstruction){
          const instruction = GameState.Debugger.currentInstruction;
          const seek = instruction.address;
          GameState.Debugger.currentInstruction = undefined;
          GameState.Debugger.state = DebuggerState.IntructionStepOver;
          GameState.Debugger.currentScript.seekTo(seek);
          GameState.Debugger.currentScript.runScript(true);
        }
      }else if(msg.type == IPCMessageType.Debug && msg.subType == IPCMessageTypeDebug.ToggleDebugState){
        const type = msg.getParam(0).getString();
        GameState.ToggleDebugState(type as EngineDebugType);
      }
    });

    GameState.lightManager = new GameState.LightManager();
    GameState.windManager = new GameState.WindManager();
    WindManager.setInstance(GameState.windManager);
    GameState.processEventListener('init');

    GameState.VideoEffectManager.SetVideoEffect(-1);
    GameState.onScreenShot = undefined;

    GameState.time = 0;
    GameState.deltaTime = 0;
    GameState.deltaTimeFixed = 0;

    GameState.canvas = document.createElement( 'canvas' );
    //GameState.canvas = GameState.renderer.domElement;

    GameState.canvas.classList.add('noselect');
    GameState.canvas.setAttribute('tabindex', '1');
    if(GameState.domElement){
      GameState.domElement.appendChild(GameState.canvas);
    }
    
    //transferToOffscreen() causes issues with savegame screenshots
    //GameState.canvas = GameState.canvas.transferControlToOffscreen();

    GameState.canvas.style.setProperty('width', '0');
    GameState.canvas.style.setProperty('height', '0');
    // WebGLRenderer uses whatever context it is handed, so creating this as
    // `webgl` pinned the whole engine to WebGL 1 no matter what the browser
    // supported. WebGL 2 accepts the engine's GLSL ES 1.00 shaders unchanged.
    const requestedContextMode = parseRendererContextMode(
      typeof window !== 'undefined' ? window.location.search : ''
    );
    let context: WebGLRenderingContext | WebGL2RenderingContext | null = null;
    if(requestedContextMode === 'webgl2'){
      context = GameState.canvas.getContext('webgl2');
      if(!context){
        console.warn('[GameState] webgl2 unavailable, falling back to webgl1');
      }
    }
    GameState.rendererContextMode = context ? 'webgl2' : 'webgl1';
    GameState.context = context ?? GameState.canvas.getContext('webgl');
    console.log(`[GameState] renderer context: ${GameState.rendererContextMode}`);

    GameState.rendererUpscaleFactor = 1;
    // Startup-only: this compiles a #define into every shader, so it cannot be
    // toggled later. `?depth=linear` runs the other half of the A/B.
    GameState.rendererDepthMode = parseRendererDepthMode(
      typeof window !== 'undefined' ? window.location.search : ''
    );
    console.log(`[GameState] depth buffer mode: ${GameState.rendererDepthMode}`);
    GameState.renderer = new THREE.WebGLRenderer({
      antialias: false,
      canvas: GameState.canvas,
      context: GameState.context,
      logarithmicDepthBuffer: GameState.rendererDepthMode === 'logarithmic',
      alpha: true,
      preserveDrawingBuffer: false
    }) as THREE.WebGLRenderer;

    
    GameState.renderer.autoClear = false;
    GameState.renderer.setSize( GameState.ResolutionManager.getViewportWidth(), GameState.ResolutionManager.getViewportHeight() );
    GameState.renderer.setClearColor(0x000000);

    let pars = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat };
		GameState.depthTarget = new THREE.WebGLRenderTarget( GameState.ResolutionManager.getViewportWidth(), GameState.ResolutionManager.getViewportHeight(), pars );
    GameState.depthTarget.texture.generateMipmaps = false;
    GameState.depthTarget.stencilBuffer = false;
    GameState.depthTarget.depthBuffer = true;
    GameState.depthTarget.depthTexture = new THREE.DepthTexture(GameState.ResolutionManager.getViewportWidth(), GameState.ResolutionManager.getViewportHeight());
    GameState.depthTarget.depthTexture.type = THREE.UnsignedShortType;

    GameState.clock = new THREE.Clock();
    GameState.stats = Stats();
    GameState.stats.showPanel(undefined);

    GameState.visible = true;

    /**
     * Initialize the scene graph
     */

    GameState.scene = new THREE.Scene();
    GameState.scene_gui = new THREE.Scene();
    GameState.scene_movie = new THREE.Scene();
    GameState.frustumMat4 = new THREE.Matrix4();
    GameState.camera = FollowerCamera.camera;

    GameState.camera_dialog = new THREE.PerspectiveCamera( 55, GameState.ResolutionManager.getViewportWidth() / GameState.ResolutionManager.getViewportHeight(), 0.01, 15000 );
    GameState.camera_dialog.up = new THREE.Vector3( 0, 0, 1 );
    GameState.camera_animated = new THREE.PerspectiveCamera( 55, GameState.ResolutionManager.getViewportWidth() / GameState.ResolutionManager.getViewportHeight(), 0.01, 15000 );
    GameState.camera_animated.up = new THREE.Vector3( 0, 1, 0 );
    GameState.camera.up = new THREE.Vector3( 0, 0, 1 );
    GameState.camera.position.set( .1, 5, 1 );              // offset the camera a bit
    GameState.camera.lookAt(new THREE.Vector3( 0, 0, 0 ));
    
    GameState.camera_gui = new THREE.OrthographicCamera(
      GameState.ResolutionManager.getViewportWidth() / -2,
      GameState.ResolutionManager.getViewportWidth() / 2,
      GameState.ResolutionManager.getViewportHeight() / 2,
      GameState.ResolutionManager.getViewportHeight() / -2,
      1, 1000
    );
    GameState.camera_gui.up = new THREE.Vector3( 0, 0, 1 );
    GameState.camera_gui.position.z = 500;
    GameState.camera_gui.updateProjectionMatrix();
    GameState.scene_gui.add(new THREE.AmbientLight(0x60534A));
    GameState.scene_movie.add(new THREE.AmbientLight(0x60534A));

    FollowerCamera.facing = Math.PI/2;
    FollowerCamera.speed = 0;

    //Static Camera's that are in the .git file of the module
    GameState.staticCameras = [];

    GameState.staticCameraIndex = 0;
    GameState.animatedCameraIndex = 0;
    GameState.currentCamera = GameState.camera;

    GameState.viewportFrustum = new THREE.Frustum();
    GameState.viewportProjectionMatrix = new THREE.Matrix4();

    //0x60534A
    GameState.globalLight = new THREE.AmbientLight(0xFFFFFF);
    GameState.globalLight.position.x = 0;
    GameState.globalLight.position.y = 0;
    GameState.globalLight.position.z = 0;
    GameState.globalLight.intensity  = 1;

    GameState.scene.add(GameState.globalLight);

    GameState.currentLeader = undefined;
    GameState.playerFeetOffset = new THREE.Vector3(0,0,1);

    GameState.collisionList = [];
    GameState.walkmeshList = [];
    GameState.group = {
      creatures: namedGroup('creatures'),
      doors: namedGroup('doors'),
      placeables: namedGroup('placeables'),
      rooms: namedGroup('rooms'),
      grass: namedGroup('grass'),
      sounds: namedGroup('sounds'),
      triggers: namedGroup('triggers'),
      waypoints: namedGroup('waypoints'),
      party: namedGroup('party'),
      lights: namedGroup('lights'),
      light_helpers: namedGroup('light_helpers'),
      shadow_lights: namedGroup('shadow_lights'),
      path_helpers: namedGroup('path_helpers'),
      emitters: namedGroup('emitters'),
      effects: namedGroup('effects'),
      stunt: namedGroup('stunt'),
      weather_effects: namedGroup('weather_effects'),
      room_walkmeshes: namedGroup('room_walkmeshes'),
      spell_instances: namedGroup('spell_instances'),
      debug: namedGroup('debug'),
      collision_helpers: namedGroup('collision_helpers'),
    };

    GameState.scene.add(GameState.group.rooms);
    GameState.scene.add(GameState.group.grass);
    GameState.scene.add(GameState.group.placeables);
    GameState.scene.add(GameState.group.doors);
    GameState.scene.add(GameState.group.creatures);
    // GameState.scene.add(GameState.group.waypoints);
    // GameState.scene.add(GameState.group.sounds);
    GameState.scene.add(GameState.group.triggers);
    // GameState.scene.add(GameState.group.stunt);
    // GameState.scene.add(GameState.group.weather_effects);

    GameState.scene.add(GameState.group.lights);
    // GameState.scene.add(GameState.group.emitters);
    GameState.scene.add(GameState.group.effects);

    GameState.scene.add(GameState.group.party);
    GameState.scene.add(GameState.group.spell_instances);
    GameState.scene.add(GameState.group.debug);
    GameState.group.debug.add(GameState.group.room_walkmeshes);
    GameState.group.debug.add(GameState.group.light_helpers);
    GameState.group.debug.add(GameState.group.shadow_lights);
    GameState.group.debug.add(GameState.group.path_helpers);
    GameState.group.debug.add(GameState.group.collision_helpers);
    GameState.group.room_walkmeshes.visible = this.debug[EngineDebugType.ROOM_WALKMESH] || this.debug[EngineDebugType.DOOR_WALKMESH] || this.debug[EngineDebugType.PLACEABLE_WALKMESH];
    GameState.group.light_helpers.visible = this.debug[EngineDebugType.LIGHT_HELPERS];
    GameState.group.shadow_lights.visible = this.debug[EngineDebugType.SHADOW_LIGHTS];
    GameState.group.path_helpers.visible = this.debug[EngineDebugType.PATH_FINDING];
    GameState.group.collision_helpers.visible = this.debug[EngineDebugType.COLLISION_HELPERS];

    GameState.interactableObjects = [
      GameState.group.placeables, 
      GameState.group.doors, 
      GameState.group.creatures, 
      GameState.group.party,
      //GameState.group.rooms
      GameState.group.room_walkmeshes
    ];

    GameState.scene_cursor_holder = new THREE.Group();
    GameState.scene_gui.add(GameState.scene_cursor_holder);

    //BEGIN: PostProcessing
    GameState.composer = new EffectComposer(GameState.renderer);
    GameState.renderPass = new RenderPass(GameState.scene, GameState.currentCamera);
    GameState.renderPassAA = new SSAARenderPass (GameState.scene, GameState.currentCamera);
    GameState.odysseyShaderPass = new OdysseyShaderPass();
    GameState.copyPass = new ShaderPass(CopyShader);
    GameState.renderPassGUI = new RenderPass(GameState.scene_gui, GameState.camera_gui);
    
    GameState.bloomPass = new BloomPass(0.5);
    GameState.bokehPass = new BokehPass(GameState.scene, GameState.currentCamera, {
      focus: 1.0,
      aperture:	0.0001,
      maxblur:	1.0,
      // width: ResolutionManager.getViewportWidth(),
      // height: ResolutionManager.getViewportHeight()
    });

    GameState.renderPassAA.sampleLevel = 1;

    GameState.renderPass.renderToScreen = false;
    GameState.copyPass.renderToScreen = false;
    GameState.renderPassGUI.renderToScreen = false;

    GameState.renderPass.clear = true;
    GameState.bloomPass.clear = false;
    GameState.odysseyShaderPass.clear = false;
    GameState.renderPassAA.clear = false;
    GameState.copyPass.clear = false;
    GameState.renderPassGUI.clear = false;
    GameState.renderPassGUI.clearDepth = true;

    GameState.bokehPass.needsSwap = true;
    GameState.bokehPass.enabled = false;

    GameState.composer.addPass(GameState.renderPass);
    // GameState.composer.addPass(GameState.bokehPass);
    // GameState.composer.addPass(GameState.renderPassAA);
    // GameState.composer.addPass(GameState.odysseyShaderPass);
    // GameState.composer.addPass(GameState.bloomPass);

    GameState.composer.addPass(GameState.renderPassGUI);
    GameState.composer.addPass(GameState.copyPass);

    GameState.renderPass.clearDepth = true;
    GameState.renderPassGUI.clearDepth = true;
    GameState.renderPass.clear = true;
    GameState.renderPassGUI.clear = false;
    GameState.renderPass.needsSwap = false;
    GameState.renderPassGUI.needsSwap = false;

    // Swoop and turret VR input. The controller takes the live minigame through
    // this provider rather than importing engine state, which keeps the VR
    // layer independent of GameState (and its tests free of the engine).
    VRSpike.miniGameInput = VRMiniGameInputController;
    // The ride's moments, in the hands. Both controllers, because the bike is
    // what is hit, not a hand; strength scales a wall tap against a slam.
    addSwoopRideListener((event) => {
      if(!VRSpike.isPresenting){ return; }
      const pattern = SWOOP_RIDE_HAPTICS[event.type];
      if(!pattern){ return; }
      const amplitude = Math.max(0.1, Math.min(1, pattern.amplitude * Math.max(0.3, event.strength)));
      VRSpike.pulseHand('left', { durationMs: pattern.durationMs, amplitude });
      VRSpike.pulseHand('right', { durationMs: pattern.durationMs, amplitude });
    });
    VRMiniGameInputController.pinHand = (hand, pose) => VRSpike.setPinnedHandPose(hand, pose);
    VRMiniGameInputController.setProvider(() => {
      if (GameState.Mode !== EngineMode.MINIGAME) return null;
      const miniGame: any = GameState.module?.area?.miniGame;
      const player: any = miniGame?.player;
      if (!miniGame || !player) return null;
      // Visible grips for the swoop, sitting on the bike's own handlebars.
      // Attached once: getObjectByName walks the whole bike, and this provider
      // runs every frame.
      if (miniGame.type === 1 && VRSpike.isPresenting) {
        if (vrSwoopGripsAttachedTo !== player.container) {
          attachSwoopGrips(player.container);
          vrSwoopGripsAttachedTo = player.container;
        }
      } else if (miniGame.type !== 1 && vrSwoopGripsAttachedTo) {
        detachSwoopGrips(vrSwoopGripsAttachedTo);
        vrSwoopGripsAttachedTo = null;
      }
      return {
        type: miniGame.type,
        // The flag has dropped once the race script grants lateral acceleration
        // (211TEL's heartbeat: SWMG_SetLateralAccelerationPerSecond(300) on Go).
        get raceStarted(){ return (player.accel_lateral_secs ?? 0) > 0; },
        setSteer: (steer: number) => { player.setSteerInput?.(steer); },
        get seatPosition(){ return GameState.getMiniGameSeat()?.position ?? null; },
        get seatRight(){ return GameState.getMiniGameSeatRight(); },
        get gripPoses(){ return readSwoopGripPoses(player.container); },
        // TSL's swoop keeps its jump script in the OnBrake slot; onBrake()
        // falls back to the engine's own jump when a module ships none.
        jump: () => (player.onBrake ? player.onBrake() : player.jump?.()),
        accelerate: () => {
          player.requestAcceleration?.();
          player.onAccelerate?.();
        },
        fire: () => player.fire?.(),
        get pitch(){ return player.rotation?.x ?? 0; },
        get yaw(){ return player.rotation?.z ?? 0; },
        rotateBy: (pitchDelta: number, yawDelta: number) => {
          player.rotate?.('x', pitchDelta);
          player.rotate?.('z', yawDelta);
        },
      };
    });

    /**
     * Phase 0.1 stereo perf spike. Async and deliberately not awaited — it only
     * promotes the GL context and adds a button, and nothing downstream depends
     * on it. If there is no WebXR runtime it logs and does nothing.
     */
    // The desktop window is unfocused for the whole headset session.
    AudioEngine.keepPlayingWhenUnfocused = () => VRSpike.isPresenting;
    VRSpike.install(GameState.renderer, GameState.scene, {

      update: (timestamp, source) => GameState.Update(timestamp, source),
      getPlayerPosition: () => {
        const miniGameSeat = GameState.getMiniGameSeat();
        if (miniGameSeat) return miniGameSeat.position;
        return resolveVRRigStandingPoint(GameState.getCurrentPlayer()?.position ?? null);
      },
      getRecentWallNormals: () => {
        if (GameState.getMiniGameSeat()) return [];
        const cm: any = (GameState.getCurrentPlayer() as any)?.collisionManager;
        const now = performance.now();
        return Array.isArray(cm?.recentWallNormals)
          ? cm.recentWallNormals.filter((n: any) => now - n.at < 600 && Number.isFinite(n.x) && Number.isFinite(n.y))
          : [];
      },
      getFacing: () => {
        const miniGameSeat = GameState.getMiniGameSeat();
        if (miniGameSeat) return miniGameSeat.facing;
        return FollowerCamera.facing;
      },
      getPlayerFacing: () => GameState.getCurrentPlayer()?.rotation.z ?? null,
      getHeldVisuals: () => {
        const player = GameState.getCurrentPlayer();
        if (!player) return describeVRHeldItemVisuals(undefined);
        const armed = vrArmedGrenadeState.getSnapshot().armed;
        const grenade = armed ? findVRArmedGrenade(player, armed.sourceKey)?.item ?? null : null;
        const armedConsumable = vrArmedConsumableState.getSnapshot().armed;
        const consumable = armedConsumable
          ? findVRArmedConsumable(player, armedConsumable.sourceKey)?.item ?? null
          : null;
        // Arming never mutates equipment: the controller host renders a
        // presentation-only off-hand copy until the engine accepts the throw
        // (or, for a medpac, the hold to the neck).
        const equipmentVisuals = describeVRHeldItemVisuals({
          // The armed item's own model in the hand (round 15: "a visible
          // medpac in your hand when armed"); a grenade or item still loading
          // shows nothing rather than the equipped off-hand item.
          LEFTHAND: (grenade || consumable)
            ? resolveVRArmedItemVisual(grenade ?? consumable)
            : player.equipment?.LEFTHAND ?? null,
          RIGHTHAND: player.equipment?.RIGHTHAND ?? null,
        });
        // Equipment slots are authored as left/right. Controller dominance is
        // a presentation/input preference, so mirror the descriptors here
        // without mutating the actor's inventory or engine equipment slots.
        return VRSpike.getDominantHand() === 'right'
          ? equipmentVisuals
          : { left: equipmentVisuals.right, right: equipmentVisuals.left };
      },
      loadHandModel: loadGenericHandModel,
      getAvatarPresentation: () => {
        const player = GameState.getCurrentPlayer();
        // A droid keeps its controller-stabilized weapon model but never gets
        // humanoid hands. racialtypes.2da row 5 is Droid; row 6 is Human. This
        // used to test `!== 6`, which gave every droid hands and took them from
        // every human — reported from the headset as exactly that inversion.
        return { humanoidHands: Boolean(player && player.getRace() !== VR_RACE_DROID) };
      },
      resetCombatInteraction: () => {
        resetVREmbodiedCombatState();
      },
      applyLocomotion: (locomotion) => {
        if (GameState.State !== EngineState.RUNNING || GameState.Mode !== EngineMode.INGAME) return;
        const player = GameState.getCurrentPlayer();
        if (!player) return;
        if (vrCreatureLocomotionAdapter.apply(player, locomotion)) {
          GameState.scene_cursor_holder.visible = false;
          FollowerCamera.clearFocusObject();
        }
      },
      // No containment in a minigame: the rider is carried by a vehicle on a
      // track, not walking a room. Feeding the soft-block a room walkmesh here
      // ran away - the bike sits far outside any room, so every frame pushed
      // the rig further to "correct" it, which moved the head further out
      // still. Measured in-headset on 211TEL: the rig climbed from y 0.47 to
      // y 1817 in seconds while the bike sat at y -183, which is the flashing,
      // bike-less view the rider actually saw.
      getCurrentRoomWalkmesh: () => {
        if(GameState.Mode == EngineMode.MINIGAME){ return null; }
        return GameState.getCurrentPlayer()?.room?.collisionManager?.walkmesh ?? null;
      },
      getSoftBlockFloor: (floorZ) => {
        // Same reason as above: a rider on a track has no room floor.
        if(GameState.Mode == EngineMode.MINIGAME){ return null; }
        const room = GameState.getCurrentPlayer()?.room;
        if (!room) return null;
        return createFloorWalkableQuery(
          [room, ...(room.linkedRoomsArray ?? [])].map((candidate) => candidate?.collisionManager?.walkmesh ?? null),
          floorZ,
        );
      },
      getComfortSettings: () => { loadVRComfortSettingsOnce(); return { ...vrComfortSettings }; },
      getCombatCueAudioOutput: () => {
        const engine = AudioEngine.GetAudioEngine();
        const destination = AudioEngine.guiChannel?.getGainNode();
        // Retail WAVs from the game's archives (gui_error, cb_ht_*, ...).
        return engine?.audioCtx && destination
          ? { context: engine.audioCtx, destination, loadSound: (resref: string) => AudioLoader.LoadSound(resref) }
          : null;
      },
      resolveCombatCueSounds: (attackerId, targetId, cue, stroke) => resolveVRCombatCueSounds(attackerId, targetId, cue, stroke),
      resolveCombatBark: (creatureId, kind) => resolveVRCombatBark(creatureId, kind),
      getCombatCuePreloadSounds: () => resolveVRCombatPreloadSounds(),
      getPlayerDisabledState: () => resolveVRPlayerDisabledState(),
      getPlayerVitals: () => {
        const actor = GameState.getCurrentPlayer() as ModuleCreature | undefined;
        if (!actor || typeof actor.getHP !== 'function' || typeof actor.getMaxHP !== 'function') return null;
        return {
          hitPoints: actor.getHP(),
          maxHitPoints: actor.getMaxHP(),
          forcePoints: typeof actor.getFP === 'function' ? actor.getFP() : 0,
          maxForcePoints: typeof actor.getMaxFP === 'function' ? actor.getMaxFP() : 0,
        };
      },
      setComfortSettings: (patch) => { Object.assign(vrComfortSettings, patch); saveVRComfortSettings(); },
      // Walk/run already exists on the creature: `getMovementSpeed()` picks
      // between the walkrate and runrate columns of creaturespeed.2da based on
      // `isWalking()`. VR simply had no route to the flag.
      getControlledActor: () => GameState.getCurrentPlayer(),
      // A minigame rider is not the party leader: the swoop's own rider says
      // where the eyes go, and the generic resolver reads the bike's meshes
      // against a local origin and gets nonsense.
      getEyeHeight: () => GameState.Mode == EngineMode.MINIGAME
        ? GameState.MINIGAME_RIDER_EYE_HEIGHT
        : resolveVRCharacterEyeHeight(GameState.getCurrentPlayer()),
      useLiveHeadHeight: () => GameState.Mode == EngineMode.MINIGAME,
      toggleWalkRun: () => {
        const player = GameState.getCurrentPlayer();
        if (!player) return;
        player.walk = !player.walk;
      },
      // ROADMAP 3.18. A pause the *player* asked for. The comfort panel pauses
      // the game behind itself too; that is its own and is not reported here,
      // so it neither shows the pause plate nor gets resumed by the wheel.
      isPaused: () => GameState.State === EngineState.PAUSED && !vrComfortSettingsPausedByVR,
      // Any pause, the VR Menu's included: a B press that begins in it is
      // never a combat cancel (round 17, R4).
      isEnginePaused: () => GameState.State === EngineState.PAUSED,
      setPaused: (paused: boolean) => {
        if (vrComfortSettingsPausedByVR) return;
        GameState.State = paused ? EngineState.PAUSED : EngineState.RUNNING;
      },
      togglePause: () => {
        GameState.State = GameState.State === EngineState.PAUSED
          ? EngineState.RUNNING
          : EngineState.PAUSED;
      },
      // Cycles the party leader to the next member.
      //
      // PartyCommand had no defined intent, and the obvious reading — open the
      // party wheel — is not the cheap option it looks like: the wheel is a
      // state machine keyed on the Menu button being held, with no imperative
      // "open this submenu" entry point, so forcing one open would mean surgery
      // on the ownership boundaries 3.8 deliberately separated. Cycling the
      // leader gives the button a real job: it possesses the next member by the
      // same SwitchPlayerCharacter route the wheel's Party submenu uses, in a
      // fixed order that always comes back round to the Exile
      // (nextPartyCycleEntry), and the wheel remains the way to pick a
      // *specific* member.
      cyclePartyLeader: () => {
        const leader = GameState.PartyManager.party[0];
        const controlledNpcId = !leader || leader.isPlayer || !Number.isInteger(leader.npcId) ? -1 : leader.npcId;
        const next = nextPartyCycleEntry(buildVRPartySwitchEntries(), controlledNpcId);
        if (!next) return false;
        GameState.PartyManager.SwitchPlayerCharacter(next.npcId, true);
        return true;
      },
      teleportPlayer: (point) => {
        const player = GameState.getCurrentPlayer();
        if (!player) return;
        const location = new EngineLocation(point.x, point.y, point.z, 0, 0, 0, GameState.module?.area);
        location.setFacing(player.rotation.z);
        player.JumpToLocation(location);
      },
      getInteractionContext: () => ({
        actor: GameState.getCurrentPlayer() ?? null,
        // The engine has already removed the player, unusable/open objects,
        // out-of-range objects, and targets without line of sight.
        targets: GameState.ModuleObjectManager.playerSelectableObjects,
      }),
      /**
       * Aim candidates for combat only — see the hook's own note for why this
       * cannot share `getInteractionContext`'s already-range-filtered set.
       *
       * Drawn from the same `playerSelectableObjects` the engine has already
       * filtered for line of sight and usability, then narrowed to live
       * hostile creatures by `isVRCombatTarget`. The range cap is applied by
       * the resolver using `resolveVRCombatRange`, so it agrees exactly with
       * `isWithinVRCombatRange` in `getCombatContext` — the wheel must never
       * offer an attack the combat bridge then refuses to nominate.
       */
      getControlledActorId: () => {
        const actor: any = GameState.getCurrentPlayer();
        return actor && Number.isFinite(actor.id) ? actor.id : null;
      },
      isDeadCreature: (id: number) => {
        const object: any = resolveVRAimedObject(id);
        return !!object && typeof object.isDead === 'function' && object.isDead() === true;
      },
      getCombatAimCandidates: () => {
        const actor = GameState.getCurrentPlayer();
        if (!actor?.position) return null;
        const candidates: VRCombatAimCandidate[] = [];
        for (const object of GameState.ModuleObjectManager.playerSelectableObjects) {
          if (!isVRCombatTarget(actor, object) || !object.position) continue;
          candidates.push({ id: object.id, position: object.position });
        }
        return {
          actorPosition: actor.position,
          maxRangeMetres: vrCombatLockRangeMetres(),
          candidates,
        };
      },
      /**
       * Combat state for the VR-authored visuals — see the hook's own note.
       *
       * Covers area creatures AND party members, deduplicated by id: a party
       * member firing is exactly the case the player is most likely to be
       * looking at, and the two collections overlap.
       */
      getCombatVisualSnapshots: () => {
        const area = GameState.module?.area;
        if (!area) return null;
        const snapshots: VRCombatActorSnapshot[] = [];
        const seen = new Set<number>();
        const add = (creature: ModuleCreature | undefined) => {
          if (!creature?.position || !Number.isInteger(creature.id)) return;
          if (seen.has(creature.id)) return;
          seen.add(creature.id);
          const action = creature.combatRound?.action;
          const target = action?.target;
          const targetIsCreature = !target ||
            (target.objectType & ModuleObjectType.ModuleCreature) !== 0;
          snapshots.push({
            id: creature.id,
            position: creature.position,
            isDroid: typeof creature.getRace === 'function' && creature.getRace() === VR_RACE_DROID,
            deathStarted: creature.deathStarted === true,
            isDead: typeof creature.isDead === 'function' && creature.isDead(),
            attackResultsCalculated: action?.resultsCalculated === true,
            attackIsRanged: typeof creature.isRangedEquipped === 'function' &&
              creature.isRangedEquipped(),
            attackResult: typeof action?.attackResult === 'number' ? action.attackResult : 0,
            attackTargetPosition: target?.position ?? null,
            attackTargetIsCreature: targetIsCreature,
            attackTargetAimPoint: targetIsCreature ? null : resolveVRStructureAimPoint(target),
            attackTargetId: target && Number.isInteger(target.id) ? target.id : null,
            hitPoints: typeof creature.getHP === 'function' ? creature.getHP() : null,
          maxHitPoints: typeof creature.getMaxHP === 'function' ? creature.getMaxHP() : null,
            heldAttacksResolved: Number(creature.combatRound?.heldAttacksResolved) || 0,
            lastHeldAttackResult: creature.combatRound?.lastHeldAttackResult,
          });
        };
        for (const creature of (area.creatures ?? [])) add(creature as ModuleCreature);
        for (const member of GameState.PartyManager.party) add(member);
        const localActor = GameState.getCurrentPlayer();
        return {
          localActorId: localActor && Number.isInteger(localActor.id) ? localActor.id : null,
          snapshots,
          playLocalShotSound: () => {
            if (localActor) playVRBlasterShotSound(localActor);
          },
          playShotSound: (actorId: number) => {
            const shooter = GameState.ModuleObjectManager.GetObjectById?.(actorId) as ModuleCreature | undefined;
            if (!shooter?.position) return;
            shooter.audioEmitter?.setPosition(shooter.position.x, shooter.position.y, shooter.position.z + 1.0);
            playVRBlasterShotSound(shooter);
          },
        };
      },
      getWorldActionPromptContext: () => {
        const actor = GameState.getCurrentPlayer() ?? null;
        return {
          actor,
          candidates: buildVRWorldPromptCandidates(
            actor,
            GameState.ModuleObjectManager.playerSelectableObjects,
          ),
          createPrompt: (candidate: VRWorldPromptCandidate) => buildVRWorldActionPrompt(candidate),
        };
      },
      getCombatContext: (aimedTargetId) => {
        const actor = GameState.getCurrentPlayer();
        if (!actor) {
          // A target and a queued action belong to a character in one module;
          // neither is valid after a load, leader change, or transition.
          resetVREmbodiedCombatState();
          return null;
        }
        observeVREmbodiedCombatActor(actor);
        vrCombatLockTargetId = aimedTargetId;
        const candidate = resolveVRAimedObject(aimedTargetId);
        // Nominated at lock range; weapon reach is enforced at dispatch. See
        // vrCombatLockRangeMetres.
        const target = isVRCombatTarget(actor, candidate) && isWithinVRCombatLockRange(actor, candidate)
          ? candidate
          : null;
        // Player-paced rounds (round 18): the player's next round is ready
        // 3 s after the last one began, whatever the aim. The hilt shows it as
        // a quiet glow, not a clock to wait on: a stroke begins it.
        const playerRound = resolveVRPlayerRoundState(actor);
        const roundReady = playerRound.untilReadyMs <= 0 && !playerRound.openingPending;
        const queuedIntent = vrCombatIntentQueue.getHead();
        // The fight decides, not the player's own flag (Part F, decision 1):
        // the flag drops between rounds in a group fight, and the ring read
        // "ready" mid-round on 9 of 23 Telos pulls (Tempo run 2, finding 2).
        const fightOn = isVRFightOnFor(actor);
        return {
          actorId: String(actor.id),
          nominatedTargetId: target ? String(target.id) : null,
          weaponMode: resolveVRCombatWeaponMode(actor),
          inCombat: fightOn,
          // The hilt readout is every requested action, next first, never a
          // hidden attack mode. An empty queue deliberately returns to basic
          // attacks. Round 6 asked to know that more than one was queued; round
          // 11 (K6) asked to see them all, stacked, rather than "+2".
          // Items already scheduled into the round (a medpac at the neck, a
          // thrown grenade) come after the chosen actions; a queued medpac
          // was invisible until it went off (critic run 4).
          stanceReadout: formatVRCombatQueueReadout([
            ...vrCombatIntentQueue.getSnapshot().entries.map((entry) => entry.label),
            ...resolveVRScheduledItemLabels(actor),
          ]),
          roundOpen: fightOn && roundReady,
          // 1 is ready (the glow, in a fight), 0 is a round running. Out of a
          // fight there is no round and nothing to show.
          tempoReadiness: !fightOn || roundReady ? 1 : 0,
          allowDominantTrigger: queuedIntent?.requiredInput === 'dominant-trigger',
          onCombatSwing: (event) => {
            if (event.actorId !== String(actor.id)) return;
            dispatchVREmbodiedCombatInput(actor, event.nominatedTargetId, event.input);
          },
          // T-B: the attacks the round still holds, as pips on the hilt.
          roundAttackPips: resolveVRRoundAttackPips(actor),
          // Two melee weapons: the off hand's own stroke spends the off-hand attack.
          offhandStrokeAvailable: resolveVRCombatWeaponMode(actor) === 'melee-dual-wield',
          onOffhandStroke: (event) => {
            if (event.actorId !== String(actor.id)) return;
            dispatchVROffhandCombatInput(actor, event.nominatedTargetId, 'stroke');
          },
          onOffhandShot: () => dispatchVROffhandCombatInput(actor, target ? String(target.id) : null, 'trigger'),
          onDirectionalForceGesture: (gesture) =>
            dispatchVRDirectionalForceGesture(actor, target ? String(target.id) : null, gesture.kind),
          onForceCastGesture: () =>
            dispatchVRForceCastGesture(actor, target ? String(target.id) : null),
          onRefusedInput: (refused) => {
            if (isVRRefusedInputMeaningful(refused, vrCombatIntentQueue.getHead(), {
              fightOn,
              blaster: resolveVRCombatWeaponMode(actor) === 'blaster',
            })) {
              tickVRRefusal(refused === 'idle-trigger' ? 'pull-did-nothing' : 'force-gesture-off-target');
            }
          },
          armedConsumable: vrArmedConsumableState.getSnapshot().armed !== undefined,
          onConsumableUseGesture: () => commitVRArmedConsumable(actor),
          onGrenadeTrigger: () => {
            commitVRArmedGrenade(actor, target ? String(target.id) : null);
          },
          nominatedTargetVolume: resolveVRCombatTargetVolume(target),
          // Chest height on the target, matching the engine-derived bolts.
          nominatedTargetAimPoint: target?.position
            ? target.position.clone().setZ(target.position.z + 1.0)
            : null,
          playShotSound: () => playVRBlasterShotSound(actor),
          // A grenade armed from the wheel keeps the off-hand trigger for the
          // throw; otherwise an off-hand blaster shoots like the main one.
          offhandShotAvailable: actor.equipment?.LEFTHAND?.baseItem?.rangedWeapon === true &&
            !vrArmedGrenadeState.getSnapshot().armed,
          playOffhandShotSound: () => playVRBlasterShotSound(actor, 'LEFTHAND'),
          onCombatTargetInvalidated: () => {
            vrArmedGrenadeState.cancel();
          },
          cancel: () => {
            vrCombatIntentQueue.clear();
            vrCombatSwingBuffer.clear();
            vrArmedGrenadeState.cancel();
            vrArmedConsumableState.cancel();
            // Cancel now stops creature combat too, not only an endless round
            // against a door. It used to return here for any creature target,
            // so pressing cancel mid-fight cleared the upcoming actions and left
            // the fight and its music running — reported from the headset as
            // "combat and combat music persist". The engine still re-enters
            // combat on its own if a hostile keeps attacking or can see the
            // player (perception re-arms excitedDuration), which is retail.
            //
            // NO `vrCombatIssuedTargetId === null` GUARD. That guard meant
            // "only cancel combat VR itself started", but combat is far more
            // often entered through the world prompt's authored Bash route,
            // which goes via onTargetMenuAction and never sets that id. The
            // guard therefore made cancel a silent no-op in exactly the case
            // that needs it: an endless round against a door, which cannot die
            // and so never resolves on its own. Traced in-headset — the queue
            // was byte-identical before and after the call.
            //
            // Clearing the combat round alone leaves the queued ActionCombat /
            // ActionPhysicalAttacks running, which re-arms excitedDuration every
            // frame and keeps battle music going with no way out. Drop the
            // queued actions and reset the engine's own combat state too.
            actor.combatRound.clearActions();
            actor.clearAllActions(true);
            actor.cancelCombat();
            vrCombatIssuedTargetId = null;
          },
        };
      },
      noteWorldPromptSelection: (promptId, label) => {
        vrArmedBashTargetId = resolveArmedBashTargetId(promptId, label);
      },
      getWeaponBashContext: (aimedTargetId) => {
        // Bash must be chosen from the prompt first; a swing never picks it.
        if (aimedTargetId === null || aimedTargetId !== vrArmedBashTargetId) return null;
        const actor = GameState.getCurrentPlayer();
        if (!actor) return null;
        const resolved = resolveVRWeaponBashTarget(actor, aimedTargetId);
        if (!resolved) return null;
        return {
          actorId: String(actor.id),
          targetId: String(resolved.target.id),
          weaponMode: resolveVRCombatWeaponMode(actor),
          volume: resolved.volume,
          bash: () => dispatchVRWeaponBash(actor, resolved.target.id),
        };
      },
      serviceCombatSwingBuffer: () => {
        const actor = GameState.getCurrentPlayer();
        if (!actor) {
          vrCombatSwingBuffer.clear();
          return null;
        }
        return serviceVRCombatSwingBuffer(actor);
      },
      getForceContext: (aimedTargetId) => {
        const actor = GameState.getCurrentPlayer();
        if (!actor) return null;
        observeVREmbodiedCombatActor(actor);
        return {
          onForceGesture: (gesture) => {
            dispatchVRDirectionalForceGesture(actor,
              aimedTargetId === null ? null : String(aimedTargetId), gesture.kind);
          },
        };
      },
      /**
       * Phase G1 — drive the engine's own target selection from VR aim.
       *
       * `InGameOverlay._canShowTargetUI()` gates the whole target UI (name
       * plate, health bar, the three action columns and their cyclers) on
       * `CursorManager.reticle2.visible` and `CursorManager.selectedObject` —
       * flatscreen mouse state that never updates during a WebXR session. Feed
       * it from VR and the engine builds its own action menu, correctly, with
       * no re-derivation on our side.
       *
       * `CursorManager.update()` maintains `reticle2.visible` and the reticle
       * texture from `CursorManager.selected`, so setting the selection is
       * enough; visibility follows.
       */
      setVRSelectedObject: (targetId) => {
        try {
          const cursor = GameState.CursorManager;
          const actor = GameState.getCurrentPlayer();
          if (!actor) return false;
          const target = resolveVRAimedObject(targetId);
          if (!target) {
            if (vrCursorSelectedTargetId !== null) {
              cursor.selected = undefined;
              cursor.selectedObject = undefined;
              vrCursorSelectedTargetId = null;
            }
            return false;
          }

          // Compare against the ENGINE's state, never a cached id.
          // `CursorManager.updateCursor()` clears selected/selectedObject on
          // its own whenever the object is briefly out of maxSelectableDistance
          // or reports !isUseable(). An id cache treats that as "still set" and
          // never re-establishes it, so the overlay's target UI — gated on
          // reticle2.visible, which follows CursorManager.selected — silently
          // stopped appearing for every object.
          if (cursor.selectedObject === target && cursor.selected) {
            vrCursorSelectedTargetId = target.id;
            return true;
          }

          // Assign directly rather than via setReticleSelectedObject: that
          // helper also calls getCurrentPlayer().lookAt(target), which would
          // now fire on every re-assert and fight VR locomotion for the body's
          // facing. updateCursor() already positions the reticle and picks its
          // texture from selectedObject each frame.
          const reticleNode = (target as any).getReticleNode?.();
          if (!reticleNode) {
            vrCursorSelectedTargetId = null;
            return false;
          }
          cursor.selected = reticleNode;
          cursor.selectedObject = target;
          vrCursorSelectedTargetId = target.id;
          return true;
        } catch (error) {
          if (!vrCursorSelectionErrorReported) {
            vrCursorSelectionErrorReported = true;
            console.error('[VR] engine target selection rejected', error);
          }
          return false;
        }
      },
      describeCombatQueue: () => {
        try {
          const actor = GameState.getCurrentPlayer() as any;
          if (!actor) return 'no-actor';
          const queue = actor.actionQueue ?? [];
          const types = Array.from(queue).map((a: any) => a?.constructor?.name ?? a?.type ?? '?');
          return `actions=${queue.length}[${types.join(',')}]` +
            ` combatAction=${actor.combatRound?.action?.constructor?.name ?? 'none'}` +
            ` scheduled=${actor.combatRound?.scheduledActionList?.length ?? -1}` +
            ` combatQueue=${actor.combatData?.combatQueue?.length ?? -1}` +
            ` combatState=${JSON.stringify(actor.combatData?.combatState)}` +
            ` target=${JSON.stringify(actor.combatData?.lastAttackTarget?.getName?.() ?? null)}`;
        } catch (error) {
          return `unreadable:${(error as Error)?.message ?? 'unknown'}`;
        }
      },
      createActionWheel: (aimedTargetId) => {
        const actor = GameState.getCurrentPlayer();
        if (!actor) return null;
        const candidate = resolveVRAimedObject(aimedTargetId);
        const target = isVRCombatTarget(actor, candidate) ? candidate : null;
        if (!target) reportVRWheelTargetMissOnce(actor, aimedTargetId, candidate);
        try {
          GameState.ActionMenuManager.SetPC(actor);
          if (target) GameState.ActionMenuManager.SetTarget(target);
          GameState.ActionMenuManager.UpdateMenuActions();
        } catch {
          return null;
        }
        const panels = GameState.ActionMenuManager.ActionPanels;
        return buildVRActionWheel({
          id: `action-wheel:${actor.id}:${target?.id ?? 'self'}`,
          targetActions: target
            ? snapshotVRActionMenuPanelEntries({
              actor,
              target,
              kind: 'target',
              panels: panels.targetPanels as readonly VRActionMenuPanel[],
            }, vrActionMenuBridgeDependencies)
            : [],
          selfActions: snapshotVRActionMenuPanelEntries({
            actor,
            target: null,
            kind: 'self',
            panels: panels.selfPanels as readonly VRActionMenuPanel[],
          }, vrActionMenuBridgeDependencies),
          grenadeActions: describeVRGrenadeInventory(actor).map((entry) => ({
            id: entry.descriptor.sourceKey,
            label: withVRStackCount(entry.descriptor.label, entry.item),
            icon: entry.descriptor.icon,
            revalidate: () => findVRArmedGrenade(actor, entry.descriptor.sourceKey) !== undefined,
            activate: () => {
              // This does not create an engine action or consume inventory. It
              // only puts a presentation copy in the off hand for a later,
              // aimed off-hand-trigger commit.
              if (findVRArmedGrenade(actor, entry.descriptor.sourceKey)) {
                // One off hand: arming a grenade puts the medpac away.
                vrArmedConsumableState.cancel();
                vrArmedGrenadeState.arm(entry.descriptor);
              }
            },
          })),
          consumableActions: describeVRConsumableInventory(actor).map((entry) => ({
            id: entry.descriptor.sourceKey,
            label: withVRStackCount(entry.descriptor.label, entry.item),
            icon: entry.descriptor.icon,
            revalidate: () => findVRArmedConsumable(actor, entry.descriptor.sourceKey) !== undefined,
            activate: () => {
              // Presentation only, like a grenade: the item is spent when the
              // hand holding it reaches the neck (commitVRArmedConsumable).
              if (findVRArmedConsumable(actor, entry.descriptor.sourceKey)) {
                vrArmedGrenadeState.cancel();
                vrArmedConsumableState.arm(entry.descriptor);
              }
            },
          })),
          targetIsHostileCreature: target !== null,
          targetIsDroid: !!target && typeof (target as any).getRace === 'function' && (target as any).getRace() === VR_RACE_DROID,
          recentForcePowerSpellIds: vrRecentForcePowers.list(),
          partyMembers: snapshotVRPartyMembers(),
          partyAttackOrder: target ? buildVRPartyAttackOrder(actor, target) : null,
          openComfortSettings: () => {
            vrComfortSettingsPanelOpen = true;
            if (GameState.State === EngineState.RUNNING) {
              GameState.State = EngineState.PAUSED;
              vrComfortSettingsPausedGame = true;
            }
          },
          /**
           * ROADMAP 4.8 — one wedge for all eight in-game screens.
           *
           * `MenuCharacter` is the Character tab, and `MenuManager` sets
           * `childMenu = MenuTop` on every one of the eight screens. `show()`
           * shows the child and `getActiveControls()` includes its controls, so
           * opening Character brings up the live tab bar and the player reaches
           * Equipment, Inventory, Abilities, Journal, Messages, Map and Options
           * from there rather than reopening the wheel.
           *
           * This also supersedes the dedicated Level-Up wedge: `MenuCharacter`
           * is where Auto Level-Up lives, so it is one hop away rather than a
           * seventh top-level item that would force the wheel to paginate.
           */
          openMenu: () => GameState.MenuManager.MenuCharacter.open(),
          // The cue follows the save itself: "saved" when it is written, the
          // refusal if writing fails (critic run 5: it played on starting).
          quickSave: () => {
            const started = AutoSaveManager.quickSave((written) => {
              if (written) { try { VRSpike.playSavedCue(); } catch { /* sound is best effort */ } }
              else signalVRRefusal('refused: quick save failed');
            });
            if (!started) signalVRRefusal('refused: quick save');
          },
          canSwapWeapons: typeof actor.hasAlternateWeaponSet === 'function' && actor.hasAlternateWeaponSet(),
          swapWeapons: () => actor.swapWeaponSets(),
          // BTN_CLEARALL's exact behaviour, offered only when there is
          // something to clear.
          canClearActions: actor.actionQueue.length > 0 ||
            actor.combatData.combatState === true ||
            actor.combatData.combatQueue.length > 0,
          clearQueuedActions: () => {
            const player = GameState.getCurrentPlayer();
            if (!player) return;
            vrCombatIntentQueue.clear();
            vrArmedGrenadeState.cancel();
            // Everything waiting, not only the queue and a grenade: a swing
            // held for the next round and an item at the neck used to survive
            // "Clear Actions" and fire anyway (critic run 4).
            vrCombatSwingBuffer.clear();
            vrArmedConsumableState.cancel();
            player.clearAllActions();
            player.combatData.combatState = false;
            player.cancelCombat();
          },
          canClearUpcomingActions: vrCombatIntentQueue.getSnapshot().entries.length > 0,
          clearUpcomingActions: () => {
            // The three-slot queue is VR presentation/input state. Clearing it
            // must not cancel an authored action already resolving in the
            // engine, nor disarm a separately chosen grenade.
            vrCombatIntentQueue.clear();
          },
        });
      },
      getComfortSettingsPanelContext: () => {
        if (!vrComfortSettingsPanelOpen) {
          if (vrComfortSettingsPausedByVR) {
            GameState.State = EngineState.RUNNING;
            vrComfortSettingsPausedByVR = false;
          }
          return null;
        }
        if (GameState.State !== EngineState.PAUSED) {
          GameState.State = EngineState.PAUSED;
          vrComfortSettingsPausedByVR = true;
        }
        // Each row carries its own action, so the order can change without
        // re-numbering a switch. Controls Guide is first (critic run 12: a
        // first-time player could not find it); Dominant Hand is last, away
        // from the rows tapped often, since one click swaps every control.
        const settingsRows: (VRComfortSettingsRow & { readonly activate: () => void })[] = [
          {
            label: 'Controls Guide',
            value: vrControlsGuideOpen ? 'Shown' : 'Hidden',
            activate: () => { vrControlsGuideOpen = !vrControlsGuideOpen; },
          },
          {
            label: 'Movement',
            value: vrComfortSettings.locomotionMode === 'smooth' ? 'Smooth' : 'Teleport',
            activate: () => { vrComfortSettings.locomotionMode = vrComfortSettings.locomotionMode === 'smooth' ? 'blink' : 'smooth'; },
          },
          {
            label: 'Turning',
            value: vrComfortSettings.turnMode === 'smooth' ? 'Smooth' : 'Snap',
            activate: () => { vrComfortSettings.turnMode = vrComfortSettings.turnMode === 'smooth' ? 'snap' : 'smooth'; },
          },
          {
            label: 'Snap Turn Angle',
            value: `${vrComfortSettings.snapTurnDegrees}°`,
            activate: () => {
              const options = [30, 45, 60, 90] as const;
              const currentIndex = options.indexOf(vrComfortSettings.snapTurnDegrees as typeof options[number]);
              vrComfortSettings.snapTurnDegrees = options[(Math.max(0, currentIndex) + 1) % options.length];
            },
          },
          {
            label: 'Comfort Vignette',
            value: vrComfortSettings.vignetteEnabled ? 'On' : 'Off',
            activate: () => { vrComfortSettings.vignetteEnabled = !vrComfortSettings.vignetteEnabled; },
          },
          {
            label: 'Damage Flash',
            value: vrComfortSettings.damageFlashEnabled !== false ? 'On' : 'Off',
            activate: () => { vrComfortSettings.damageFlashEnabled = vrComfortSettings.damageFlashEnabled === false; },
          },
          {
            label: 'Unpause on Wheel Close',
            value: vrComfortSettings.unpauseOnWheelClose === true ? 'On' : 'Off',
            activate: () => { vrComfortSettings.unpauseOnWheelClose = vrComfortSettings.unpauseOnWheelClose !== true; },
          },
          {
            label: 'Combat Sounds',
            value: vrComfortSettings.combatSoundsEnabled !== false ? 'On' : 'Off',
            activate: () => { vrComfortSettings.combatSoundsEnabled = vrComfortSettings.combatSoundsEnabled === false; },
          },
          {
            label: 'Wrist Health',
            value: vrComfortSettings.healthPlateEnabled !== false ? 'On' : 'Off',
            activate: () => { vrComfortSettings.healthPlateEnabled = vrComfortSettings.healthPlateEnabled === false; },
          },
          {
            label: 'Dialogue Text',
            value: VR_DIALOGUE_TEXT_LABELS[Math.max(0, VR_DIALOGUE_TEXT_SCALES.indexOf((vrComfortSettings.dialogueTextScale ?? 1) as any))],
            activate: () => {
              const current = Math.max(0, VR_DIALOGUE_TEXT_SCALES.indexOf((vrComfortSettings.dialogueTextScale ?? 1) as any));
              vrComfortSettings.dialogueTextScale = VR_DIALOGUE_TEXT_SCALES[(current + 1) % VR_DIALOGUE_TEXT_SCALES.length];
            },
          },
          {
            // ROADMAP 3.15: the setting existed in VRSpike but no row reached it.
            label: 'Dominant Hand',
            value: VRSpike.currentDominantHand === 'left' ? 'Left' : 'Right',
            activate: () => { VRSpike.setDominantHand(VRSpike.currentDominantHand === 'left' ? 'right' : 'left'); },
          },
        ];
        const rows: VRComfortSettingsRow[] = settingsRows.map(({ label, value }) => ({ label, value }));
        return {
          rows,
          controlsGuide: vrControlsGuideOpen,
          activateRow: (index: number) => {
            settingsRows[index]?.activate();
            saveVRComfortSettings();
          },
          close: () => {
            vrComfortSettingsPanelOpen = false;
            vrControlsGuideOpen = false;
            if (vrComfortSettingsPausedGame && GameState.State === EngineState.PAUSED) GameState.State = EngineState.RUNNING;
            vrComfortSettingsPausedGame = false;
          },
        };
      },
      /**
       * Phase G2 — the in-game HUD overlay, presented separately from
       * foreground panels.
       *
       * It cannot go through `getPanelContext`: that path claims foreground
       * input ownership, which suspends locomotion and gameplay. The HUD must
       * stay up *while* the player walks around, so it gets its own context and
       * its own host. Returns null unless the overlay is the only visible menu.
       */
      getInGameOverlayContext: () => {
        const overlay = GameState.MenuManager.InGameOverlay;
        if (!overlay?.bVisible) return null;
        const foregroundMenu = GameState.MenuManager.GetForegroundMenu();
        if (foregroundMenu?.bVisible && foregroundMenu !== overlay) return null;
        if (GameState.Mode !== EngineMode.INGAME) return null;
        return {
          overlay,
          guiScene: GameState.scene_gui,
          guiCamera: GameState.camera_gui,
          viewportWidth: GameState.ResolutionManager.getViewportWidth(),
          viewportHeight: GameState.ResolutionManager.getViewportHeight(),
          pointerSink: vrLegacyGUIPointerAdapter,
        };
      },
      getPanelContext: () => {
        const foregroundMenu = GameState.MenuManager.GetForegroundMenu();
        const menu = foregroundMenu?.bVisible && foregroundMenu !== GameState.MenuManager.InGameOverlay
          ? foregroundMenu
          : null;
        // A conversation held in the world shows only its dialogue, in the
        // lower part of the view, so the player can see who they are talking
        // to (round 7: direct interactions "should only show dialogue on the
        // bottom half of the screen"). The fade quad is left out of it: fades
        // belong to authored shots, which the theater shows, and composited
        // here they turned the dialogue into a black slab on every
        // {Fade out} node — the "black screen" of the same report.
        const worldDialogue = isVRWorldDialogue(menu);
        const occludedGuiRoots = menu ? getOccludedGuiRoots(menu) : [];
        return {
          menu,
          guiScene: GameState.scene_gui,
          guiCamera: GameState.camera_gui,
          viewportWidth: GameState.ResolutionManager.getViewportWidth(),
          viewportHeight: GameState.ResolutionManager.getViewportHeight(),
          pointerSink: vrLegacyGUIPointerAdapter,
          occludedGuiRoots: worldDialogue
            ? [...occludedGuiRoots, GameState.FadeOverlayManager.plane]
            : occludedGuiRoots,
          presentOptions: worldDialogue
            ? {
              region: GameState.MenuManager.InGameDialog.getVRWorldDialogueRegion(),
              verticalOffsetMetres: VR_WORLD_DIALOGUE_VERTICAL_OFFSET_METRES,
              scale: vrComfortSettings.dialogueTextScale ?? 1,
              scaleAnchor: 'top',
              backingOpacity: 0.9,
            }
            : menu && !VR_UNTRIMMED_MENU_RESREFS.has(String((menu as any).gui_resref || '').toLowerCase())
              ? {
                // Round 14: keep the menu, not the full-screen fill behind it.
                region: resolveVRMenuRegion(
                  [(menu as any).tGuiPanel?.extent, (menu as any).childMenu?.bVisible ? (menu as any).childMenu?.tGuiPanel?.extent : null],
                  GameState.ResolutionManager.getViewportWidth(),
                  GameState.ResolutionManager.getViewportHeight(),
                ),
                // Round 14 enlarged a trimmed menu to 1.25 m; round 15 found that
                // too large and blurred, so it gets half that enlargement.
                regionWidthMetres: 1.25,
                regionEnlargeFraction: 0.5,
                // A computer terminal is a page of text read at arm's length:
                // it was ~4 px a line in the emulator and ignored the Dialogue
                // Text size (critic run 11). It takes the text size too.
                ...(menu === GameState.MenuManager.InGameComputer
                  ? { regionWidthMetres: 1.3, regionEnlargeFraction: 1, scale: vrComfortSettings.dialogueTextScale ?? 1, scaleAnchor: 'top' as const }
                  : {}),
              }
              : undefined,
        };
      },
      getMovieContext: () => GameState.VideoManager.isMoviePlaying()
        ? {
          canSkip: GameState.VideoManager.isCurrentMovieSkippable(),
          skip: () => GameState.VideoManager.skipMovie(),
        }
        : null,
      getCutsceneContext: () => {
        observeVRCutsceneMove();
        const currentEntry = GameState.CutsceneManager.currentEntry;
        // The computer panel withholds skip because it owns input while it is
        // showing numbered options — but only then. `setReplies` filters
        // continue-dialog nodes out of the displayed list, so an entry whose
        // only reply is a blank continue node shows NO options at all: nothing
        // is clickable, the VR pointer reports "no clickable control among
        // [LB_MESSAGE, LBL_BAR1]", and the console is a dead end. That is the
        // Ebon Hawk communications console, whose first entry is skippable and
        // whose single reply is a continue node — the player could click, hear
        // the click, and never advance.
        //
        // Flatscreen advances it by skipping the entry, which runs
        // showReplies() and auto-advances the continue node. Grant the same
        // route whenever the panel has nothing to choose from.
        const computerOwnsInput = GameState.MenuManager.InGameComputer?.isVisible() &&
          (GameState.CutsceneManager.currentReplies || [])
            .some((reply) => !reply.isContinueDialog());
        // Direct conversations are held in the world with the dialogue on a
        // panel (round 6); shots of anything the player cannot see from where
        // they stand go to the theater (round 7). Decided per shot — see
        // resolveVRCutscenePresentation.
        const presentation: VRCutscenePresentation = GameState.CutsceneManager.active
          ? resolveCurrentVRCutscenePresentation()
          : 'world';
        GameState.vrDialogWorldPresentation = GameState.CutsceneManager.active && VRSpike.isPresenting &&
          presentation === 'world';
        return GameState.CutsceneManager.active && !computerOwnsInput
          ? {
            presentation,
            hideWorld: presentation === 'theater' && vrMovedConversation !== null &&
              vrMovedConversation === (GameState.CutsceneManager.dialog ?? null),
            canSkip: currentEntry?.skippable === true,
            skip: () => {
              if (currentEntry) GameState.CutsceneManager.playerSkipEntry(currentEntry);
            },
            abort: () => {
              // Mirrors flatscreen's unconditional DialogAbort
              // (IngameControls.ts, KeyMapAction.DialogAbort) — the escape
              // hatch VR had none of for an authored `NodeUnskippable` entry,
              // which otherwise had no skip button and no way out. Only
              // while there is no reply choice on screen: once the replies are
              // up the panel owns input and the player should pick one, not
              // have the whole conversation end under them.
              //
              // `repliesShown` alone could never enforce that. `showReplies()`
              // sets `this.currentEntry = undefined` at the very moment the
              // reply list goes up, so the captured `currentEntry` is null
              // exactly when the guard is meant to bite — and `canSkip` above
              // reads the same field, so it is false then too. Pressing the
              // trigger to choose a reply therefore fell through to abort.
              //
              // That is how the Peragus utility lift failed: choosing
              // "[Go outside.]" aborted the conversation instead of selecting
              // it — logged as endConversation(aborted=true) with
              // state=WAITING_FOR_PC_CHOICE and both replies live — so the
              // terminal reply carrying `a_to_002ebo` never ran and the player
              // was left standing at the controls.
              //
              // The conversation state is authoritative while the entry is not.
              if (GameState.CutsceneManager.isWaitingForPCChoice()) return;
              if (currentEntry?.repliesShown) return;
              GameState.CutsceneManager.endConversation(true);
            },
          }
          : null;
      },
      getKeyboardContext: () => {
        // `activeGUIElement` is only ever set by clicking a control with a
        // mouse (GUILabel.setEditable installs a *click* handler and nothing
        // else). MenuSaveName papers over this by focusing its edit box in
        // show(); CharGenName does not, so character creation's name field
        // was never focused in VR and every keystroke was silently dropped.
        // Fall back to the foreground menu's own editable field so the VR
        // keyboard works on any name-entry screen without first demanding a
        // precise pointer click on a small text box.
        const activeControl = GameState.MenuManager.activeGUIElement as VRKeyboardCapableControl | undefined;
        const control = isVRKeyboardCapableControl(activeControl)
          ? activeControl
          : findVREditableControl(GameState.MenuManager.GetForegroundMenu());
        return control
          ? {
            owner: control,
            onKeyDown: control.onKeyDown.bind(control) as (event: { readonly which: number; readonly shiftKey: boolean }) => void,
            cancel: () => control.menu?.triggerControllerBPress?.(),
          }
          : null;
      },
      /**
       * ROADMAP 4.8. Only a live hostile creature is marked: a wheel opened on
       * a door, a container, or empty space acts on world routes rather than on
       * a combat target, and ringing a footlocker would be a lie.
       *
       * Dead targets stop being marked too — `isVRCombatTarget` fails closed on
       * them — so the ring cannot linger on a corpse while the wheel is still up.
       */
      getCombatTargetHighlight: (targetId) => {
        const actor = GameState.getCurrentPlayer();
        if (!actor) return null;
        const candidate = resolveVRAimedObject(targetId);
        if (!candidate || !isVRCombatTarget(actor, candidate)) return null;
        const position = candidate.position;
        if (!position) return null;
        return { id: String(candidate.id), position: position.clone() };
      },
      getWorldTargetIndicator: () => {
        const hoveredObject = GameState.CursorManager.hoveredObject;
        const selectedObject = GameState.CursorManager.selectedObject;
        const object = hoveredObject ?? selectedObject;
        const reticle = hoveredObject && GameState.CursorManager.reticle.visible
          ? GameState.CursorManager.reticle
          : selectedObject && GameState.CursorManager.reticle2.visible
            ? GameState.CursorManager.reticle2
            : null;
        if (!object || !reticle) return null;
        // A corpse is not a target: its name plate and brackets stayed up
        // after the kill (critic runs 11-12).
        if (typeof (object as any).isDead === 'function' && (object as any).isDead()) return null;
        // In a fight only hostiles keep a plate (locked by Allen, 2026-10-13).
        const plateActor = GameState.getCurrentPlayer();
        if (isVRCombatNamePlateHidden(plateActor, object as any,
          (object.objectType & ModuleObjectType.ModuleCreature) !== 0, isVRFightOnFor(plateActor))) return null;
        const position = reticle.getWorldPosition(new THREE.Vector3());
        return {
          id: String(object.id),
          // Raw retail names carry designer annotations — `Blast Door{HK-50}`,
          // `Body{Invis container}`. resolveVRWorldPromptName already strips
          // them; this fallback path did not, so any object reached through the
          // engine cursor rather than the VR prompt showed the annotation on a
          // label an arm's length from the player's face.
          name: resolveDisplayName(object.getName?.()) || 'Object',
          position,
        };
      },
      // The engine hovers the nearest interactable when nothing is selected,
      // which mid-firefight is usually the Remote or a companion: its cyan
      // brackets stayed up after its prompt and plate were dropped. In a fight
      // only hostiles keep brackets (locked by Allen, 2026-10-13).
      hideCombatNonHostileReticles: () => {
        const cursor = GameState.CursorManager;
        const actor = GameState.getCurrentPlayer();
        const pairs: [ModuleObject | undefined, THREE.Object3D | undefined][] = [
          [cursor.hoveredObject, cursor.reticle],
          [cursor.selectedObject, cursor.reticle2],
        ];
        for (const [object, reticle] of pairs) {
          if (!object || !reticle?.visible) continue;
          if (isVRCombatNamePlateHidden(actor, object as any,
            (object.objectType & ModuleObjectType.ModuleCreature) !== 0, isVRFightOnFor(actor))) reticle.visible = false;
        }
      },
      getWorldContext: () => {
        const area = GameState.module?.area;
        const player = GameState.getCurrentPlayer();
        const rooms = area?.rooms ?? [];
        // Counted rather than filtered: this runs every frame purely so the
        // room trace can build a string it usually discards, and `filter`
        // allocated an array of visible rooms each time to then read `.length`.
        let roomsVisible = 0;
        for(let i = 0, il = rooms.length; i < il; i++){
          if(rooms[i].model?.visible) roomsVisible++;
        }
        return {
          module: GameState.module?.filename ?? area?.name ?? null,
          position: player?.position ?? null,
          room: player?.room?.roomName ?? null,
          roomsVisible,
          roomsTotal: rooms.length,
        };
      },
    });

    /**
     * Initialize the game controls
     */
    GameState.controls = new IngameControls(GameState.currentCamera, GameState.canvas);

    /**
     * Initialize the FadeOverlayManager
     */
    GameState.FadeOverlayManager.Initialize();

    window.addEventListener('resize', () => {
      GameState.EventOnResize();
    });


    try{
      //init shaders
      PerformanceMonitor.start('ShaderManager.Init');
      GameState.ShaderManager.Init();
      PerformanceMonitor.stop('ShaderManager.Init');

      GameState.TutorialWindowTracker = [];

      /**
       * Initialize Audio for the GUI
       */
      const audioEngine = AudioEngine.GetAudioEngine();
      AudioEngine.GAIN_MUSIC = parseInt(GameState.iniConfig.getProperty('Sound Options.Music Volume')) || 0
      AudioEngine.GAIN_VO = parseInt(GameState.iniConfig.getProperty('Sound Options.Voiceover Volume')) || 0
      AudioEngine.GAIN_SFX = parseInt(GameState.iniConfig.getProperty('Sound Options.Sound Effects Volume')) || 0
      AudioEngine.GAIN_GUI = parseInt(GameState.iniConfig.getProperty('Sound Options.Sound Effects Volume')) || 0
      AudioEngine.GAIN_MOVIE = parseInt(GameState.iniConfig.getProperty('Sound Options.Movie Volume')) || 0

      GameState.guiAudioEmitter = new AudioEmitter(audioEngine, AudioEngineChannel.GUI);
      GameState.guiAudioEmitter.maxDistance = 100;
      GameState.guiAudioEmitter.volume = 127;
      GameState.guiAudioEmitter.setPriorityGroupId(AudioPriorityGroup.GUI);
      GameState.guiAudioEmitter.load();
    
      GameState.audioEmitter = new AudioEmitter(audioEngine);
      GameState.audioEmitter.maxDistance = 50;
      GameState.audioEmitter.type = AudioEmitterType.GLOBAL;
      GameState.audioEmitter.setPriorityGroupId(AudioPriorityGroup.SCRIPTED_PLAYSOUND);
      GameState.audioEmitter.load();

      /**
       * Initialize the LightManager
       */
      GameState.lightManager.init(GameState);
      GameState.windManager.init(GameState);
      GameState.lightManager.setLightHelpersVisible(ConfigClient.get('GameState.debug.light_helpers') ? true : false);

      //AudioEngine.Unmute()
      GameState.SetEngineMode(EngineMode.GUI);
      GameState.State = EngineState.RUNNING;
      GameState.inMenu = false;

      /**
       * Initialize the CursorManager
       */
      GameState.CursorManager.MenuManager = GameState.MenuManager;
      GameState.CursorManager.selected = undefined;
      GameState.CursorManager.hovered = undefined;
      await GameState.CursorManager.init();

      GameState.scene_cursor_holder.add( GameState.CursorManager.cursor );
      GameState.scene.add( GameState.CursorManager.reticle );
      GameState.scene.add( GameState.CursorManager.reticle2 );
      GameState.scene_gui.add( GameState.CursorManager.arrow );
      GameState.scene.add( GameState.CursorManager.testPoints );
      console.log('CursorManager: Complete');

      PerformanceMonitor.start('PartyManager.Initialize');
      GameState.PartyManager.Initialize();
      PerformanceMonitor.stop('PartyManager.Initialize');

      /**
       * Initialize the MenuManager
       */
      PerformanceMonitor.start('MenuManager.Init');
      GameState.MenuManager.Init();
      PerformanceMonitor.stop('MenuManager.Init');

      PerformanceMonitor.start('MenuManager.LoadMainGameMenus');
      await GameState.MenuManager.LoadMainGameMenus();
      PerformanceMonitor.stop('MenuManager.LoadMainGameMenus');

      /**
       * Preload the legal screen texture
       */
      if(GameState.GameKey == GameEngineType.TSL){
        await GameState.LegalScreenManager.Initialize();
      }

      /**
       * Preload fx textures
       */
      TextureLoader.enQueue(GameState.preloadTextures,
        undefined,
        TextureType.TEXTURE,
        undefined,
        undefined,
        'particle'
      );

      if(GameState.GameKey == GameEngineType.KOTOR){
        GameState.VideoManager.queueMovie('leclogo', true);
        GameState.VideoManager.queueMovie('biologo', true);
        GameState.VideoManager.queueMovie('legal', true);
      }else if(GameState.GameKey == GameEngineType.TSL){
        GameState.VideoManager.queueMovie('leclogo', true);
        GameState.VideoManager.queueMovie('ObsidianEnt', true);
        GameState.VideoManager.queueMovie('Legal', true);
      }

      GameState.Ready = true;
      GameState.Start();
      console.log(PerformanceMonitor.toString());
    }catch(e){
      console.error(e);
    }
  }

  static Start(){

    if(GameState.Ready && !GameState.OnReadyCalled){
      GameState.OnReadyCalled = true;
      GameState.processEventListener('ready');
      window.dispatchEvent(new Event('resize'));
      
      // if(GameState.GameKey == GameEngineType.TSL){
      //   GameState.SetEngineMode(EngineMode.LEGAL);
      //   GameState.State = EngineState.RUNNING;
      //   GameState.Update();
      //   return;
      // }

      GameState.VideoManager.playMovieQueue( () => {
        window.dispatchEvent(new Event('resize'));
        GameState.MenuManager.MainMenu.Start();
        GameState.SetEngineMode(EngineMode.GUI);
        GameState.State = EngineState.RUNNING;
        AudioEngine.Unmute(AudioEngineChannel.ALL);
        AudioEngine.Mute(AudioEngineChannel.MOVIE);
      }).catch((e) => {
        console.error(e);
        window.dispatchEvent(new Event('resize'));
        GameState.MenuManager.MainMenu.Start();
        GameState.SetEngineMode(EngineMode.GUI);
        GameState.State = EngineState.RUNNING;
        AudioEngine.Unmute(AudioEngineChannel.ALL);
        AudioEngine.Mute(AudioEngineChannel.MOVIE);
      });
      //Start the game update loop
      GameState.Update();
    }
  }

  static EventOnResize(){
    // An immersive XR session owns the canvas, the renderer size, and every 3D
    // camera's projection. three refuses `renderer.setSize()` outright while
    // presenting ("Can't change size while VR device is presenting"), and
    // rewriting the composer, depth target, world camera aspect, or the
    // cutscene cameras mid-session corrupts the stereo view.
    //
    // The 2D GUI half must still run. `VRPanelHost` reprojects the legacy GUI
    // by rendering `guiScene` through `camera_gui`, so skipping the
    // `camera_gui` bounds and `MenuManager.Resize()` below leaves every
    // summoned menu rendering as an empty black quad in the headset. A browser
    // resize is routine in VR (the desktop window behind the headset changes
    // size), so this is a split, not a bail-out.
    const xrOwnsRenderTargets = !!GameState.renderer?.xr?.isPresenting;

    GameState.ResolutionManager.recalculate();
    let width = GameState.ResolutionManager.getViewportWidth();
    let height = GameState.ResolutionManager.getViewportHeight();

    if(!xrOwnsRenderTargets){
      GameState.composer.setSize(width * GameState.rendererUpscaleFactor, height * GameState.rendererUpscaleFactor);
    }

    GameState.FadeOverlayManager.plane.scale.set(width, height, 1);

    GameState.VideoManager.resize(width, height);

    GameState.camera_gui.left = width / -2;
    GameState.camera_gui.right = width / 2;
    GameState.camera_gui.top = height / 2;
    GameState.camera_gui.bottom = height / -2;

    GameState.camera_gui.updateProjectionMatrix();

    if(!xrOwnsRenderTargets){
      GameState.camera.aspect = width / height;
      GameState.camera.updateProjectionMatrix();

      GameState.renderer.setSize(width, height);

      GameState.camera_dialog.aspect = GameState.camera.aspect;
      GameState.camera_dialog.updateProjectionMatrix();

      GameState.camera_animated.aspect = GameState.camera.aspect;
      GameState.camera_animated.updateProjectionMatrix();

      for(let i = 0; i < GameState.staticCameras.length; i++){
        GameState.staticCameras[i].aspect = GameState.camera.aspect;
        GameState.staticCameras[i].updateProjectionMatrix();
      }
    }

    //GameState.bokehPass.renderTargetColor.setSize(width * GameState.rendererUpscaleFactor, height * GameState.rendererUpscaleFactor);

    GameState.screenCenter.x = ( (GameState.ResolutionManager.getViewportWidth()/2) / GameState.ResolutionManager.getViewportWidth() ) * 2 - 1;
    GameState.screenCenter.y = - ( (GameState.ResolutionManager.getViewportHeight()/2) / GameState.ResolutionManager.getViewportHeight() ) * 2 + 1;

    GameState.MenuManager.Resize();

    if(!xrOwnsRenderTargets){
      GameState.depthTarget.setSize(GameState.ResolutionManager.getViewportWidth() * GameState.rendererUpscaleFactor, GameState.ResolutionManager.getViewportHeight() * GameState.rendererUpscaleFactor);
    }

    if(GameState.ResolutionManager.vpScaleFactor){
      GameState.canvas.style.transform = 'scale('+GameState.ResolutionManager.vpScaleFactor+')';
    }else{
      GameState.canvas.style.transform = '';
    }

  }

  static updateRendererUpscaleFactor(){
    this.EventOnResize();
  }

  /**
   * Rebuilds the frustum that `ModuleObject.isOnScreen()` culls against.
   *
   * `updateVisibility()` hard-sets `model.visible = false` for anything outside
   * this frustum. Built from `currentCamera` — the flatscreen follower camera —
   * that culled against a viewpoint the player is no longer looking through
   * once an immersive session takes over, so doors, creatures, and the player's
   * own model vanished in the headset while rendering fine in flatscreen.
   *
   * While presenting, three's `WebXRManager.getCamera()` returns an ArrayCamera
   * whose projection is computed specifically to encompass both eye frusta for
   * exactly this purpose, so it is the correct culling source in XR.
   */
  /**
   * TEMPORARY (VR-PLAYTEST-FIX-PLAN.md issue 13): names objects whose culling
   * bounds cannot describe where they are.
   *
   * `updateModelVisibility` hides anything `isOnScreen()` rejects, and that
   * tests the bounding sphere derived from `box`. An empty `Box3` yields a
   * zero-radius sphere at the world origin, so the object renders only while
   * the origin is in view and stays interactable throughout — which is the
   * reported "invisible until it is at the extreme left of my vision".
   *
   * Runs once per module load and says nothing when everything is sound.
   */
  static reportCullingBoundsAnomalies(){
    try{
      const area = GameState.module?.area;
      if(!area) return;
      const sphere = new THREE.Sphere();
      const samples: BoundsSample[] = [];
      const collect = (objects: any[], kind: string) => {
        if(!Array.isArray(objects)) return;
        for(const object of objects){
          if(!object?.box || !object?.position) continue;
          object.box.getBoundingSphere(sphere);
          samples.push({
            name: typeof object.getTag === 'function' ? (object.getTag() || kind) : kind,
            kind,
            position: { x: object.position.x, y: object.position.y, z: object.position.z },
            empty: object.box.isEmpty(),
            center: { x: sphere.center.x, y: sphere.center.y, z: sphere.center.z },
            radius: sphere.radius,
          });
        }
      };
      collect(area.doors, 'door');
      collect(area.placeables, 'placeable');
      collect(area.creatures, 'creature');

      const anomalies = findCullingBoundsAnomalies(samples);
      if(!anomalies.length) return;
      console.warn(describeCullingBoundsAnomalies(anomalies));
    }catch(e){
      // Diagnostics must never block a module becoming playable.
    }
  }

  static updateViewportFrustum(){
    let cullCamera: THREE.Camera = GameState.currentCamera;
    try {
      const xr = GameState.renderer?.xr;
      // In VR the headset camera is what renders the world — except while an
      // authored camera owns the shot. In DIALOG the engine points
      // `currentCamera` at the placeable/dialogue camera and VR reprojects
      // THAT camera onto the theater surface, so culling from the headset
      // hides precisely the rooms the shot is aimed at.
      //
      // `updateRoomVisibility`'s DIALOG branch already tests room boxes
      // against `GameState.currentCamera.position`; taking the frustum from a
      // different camera left those two halves disagreeing. The Ebon Hawk
      // security console showed it plainly — every camera feed rendered the
      // skybox, space with an asteroid drifting past, because each room failed
      // both the containsPoint test and a frustum belonging to the player's
      // head back at the console. Reported from a headset session.
      const authoredCameraOwnsShot = GameState.Mode == EngineMode.DIALOG;
      if(xr?.isPresenting && !authoredCameraOwnsShot && typeof xr.getCamera === 'function'){
        const xrCamera = (xr.getCamera as unknown as () => THREE.Camera)();
        if(xrCamera?.projectionMatrix) cullCamera = xrCamera;
      }
    }catch(e){
      // Fall back to the flatscreen camera rather than losing culling entirely.
    }
    GameState.frustumMat4.multiplyMatrices( cullCamera.projectionMatrix, cullCamera.matrixWorldInverse );
    GameState.viewportFrustum.setFromProjectionMatrix(GameState.frustumMat4);
  }

  static updateCurrentCameraPosition(){
    GameState.currentCameraPosition.set(0, 0, 0);
    GameState.currentCameraPosition.applyMatrix4(FollowerCamera.camera.matrix);
  }

  /**
   * The per-frame world systems every playable engine mode drives identically.
   *
   * `lightTarget` is what light distance is measured from — the player while
   * ingame, the camera during dialogue, where the authored shot rather than the
   * party decides what is near.
   *
   * Deliberately does not rebuild the culling frustum. `Update` rebuilds it
   * once per frame after `Render`, which is the only point where the XR camera
   * carries a world pose; rebuilding it here instead gave every caller below a
   * frustum sitting at the world origin while presenting, and lights were
   * culled against it. See the note in `Update`.
   */
  static updateWorldSystems(delta: number, lightTarget: THREE.Camera|ModuleObject){
    GameState.lightManager.update(delta, lightTarget);
    GameState.windManager.update(delta);
    GameState.module.area.updateRoomAnimatedLights(delta);
    GameState.module.area.updateRoomWindUniforms();
    GameState.CameraShakeManager.update(delta, GameState.currentCamera);
  }

  /** Shows the PAUSE overlay only while paused with the in-game overlay up. */
  static syncPauseOverlay(){
    const modeBeforeOverlay = GameState.Mode;
    if(GameState.State == EngineState.PAUSED && GameState.MenuManager.InGameOverlay.isVisible()){
      if(!GameState.MenuManager.InGamePause.isVisible())
        GameState.MenuManager.InGamePause.show();
    }else{
      if(GameState.MenuManager.InGamePause.isVisible())
        GameState.MenuManager.InGamePause.hide();
    }

    // The pause overlay draws on top of whichever mode owns the frame; it does
    // not own that mode. GameMenu.show() assigns the menu's own engineMode, and
    // InGamePause declares INGAME - so pausing inside a minigame ended the race
    // outright: MINIGAME stopped being the mode, so the minigame stopped
    // ticking, and nothing ever set it back on unpause.
    if(GameState.Mode !== modeBeforeOverlay){
      GameState.SetEngineMode(modeBeforeOverlay);
    }
  }

  /**
   * Where the rider sits in a minigame, in world space, or null outside one.
   *
   * A minigame player rides a track node: its own `position` stays at the local
   * origin for the whole race while the container's world matrix is what moves.
   * Anchoring the VR rig to `position` therefore left the rider parked at the
   * world origin watching the track stream past hundreds of units away, with no
   * bike anywhere in sight.
   *
   * Facing is taken from the container's world +Y axis, which is the direction
   * of travel (measured on 211TEL: the bike moves +513 on Y with its +Y axis at
   * yaw pi/2). VRSpike yaws the rig by `facing + pi/2`, matching how KOTOR
   * renders its camera at bearing + 90 degrees, so the bearing it wants is that
   * heading minus pi/2.
   */
  private static miniGameSeatPosition = new THREE.Vector3();
  private static miniGameSeatQuaternion = new THREE.Quaternion();
  private static miniGameSeatScale = new THREE.Vector3();
  private static miniGameSeatForward = new THREE.Vector3();
  private static miniGameSeat: { position: THREE.Vector3; facing: number } = {
    position: new THREE.Vector3(), facing: 0,
  };

  /**
   * Where the rider's head is on the bike, in game units from the bike origin.
   *
   * Measured from the authored rider (`trider` in v_supertrike01, read with
   * PyKotor): its mesh spans y 0.12..1.65 and z 0.42..1.24, and its node sits
   * at y 0.50. A seated figure's head is over its hips, near the node, with
   * the legs making up the forward span - so the head is about 0.6 forward,
   * and the eyes a hand's breadth under the top of the head at z 1.24. The
   * previous 0.7 was the middle of the span, which is the knees.
   */
  static readonly MINIGAME_SEAT_FORWARD_OFFSET = 0.6;
  /**
   * Above the authored rider's eyes (1.13). Tuned live in the headset on
   * 2026-09-26: at the rider's own eye line the windshield (z 0.92..1.22)
   * filled the view and the track could not be seen; 1.45 clears it.
   */
  static readonly MINIGAME_RIDER_EYE_HEIGHT = 1.45;

  /**
   * The body the first-person submission must leave out.
   *
   * Ordinarily that is the party leader's model, welded to the rig at eye
   * height. In a minigame the rider is not the party leader at all: the swoop
   * carries its own rider, the `trider` node inside v_supertrike01, a 994-vertex
   * figure seated exactly where the player is. Drawn in first person it reads as
   * a second pair of arms in front of the player's own hands.
   *
   * Cached per model, because this runs once a frame and the lookup walks the
   * bike's 340 nodes.
   */
  private static miniGameRiderCache = new WeakMap<object, THREE.Object3D | null>();

  public static getFirstPersonHiddenBody(): THREE.Object3D | null | undefined {
    if(GameState.Mode != EngineMode.MINIGAME){
      // The controlled character (party[0]), not the fixed main-PC slot: after
      // a party swap the slot points at someone standing across the room.
      return GameState.getCurrentPlayer()?.model;
    }
    const models: any[] = (GameState.module?.area?.miniGame?.player as any)?.models ?? [];
    for(const model of models){
      if(!model){ continue; }
      if(GameState.miniGameRiderCache.has(model)){
        const cached = GameState.miniGameRiderCache.get(model);
        if(cached){ return cached; }
        continue;
      }
      let rider: THREE.Object3D | null = null;
      model.traverse((node: THREE.Object3D) => {
        if(rider){ return; }
        if(String(node.name || '').replace(/\0[\s\S]*$/, '') === 'trider'){ rider = node; }
      });
      GameState.miniGameRiderCache.set(model, rider);
      if(rider){ return rider; }
    }
    return null;
  }

  public static getMiniGameSeat(): { position: THREE.Vector3; facing: number } | null {
    if(GameState.Mode != EngineMode.MINIGAME){ return null; }
    const container = (GameState.module?.area?.miniGame?.player as any)?.container;
    if(!container){ return null; }
    container.updateMatrixWorld(true);
    container.matrixWorld.decompose(
      GameState.miniGameSeatPosition,
      GameState.miniGameSeatQuaternion,
      GameState.miniGameSeatScale,
    );
    GameState.miniGameSeatForward.set(0, 1, 0).applyQuaternion(GameState.miniGameSeatQuaternion);

    // Sit the rider on the saddle rather than behind it. The hook the rider
    // hangs from is the bike's own origin, which is well aft of the seat: in
    // the headset that put the player's head behind the seat back, looking
    // forward at it. The bike's own rider (`trider`) spans y 0.12 to 1.65 from
    // that origin, so its head sits near the middle of that span.
    GameState.miniGameSeat.position.copy(GameState.miniGameSeatPosition).addScaledVector(
      GameState.miniGameSeatForward, GameState.MINIGAME_SEAT_FORWARD_OFFSET,
    );

    // Face the way the bike travels. VRSpike yaws the rig by `facing + pi/2`,
    // matching how KOTOR renders its camera at bearing + 90 degrees - but a
    // minigame rider is welded to a vehicle rather than orbited by a follower
    // camera, and measured in the headset that convention left the rider facing
    // 90 degrees left of travel: rig yaw pi against a heading of pi/2. The
    // second half turn takes that back out.
    GameState.miniGameSeat.facing = Math.atan2(
      GameState.miniGameSeatForward.y, GameState.miniGameSeatForward.x,
    ) - Math.PI;
    return GameState.miniGameSeat;
  }

  private static miniGameSeatRight = new THREE.Vector3();

  /**
   * The bike's own right-hand axis in world space, for lean steering: the
   * rider's head is measured across this, whichever way the course has turned
   * the bike. Null outside a minigame.
   */
  public static getMiniGameSeatRight(): THREE.Vector3 | null {
    if(!GameState.getMiniGameSeat()){ return null; }
    // getMiniGameSeat has just decomposed the container's world matrix.
    return GameState.miniGameSeatRight.set(1, 0, 0)
      .applyQuaternion(GameState.miniGameSeatQuaternion).normalize();
  }

  public static getCurrentPlayer(): ModuleCreature {
    if(GameState.Mode == EngineMode.MINIGAME){
      return GameState.module.area.miniGame.player as any;
    }
    let p = GameState.PartyManager.party[0];
    return p ? p : GameState.PartyManager.Player;
  }

  static ResetModuleAudio(){                        
    GameState.CutsceneManager.audioEmitter = 
    this.audioEmitter = new AudioEmitter(AudioEngine.GetAudioEngine(), AudioEngineChannel.VO);
    this.audioEmitter.maxDistance = 50;
    this.audioEmitter.type = AudioEmitterType.GLOBAL;
    this.audioEmitter.setPriorityGroupId(AudioPriorityGroup.UNMASKABLE_SOUND);
    this.audioEmitter.load();
  }

  /**
   * Load a module
   * @param name 
   * @param waypoint - The waypoint to spawn the player at (if null, the player will spawn at the entry waypoint)
   * @param sMovie1 - The first movie to play
   * @param sMovie2 - The second movie to play
   * @param sMovie3 - The third movie to play
   * @param sMovie4 - The fourth movie to play
   * @param sMovie5 - The fifth movie to play
   * @param sMovie6 - The sixth movie to play
   */
  static async LoadModule(name = '', waypoint: string = null, sMovie1 = '', sMovie2 = '', sMovie3 = '', sMovie4 = '', sMovie5 = '', sMovie6 = ''){
    try{
      if(GameState.loadingModule){
        return;
      }
      EventManager.FireEvent('module.load', {
        name: name,
        waypoint: waypoint?.toString(),
        sMovie1: sMovie1,
        sMovie2: sMovie2,
        sMovie3: sMovie3,
        sMovie4: sMovie4,
        sMovie5: sMovie5,
        sMovie6: sMovie6
      });
      GameState.loadingModule = true;
      AutoSaveManager.cancel();
      // The transition must carry the Exile as the player character; a
      // possessed companion is taken over again once the new area is ready.
      const possessedNpcId = GameState.PartyManager.HandBackControlForTransition();
      await GameState.MenuManager.LoadScreen.setLoadBackground('load_'+name);
      GameState.FadeOverlayManager.FadeOut(0, 0, 0, 0);
      /**
       * Set the game mode to loading
       */
      GameState.SetEngineMode(EngineMode.LOADING);
      GameState.MenuManager.ClearMenus();

      GameState.UnloadModule();

      GameState.MenuManager.LoadScreen.setProgress(0);
      GameState.MenuManager.LoadScreen.showRandomHint();
      GameState.MenuManager.LoadScreen.open();

      await GameState.MenuManager.LoadInGameMenus();
      
      GameState.VideoEffectManager.SetVideoEffect(-1);
      GameState.ModuleObjectManager.playerSelectableObjects = [];
      GameState.VideoManager.queueMovie(sMovie1, true);
      GameState.VideoManager.queueMovie(sMovie2, true);
      GameState.VideoManager.queueMovie(sMovie3, true);
      GameState.VideoManager.queueMovie(sMovie4, true);
      GameState.VideoManager.queueMovie(sMovie5, true);
      GameState.VideoManager.queueMovie(sMovie6, true);
      GameState.SetEngineMode(EngineMode.LOADING);
      
      if(GameState.module){
        try{ await GameState.module.save(); }catch(e){
          console.error(e);
        }
        try{ GameState.module.dispose(); }catch(e){
          console.error(e);
        }
      }

      // Party members keep their instances across the load; drop what they
      // still point at in the outgoing area (last trigger, door, conversation).
      for(const member of GameState.PartyManager.party){
        try{ member?.clearAreaReferences?.(); }catch(e){ console.error(e); }
      }

      //Remove all cached scripts and kill all running instances
      GameState.NWScript.Reload();

      //Resets all keys to their default state
      GameState.controls.initKeys();

      await GameState.FactionManager.Load();

      // Module.Load swallows its own failures and returns undefined; one
      // dropped asset read then used to surface here as "Cannot read
      // properties of undefined (reading 'loadScene')" with the game stranded
      // on the load screen. Give the load a second chance before giving up.
      let module = await GameState.Module.Load(name, waypoint);
      if(!module){
        console.warn(`GameState.LoadModule: '${name}' failed to load; retrying once`);
        module = await GameState.Module.Load(name, waypoint);
      }
      if(!module){
        throw new Error(`GameState.LoadModule: module '${name}' could not be loaded`);
      }
      GameState.module = module;
      GameState.scene.visible = false;

      console.log('Module.loadScene');
      await module.loadScene();

      await TextureLoader.LoadQueue( (ref: ITextureLoaderQueuedRef) => {
        const material = ref.material as any;
        if(material?.map){
          GameState.renderer.initTexture(material.map);
        }
      });

      module.initEventQueue();

      console.log('Module.initScripts');
      await module.initScripts();

      //GameState.scene_gui.background = null;
      GameState.scene.visible = true;
      
      AudioEngine.Unmute();
      // playMovieQueue rejects when a queue is already active, and this call was
      // neither awaited nor caught, so the rejection escaped as an unhandled page
      // exception and the completion below never ran.
      //
      // That completion is the whole post-load setup: spawn scripts, the in-game
      // overlay, the scene compile - and `loadingModule = false` on its last
      // line. Leaving that flag latched makes LoadModule return immediately from
      // then on, so every later transition is a silent no-op. The failure is a
      // hard stop at the next door, not a dropped movie.
      //
      // The boot-path call to playMovieQueue already recovers exactly this way;
      // this one did not. Seen once in an 82-module sweep and not reproducible in
      // isolation, which is what a timing-dependent race looks like.
      const completeModuleLoad = async () => {
        const runSpawnScripts = !GameState.isLoadingSave;
        GameState.isLoadingSave = false;

        GameState.ResetModuleAudio();

        GameState.MenuManager.InGameOverlay.recalculatePosition();
        GameState.MenuManager.InGameOverlay.open();

        GameState.renderer.compile(GameState.scene, GameState.currentCamera);
        GameState.renderer.setClearColor( new THREE.Color(GameState.module.area.sun.fogColor) );
        
        console.log('ModuleArea.initAreaObjects');
        GameState.SetEngineMode(GameState.module.area.miniGame ? EngineMode.MINIGAME : EngineMode.INGAME);
        await GameState.module.area.initAreaObjects(runSpawnScripts);
        console.log('ModuleArea: ready to play');
        GameState.reportCullingBoundsAnomalies();
        GameState.module.readyToProcessEvents = true;
        // Arriving in an area (not loading a save) autosaves, as retail does.
        if(runSpawnScripts){
          AutoSaveManager.request('area');
        }

        if(possessedNpcId >= 0 && GameState.PartyManager.party.some((pm) => pm && pm.npcId == possessedNpcId)){
          try{ GameState.PartyManager.SwitchPlayerCharacter(possessedNpcId, true); }catch(e){ console.error(e); }
        }

        if(GameState.Mode == EngineMode.INGAME){
          const anyCanLevel = GameState.PartyManager.party.some((p) => p.canLevelUp());
          if(anyCanLevel){
            GameState.audioEmitter.playSound('gui_level');
          }
        }

        //Reveal the area
        GameState.MenuManager.LoadScreen.close();
        if(!GameState.holdWorldFadeInForDialog){
          GameState.FadeOverlayManager.FadeIn(2.5, 0, 0, 0, 1);
        }
        GameState.module.area.musicBackgroundPlay(true);
        GameState.loadingModule = false;
      };
      VideoManager.playMovieQueue(completeModuleLoad).catch(async (e) => {
        console.error('GameState.LoadModule: the movie queue did not start; completing the load without it', e);
        try {
          await completeModuleLoad();
        } catch (completionError) {
          console.error(completionError);
        }
      });
    }catch(e){
      // Leave the flag clear so a later transition is not a silent no-op.
      GameState.loadingModule = false;
      console.error(e);
      throw e;
    }
  }

  static RestoreEnginePlayMode(): void {
    if (GameState.VideoManager.ownsMovieMode()) {
      console.log('RestoreEnginePlayMode: deferred while movie playback owns engine mode');
      return;
    }
    //A conversation can still be active when something else (e.g. a movie finishing,
    //or an engine-mode flip during stunt-camera loading) calls this. Restoring straight
    //to INGAME/GUI here abandons that conversation's camera/scene setup mid-flight -
    //observed as a black screen that only cleared after a pause/unpause forced a
    //re-evaluation. Restore to DIALOG instead so CutsceneManager.update() keeps running.
    if(GameState.CutsceneManager.active){
      console.log('RestoreEnginePlayMode: DIALOG (conversation still active)');
      GameState.SetEngineMode(EngineMode.DIALOG);
      // A movie that interrupted a conversation left its replies unshown.
      GameState.CutsceneManager.resumeDeferredReplies();
      return;
    }
    if(GameState.module){
      if(GameState.module.area.miniGame){
        console.log('RestoreEnginePlayMode: MINIGAME');
        GameState.SetEngineMode(EngineMode.MINIGAME)
      }else{
        console.log('RestoreEnginePlayMode: INGAME');
        GameState.SetEngineMode(EngineMode.INGAME);
      }
    }else{
      console.log('RestoreEnginePlayMode: GUI');
      GameState.SetEngineMode(EngineMode.GUI);
    }
  }

  static SetEngineMode(mode: EngineMode){
    if (GameState.VideoManager.shouldDeferEngineModeChange(mode)) {
      console.log('SetEngineMode: deferred while movie playback owns engine mode', mode);
      return;
    }
    if(GameState.Mode == mode){
      return;
    }
    console.log('SetEngineMode: ', mode);
    GameState.Mode = mode;
    if(mode == EngineMode.LOADING){
      if(GameState.MenuManager.LoadScreen){
        GameState.MenuManager.LoadScreen.setProgress(0);
        GameState.MenuManager.LoadScreen.open();
      }
    }

    if(mode != EngineMode.INGAME){
      if(GameState.MenuManager.InGameBark)
        GameState.MenuManager.InGameBark.close();
  
      if(GameState.MenuManager.InGameAreaTransition)
        GameState.MenuManager.InGameAreaTransition.hide();
    }

    if(!(mode == EngineMode.INGAME || mode == EngineMode.DIALOG || mode == EngineMode.FREELOOK || mode == EngineMode.MINIGAME)){
      AudioEngine.Mute(AudioEngineChannel.SFX);
    }

    if(mode == EngineMode.INGAME || mode == EngineMode.DIALOG || mode == EngineMode.FREELOOK || mode == EngineMode.MINIGAME){
      AudioEngine.Unmute(AudioEngineChannel.SFX);
    }

    if(mode == EngineMode.GUI && GameState.FadeOverlayManager.material.visible){
      GameState.FadeOverlayManager.material.visible = false;
    }
  }

  static UnloadModule(){
    if(GameState.module){
      EventManager.FireEvent('module.unload', {
        name: GameState.module.name
      });
    }
    GameState.MenuManager.ClearMenus();
    GameState.deltaTime = 0;
    // GameState.initTimers();
    ResourceLoader.clearCache();

    GameState.scene.visible = false;
    GameState.SetEngineMode(EngineMode.LOADING);
    GameState.ModuleObjectManager.Reset();
    GameState.renderer.setClearColor(new THREE.Color(0, 0, 0));
    GameState.AlphaTest = 0;
    GameState.holdWorldFadeInForDialog = false;
    //Clear on unload so a sequence that disables transit and never re-enables
    //it - a real risk while TSL script coverage is incomplete - cannot leave
    //the player permanently unable to change area.
    GameState.disableTransit = false;
    const audioEngine = AudioEngine.GetAudioEngine();
    audioEngine.reset();
    // Same reason as the audio reset directly above: a module transition
    // abandons whatever the outgoing module still had in flight. This was the
    // one manager left out, and movie mode is owned by a flag that only ever
    // cleared itself when a queue drained - so a transition during a movie
    // leaked the ownership, and the next LoadModule threw on it. LoadModule
    // also queues the incoming module movies onto the same static queue a few
    // lines after calling this, which an outgoing queue would have swallowed.
    GameState.VideoManager.reset();

    GameState.lightManager.clearLights();
    GameState.windManager.clear();

    GameState.CursorManager.selected = undefined;
    GameState.CursorManager.selectedObject = undefined;
    GameState.CursorManager.hovered = undefined;
    GameState.CursorManager.hoveredObject = undefined;

    GameState.staticCameras = [];
    GameState.CutsceneManager.paused = false;
    // A callback waiting on the outgoing module's conversation (the Lab
    // Station opening) must not fire in the next module.
    GameState.CutsceneManager.clearAfterConversationQueue();

    AudioEngine.Mute();
  }

  static ReloadTextureCache(){
    if(GameState.module && GameState.module.area){
      GameState.module.area.reloadTextures();
    }
  }

  static getCameraById(id = 0){
    for(let i = 0; i < GameState.staticCameras.length; i++){
      if(GameState.staticCameras[i].userData.ingameID == id)
        return GameState.staticCameras[i];
    }

    return GameState.currentCamera;
  }

  static forwardVector = new THREE.Vector3(0, 0, );

  /**
   * Schedule the next frame.
   *
   * While a WebXR session is presenting, the headset owns the frame callback
   * via `renderer.setAnimationLoop` and runs at its own refresh rate.
   * requestAnimationFrame runs at the monitor's rate instead, so scheduling
   * both would double-step the engine. VRSpike re-arms rAF when the session ends.
   */
  static scheduleNextFrame(){
    if(VRSpike.isPresenting) return;
    requestAnimationFrame( GameState.Update );
  }

  static Update(timestamp: number = performance.now(), frameSource: EngineFrameSource = 'browser'){

    if(frameSource === 'browser') VRSpike.perf.recordBrowserCallback();
    if(!shouldProcessEngineFrame(frameSource, VRSpike.isPresenting)) return;
    VRSpike.perf.recordEngineUpdate(frameSource, timestamp);
    const simulationCpuStart = performance.now();
    GameState.scheduleNextFrame();

    GameState.forwardVector.set(0, 0, -1);

    // A module load, a movie or a background tab leaves a multi-second gap
    // on the clock; simulating it as one frame moved the Exile 10.5 m through
    // a wall on arrival in 103PER. See FrameDeltaRules.
    const delta = clampFrameDelta(GameState.clock.getDelta());
    GameState.processEventListener('beforeRender', [delta]);
    GameState.delta = delta;
    GameState.deltaTime += delta;
    GameState.deltaTimeFixed += (1/60);

    /**
     * Pause the main loop if the debugger is active
     */
    if(GameState.debugMode && !!GameState.Debugger.state){
      return;
    }

    GameState.controls.Update(delta);
    VRSpike.traceStartupStage('controls-complete');
    GameState.scene_cursor_holder.visible = !VRSpike.isPresenting && GameState.Mode != EngineMode.MOVIE && GameState.Mode != EngineMode.LEGAL;
    if(GameState.Mode == EngineMode.MOVIE || GameState.VideoManager.isMoviePlaying()){
      GameState.Mode = EngineMode.MOVIE;
      GameState.UpdateMovie(delta, timestamp);
      // A movie frame is a finished frame too. Returning past the terminator at
      // the end of this method kept the startup trace logging two lines every
      // frame for as long as a movie played after entering VR.
      VRSpike.completeStartupTrace();
      return;
    }

    if(GameState.Mode == EngineMode.LEGAL){
      GameState.UpdateLegal(delta);
      VRSpike.completeStartupTrace();
      return;
    }

    GameState.VideoEffectManager.Update(delta);

    GameState.MenuManager.Update(delta);
    VRSpike.traceStartupStage('menus-complete');
    if(GameState.MenuManager.InGameAreaTransition)
      GameState.MenuManager.InGameAreaTransition.hide();

    if(!GameState.loadingTextures && TextureLoader.queue.length){
      GameState.loadingTextures = true;
      // The latch must clear on failure too. `.then` alone leaves it stuck on
      // true after a single rejection, and nothing ever resolves another
      // texture for the rest of the session — which presents as a permanently
      // untextured world rather than as an error.
      TextureLoader.LoadQueue()
        .catch((error) => {
          if(!GameState.textureDrainErrorReported){
            GameState.textureDrainErrorReported = true;
            console.error('[GameState] texture drain rejected; further drains continue', error);
          }
        })
        .then( () => {
          GameState.loadingTextures = false;
        });
    }

    if(GameState.MenuManager.InGamePause)
      GameState.MenuManager.InGamePause.hide();

    switch(GameState.Mode){
      case EngineMode.LOADING:
        break;
      case EngineMode.GUI:
        GameState.UpdateGUI(delta);
        break;
      case EngineMode.INGAME:
        GameState.UpdateIngame(delta);
        break;
      case EngineMode.DIALOG:
        GameState.UpdateDialog(delta);
        break;
      case EngineMode.MINIGAME:
        GameState.UpdateMinigame(delta);
        break;
      case EngineMode.FREELOOK:
        GameState.UpdateFreeLook(delta);
        break;
    }
    AutoSaveManager.update(delta);
    VRSpike.traceStartupStage('simulation-complete');

    // In VR the listener is the headset, not the flatscreen follow camera.
    if(VRSpike.getListenerPose(vrAudioListenerPosition, vrAudioListenerForward)){
      AudioEngine.GetAudioEngine().update(delta, vrAudioListenerPosition, GameState.currentCamera.rotation, vrAudioListenerForward);
    }else{
      AudioEngine.GetAudioEngine().update(delta, GameState.currentCamera.position, GameState.currentCamera.rotation, GameState.forwardVector);
    }
    VRSpike.traceStartupStage('audio-complete');

    const renderCpuStart = performance.now();
    VRSpike.traceStartupStage('render-start');
    // A headset ray needs a larger target than a mouse cursor; see
    // PointerHitPadding. Driven from presentation state so flatscreen keeps
    // the authored hit areas exactly.
    setPointerHitPadding(VRSpike.isPresenting ? VR_POINTER_HIT_PADDING : 0);
    GameState.Render(delta, timestamp);
    VRSpike.traceStartupStage('render-complete');
    // Rebuild the culling frustum now that the XR camera carries a world pose.
    // three writes the reference-space-LOCAL head pose into its XR camera at
    // frame start and only composes the rig during render(), so the copy read
    // during the simulation phase above sits near the world origin — measured
    // in-headset at (-0.62, 0.69, -0.31) while the player stood at
    // (44.37, 44.64, 2.50). Culling against that hid every door and creature
    // and let them reappear only when the origin swung through view.
    //
    // This is the ONLY rebuild in the frame, deliberately. The four Update*
    // modes each used to rebuild it again mid-simulation, which reintroduced
    // exactly that origin-anchored frustum — and `lightManager.update` ran
    // four lines later and culled every dynamic light against it. Consumers
    // read the frustum built here at the end of the previous frame; a frame of
    // latency on culling bounds is invisible, a frustum in the wrong place is
    // not. Do not add a rebuild back into the simulation phase.
    GameState.updateViewportFrustum();
    const renderCpuEnd = performance.now();
    VRSpike.perf.recordCpuFrame(
      renderCpuStart - simulationCpuStart,
      renderCpuEnd - renderCpuStart
    );

    //NoClickTimer: Update
    if( ((GameState.Mode == EngineMode.MINIGAME || GameState.Mode == EngineMode.DIALOG) || (GameState.Mode == EngineMode.INGAME)) && GameState.State != EngineState.PAUSED){
      if(GameState.noClickTimer){
        GameState.noClickTimer -= (1 * delta);
        if(GameState.noClickTimer < 0){
          GameState.noClickTimer = 0;
        }
      }
    }

    GameState.stats.update();
    GameState.processEventListener('afterRender', [delta]);
    // Roll performance windows only after the current XR frame has rendered,
    // otherwise the render is incorrectly credited to the following window.
    VRSpike.perf.tick();
    VRSpike.completeStartupTrace();
  }

  static UpdateMovie(delta: number = 0, frameTimestamp: number = performance.now()){
    GameState.VideoManager.update(delta);
    if(VRSpike.isPresenting){
      VRSpike.renderMovie(
        GameState.scene_movie,
        GameState.camera_gui,
        GameState.ResolutionManager.getViewportWidth(),
        GameState.ResolutionManager.getViewportHeight(),
        frameTimestamp
      );
      GameState.processEventListener('afterRender', [delta]);
      return;
    }
    GameState.renderer.render(GameState.scene_movie, GameState.camera_gui);
    GameState.processEventListener('afterRender', [delta]);
  }

  static UpdateGUI(delta: number = 0){
    //NOP
  }

  static UpdateIngame(delta: number = 0){
    //Get Selectable Objects In Range
    GameState.ModuleObjectManager.TickSelectableObjects(delta);
    updateVRLeaderControl(delta);

    //Update Mode Camera
    //Make sure we are using the follower camera while ingame
    GameState.currentCamera = GameState.camera;
    GameState.VideoEffectManager.SetVideoEffect(-1);
    // `forceVector` is cleared when a ModuleObject is disposed, and
    // `PartyManager.party` still points at the outgoing module's party for a
    // frame after a transition — so a live player reference is not proof of a
    // live vector. Reading it threw every frame, which stops the world
    // advancing and reads as a freeze rather than a crash. Ordinary play hides
    // this behind a loading screen; the module sweep warps straight between
    // areas and hit it on 5 of its first 17 modules.
    const currentPlayer = GameState.getCurrentPlayer();
    if(currentPlayer?.forceVector){
      GameState.forwardVector.copy(currentPlayer.forceVector).multiplyScalar(100);
      GameState.forwardVector.z = -1;
    }

    if(GameState.State != EngineState.PAUSED){
      GameState.updateTime(delta);
    }

    //Handle Module Tick
    if(
      GameState.State == EngineState.PAUSED || GameState.MenuManager.activeModals.length
    ){
      GameState.module.tickPaused(delta);
    }else{
      GameState.module.tick(delta);

      //Update the Bark Overlay if it is visible
      if(GameState.MenuManager.InGameBark?.bVisible){
        GameState.MenuManager.InGameBark.update(delta);
      }
    }

    GameState.FadeOverlayManager.Update(delta);
    GameState.updateCurrentCameraPosition();
    GameState.updateWorldSystems(delta, GameState.getCurrentPlayer());

    //Handle the visibility of the PAUSE overlay
    GameState.syncPauseOverlay();
    if(GameState.MenuManager.InGameAreaTransition.transitionObject){
      GameState.MenuManager.InGameAreaTransition.show();
    }
  }

  static UpdateDialog(delta: number = 0){
    if(GameState.State != EngineState.PAUSED){
      GameState.updateTime(delta);
    }
    const isEntryMode = GameState.MenuManager.InGameDialog.isVisible() && !GameState.MenuManager.InGameDialog.LB_REPLIES.isVisible() && GameState.scene_cursor_holder.visible;
    if(isEntryMode){
      GameState.scene_cursor_holder.visible = false;
    }
    GameState.module.tick(delta);
    GameState.CutsceneManager.update(delta);
    if(GameState.MenuManager.InGameBark?.bVisible){
      GameState.MenuManager.InGameBark.update(delta);
    }
    GameState.FadeOverlayManager.Update(delta);
    GameState.updateCurrentCameraPosition();
    //During dialogue the authored shot, not the party, decides what is near.
    GameState.updateWorldSystems(delta, GameState.currentCamera);

    //Handle the visibility of the PAUSE overlay
    GameState.syncPauseOverlay();
  }

  static UpdateMinigame(delta: number = 0){
    GameState.updateCurrentCameraPosition();

    GameState.updateTime(delta);

    // Tick the module, exactly as UpdateInGame does. Without this the swoop and
    // the turret never ran at all: `ModuleMiniGame.tick()` is only reached from
    // `ModuleArea.update()`, which is only reached from `Module.tick()`, and the
    // one engine mode that owns a minigame was the one mode that never called
    // it. The bike therefore sat on the start line with no heartbeat - and the
    // heartbeat script is the whole race, from the gear countdown to the lap
    // timer - while the turret's guns never came alive.
    if(
      GameState.State == EngineState.PAUSED || GameState.MenuManager.activeModals.length
    ){
      GameState.module.tickPaused(delta);
    }else{
      GameState.module.tick(delta);
    }

    GameState.FadeOverlayManager.Update(delta);
    GameState.updateWorldSystems(delta, GameState.getCurrentPlayer());

    //Handle the visibility of the PAUSE overlay
    GameState.syncPauseOverlay();
  }

  static UpdateFreeLook(delta: number = 0){
    //Update Mode Camera
    GameState.VideoEffectManager.SetVideoEffect(-1);
    const player = GameState.getCurrentPlayer();
    if(player){
      const appearance = player.getAppearance();
      if(appearance){
        const effectId = appearance.freelookeffect;
        if(!isNaN(effectId)){
          GameState.VideoEffectManager.SetVideoEffect(effectId);
        }
      }
    }

    GameState.updateCurrentCameraPosition();

    GameState.updateTime(delta);
    GameState.FadeOverlayManager.Update(delta);
    GameState.updateWorldSystems(delta, GameState.getCurrentPlayer());
  }

  static UpdateLegal(delta: number = 0){
    GameState.LegalScreenManager.Update(delta);
    GameState.renderer.render(this.scene, GameState.camera_gui);
    GameState.processEventListener('afterRender', [delta]);
  }

  static Render(delta: number = 0, frameTimestamp: number = performance.now()){
    /**
     * EffectComposer draws into its own render targets and blits to the default
     * framebuffer, which is not the one XR presents. Bypass it while presenting.
     */
    if(VRSpike.isPresenting){
      // The body to hide is the one the rig is welded to — the creature the
      // player is actually driving, which is `party[0]`. The main-PC slot stays
      // pointed at the story protagonist even after the leader changes, so
      // using it made the renderer hide the character standing across the room
      // while drawing the controlled one into the player's face. Reported from
      // a headset session: switching party member to 3C-FD turned T3-M4
      // invisible. `getControlledActor` already carries this exact meaning.
      //
      // Kept out of the argument list: the suppression test reads this call's
      // text to prove the fixed slot is not used, and prose naming it there
      // would satisfy the search for the very thing it forbids.
      VRSpike.render(
        GameState.currentCamera,
        frameTimestamp,
        GameState.getFirstPersonHiddenBody(),
      );
      return;
    }

    GameState.renderPass.camera = GameState.currentCamera;
    GameState.renderPassAA.camera = GameState.currentCamera;
    GameState.bokehPass.camera = GameState.currentCamera;

    GameState.composer.render(delta);
  }

  static updateTime(delta: number = 0){
    GameState.time += delta;

    if(GameState.deltaTime > 1000)
      GameState.deltaTime = GameState.deltaTime % 1;
  }

  /**
   * Get a screenshot of the current game from the view of the player camera
   * @param width - The width of the screenshot (default: 256)
   * @param height - The height of the screenshot (default: 256)
   * @returns A promise that resolves to a TGAObject
   */
  static async GetScreenShot(width = 256, height = 256): Promise<TGAObject> {

    if (!GameState.lastGameplayThumb) {
      GameState.lastGameplayThumb = new OffscreenCanvas(width, height);
      GameState.lastGameplayThumbCtx = GameState.lastGameplayThumb.getContext('2d')!;
    }else{
      GameState.lastGameplayThumb.width = width;
      GameState.lastGameplayThumb.height = height;
    }

    /**
     * Initialize the render target
     */
    if (!GameState.lastGameplayThumbRT) {
      GameState.lastGameplayThumbRT = new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: true,
        stencilBuffer: false,
      });
    }else{
      GameState.lastGameplayThumbRT.setSize(width, height);
      GameState.lastGameplayThumbRT.texture.needsUpdate = true;
    }

    // Render WORLD ONLY into a tiny RT
    const prevRT = GameState.renderer.getRenderTarget();
    GameState.renderer.setRenderTarget(GameState.lastGameplayThumbRT);
    GameState.renderer.clear(true, true, true);
    GameState.renderer.render(GameState.scene, GameState.camera); // gameplay world camera
    GameState.renderer.setRenderTarget(prevRT);

    // Read pixels (small 256x256 so this is quick)
    const pixels = new Uint8Array(width * height * 4);
    GameState.renderer.readRenderTargetPixels(GameState.lastGameplayThumbRT, 0, 0, width, height, pixels);

    // Flip Y + force alpha
    const flipped = new Uint8ClampedArray(pixels.length);
    const rowBytes = width * 4;
    for (let y = 0; y < height; y++) {
      const src = (width - 1 - y) * rowBytes;
      const dst = y * rowBytes;
      flipped.set(pixels.subarray(src, src + rowBytes), dst);
    }
    for (let i = 3; i < flipped.length; i += 4) flipped[i] = 255;

    // Store into the cached canvas
    GameState.lastGameplayThumbCtx!.putImageData(new ImageData(flipped, width, height), 0, 0);

    // Prefer the last clean gameplay frame (pre-menu)
    if (GameState.lastGameplayThumb) {
      return TGAObject.FromCanvas(GameState.lastGameplayThumb);
    }

    // Fallback: if no cached frame exists yet, grab current frame
    const bmp = await createImageBitmap(GameState.canvas);
    const ssCanvas = new OffscreenCanvas(width, height);
    const ctx = ssCanvas.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0, width, height);
    return TGAObject.FromCanvas(ssCanvas);
  }

}
