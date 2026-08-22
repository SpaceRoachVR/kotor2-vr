import * as THREE from "three";
import {
  AppearanceManager, AutoPauseManager, TLKManager, CharGenManager, CheatConsoleManager, CameraShakeManager, ConfigManager, CursorManager, DialogMessageManager,
  FadeOverlayManager, FeedbackMessageManager, GlobalVariableManager, InventoryManager, JournalManager, LightManager, WindManager, MenuManager, ModuleObjectManager, PartyManager,
  ResolutionManager, ShaderManager, TwoDAManager, FactionManager,
  VideoEffectManager, VideoManager, PazaakManager, UINotificationManager, CutsceneManager, LegalScreenManager, EventManager
} from "@/managers";

import type { SWRuleSet } from "@/engine/rules/SWRuleSet";

import type { TalentObject, TalentFeat, TalentSkill, TalentSpell } from "@/talents";
import type { ModuleObject, ModuleCreature, Module, ModuleDoor } from "@/module";
import type { NWScript } from "@/nwscript/NWScript";
import type { SaveGame } from "@/engine/SaveGame";
import type { GameEffectFactory } from "@/effects/GameEffectFactory";
import type { GameEventFactory } from "@/events/GameEventFactory";

import type { ActionMenuManager } from "@/engine/menu/ActionMenuManager";
import type { ActionFactory } from "@/actions/ActionFactory";

import { IngameControls } from "@/controls/IngameControls";
import { Mouse } from "@/controls/Mouse";

import { INIConfig } from "@/engine/INIConfig";

// import { OdysseyObject3D } from "@/three/odyssey";
import { AudioEngine, AudioEmitter } from "@/audio";
import { TGAObject } from "@/resource/TGAObject";

import { IGameStateGroups } from "@/interface/engine/IGameStateGroups";
import { ITextureLoaderQueuedRef } from "@/interface/loaders/ITextureLoaderQueuedRef";

import { AudioEngineChannel } from "@/enums/audio/AudioEngineChannel";
import { AudioPriorityGroup } from "@/enums/audio/AudioPriorityGroup";
import { EngineState, EngineMode, GameEngineType, GameEngineEnv, EngineDebugType } from "@/enums/engine";
import { TextureType } from "@/enums/loaders/TextureType";

import { EngineContext } from "@/engine/EngineContext";

import { ConfigClient } from "@/utility/ConfigClient";
import { FollowerCamera } from "@/engine/FollowerCamera";
import { OdysseyShaderPass } from "@/shaders/pass/OdysseyShaderPass";
import { ResourceLoader, TextureLoader } from "@/loaders";
import { VRSpike } from "@/vr/VRSpike";
import { EngineFrameSource, shouldProcessEngineFrame } from "@/vr/XRFrameCadence";
import { CreatureLocomotionAdapter } from "@/vr/runtime/CreatureLocomotionAdapter";
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
import type { CombatWeaponMode, VRComfortSettings } from "@/vr/runtime/XRTypes";
import type { HeldItemClassFallbackTransform, HeldItemVisualDescriptor } from "@/vr/runtime/XRControllerAnchorHost";
import { BaseItemType } from "@/enums/combat/BaseItemType";
import type { VRComfortSettingsRow } from "@/vr/runtime/VRComfortSettingsHost";
import {
  buildVRActionWheel,
} from "@/vr/runtime/VRActionWheelModelBuilder";
import type {
  VRActionMenuEntry,
  VRActionWheelPartyMember,
} from "@/vr/runtime/VRActionWheelModelBuilder";
import {
  snapshotVRActionMenuPanelEntries,
} from "@/vr/runtime/VRActionMenuEngineBridge";
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
import { canAttemptSecurityUnlock } from "@/engine/interaction/ObjectLockRules";
import { shouldAutoCancelNonCreatureCombat } from "@/engine/interaction/CombatCancellationRules";

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

const vrCreatureLocomotionAdapter = new CreatureLocomotionAdapter(TURN_SPEED_FAST);
let vrCombatIssuedTargetId: number | null = null;
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
};
let vrComfortSettingsPanelOpen = false;
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
  return actor.isRangedEquipped() ? 15.0 : 2.0;
}

