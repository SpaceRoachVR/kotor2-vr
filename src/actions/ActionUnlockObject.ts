import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import { ActionStatus } from "@/enums/actions/ActionStatus";
import { ActionType } from "@/enums/actions/ActionType";
import { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";
import { GameState } from "@/GameState";
import { SSFType } from "@/enums/resource/SSFType";
import { Utility } from "@/utility/Utility";
import { Action } from "@/actions/Action";
import { BitWise } from "@/utility/BitWise";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
// import type { ModulePlaceable } from "@/module/ModulePlaceable";
// import type { ModuleDoor } from "@/module/ModuleDoor";
import type { ModuleItem } from "@/module/ModuleItem";
import type { ModuleObject } from "@/module/ModuleObject";
import { SkillType } from "@/enums/nwscript/SkillType";
import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";
import { ModuleItemProperty } from "@/enums/module/ModuleItemProperty";
import { SignalEventType } from "@/enums/events/SignalEventType";
import { canAttemptSecurityUnlock } from "@/engine/interaction/ObjectLockRules";
import { ActionApproachPolicy } from "@/engine/interaction/ActionApproachPolicy";

/** How long a security tunneler's Security bonus lasts: long enough for the 1.5 s pick. */
const TUNNELER_BONUS_SECONDS = 3;

/**
 * ActionUnlockObject class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file ActionUnlockObject.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class ActionUnlockObject extends Action {
  timer: number;
  shouted: boolean;
  usedItem: boolean;
  oItem: ModuleItem;
  failureSignalled: boolean = false;
  lockpickStarted: boolean = false;

  constructor( actionId: number = -1, groupId: number = -1 ){
    super(actionId, groupId);
    this.type = ActionType.ActionUnlockObject;
    this.timer = 1.5;

    //PARAMS
    // 0 - dword: object id
    // 1 - dword: item id (security tunneler)
    
  }

  update(delta: number = 0): ActionStatus {
    this.target = this.getParameter<ModuleObject>(0);
    this.oItem = this.getParameter<ModuleItem>(1);

    if(!BitWise.InstanceOfObject(this.target, ModuleObjectType.ModuleDoor) && !BitWise.InstanceOfObject(this.target, ModuleObjectType.ModulePlaceable))
      return ActionStatus.FAILED;

    if(BitWise.InstanceOfObject(this.owner, ModuleObjectType.ModuleDoor) || BitWise.InstanceOfObject(this.owner, ModuleObjectType.ModulePlaceable)){
      return ActionStatus.FAILED;
    }

    const lockTarget = this.target as ModuleObject & {
      isLocked(): boolean;
      lockable: boolean;
      keyRequired: boolean;
    };
    if(!canAttemptSecurityUnlock({
      locked: lockTarget.isLocked(),
      lockable: lockTarget.lockable,
      keyRequired: lockTarget.keyRequired,
    })){
      this.signalFailure();
      return ActionStatus.FAILED;
    }
    
    if(!this.shouted){
      this.shouted = true;
      this.owner.playSoundSet(SSFType.UNLOCK);
    }

    let distance = Utility.Distance2D(this.owner.position, this.target.position);
    // VR owns the player's position; walking them to the target drags them
      // through the world. Actor-scoped so party and NPC movement is untouched.
      if(distance > 1.5 &&
        !ActionApproachPolicy.isApproachSuppressedFor(this.owner)){
        
      // this.owner.openSpot = undefined;
      let actionMoveToTarget = new GameState.ActionFactory.ActionMoveToPoint();
      actionMoveToTarget.setParameter(0, ActionParameterType.FLOAT, this.target.position.x);
      actionMoveToTarget.setParameter(1, ActionParameterType.FLOAT, this.target.position.y);
      actionMoveToTarget.setParameter(2, ActionParameterType.FLOAT, this.target.position.z);
      actionMoveToTarget.setParameter(3, ActionParameterType.DWORD, GameState.module.area.id);
      actionMoveToTarget.setParameter(4, ActionParameterType.DWORD, this.target.id);
      actionMoveToTarget.setParameter(5, ActionParameterType.INT, 1);
      actionMoveToTarget.setParameter(6, ActionParameterType.FLOAT, 1.5 );
      actionMoveToTarget.setParameter(7, ActionParameterType.INT, 0);
      actionMoveToTarget.setParameter(8, ActionParameterType.FLOAT, 30.0);
      this.owner.actionQueue.addFront(actionMoveToTarget);

      return ActionStatus.IN_PROGRESS;
    }else{

      if(this.oItem && !this.usedItem){
        for(let i = 0, len = this.oItem.properties.length; i < len; i++){
          let property = this.oItem.properties[i];
          if(!property.isUseable()){ continue; }
    
          if(property.is(ModuleItemProperty.ThievesTools)){
            const effect = new GameState.GameEffectFactory.EffectSkillIncrease();
            effect.setCreator(this.owner);
            effect.setSpellId(-1);
            effect.setInt(0, SkillType.SECURITY);
            effect.setInt(1, property.getValue());
            effect.setInt(2, GameState.SWRuleSet.racialTypeCount);
            // addEffect gives this its duration and expiry. It used to ignore
            // both for an unlinked effect, so this "3 second" bonus never
            // expired and each tunneler stacked another +6 Security for good:
            // a headset run climbed 6 → 12 → 18 → 24 → 42 → 78. See
            // effects/GameEffectDuration.ts.
            this.owner.addEffect(effect.initialize(), GameEffectDurationType.TEMPORARY, TUNNELER_BONUS_SECONDS);
          }
        }
        this.usedItem = true;
      }

      this.owner.setAnimationState(ModuleCreatureAnimState.IDLE);
      // A VR player picks from where they stand and may shuffle while doing it;
      // pinning them in place for 1.5 s reads as the controls locking up. How
      // far they may drift before the pick is abandoned is VR's locomotion
      // policy (retainVRInPlaceSkillActionsWhileMoving), not this action's.
      if(!ActionApproachPolicy.isApproachSuppressedFor(this.owner)){
        this.owner.force = 0;
        this.owner.speed = 0;
      }

      if(BitWise.InstanceOfObject(this.owner, ModuleObjectType.ModuleCreature))
        this.owner.setFacingObject( this.target );

      // The constructor sets `timer`, so this condition was never true and
      // `gui_lockpick` never played. The player therefore got no feedback at
      // all for the 1.5 s this action takes, which is what made Security read
      // as a dead button in a headset session — and pressing again restarted
      // the timer, so trying harder guaranteed it never finished. See
      // ActionQueue.hasEquivalentAction for the measurement.
      if(!this.lockpickStarted){
        this.lockpickStarted = true;
        this.target.audioEmitter.playSound('gui_lockpick');
      }

      if(!this.owner.isSimpleCreature()){
        if(BitWise.InstanceOfObject(this.target, ModuleObjectType.ModuleDoor)){
          this.owner.setAnimationState(ModuleCreatureAnimState.UNLOCK_DOOR);
        }else{
          this.owner.setAnimationState(ModuleCreatureAnimState.UNLOCK_CONTAINER);
        }
      }

      this.timer -= delta;

      if(this.timer <= 0){
        // The queued action owns failure signalling below. Direct NWScript
        // calls retain the target's own failure route, but routing both here
        // would execute OnFailToOpen twice.
        const unlocked = (this.target as any).attemptUnlock(this.owner, false);
        // TEMPORARY (round 7 restart): proves a Security press reached its
        // roll, and with what, for the headset check on Low Security Doors.
        if(ActionApproachPolicy.isApproachSuppressedFor(this.owner)){
          console.info(
            `[VR security] TEMPORARY attempt target='${this.target.getName?.()}' unlocked=${unlocked}` +
            ` security=${this.owner.getSkillLevel?.(SkillType.SECURITY)} int=${(this.owner as any).getINT?.()}` +
            ` inCombat=${!!(this.owner as any).combatData?.combatState}` +
            ` dc=${(this.target as any).openLockDC} tunneler=${!!this.oItem}`
          );
        }
        if(!unlocked){
          this.signalFailure();
        }
        this.consumeTunneler();
        return ActionStatus.COMPLETE;
      }

      return ActionStatus.IN_PROGRESS;
      
    }

    return ActionStatus.FAILED;
  }

  /**
   * Spends one charge of the security tunneler this attempt used.
   *
   * This used to run on every in-progress frame of the 1.5 s pick, so a
   * single-charge tunneler was taken out of the inventory on the first frame —
   * before the roll it was meant to boost — and a multi-charge one was drained
   * in a handful of frames. One attempt costs one charge.
   */
  private consumeTunneler(): void {
    if(!this.oItem) return;
    if(this.oItem.charges > 1){
      this.oItem.charges -= 1;
    }else{
      this.owner.removeItem(this.oItem, 1);
    }
  }

  private signalFailure(): void {
    if (this.failureSignalled) return;
    this.failureSignalled = true;
    const event = new GameState.GameEventFactory.EventSignalEvent();
    event.setCaller(this.getOwner());
    event.setObject(this.target);
    event.setDay(GameState.module.timeManager.pauseDay);
    event.setTime(GameState.module.timeManager.pauseTime);
    event.eventType = SignalEventType.OnFailToOpen;
    GameState.module.addEvent(event);
  }

}
