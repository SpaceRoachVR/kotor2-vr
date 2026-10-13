import { GameState } from "@/GameState";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { chooseMeleeApproach, meleeHoldPoint } from "@/engine/rules/MeleeCrowdRules";
import { TURN_SPEED_FAST } from "@/engine/TurnSpeeds";
import { BitWise } from "@/utility/BitWise";
import { Utility } from "@/utility/Utility";
import type { Action } from "@/actions/Action";
import type { ModuleCreature } from "@/module/ModuleCreature";

/**
 * How a melee attacker out of reach closes on its target (ActionPhysicalAttacks).
 *
 * - `spot`: walk to its open spot around the target (retail).
 * - `retargeted`: the target was full under the host's crowd policy and the
 *   attack now aims at another defender; the action runs again next frame.
 * - `wait`: the target is full and nobody else has room: stand here, facing it.
 * - `close`: as `wait`, but too far off; walk in to the policy's hold distance.
 * - `backoff`: as `wait`, but too close (it was already in reach without a
 *   spot): step back out to the hold distance first.
 *
 * See MeleeCrowdRules.
 */
export type MeleeApproachStep =
  | { readonly kind: 'spot' }
  | { readonly kind: 'retargeted' }
  | { readonly kind: 'wait' }
  | { readonly kind: 'close'; readonly stopWithin: number }
  | { readonly kind: 'backoff'; readonly point: { readonly x: number; readonly y: number } };

/** Per attack action: the spot it last walked for, and how far off it was then. */
const spotAttempts = new WeakMap<Action, { spot: unknown; distance: number; avoid: Set<unknown> }>();

/**
 * The open spot an out-of-reach melee attacker walks for. Asked again each
 * time its walk ends short of reach; when it got no nearer to the spot than
 * the last time (wedged behind bodies, or the path went nowhere) that spot is
 * passed over for another, and with none left it walks at the target itself.
 */
export function pickMeleeSpot(owner: ModuleCreature, target: ModuleCreature, action: Action): any {
  let memo = spotAttempts.get(action);
  if(!memo){
    memo = { spot: undefined, distance: Infinity, avoid: new Set() };
    spotAttempts.set(action, memo);
  }
  let spot = target.getClosesetOpenSpot(owner, memo.avoid);
  if(spot && spot === memo.spot && Utility.Distance2D(owner.position, spot.targetVector) > memo.distance - 0.3){
    memo.avoid.add(spot);
    spot.object = undefined;
    spot = target.getClosesetOpenSpot(owner, memo.avoid);
  }
  if(!spot && memo.avoid.size) memo.avoid.clear();
  memo.spot = spot;
  memo.distance = spot ? Utility.Distance2D(owner.position, spot.targetVector) : Infinity;
  return spot;
}

export function planMeleeApproach(owner: ModuleCreature, target: ModuleCreature, action: Action): MeleeApproachStep {
  const policy = GameState.meleeCrowdPolicy?.(owner, target);
  if(!policy) return { kind: 'spot' };
  const decision = chooseMeleeApproach<ModuleCreature>({
    target,
    holdsSpot: target.holdsMeleeSpot(owner),
    policy,
    attackersOn: (defender) => defender.countMeleeSpotHolders(owner),
    distanceTo: (defender) => Utility.Distance2D(owner.position, defender.position),
    isAvailable: (defender) => BitWise.InstanceOfObject(defender, ModuleObjectType.ModuleCreature) &&
      !defender.destroyed && !defender.isDead() && defender.area === owner.area && owner.isHostile(defender),
  });
  if(decision.kind === 'approach') return { kind: 'spot' };
  if(decision.kind === 'retarget'){
    const next = decision.target;
    action.setParameter(1, ActionParameterType.DWORD, next.id);
    const round = owner.combatRound;
    if(round?.action && round.action.target === target) round.action.target = next;
    target.removeObjectFromTargetPositions(owner);
    // Counted on its new defender at once, so two attackers switching in the
    // same frame cannot both take its last place.
    owner.openSpot = next.getClosesetOpenSpot(owner);
    return { kind: 'retargeted' };
  }
  const holdDistance = Math.max(0, Number(policy.holdDistance) || 0);
  const distance = Utility.Distance2D(owner.position, target.position);
  if(distance > holdDistance + 0.5){
    return { kind: 'close', stopWithin: holdDistance };
  }
  const back = distance < holdDistance - 0.5 ? meleeHoldPoint(target.position, owner.position, holdDistance) : null;
  if(back){
    return { kind: 'backoff', point: back };
  }
  owner.force = 0;
  owner.speed = 0;
  owner.setFacing(
    Math.atan2(owner.position.y - target.position.y, owner.position.x - target.position.x) + Math.PI/2,
    false,
    TURN_SPEED_FAST
  );
  return { kind: 'wait' };
}
