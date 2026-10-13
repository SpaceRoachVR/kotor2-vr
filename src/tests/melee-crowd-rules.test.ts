import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { chooseMeleeApproach, meleeHoldPoint, meleeSpotRadius, type MeleeCrowdPolicy } from '@/engine/rules/MeleeCrowdRules';

type D = { name: string; count: number; distance: number; available?: boolean };

const run = (target: D, others: D[], policy: MeleeCrowdPolicy | null, holdsSpot = false) => chooseMeleeApproach<D>({
  target,
  holdsSpot,
  policy: policy ? { ...policy, alternatives: [target, ...others] } : null,
  attackersOn: (d) => d.count,
  distanceTo: (d) => d.distance,
  isAvailable: (d) => d.available !== false,
});

const CAP3: MeleeCrowdPolicy = { maxAttackers: 3, holdDistance: 3, alternatives: [] };

describe('melee open spots and the crowd cap', () => {
  test('the spot ring is the defender\'s personal space plus the attacker\'s', () => {
    expect(meleeSpotRadius(0.6, 0.6)).toBeCloseTo(1.2);
    expect(meleeSpotRadius(0.35, 1.2)).toBeCloseTo(1.55);
    expect(meleeSpotRadius(NaN, 0.5)).toBeCloseTo(0.5);
  });

  test('with no policy every melee attacker approaches (retail)', () => {
    const player = { name: 'p', count: 7, distance: 4 };
    expect(run(player, [], null)).toEqual({ kind: 'approach' });
  });

  test('a defender under the cap takes the attacker', () => {
    const player = { name: 'p', count: 2, distance: 4 };
    expect(run(player, [{ name: 'a', count: 0, distance: 1 }], CAP3)).toEqual({ kind: 'approach' });
  });

  test('an attacker that already holds a spot keeps it even when the defender is full', () => {
    const player = { name: 'p', count: 3, distance: 1 };
    expect(run(player, [{ name: 'a', count: 0, distance: 1 }], CAP3, true)).toEqual({ kind: 'approach' });
  });

  test('overflow switches to the least crowded party member, the nearer on a tie', () => {
    const player = { name: 'p', count: 3, distance: 4 };
    const atton = { name: 'atton', count: 1, distance: 2 };
    const kreia = { name: 'kreia', count: 1, distance: 6 };
    const bao = { name: 'bao', count: 2, distance: 1 };
    const result = run(player, [atton, kreia, bao], CAP3);
    expect(result).toEqual({ kind: 'retarget', target: atton });
  });

  test('full or unavailable alternatives leave the attacker waiting', () => {
    const player = { name: 'p', count: 3, distance: 4 };
    const full = { name: 'full', count: 3, distance: 1 };
    const down = { name: 'down', count: 0, distance: 1, available: false };
    expect(run(player, [full, down], CAP3)).toEqual({ kind: 'hold' });
  });

  test('a waiting attacker stands on the line back towards where it came from', () => {
    expect(meleeHoldPoint({ x: 0, y: 0 }, { x: 1, y: 0 }, 3)).toEqual({ x: 3, y: 0 });
    expect(meleeHoldPoint({ x: 0, y: 0 }, { x: 0, y: 5 }, 3)).toBeNull();
  });
});

describe('ActionPhysicalAttacks wiring', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/actions/ActionPhysicalAttacks.ts'), 'utf8');

  test('melee attackers walk to an open spot, ranged attackers do not', () => {
    expect(source).not.toContain('/*if(!owner.isRangedEquipped()){ //MELEE');
    expect(source).toContain('const melee = !owner.isRangedEquipped() && BitWise.InstanceOfObject(target, ModuleObjectType.ModuleCreature);');
    expect(source).toContain('owner.openSpot = pickMeleeSpot(owner, target, this);');
    expect(source).toContain('owner.openSpot = target.getClosesetOpenSpot(owner);');
  });

  test('the crowd policy is decided before a round begins; a round under way runs as before', () => {
    expect(source).toContain('const meleeStep = melee && !approachSuppressed && !owner.combatRound?.roundStarted &&');
    const inReach = source.slice(source.indexOf('}else{', source.indexOf('owner.actionQueue.addFront(actionMoveToTarget);')));
    expect(inReach).not.toContain('planMeleeApproach');
    expect(inReach).toContain('combatRound.calculateAttackDamage(owner, combatRound.action);');
  });
});
