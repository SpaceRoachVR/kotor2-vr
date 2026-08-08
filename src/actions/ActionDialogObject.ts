import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import { ActionStatus } from "@/enums/actions/ActionStatus";
import { ActionType } from "@/enums/actions/ActionType";
import { EngineMode } from "@/enums/engine/EngineMode";
import { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";
import { ModuleObjectScript } from "@/enums/module/ModuleObjectScript";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { GameState } from "@/GameState";
import type { ModuleObject } from "@/module/ModuleObject";
import { DLGObject } from "@/resource/DLGObject";
import { BitWise } from "@/utility/BitWise";
import { Utility } from "@/utility/Utility";
import { Action } from "@/actions/Action";

/**
 * ActionDialogObject class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file ActionDialogObject.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class ActionDialogObject extends Action {
  validate_conversation_resref: boolean = false;
  conversation: DLGObject;

  constructor( actionId: number = -1, groupId: number = -1 ){
    super(actionId, groupId);
    this.type = ActionType.ActionDialogObject;
    this.clearable = false;

    //PARAMS
    // 0 - dword:   speaker object id
    // 1 - string:  conversation resref
    // 2 - int:     bPrivateConversation 
    // 3 - int:     (?) nConversationType
    // 4 - int:     ignoreStartRange
    // 5 - dword:   (?) listener - `appears to be object_invalid mostly`
    
  }

  update(delta: number = 0): ActionStatus {
    this.target = this.getParameter<ModuleObject>(0);
    let conversation_resref: string = this.getParameter<string>(1) || '';
    let ignoreStartRange = this.getParameter<number>(4) || 0;

    if(!this.validate_conversation_resref){
      this.validate_conversation_resref = true;
      //Record what the script actually asked for versus what the object would
      //supply, so a wrong-conversation bug can be traced to the request rather
      //than guessed at from the dialogue that ends up playing.
      console.log(
        `ActionDialogObject: requested='${conversation_resref || '(none)'}'`,
        `ownerDefault='${(this.owner as any)?.conversation?.resref ?? '(none)'}'`,
        `owner='${this.owner?.getTag ? this.owner.getTag() : '?'}'`,
        `target='${this.target?.getTag ? this.target.getTag() : '?'}'`
      );
      if(conversation_resref){
        this.conversation = DLGObject.FromResRef(conversation_resref);
        if(!this.conversation){
          //FromResRef only consults the module resource cache, so an uncached
          //dialogue resolves to undefined and the calls below silently fall
          //back to the object's default conversation. That plays an entirely
          //different scene with no indication anything went wrong.
          console.warn(
            `ActionDialogObject: could not resolve conversation '${conversation_resref}' - falling back to the default conversation of`,
            this.owner?.getTag ? this.owner.getTag() : this.owner
          );
        }
      }
    }

    if(GameState.Mode == EngineMode.DIALOG){
      console.log('ActionDialogObject: Already in dialog', this.owner.getName(), this.owner.getTag());
      return ActionStatus.FAILED;
    }

    if(!BitWise.InstanceOfObject(this.owner, ModuleObjectType.ModuleCreature))
    {
      GameState.CutsceneManager.startConversation(this.conversation ? this.conversation : this.owner.conversation, this.owner, this.target);
      return ActionStatus.COMPLETE;
    }

    let distance = Utility.Distance2D(this.owner.position, this.target.position);
    if(distance > 4.5 && !ignoreStartRange){
      // this.owner.openSpot = undefined;
      let actionMoveToTarget = new GameState.ActionFactory.ActionMoveToPoint();
      actionMoveToTarget.setParameter(0, ActionParameterType.FLOAT, this.target.position.x);
      actionMoveToTarget.setParameter(1, ActionParameterType.FLOAT, this.target.position.y);
      actionMoveToTarget.setParameter(2, ActionParameterType.FLOAT, this.target.position.z);
      actionMoveToTarget.setParameter(3, ActionParameterType.DWORD, GameState.module.area.id);
      actionMoveToTarget.setParameter(4, ActionParameterType.DWORD, this.target.id);
      actionMoveToTarget.setParameter(5, ActionParameterType.INT, 1);
      actionMoveToTarget.setParameter(6, ActionParameterType.FLOAT, 4.5 );
      actionMoveToTarget.setParameter(7, ActionParameterType.INT, 0);
      actionMoveToTarget.setParameter(8, ActionParameterType.FLOAT, 30.0);
      this.owner.actionQueue.addFront(actionMoveToTarget);

      return ActionStatus.IN_PROGRESS;
    }else{
      this.owner.setAnimationState(ModuleCreatureAnimState.IDLE);
      this.owner.force = 0;
      this.owner.speed = 0;

      this.owner.heardStrings = [];
      this.target.heardStrings = [];
      //Only route through the target's OnDialog script when the target is not
      //the player. That script exists so a creature the player approaches can
      //select its own conversation. When an NPC initiates on the player it
      //must not run: the player's OnDialog is the party-member handler, which
      //calls BeginConversation with no resref and therefore starts the
      //*player's* own dialogue - silently replacing the NPC's scene.
      const targetIsPlayer = !!this.target?.isPlayer;
      const onDialog = (!targetIsPlayer && BitWise.InstanceOfObject(this.target, ModuleObjectType.ModuleCreature)) ? this.target.scripts[ModuleObjectScript.CreatureOnDialog] : undefined;
      if(onDialog){
        this.target.onDialog(this.owner, -1, this.conversation);
      }else{
        GameState.CutsceneManager.startConversation(this.conversation ? this.conversation : this.owner.conversation, this.target, this.owner);
      }
      return ActionStatus.COMPLETE;
    }
    
    return ActionStatus.FAILED;
  }

}
