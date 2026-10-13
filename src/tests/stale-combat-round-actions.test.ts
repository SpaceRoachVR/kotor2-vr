import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { dropStaleCombatActions, isCombatActionTargetGone } from '../combat/staleCombatActions';

/**
 * A combat round action that never started keeps its creature from acting:
 * ModuleCreature.updateCombat queues a new attack only when the round has no
 * action, ActionPhysicalAttacks fails on a dead target without clearing it, and
 * the round never begins. A companion killing the player's target therefore
 * left the player's next attacks waiting forever (6 of 6 pulls dead), and
 * rounds aimed at objects from a module already left (001EBO's Power Surge on
 * T3-M4) carried into the next area.
 */
describe('stale combat round actions', () => {
  const area = { id: 'area' };
  const otherArea = { id: 'other' };
  const live = (a: unknown = area) => ({ isDead: () => false, destroyed: false, area: a });
  const dead = () => ({ isDead: () => true, destroyed: false, area });

  test('a live target in the owner area is kept', () => {
    expect(isCombatActionTargetGone({ target: live() }, area)).toBe(false);
  });

  test('a dead, destroyed or elsewhere target is gone', () => {
    expect(isCombatActionTargetGone({ target: dead() }, area)).toBe(true);
    expect(isCombatActionTargetGone({ target: { ...live(), destroyed: true } }, area)).toBe(true);
    expect(isCombatActionTargetGone({ target: live(otherArea) }, area)).toBe(true);
    expect(isCombatActionTargetGone({ target: { ...live(), area: undefined } }, area)).toBe(true);
  });

  test('an action with no target (equip, unequip) is never stale', () => {
    expect(isCombatActionTargetGone({ target: undefined }, area)).toBe(false);
  });

  test('without an owner area only death and destruction count', () => {
    expect(isCombatActionTargetGone({ target: live(otherArea) }, undefined)).toBe(false);
    expect(isCombatActionTargetGone({ target: dead() }, undefined)).toBe(true);
  });

  test('an unstarted action and scheduled actions on gone targets are dropped; live ones stay', () => {
    const keep = { target: live() };
    const round = { roundStarted: false, action: { target: dead() } as any, scheduledActionList: [{ target: dead() }, keep, { target: live(otherArea) }] as any[] };
    expect(dropStaleCombatActions(round, area)).toBe(3);
    expect(round.action).toBeUndefined();
    expect(round.scheduledActionList).toEqual([keep]);
  });

  test('the action of a round already under way is left to finish', () => {
    const action = { target: dead() };
    const round = { roundStarted: true, action: action as any, scheduledActionList: [] as any[] };
    expect(dropStaleCombatActions(round, area)).toBe(0);
    expect(round.action).toBe(action);
  });

  test('ModuleCreature.updateCombat drops stale actions every frame', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/module/ModuleCreature.ts'), 'utf8');
    const at = src.indexOf('  updateCombat(delta = 0){');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('\n  updateCasting(', at));
    expect(body).toContain('dropStaleCombatActions(this.combatRound, this.area)');
  });
});
