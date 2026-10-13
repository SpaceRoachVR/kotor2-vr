import { CombatRound } from "@/combat/CombatRound";
import { ModuleObjectType, SSFType } from "@/enums";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import { ActionStatus } from "@/enums/actions/ActionStatus";
import { ActionType } from "@/enums/actions/ActionType";
import { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";
import { GameState } from "@/GameState";
import type { ModuleCreature } from "@/module/ModuleCreature";
import type { ModuleObject } from "@/module/ModuleObject";
import { BitWise } from "@/utility/BitWise";
import { Utility } from "@/utility/Utility";
import { Action } from "@/actions/Action";
import * as THREE from 'three';
import { TURN_SPEED_FAST } from "@/engine/TurnSpeeds";
import {
  canExecuteObjectDestruction,
  isObjectDestructionTarget,
} from "@/engine/interaction/ObjectLockRules";
import { ActionApproachPolicy } from "@/engine/interaction/ActionApproachPolicy";
import { pickMeleeSpot, planMeleeApproach } from "@/combat/meleeApproach";

/**
 * ActionPhysicalAttacks class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file ActionPhysicalAttacks.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class ActionPhysicalAttacks extends Action {

  constructor( actionId: number = -1, groupId: number = -1 ){
    super(actionId, groupId);
    this.type = ActionType.ActionPhysicalAttacks;

    //PARAMS
    // 0 - (?)
    // 1 - Target (DWORD)
    // 2 - (?)
    // 3 - AnimationIndex (INT)
    // 4 - AnimationLength (INT)
    // 5 - (?)
    // 6 - (?)
    // 7 - (?)
    // 8 - (?)
    // 9 - (?)
  }

  update(delta: number = 0): ActionStatus {
    
    this.target = this.getParameter<ModuleObject>(1);

    if(!BitWise.InstanceOfObject(this.target, ModuleObjectType.ModuleObject)){
      return ActionStatus.FAILED;
    }

    if(!BitWise.InstanceOfObject(this.owner, ModuleObjectType.ModuleCreature)){
      return ActionStatus.FAILED;
    }

    if (isObjectDestructionTarget(this.target) && !canExecuteObjectDestruction(this.target)) {
      return ActionStatus.FAILED;
    }

    const owner: ModuleCreature = this.owner as any;
    const target: ModuleCreature = this.target as any;

    owner.resetExcitedDuration();
    let range = ( owner.isRangedEquipped() ? 15.0 : 2.0 );

    if(target.isDead()){
      //todo: we may need to end combatround early here if it has already started
      return ActionStatus.FAILED;
    }else{
      let distance = Utility.Distance2D(owner.position, target.position);
      const approachSuppressed = ActionApproachPolicy.isApproachSuppressedFor(this.owner);
      // Melee attackers take an open spot around their target (retail); a
      // host crowd policy may send one to another defender, or keep it off
      // until there is room. Decided before a round begins, never during one.
      const melee = !owner.isRangedEquipped() && BitWise.InstanceOfObject(target, ModuleObjectType.ModuleCreature);
      const meleeStep = melee && !approachSuppressed && !owner.combatRound?.roundStarted &&
        !(distance <= range && target.holdsMeleeSpot(owner)) ? planMeleeApproach(owner, target, this) : undefined;
      if(meleeStep?.kind == 'retargeted' || meleeStep?.kind == 'wait'){
        return ActionStatus.IN_PROGRESS;
      }
      // VR owns the player's position; walking them to the target drags them
      // through the world. Actor-scoped so party and NPC movement is untouched.
      if( (distance > range && !approachSuppressed) || meleeStep?.kind == 'backoff' ){

        owner.openSpot = undefined;
        let target_position = target.position.clone();
        let stopWithin = 0;
        let arriveWithin = range;

        if(meleeStep?.kind == 'backoff'){
          target_position.set(meleeStep.point.x, meleeStep.point.y, target_position.z);
          arriveWithin = 0.25;
        }else if(meleeStep?.kind == 'close'){
          stopWithin = meleeStep.stopWithin;
        }else if(melee){
          owner.openSpot = pickMeleeSpot(owner, target, this);
          if(typeof owner.openSpot != 'undefined'){
            target_position.copy(owner.openSpot.targetVector);
            // Into reach on the way: the spot sets the side it comes from.
            stopWithin = Math.max(owner.openSpot.radius + 0.25, range - 0.1);
            arriveWithin = 0.25;
          }
        }

        let actionMoveToTarget = new GameState.ActionFactory.ActionMoveToPoint(this.groupId);
        actionMoveToTarget.setParameter(0, ActionParameterType.FLOAT, target_position.x);
        actionMoveToTarget.setParameter(1, ActionParameterType.FLOAT, target_position.y);
        actionMoveToTarget.setParameter(2, ActionParameterType.FLOAT, target_position.z);
        actionMoveToTarget.setParameter(3, ActionParameterType.DWORD, target.area.id);
        actionMoveToTarget.setParameter(4, ActionParameterType.DWORD, target.id);
        actionMoveToTarget.setParameter(5, ActionParameterType.INT, 1);
        actionMoveToTarget.setParameter(6, ActionParameterType.FLOAT, arriveWithin );
        actionMoveToTarget.setParameter(7, ActionParameterType.INT, 0);
        actionMoveToTarget.setParameter(8, ActionParameterType.FLOAT, 30.0);
        actionMoveToTarget.stopWithin = stopWithin;
        owner.actionQueue.addFront(actionMoveToTarget);

        return ActionStatus.IN_PROGRESS;
      }else{
        // VR moves the player from the stick, which sets force every frame; zeroing it here rooted a player strafing while an attack or cast waited for its round (critic run 4).
        if(!approachSuppressed){
          owner.force = 0;
          owner.speed = 0;
        }

        if(!owner.combatRound){
          return ActionStatus.FAILED;
        }

        // In reach without a spot (it started close): take one, so it counts.
        if(melee && !target.holdsMeleeSpot(owner)){
          owner.openSpot = target.getClosesetOpenSpot(owner);
        }

        const combatRound = owner.combatRound;
        if(!combatRound.roundPaused) {

          if( !combatRound.engaged ){ //non dueling round
            combatRound.beginCombatRound();
            combatRound.pauseRound(owner, CombatRound.ROUND_LENGTH);
            if(combatRound.action){
              combatRound.action.animation = ModuleCreatureAnimState.ATTACK;
            }

          }else{ //dueling round
            combatRound.beginCombatRound();
            if(combatRound.action){
              combatRound.action.animation = ModuleCreatureAnimState.ATTACK_DUELING;
            }
            combatRound.pauseRound(owner, CombatRound.ROUND_LENGTH);

            if(combatRound.master){
              target.combatRound.beginCombatRound();
              target.combatRound.pauseRound(owner, CombatRound.ROUND_LENGTH/2);
              if(target.combatRound.action){
                target.combatRound.action.animation = ModuleCreatureAnimState.ATTACK_DUELING;
              }
            }

          }

          if(combatRound.roundStarted){

            if(BitWise.InstanceOfObject(combatRound.newAttackTarget, ModuleObjectType.ModuleObject)){
              combatRound.setAttackTarget(combatRound.newAttackTarget);
            }

            combatRound.calculateAttackDamage(owner, combatRound.action);

            owner.setFacing(
              Math.atan2(
                owner.position.y - target.position.y,
                owner.position.x - target.position.x
              ) + Math.PI/2,
              false,
              TURN_SPEED_FAST
            );

            // Every attack voices a line unless the host picked a sparser
            // policy (AttackBarkGate); the attack itself is unchanged.
            if(GameState.attackBarkGate.shouldBark(owner, performance.now(), GameState.attackBarkPolicy?.(owner) ?? undefined)){
              const attack_sound = THREE.MathUtils.randInt(0, 2);
              switch(attack_sound){
                case 1:
                  owner.playSoundSet(SSFType.ATTACK_2);
                break;
                case 2:
                  owner.playSoundSet(SSFType.ATTACK_3);
                break;
                default:
                  owner.playSoundSet(SSFType.ATTACK_1);
                break;
              }
            }

            return ActionStatus.COMPLETE;
          }

        }
        return ActionStatus.IN_PROGRESS;
      }
    }
  }

}