function isWithinVRCombatRange(actor: ModuleCreature, target: ModuleObject): boolean {
  return Math.hypot(
    actor.position.x - target.position.x,
    actor.position.y - target.position.y
  ) <= resolveVRCombatRange(actor);
}

function resolveVRAimedObject(aimedTargetId: number | null): ModuleObject | null {
  if (aimedTargetId === null) return null;
  return GameState.ModuleObjectManager.playerSelectableObjects.find(
    (object) => object.id === aimedTargetId
  ) ?? null;
}

function getVRActionLabel(entry: VRActionMenuEntry, target: ModuleObject | null): string {
  const talentLabel = entry.talent?.label ?? entry.talent?.name;
  if (typeof talentLabel === 'string' && talentLabel.trim()) return toPlayerFacingActionLabel(talentLabel);
  const itemName = entry.item?.getName?.();
  if (typeof itemName === 'string' && itemName.trim()) return toPlayerFacingActionLabel(itemName);
  const icon = typeof entry.icon === 'string' ? entry.icon.toLowerCase() : '';
  if (icon.includes('attack')) return (target?.objectType & ModuleObjectType.ModuleDoor) !== 0 ? 'Bash' : 'Attack';
  if (icon.includes('security') || icon.includes('unlock') || /(^|_)sec/.test(icon)) return 'Security';
  if (icon.includes('dismine')) return 'Disarm';
  if (icon.includes('recmine')) return 'Recover';
  if (icon.includes('mine')) return 'Mine';
  return 'Action';
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
  getPlayerFacingLabel: (entry, target) => getVRActionLabel(entry, target),
  getIcon: (entry) => getVRActionIcon(entry),
  logger: console,
  onTargetMenuAction: (panelIndex) => GameState.ActionMenuManager.onTargetMenuAction(panelIndex),
  onSelfMenuAction: (panelIndex) => GameState.ActionMenuManager.onSelfMenuAction(panelIndex),
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
  if (isDirectVRWorldUseTarget(target)) {
    const descriptor = describeDirectVRWorldUse(actor, target, console, {
      authoredActionCount,
      getLiveAuthoredActionCount: () => {
        if (!isLiveVRWorldPromptCandidate(actor, target, candidate)) return 1;
        const livePanels = refreshVRWorldPromptPanels(actor, target);
        return livePanels ? countVRWorldPromptTargetActions(livePanels.targetPanels) : 1;
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
    const hasActions = hasPotentialVRWorldPromptActions(actorActionState, target);
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
    const supportedType = (target.objectType & (
      ModuleObjectType.ModuleDoor |
      ModuleObjectType.ModulePlaceable |
      ModuleObjectType.ModuleTrigger
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

function hasPotentialVRWorldPromptActions(
  actorState: VRWorldPromptActorActionState,
  target: ModuleObject,
): boolean {
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
  const securitySkill = readVRActorSkill(actor, SkillType.SECURITY);
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

function snapshotVRPartyMembers(): readonly VRActionWheelPartyMember[] {
  return GameState.PartyManager.party.slice(1).map((member) => ({
    id: String(member.id),
    label: member.getName(),
    icon: member.getPortraitResRef() || undefined,
    resolveCurrentIndex: () => GameState.PartyManager.party.indexOf(member),
    switchLeader: (index: number) => GameState.PartyManager.SwitchLeaderAtIndex(index),
  }));
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

function resolveHeldItemClassFallback(item: VREquippedHeldItem): HeldItemClassFallbackTransform {
  const baseItemId = typeof item.baseItemId === 'number' ? item.baseItemId : -1;
  const itemClass = typeof item.baseItem?.itemClass === 'string'
    ? item.baseItem.itemClass.toLocaleLowerCase()
    : '';
  const isLightsaber = baseItemId === BaseItemType.LIGHTSABER ||
    baseItemId === BaseItemType.DOUBLE_BLADED_LIGHTSABER ||
    baseItemId === BaseItemType.SHORT_LIGHTSABER ||
    itemClass.includes('lghtsbr');
  const isBlaster = item.baseItem?.rangedWeapon === true || itemClass.includes('blaster') ||
    (baseItemId >= BaseItemType.BLASTER_PISTOL && baseItemId <= BaseItemType.HEAVY_REPEATING_BLASTER) ||
    baseItemId === BaseItemType.BLASTER_RIFLE;

  if (isLightsaber) {
    return {
      position: new THREE.Vector3(0, -0.015, -0.065),
      rotation: new THREE.Euler(0, 0, -Math.PI / 2),
      scale: 0.012,
    };
  }
  if (isBlaster) {
    return {
      position: new THREE.Vector3(0.035, -0.02, -0.09),
      rotation: new THREE.Euler(0, Math.PI / 2, 0),
      scale: 0.012,
    };
  }
  return {
    position: new THREE.Vector3(0, -0.02, -0.06),
    rotation: new THREE.Euler(0, 0, 0),
    scale: 0.01,
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

function findVRForceGestureSpell(actor: ModuleCreature, kind: 'push' | 'pull'): TalentSpell | null {
  const keyword = kind.toLowerCase();
  return actor.getSpells().find((spell) => {
    const searchable = `${spell.label} ${spell.impactscript} ${spell.iconresref}`.toLowerCase();
    return searchable.includes(keyword);
  }) ?? null;
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
});

export class GameState implements EngineContext {

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
  static maxSelectableDistanceSquared = GameState.maxSelectableDistance * GameState.maxSelectableDistance;

  static delta: number = 0;

  static SaveGame: SaveGame;
  
  static currentGamepad: Gamepad;
  static videoEffect: number = -1;
  static onScreenShot?: Function;
  static time: number = 0;
  static deltaTime: number = 0;
  static deltaTimeFixed: number = 0;

  static canvas: HTMLCanvasElement;
  static context: WebGLRenderingContext;
  static rendererUpscaleFactor: number;
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
    GameState.context = GameState.canvas.getContext( 'webgl' );

    GameState.rendererUpscaleFactor = 1;
    GameState.renderer = new THREE.WebGLRenderer({
      antialias: false,
      canvas: GameState.canvas,
      context: GameState.context,
      logarithmicDepthBuffer: true,
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

    /**
     * Phase 0.1 stereo perf spike. Async and deliberately not awaited — it only
     * promotes the GL context and adds a button, and nothing downstream depends
     * on it. If there is no WebXR runtime it logs and does nothing.
     */
    VRSpike.install(GameState.renderer, GameState.scene, {
      update: (timestamp, source) => GameState.Update(timestamp, source),
      getPlayerPosition: () => GameState.getCurrentPlayer()?.position ?? null,
      getFacing: () => FollowerCamera.facing,
      getPlayerFacing: () => GameState.getCurrentPlayer()?.rotation.z ?? null,
      getHeldVisuals: () => {
        const player = GameState.getCurrentPlayer();
        return describeVRHeldItemVisuals(player?.equipment);
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
      getCurrentRoomWalkmesh: () => GameState.getCurrentPlayer()?.room?.collisionManager?.walkmesh ?? null,
      getComfortSettings: () => ({ ...vrComfortSettings }),
      setComfortSettings: (patch) => Object.assign(vrComfortSettings, patch),
      // Walk/run already exists on the creature: `getMovementSpeed()` picks
      // between the walkrate and runrate columns of creaturespeed.2da based on
      // `isWalking()`. VR simply had no route to the flag.
      toggleWalkRun: () => {
        const player = GameState.getCurrentPlayer();
        if (!player) return;
        player.walk = !player.walk;
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
      // leader gives the button a real job using the same `SwitchLeaderAtIndex`
      // route the wheel's Party submenu already calls, and the wheel remains
      // the way to pick a *specific* member.
      cyclePartyLeader: () => {
        const members = snapshotVRPartyMembers();
        for (const member of members) {
          const index = member.resolveCurrentIndex();
          if (!Number.isInteger(index) || index <= 0) continue;
          member.switchLeader(index);
          return true;
        }
        return false;
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
        if (!actor) return null;
        const candidate = resolveVRAimedObject(aimedTargetId);
        const target = isVRCombatTarget(actor, candidate) && isWithinVRCombatRange(actor, candidate)
          ? candidate
          : null;
        return {
          actorId: String(actor.id),
          nominatedTargetId: target ? String(target.id) : null,
          weaponMode: resolveVRCombatWeaponMode(actor),
          inCombat: actor.combatData.combatState === true,
          onCombatSwing: (event) => {
            // The controller layer can animate all physical swings, but never
            // creates damage. Only a cadence-authorized event aimed at the
            // current engine target enters the normal CombatRound pipeline.
            if (!event.rollEligible || !target || event.nominatedTargetId !== String(target.id)) return;
            actor.attackCreature(target);
            vrCombatIssuedTargetId = target.id;
          },
          cancel: () => {
            const combatTarget = actor.combatData?.lastAttackTarget;
            if (!shouldAutoCancelNonCreatureCombat(combatTarget)) return;
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
      getForceContext: (aimedTargetId) => {
        const actor = GameState.getCurrentPlayer();
        if (!actor) return null;
        const candidate = resolveVRAimedObject(aimedTargetId);
        const target = isVRCombatTarget(actor, candidate) ? candidate : null;
        return {
          onForceGesture: (gesture) => {
            if (!target) return;
            const spell = findVRForceGestureSpell(actor, gesture.kind);
            if (!spell) return;
            spell.useTalentOnObject(target, actor);
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
          canLevelUp: actor.canLevelUp(),
          partyMembers: snapshotVRPartyMembers(),
          openInventory: () => GameState.MenuManager.MenuInventory.open(),
          openCharacter: () => GameState.MenuManager.MenuCharacter.open(),
          openMap: () => GameState.MenuManager.MenuMap.open(),
          openComfortSettings: () => { vrComfortSettingsPanelOpen = true; },
          // The rest of InGameOverlay's screens (ROADMAP 4.5). Equipment,
          // Abilities, Journal, Messages, and Options had no VR route at all.
          openEquipment: () => GameState.MenuManager.MenuEquipment.open(),
          openAbilities: () => GameState.MenuManager.MenuAbilities.open(),
          openJournal: () => GameState.MenuManager.MenuJournal.open(),
          openMessages: () => GameState.MenuManager.MenuMessages.open(),
          openOptions: () => GameState.MenuManager.MenuOptions.open(),
          // BTN_CLEARALL's exact behaviour, offered only when there is
          // something to clear.
          canClearActions: actor.actionQueue.length > 0 ||
            actor.combatData.combatState === true ||
            actor.combatData.combatQueue.length > 0,
          clearQueuedActions: () => {
            const player = GameState.getCurrentPlayer();
            if (!player) return;
            player.clearAllActions();
            player.combatData.combatState = false;
            player.cancelCombat();
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
        const rows: VRComfortSettingsRow[] = [
          {
            label: 'Movement',
            value: vrComfortSettings.locomotionMode === 'smooth' ? 'Smooth' : 'Teleport',
          },
          {
            label: 'Turning',
            value: vrComfortSettings.turnMode === 'smooth' ? 'Smooth' : 'Snap',
          },
          {
            label: 'Snap Turn Angle',
            value: `${vrComfortSettings.snapTurnDegrees}°`,
          },
          {
            label: 'Comfort Vignette',
            value: vrComfortSettings.vignetteEnabled ? 'On' : 'Off',
          },
        ];
        return {
          rows,
          activateRow: (index: number) => {
            switch (index) {
              case 0:
                vrComfortSettings.locomotionMode = vrComfortSettings.locomotionMode === 'smooth' ? 'blink' : 'smooth';
                break;
              case 1:
                vrComfortSettings.turnMode = vrComfortSettings.turnMode === 'smooth' ? 'snap' : 'smooth';
                break;
              case 2: {
                const options = [30, 45, 60, 90] as const;
                const currentIndex = options.indexOf(vrComfortSettings.snapTurnDegrees as typeof options[number]);
                vrComfortSettings.snapTurnDegrees = options[(Math.max(0, currentIndex) + 1) % options.length];
                break;
              }
              case 3:
                vrComfortSettings.vignetteEnabled = !vrComfortSettings.vignetteEnabled;
                break;
            }
          },
          close: () => { vrComfortSettingsPanelOpen = false; },
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
        return {
          menu,
          guiScene: GameState.scene_gui,
          guiCamera: GameState.camera_gui,
          viewportWidth: GameState.ResolutionManager.getViewportWidth(),
          viewportHeight: GameState.ResolutionManager.getViewportHeight(),
          pointerSink: vrLegacyGUIPointerAdapter,
        };
      },
      getMovieContext: () => GameState.VideoManager.isMoviePlaying()
        ? {
          canSkip: GameState.VideoManager.isCurrentMovieSkippable(),
          skip: () => GameState.VideoManager.skipMovie(),
        }
        : null,
      getCutsceneContext: () => {
        const currentEntry = GameState.CutsceneManager.currentEntry;
        return GameState.CutsceneManager.active && !GameState.MenuManager.InGameComputer?.isVisible()
          ? {
            canSkip: currentEntry?.skippable === true,
            skip: () => {
              if (currentEntry) GameState.CutsceneManager.playerSkipEntry(currentEntry);
            },
            abort: () => {
              // Mirrors flatscreen's unconditional DialogAbort
              // (IngameControls.ts, KeyMapAction.DialogAbort) — the escape
              // hatch VR had none of for an authored `NodeUnskippable` entry,
              // which otherwise had no skip button and no way out. Only
              // while there is no reply choice on screen: once
              // repliesShown is true the panel owns input and the player
              // should pick a reply, not have the whole conversation end
              // under them.
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
      getWorldContext: () => {
        const area = GameState.module?.area;
        const player = GameState.getCurrentPlayer();
        const rooms = area?.rooms ?? [];
        return {
          module: GameState.module?.filename ?? area?.name ?? null,
          position: player?.position ?? null,
          room: player?.room?.roomName ?? null,
          roomsVisible: rooms.filter((room) => !!room.model?.visible).length,
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
  static updateViewportFrustum(){
    let cullCamera: THREE.Camera = GameState.currentCamera;
    try {
      const xr = GameState.renderer?.xr;
      if(xr?.isPresenting && typeof xr.getCamera === 'function'){
        const xrCamera = (xr.getCamera as unknown as () => THREE.Camera)();
        if(xrCamera?.projectionMatrix) cullCamera = xrCamera;
      }
    }catch(e){
      // Fall back to the flatscreen camera rather than losing culling entirely.
    }
    GameState.frustumMat4.multiplyMatrices( cullCamera.projectionMatrix, cullCamera.matrixWorldInverse );
    GameState.viewportFrustum.setFromProjectionMatrix(GameState.frustumMat4);
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

      //Remove all cached scripts and kill all running instances
      GameState.NWScript.Reload();

      //Resets all keys to their default state
      GameState.controls.initKeys();

      await GameState.FactionManager.Load();

      const module = await GameState.Module.Load(name, waypoint);
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
      VideoManager.playMovieQueue( async () => {
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
        GameState.module.readyToProcessEvents = true;

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
        GameState.module.area.musicBackgroundPlay();
        GameState.loadingModule = false;
      });
    }catch(e){
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

    GameState.lightManager.clearLights();
    GameState.windManager.clear();

    GameState.CursorManager.selected = undefined;
    GameState.CursorManager.selectedObject = undefined;
    GameState.CursorManager.hovered = undefined;
    GameState.CursorManager.hoveredObject = undefined;

    GameState.staticCameras = [];
    GameState.CutsceneManager.paused = false;

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

    const delta = GameState.clock.getDelta();
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
      return;
    }

    if(GameState.Mode == EngineMode.LEGAL){
      GameState.UpdateLegal(delta);
      return;
    }

    GameState.VideoEffectManager.Update(delta);

    GameState.MenuManager.Update(delta);
    VRSpike.traceStartupStage('menus-complete');
    if(GameState.MenuManager.InGameAreaTransition)
      GameState.MenuManager.InGameAreaTransition.hide();

    if(!GameState.loadingTextures && TextureLoader.queue.length){
      GameState.loadingTextures = true;
      TextureLoader.LoadQueue().then( () => {
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
    VRSpike.traceStartupStage('simulation-complete');

    AudioEngine.GetAudioEngine().update(delta, GameState.currentCamera.position, GameState.currentCamera.rotation, GameState.forwardVector);
    VRSpike.traceStartupStage('audio-complete');

    const renderCpuStart = performance.now();
    VRSpike.traceStartupStage('render-start');
    GameState.Render(delta, timestamp);
    VRSpike.traceStartupStage('render-complete');
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

    //Update Mode Camera
    //Make sure we are using the follower camera while ingame
    GameState.currentCamera = GameState.camera;
    GameState.VideoEffectManager.SetVideoEffect(-1);
    if(GameState.getCurrentPlayer()){
      GameState.forwardVector.copy(GameState.getCurrentPlayer().forceVector).multiplyScalar(100);
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
    GameState.updateViewportFrustum();
    GameState.currentCameraPosition.set(0, 0, 0);
    GameState.currentCameraPosition.applyMatrix4(FollowerCamera.camera.matrix);
    GameState.lightManager.update(delta, GameState.getCurrentPlayer());
    GameState.windManager.update(delta);
    GameState.module.area.updateRoomAnimatedLights(delta);
    GameState.module.area.updateRoomWindUniforms();
    GameState.CameraShakeManager.update(delta, GameState.currentCamera);
    
    //Handle the visibility of the PAUSE overlay
    if(GameState.State == EngineState.PAUSED && GameState.MenuManager.InGameOverlay.isVisible()){
      if(!GameState.MenuManager.InGamePause.isVisible())
        GameState.MenuManager.InGamePause.show();
    }else{
      if(GameState.MenuManager.InGamePause.isVisible())
        GameState.MenuManager.InGamePause.hide();
    }
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
    GameState.updateViewportFrustum();
    GameState.currentCameraPosition.set(0, 0, 0);
    GameState.currentCameraPosition.applyMatrix4(FollowerCamera.camera.matrix);
    GameState.lightManager.update(delta, GameState.currentCamera);
    GameState.windManager.update(delta);
    GameState.module.area.updateRoomAnimatedLights(delta);
    GameState.module.area.updateRoomWindUniforms();
    GameState.CameraShakeManager.update(delta, GameState.currentCamera);
    
    //Handle the visibility of the PAUSE overlay
    if(GameState.State == EngineState.PAUSED && GameState.MenuManager.InGameOverlay.isVisible()){
      if(!GameState.MenuManager.InGamePause.isVisible())
        GameState.MenuManager.InGamePause.show();
    }else{
      if(GameState.MenuManager.InGamePause.isVisible())
        GameState.MenuManager.InGamePause.hide();
    }
  }

  static UpdateMinigame(delta: number = 0){
    GameState.updateViewportFrustum();
    GameState.currentCameraPosition.set(0, 0, 0);
    GameState.currentCameraPosition.applyMatrix4(FollowerCamera.camera.matrix);

    GameState.updateTime(delta);
    GameState.FadeOverlayManager.Update(delta);
    GameState.lightManager.update(delta, GameState.getCurrentPlayer());
    GameState.windManager.update(delta);
    GameState.module.area.updateRoomAnimatedLights(delta);
    GameState.module.area.updateRoomWindUniforms();
    GameState.CameraShakeManager.update(delta, GameState.currentCamera);

    //Handle the visibility of the PAUSE overlay
    if(GameState.State == EngineState.PAUSED && GameState.MenuManager.InGameOverlay.isVisible()){
      if(!GameState.MenuManager.InGamePause.isVisible())
        GameState.MenuManager.InGamePause.show();
    }else{
      if(GameState.MenuManager.InGamePause.isVisible())
        GameState.MenuManager.InGamePause.hide();
    }
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

    GameState.updateViewportFrustum();
    GameState.currentCameraPosition.set(0, 0, 0);
    GameState.currentCameraPosition.applyMatrix4(FollowerCamera.camera.matrix);

    GameState.updateTime(delta);
    GameState.FadeOverlayManager.Update(delta);
    GameState.lightManager.update(delta, GameState.getCurrentPlayer());
    GameState.windManager.update(delta);
    GameState.module.area.updateRoomAnimatedLights(delta);
    GameState.module.area.updateRoomWindUniforms();
    GameState.CameraShakeManager.update(delta, GameState.currentCamera);
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
      VRSpike.render(GameState.currentCamera, frameTimestamp);
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
