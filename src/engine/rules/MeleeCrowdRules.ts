/**
 * Where a melee attacker goes to fight its target.
 *
 * Retail melee attackers take an open spot around their target: a ring at the
 * target's personal space plus the attacker's own, one attacker per spot, the
 * spot nearest the attacker first. This engine walked every attacker to the
 * target's centre instead, so two engaged and the rest stood blocked behind
 * them with a target and no attack, or piled into one arc through each other.
 *
 * A host may also cap how many melee attackers one defender takes at once
 * (MeleeCrowdPolicy). An attacker that finds its defender full switches to
 * the least crowded alternative the policy names, or waits a few metres off
 * until a spot frees. The cap only decides where an attacker stands and whom
 * it walks to: an attacker already in reach still attacks, ranged attackers
 * never take a spot, and no roll is changed. With no policy every attacker
 * takes a spot, as retail.
 *
 * Deliberately free of engine imports so it can be tested without the world.
 */

export interface MeleeCrowdPolicy {
  /** The most melee attackers that hold spots around one defender at once. */
  readonly maxAttackers: number;
  /** Where an attacker waiting for a spot stands, metres from the defender's centre. */
  readonly holdDistance: number;
  /** Who the attacker may switch to when its defender is full. */
  readonly alternatives: readonly unknown[];
}

export type MeleeApproach<T> =
  | { readonly kind: 'approach' }
  | { readonly kind: 'retarget'; readonly target: T }
  | { readonly kind: 'hold' };

export interface MeleeApproachInput<T> {
  readonly target: T;
  /** The attacker already holds a spot around `target`. */
  readonly holdsSpot: boolean;
  readonly policy?: MeleeCrowdPolicy | null;
  /** Live spot holders around `defender`, not counting this attacker. */
  readonly attackersOn: (defender: T) => number;
  readonly distanceTo: (defender: T) => number;
  /** Whether `defender` can be fought at all (alive, in the area). */
  readonly isAvailable: (defender: T) => boolean;
}

/** Spot ring radius: the defender's personal space plus the attacker's own. */
export function meleeSpotRadius(defenderPersonalSpace: number, attackerPersonalSpace: number): number {
  const a = Number.isFinite(defenderPersonalSpace) && defenderPersonalSpace > 0 ? defenderPersonalSpace : 0;
  const b = Number.isFinite(attackerPersonalSpace) && attackerPersonalSpace > 0 ? attackerPersonalSpace : 0;
  return a + b;
}

/** Whether the attacker walks to a spot on its target, switches defender, or waits. */
export function chooseMeleeApproach<T>(input: MeleeApproachInput<T>): MeleeApproach<T> {
  const policy = input.policy;
  if(!policy || input.holdsSpot) return { kind: 'approach' };
  const cap = Math.max(1, Math.floor(Number(policy.maxAttackers) || 0));
  if(input.attackersOn(input.target) < cap) return { kind: 'approach' };
  let best: T | undefined;
  let bestCount = Infinity;
  let bestDistance = Infinity;
  for(const candidate of (policy.alternatives || []) as T[]){
    if(candidate === input.target || !input.isAvailable(candidate)) continue;
    const count = input.attackersOn(candidate);
    if(count >= cap) continue;
    const distance = input.distanceTo(candidate);
    if(count < bestCount || (count === bestCount && distance < bestDistance)){
      best = candidate;
      bestCount = count;
      bestDistance = distance;
    }
  }
  return best !== undefined ? { kind: 'retarget', target: best } : { kind: 'hold' };
}

/**
 * Where an attacker waiting for room stands: on the line from the defender
 * back towards the attacker, `holdDistance` from the defender. Null when the
 * attacker is already at least that far out.
 */
export function meleeHoldPoint(
  defender: { readonly x: number; readonly y: number },
  attacker: { readonly x: number; readonly y: number },
  holdDistance: number,
): { x: number; y: number } | null {
  const dx = attacker.x - defender.x;
  const dy = attacker.y - defender.y;
  const distance = Math.hypot(dx, dy);
  if(!(holdDistance > 0) || distance >= holdDistance) return null;
  if(distance < 1e-6) return { x: defender.x + holdDistance, y: defender.y };
  return { x: defender.x + dx / distance * holdDistance, y: defender.y + dy / distance * holdDistance };
}
