import { ActionStatus } from "@/enums/actions/ActionStatus";
import { ActionType } from "@/enums/actions/ActionType";
import type { ModuleObject } from "@/module";
import type { Action } from "@/actions/Action";

/**
 * ActionQueue class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file ActionQueue.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class ActionQueue extends Array {

  static AUTO_INCREMENT_GROUP_ID = 0xFFFF;
  static MAX_GROUP_ID = 0xFFFE;
  
  NEXT_GROUP_ID: number = 0;
  nextGroupId: number;
  lastGroupId: number;
  owner: any;

  /**
   * ActionQueue
   * initializes a new ActionQueue object
   *
   * @param ...items - an array of actions to initialize the queue with
   * @returns void
   *
   */
  constructor(...items: any[]){
    super(...items);
    this.nextGroupId = 1;
    this.lastGroupId = 0;
    this.owner = undefined;
  }

  /**
   * set the owner object of the queue
   *
   * @param owner - the owner ModuleObject
   * @returns void
   *
   */
  setOwner( owner: ModuleObject ){
    this.owner = owner;
  }

  /**
   * add action to the back of the queue
   *
   * @param actionNode - the action node to add
   * @returns void
   *
   */
  add( actionNode: Action ){
    if(!actionNode){ return; }
    actionNode.owner = this.owner;
    super.push( actionNode );
  }

  /**
   * Add the supplied action to the front of the queue
   *
   * @param actionNode - the action node to add
   * @returns void
   *
   */
  addFront( actionNode: Action ){
    if(!actionNode){ return; }
    actionNode.owner = this.owner;
    super.unshift( actionNode );
  }

  /**
   * handles the groupId parameter.
   * It can either be set to auto increment or use the value passed as it's groupId
   *
   * @param actionNode - the action node to push
   * @returns void
   *
   */
  #processGroupId(actionNode: Action){
    let newGroupId = actionNode.groupId;
    if(newGroupId < 0 || newGroupId > 0xFFFF){
      console.warn('Invalid GroupID', newGroupId);
      newGroupId = 0xFFFF;
    }
    if(newGroupId == ActionQueue.AUTO_INCREMENT_GROUP_ID){
      newGroupId = this.nextGroupId;
      if(newGroupId >= ActionQueue.MAX_GROUP_ID){
        newGroupId = this.lastGroupId = 0;
        this.nextGroupId = 1;
      }else{
        this.lastGroupId = newGroupId;
        this.nextGroupId++;
      }
      actionNode.groupId = newGroupId;
    }else if(actionNode.groupId == ActionQueue.MAX_GROUP_ID){
      actionNode.groupId = this.lastGroupId;
    }else{
      actionNode.groupId = newGroupId;
    }
  }


  /**
   * push the actionNode into the queue
   *
   * @param actionNode - the action node to push
   * @returns void
   *
   */
  //@ts-expect-error
  push( actionNode: Action ){
    actionNode.owner = this.owner;
    actionNode.queue = this;
    this.#processGroupId(actionNode);
    this.add( actionNode );
  }

  /**
   * shifts the actionNode to the beginning of the queue
   *
   * @param actionNode - the action node to push
   * @returns void
   *
   */
  //@ts-expect-error
  unshift( actionNode: Action ){
    actionNode.owner = this.owner;
    actionNode.queue = undefined;
    this.#processGroupId(actionNode);
    this.addFront( actionNode );
  }

  /**
   * updates the current action in the queue
   *
   * @param delta - deltaTime
   * @returns void
   *
   */
  process( delta: number = 0 ){
    let action = this[0];
    if(!action){ return; }
    action.owner = this.owner;

    let status: ActionStatus;
    try{
      status = action.update( delta );
    }catch(e){
      //Without this the throwing action is never shifted off the queue, so it
      //re-throws on every frame forever and the owner can never act again.
      console.error(
        `ActionQueue: action type ${action.type} threw for owner`,
        `'${this.owner?.getTag ? this.owner.getTag() : '?'}'`,
        `- dropping it from the queue.`, e
      );
      this.shift();
      return;
    }

    if(status != ActionStatus.IN_PROGRESS){
      this.shift();
    }
  }

  /**
   * clears all actions from the queue
   *
   * @returns void
   *
   */
  clear(){
    this.splice(0, this.length).map( (a: Action) => a.dispose() );
  }

  /**
   * removes the action from the queue
   *
   * @param actionNode - node to remove
   * @returns void
   *
   */
  clearAction(action: Action){
    if(action){
      const index = this.indexOf(action);
      if(index >= 0){
        this.splice(index, 1).map( (a: Action) => a.dispose() );
        this.clearActionsByGroupId(action.groupId);
      }
    }
  }

  /**
   * removes actions with the supplied groupId from the queue
   *
   * @param groupId - groupId to remove
   * @returns void
   *
   */
  clearActionsByGroupId(groupId: number = -1){
    if(groupId > 0) return;
    let index = this.length;
    while(index--){
      const action = this[index];
      if(action && action.groupId == groupId){
        this.splice(index, 1).map( (a: Action) => a.dispose() );
      }
    }
  }

  actionTypeExists(actionType: ActionType){
    return this.findIndex( (a: Action) => a.type == actionType ) >= 0;
  }

  /**
   * Whether an action equivalent to `candidate` — same type, same parameters —
   * is already in this queue.
   *
   * Re-issuing an authored menu action while its predecessor is still running
   * is not harmless. `addFront` puts the new one ahead of the old, and these
   * actions time themselves: `ActionUnlockObject` runs a 1.5 s lockpick before
   * it rolls. So a player who presses Security again — which they do, because
   * nothing visible happens during those 1.5 s — restarts the timer, and the
   * door can never open while they keep trying.
   *
   * Measured live in a headset session: nine presses at ~0.9 s intervals left
   * nine `ActionUnlockObject`s queued with the front timer oscillating around
   * 0.6 and the door still locked; the moment the presses stopped the queue
   * drained and the door unlocked. The player's reading was "the button does
   * nothing", and pressing harder was precisely the wrong remedy.
   *
   * Compares the stored parameter values rather than resolved objects: those
   * are ids and primitives, so two presses of the same menu entry against the
   * same target compare equal without touching the module object manager.
   */
  hasEquivalentAction(candidate: Action): boolean {
    if(!candidate) return false;
    return this.findIndex( (queued: Action) =>
      ActionQueue.actionsAreEquivalent(queued, candidate) ) >= 0;
  }

  private static actionsAreEquivalent(a: Action, b: Action): boolean {
    if(!a || !b || a.type !== b.type) return false;
    const aParams = a.parameters || [];
    const bParams = b.parameters || [];
    if(aParams.length !== bParams.length) return false;
    for(let i = 0; i < aParams.length; i++){
      const pa = aParams[i];
      const pb = bParams[i];
      if(!pa || !pb) {
        if(pa !== pb) return false;
        continue;
      }
      if(pa.type !== pb.type || pa.value !== pb.value) return false;
    }
    return true;
  }

}