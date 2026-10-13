/**
 * Moves every creature's combat references from one object to its
 * replacement.
 *
 * A leader switch rebuilds a companion: the instance that stood in the world
 * is destroyed and a new one is made from its template. Creatures fighting the
 * old instance kept it as their target, so enemies went on attacking a
 * destroyed copy for one or two rounds after the switch while the real member
 * stood beside it (Hive, run 2). Their targets, attackers, round actions and
 * queued actions now follow the member to the new instance.
 *
 * Deliberately free of engine imports so it can be tested without the world.
 */

import { ActionParameterType } from "@/enums/actions/ActionParameterType";

const COMBAT_DATA_FIELDS = [
  'lastAttemptedAttackTarget',
  'lastAttackTarget',
  'lastSpellTarget',
  'lastAttemptedSpellTarget',
  'lastSpellAttacker',
  'lastAttackObject',
  'lastDamager',
  'lastAttacker',
  'scriptedAttackTarget',
] as const;

const COMBAT_ROUND_FIELDS = ['newAttackTarget', 'dodgeTarget', 'masterID', 'roundPausedBy'] as const;


export interface RepointableCreature {
  combatData?: Record<string, unknown>;
  combatRound?: {
    action?: { target?: unknown };
    scheduledActionList?: { target?: unknown }[];
    [field: string]: unknown;
  };
  actionQueue?: ArrayLike<{ target?: unknown; parameters?: { type: number; value: unknown }[] }>;
  openSpot?: { owner?: unknown };
}

/**
 * Re-points every reference to `from` held by `creatures` at `to`. Action
 * parameters store object ids, so ids equal to `fromId` become `to.id`.
 * Returns how many references moved.
 */
export function repointCombatReferences(
  creatures: Iterable<RepointableCreature | null | undefined>,
  from: unknown,
  to: { id: number },
  fromId?: number,
): number {
  if(!from || !to || from === to) return 0;
  let moved = 0;
  const idMoves = Number.isFinite(fromId) && fromId !== to.id;
  for(const creature of creatures){
    if(!creature || creature === from) continue;
    const data = creature.combatData;
    if(data){
      for(const field of COMBAT_DATA_FIELDS){
        if(data[field] === from){ data[field] = to; moved++; }
      }
    }
    const round = creature.combatRound;
    if(round){
      for(const field of COMBAT_ROUND_FIELDS){
        if(round[field] === from){ round[field] = to; moved++; }
      }
      if(round.action && round.action.target === from){ round.action.target = to; moved++; }
      for(const scheduled of round.scheduledActionList ?? []){
        if(scheduled && scheduled.target === from){ scheduled.target = to; moved++; }
      }
    }
    const queue = creature.actionQueue;
    if(queue){
      for(let i = 0; i < queue.length; i++){
        const action = queue[i];
        if(!action) continue;
        if(action.target === from){ action.target = to; moved++; }
        if(idMoves){
          for(const parameter of action.parameters ?? []){
            if(parameter && parameter.type === ActionParameterType.DWORD && parameter.value === fromId){ parameter.value = to.id; moved++; }
          }
        }
      }
    }
    if(creature.openSpot && creature.openSpot.owner === from){ creature.openSpot = undefined; moved++; }
  }
  return moved;
}
