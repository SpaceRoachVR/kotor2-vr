/**
 * Combat round actions whose target is gone.
 *
 * A creature acts in combat by taking the next action from its round's
 * schedule. An action that never started is still "the round's action": while
 * it is set, ModuleCreature.updateCombat queues nothing new and the attack
 * itself (ActionPhysicalAttacks) fails on a dead target without clearing it,
 * so the creature can never start another round. The same happens to rounds
 * aimed at an object in an area the creature has left. Such actions are
 * dropped here; an action whose round is already under way is left to finish.
 *
 * Deliberately free of engine imports so it can be tested without the world.
 */

export interface CombatActionTargetLike {
  isDead?: () => boolean;
  destroyed?: boolean;
  area?: unknown;
}

export interface CombatActionLike {
  target?: CombatActionTargetLike;
}

export interface CombatRoundLike {
  roundStarted: boolean;
  action?: CombatActionLike;
  scheduledActionList: CombatActionLike[];
}

/**
 * True when the action aims at something no longer there to act on: dead,
 * destroyed, or outside the owner's area. Actions with no target (equip,
 * unequip) are never stale. With no owner area, only death and destruction
 * count.
 */
export function isCombatActionTargetGone(action: CombatActionLike | undefined, ownerArea: unknown): boolean {
  const target = action?.target;
  if(!target) return false;
  if(target.destroyed) return true;
  if(typeof target.isDead === 'function' && target.isDead()) return true;
  if(ownerArea && target.area !== ownerArea) return true;
  return false;
}

/**
 * Drops the round's unstarted action and every scheduled action whose target
 * is gone. Returns how many were dropped.
 */
export function dropStaleCombatActions(round: CombatRoundLike, ownerArea: unknown): number {
  let dropped = 0;
  if(!round.roundStarted && round.action && isCombatActionTargetGone(round.action, ownerArea)){
    round.action = undefined;
    dropped++;
  }
  const list = round.scheduledActionList;
  for(let i = list.length - 1; i >= 0; i--){
    if(isCombatActionTargetGone(list[i], ownerArea)){
      list.splice(i, 1);
      dropped++;
    }
  }
  return dropped;
}
