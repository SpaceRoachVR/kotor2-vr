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
} from "@/vr/runtime/LegacyGUIVRPointerAdapter";
import { VRContextActionPanelController } from "@/vr/runtime/VRContextActionPanelController";
import { tryDirectVRWorldUse } from "@/vr/runtime/VRWorldUseAdapter";
import type { EngineInteractableObject } from "@/vr/runtime/ModuleObjectInteractionTarget";
import type { CombatWeaponMode } from "@/vr/runtime/XRTypes";

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
const vrContextActionPanelController = new VRContextActionPanelController({
  triggerControllerAPress: () => GameState.MenuManager.InGameOverlay.triggerControllerAPress(),
  triggerControllerBPress: () => GameState.MenuManager.InGameOverlay.triggerControllerBPress(),
  triggerControllerXPress: () => GameState.MenuManager.InGameOverlay.triggerControllerXPress(),
  triggerControllerYPress: () => GameState.MenuManager.InGameOverlay.triggerControllerYPress(),
});
let vrContextActionTarget: EngineInteractableObject | null = null;
let vrRadialMenuPausedByVR = false;
let vrCombatIssuedTargetId: number | null = null;

function isVRCombatTarget(actor: ModuleCreature, candidate: ModuleObject | null | undefined): candidate is ModuleObject {
  return !!candidate && candidate !== actor &&
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
function resolveVRAimedObject(aimedTargetId: number | null): ModuleObject | null {
  if (aimedTargetId === null) return null;
  return GameState.ModuleObjectManager.playerSelectableObjects.find(
    (object) => object.id === aimedTargetId
  ) ?? null;
}

interface VRActionMenuEntry {
  readonly icon?: unknown;
  readonly action?: { readonly type?: unknown };
  readonly talent?: { readonly label?: unknown; readonly name?: unknown };
  readonly item?: { getName?: () => unknown };
}

interface VRActionPanel {
  readonly actions: readonly VRActionMenuEntry[];
  selectedIndex: number;
}

function getVRActionLabel(entry: VRActionMenuEntry, target: ModuleObject | null): string {
  const talentLabel = entry.talent?.label ?? entry.talent?.name;
  if (typeof talentLabel === 'string' && talentLabel.trim()) return toPlayerFacingActionLabel(talentLabel);
  const itemName = entry.item?.getName?.();
  if (typeof itemName === 'string' && itemName.trim()) return toPlayerFacingActionLabel(itemName);
  const icon = typeof entry.icon === 'string' ? entry.icon.toLowerCase() : '';
  if (icon.includes('attack')) return (target?.objectType & ModuleObjectType.ModuleDoor) !== 0 ? 'Bash' : 'Attack';
  if (icon.includes('security') || icon.includes('unlock')) return 'Security';
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

function buildVRRadialItems(
  panels: { readonly targetPanels: readonly VRActionPanel[]; readonly selfPanels: readonly VRActionPanel[] },
  target: ModuleObject | null
): readonly import('./vr/runtime/VRRadialMenuController').VRRadialMenuItem[] {
  const candidates: Array<{
    readonly entry: VRActionMenuEntry;
    readonly activate: () => void;
  }> = [];
  panels.targetPanels.forEach((panel, panelIndex) => {
    panel.actions.forEach((entry, actionIndex) => {
      candidates.push({
        entry,
        activate: () => {
          panel.selectedIndex = actionIndex;
          GameState.ActionMenuManager.onTargetMenuAction(panelIndex);
        },
      });
    });
  });
  // Self actions, including Force powers, are deliberately radial-only in VR.
  panels.selfPanels.forEach((panel, panelIndex) => {
    panel.actions.forEach((entry, actionIndex) => {
      candidates.push({
        entry,
        activate: () => {
          panel.selectedIndex = actionIndex;
          GameState.ActionMenuManager.onSelfMenuAction(panelIndex);
        },
      });
    });
  });
  const items = candidates.slice(0, 4).map(({ entry, activate }, index) => ({
    id: `action-${index}`,
    label: getVRActionLabel(entry, target),
    icon: getVRActionIcon(entry),
    activate,
  }));
  while (items.length < 4) {
    items.push({ id: `unavailable-${items.length}`, label: 'No action', activate: (): void => {} });
  }
  return items;
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

function findVRForceGestureSpell(actor: ModuleCreature, kind: 'push' | 'pull'): TalentSpell | null {
  const keyword = kind.toLowerCase();
  return actor.getSpells().find((spell) => {
    const searchable = `${spell.label} ${spell.impactscript} ${spell.iconresref}`.toLowerCase();
    return searchable.includes(keyword);
  }) ?? null;
}
const vrLegacyGUIPointerAdapter = new LegacyGUIVRPointerAdapter({
  getViewportSize: () => ({
    width: GameState.ResolutionManager.getViewportWidth(),
    height: GameState.ResolutionManager.getViewportHeight(),
  }),
  getControlsAtPointer: () => GameState.controls?.MenuGetActiveUIElements() ?? [],
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
        const left = player?.equipment.LEFTHAND?.model;
        const right = player?.equipment.RIGHTHAND?.model;
        return {
          left: left instanceof THREE.Object3D ? left : null,
          right: right instanceof THREE.Object3D ? right : null,
        };
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
      getInteractionContext: () => ({
        actor: GameState.getCurrentPlayer() ?? null,
        // The engine has already removed the player, unusable/open objects,
        // out-of-range objects, and targets without line of sight.
        targets: GameState.ModuleObjectManager.playerSelectableObjects,
        onInteractionIntent: (intent) => {
          const actor = GameState.getCurrentPlayer();
          const target = GameState.ModuleObjectManager.playerSelectableObjects.find(
            (object) => `module-object:${object.id}` === intent.targetId
          );
          if (!actor || !target) {
            vrContextActionTarget = null;
            vrContextActionPanelController.close();
            return;
          }

          const directUseResult = tryDirectVRWorldUse(actor, target);
          if (directUseResult.handled) {
            vrContextActionTarget = null;
            vrContextActionPanelController.close();
            return { feedbackLabel: directUseResult.feedbackLabel };
          }

          GameState.ActionMenuManager.SetPC(actor);
          GameState.ActionMenuManager.SetTarget(target);
          GameState.ActionMenuManager.UpdateMenuActions();
          if (GameState.ActionMenuManager.targetActionCount() > 0) {
            vrContextActionTarget = target;
            vrContextActionPanelController.open(intent.targetId);
          } else {
            vrContextActionTarget = null;
            vrContextActionPanelController.close();
          }
        },
      }),
      getCombatContext: (aimedTargetId) => {
        const actor = GameState.getCurrentPlayer();
        if (!actor) return null;
        const candidate = resolveVRAimedObject(aimedTargetId);
        const target = isVRCombatTarget(actor, candidate) ? candidate : null;
        return {
          actorId: String(actor.id),
          nominatedTargetId: target ? String(target.id) : null,
          weaponMode: resolveVRCombatWeaponMode(actor),
          onCombatSwing: (event) => {
            // The controller layer can animate all physical swings, but never
            // creates damage. Only a cadence-authorized event aimed at the
            // current engine target enters the normal CombatRound pipeline.
            if (!event.rollEligible || !target || event.nominatedTargetId !== String(target.id)) return;
            actor.attackCreature(target);
            vrCombatIssuedTargetId = target.id;
          },
          cancel: () => {
            if (vrCombatIssuedTargetId === null) return;
            actor.combatRound.clearActions();
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
      getRadialMenuContext: (aimedTargetId) => {
        const actor = GameState.getCurrentPlayer();
        const target = resolveVRAimedObject(aimedTargetId);
        if (actor && target && target !== actor) {
          GameState.ActionMenuManager.SetPC(actor);
          GameState.ActionMenuManager.SetTarget(target);
          GameState.ActionMenuManager.UpdateMenuActions();
        }
        const panels = GameState.ActionMenuManager.ActionPanels;
        return {
          items: buildVRRadialItems(panels, target ?? null),
          setPaused: (paused: boolean) => {
          if (paused && GameState.State !== EngineState.PAUSED) {
            GameState.State = EngineState.PAUSED;
            vrRadialMenuPausedByVR = true;
          } else if (!paused && vrRadialMenuPausedByVR) {
            GameState.State = EngineState.RUNNING;
            vrRadialMenuPausedByVR = false;
          }
        },
        };
      },
      getPanelContext: () => {
        const foregroundMenu = GameState.MenuManager.GetForegroundMenu();
        let menu = foregroundMenu?.bVisible && foregroundMenu !== GameState.MenuManager.InGameOverlay
          ? foregroundMenu
          : null;
        if (menu) {
          vrContextActionTarget = null;
          vrContextActionPanelController.close();
        } else if (vrContextActionTarget) {
          const targetId = `module-object:${vrContextActionTarget.id}`;
          const targetIsAvailable = GameState.ModuleObjectManager.playerSelectableObjects.includes(
            vrContextActionTarget as ModuleObject
          );
          menu = targetIsAvailable
            ? vrContextActionPanelController.resolve(
              targetId,
              GameState.ActionMenuManager.targetActionCount() > 0
            )
            : null;
          if (!menu) vrContextActionTarget = null;
        }
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
        const control = GameState.MenuManager.activeGUIElement as {
          editable?: unknown;
          onKeyDown?: unknown;
          menu?: { triggerControllerBPress?: () => void };
        } | undefined;
        return control?.editable === true && typeof control.onKeyDown === 'function'
          ? {
            onKeyDown: control.onKeyDown as (event: { readonly which: number; readonly shiftKey: boolean }) => void,
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
          name: object.getName(),
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
        TextureType.TEXTURE
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
    GameState.ResolutionManager.recalculate();
    let width = GameState.ResolutionManager.getViewportWidth();
    let height = GameState.ResolutionManager.getViewportHeight();

    GameState.composer.setSize(width * GameState.rendererUpscaleFactor, height * GameState.rendererUpscaleFactor);

    GameState.FadeOverlayManager.plane.scale.set(width, height, 1);

    GameState.VideoManager.resize(width, height);

    GameState.camera_gui.left = width / -2;
    GameState.camera_gui.right = width / 2;
    GameState.camera_gui.top = height / 2;
    GameState.camera_gui.bottom = height / -2;

    GameState.camera_gui.updateProjectionMatrix();

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

    //GameState.bokehPass.renderTargetColor.setSize(width * GameState.rendererUpscaleFactor, height * GameState.rendererUpscaleFactor);

    GameState.screenCenter.x = ( (GameState.ResolutionManager.getViewportWidth()/2) / GameState.ResolutionManager.getViewportWidth() ) * 2 - 1;
    GameState.screenCenter.y = - ( (GameState.ResolutionManager.getViewportHeight()/2) / GameState.ResolutionManager.getViewportHeight() ) * 2 + 1; 

    GameState.MenuManager.Resize();

    GameState.depthTarget.setSize(GameState.ResolutionManager.getViewportWidth() * GameState.rendererUpscaleFactor, GameState.ResolutionManager.getViewportHeight() * GameState.rendererUpscaleFactor);

    if(GameState.ResolutionManager.vpScaleFactor){
      GameState.canvas.style.transform = 'scale('+GameState.ResolutionManager.vpScaleFactor+')';
    }else{
      GameState.canvas.style.transform = '';
    }

  }

  static updateRendererUpscaleFactor(){
    this.EventOnResize();
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
    GameState.frustumMat4.multiplyMatrices( GameState.currentCamera.projectionMatrix, GameState.currentCamera.matrixWorldInverse )
    GameState.viewportFrustum.setFromProjectionMatrix(GameState.frustumMat4);
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
    GameState.frustumMat4.multiplyMatrices( GameState.currentCamera.projectionMatrix, GameState.currentCamera.matrixWorldInverse )
    GameState.viewportFrustum.setFromProjectionMatrix(GameState.frustumMat4);
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
    GameState.frustumMat4.multiplyMatrices( GameState.currentCamera.projectionMatrix, GameState.currentCamera.matrixWorldInverse )
    GameState.viewportFrustum.setFromProjectionMatrix(GameState.frustumMat4);
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

    GameState.frustumMat4.multiplyMatrices( GameState.currentCamera.projectionMatrix, GameState.currentCamera.matrixWorldInverse )
    GameState.viewportFrustum.setFromProjectionMatrix(GameState.frustumMat4);
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
