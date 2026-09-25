import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { shouldIgnoreCreatureCollision } from '@/engine/collision/PartyCollisionRules';

describe('shouldIgnoreCreatureCollision', () => {
  const exile = { isPM: false, name: 'exile' };
  const atton = { isPM: true, name: 'atton' };
  const t3 = { isPM: true, name: 't3' };
  const droid = { isPM: false, name: 'droid' };
  const party = [exile, atton, t3];

  test('the party leader walks through their own followers', () => {
    // 106PER decontamination strip: Atton between the Exile and the console.
    expect(shouldIgnoreCreatureCollision(exile, atton, party)).toBe(true);
    expect(shouldIgnoreCreatureCollision(exile, t3, party)).toBe(true);
  });

  test('a follower still collides with the leader and with other followers', () => {
    expect(shouldIgnoreCreatureCollision(atton, exile, party)).toBe(false);
    expect(shouldIgnoreCreatureCollision(atton, t3, party)).toBe(false);
  });

  test('nothing outside the party is affected', () => {
    expect(shouldIgnoreCreatureCollision(exile, droid, party)).toBe(false);
    expect(shouldIgnoreCreatureCollision(droid, exile, party)).toBe(false);
    expect(shouldIgnoreCreatureCollision(droid, atton, party)).toBe(false);
  });

  test('a possessed companion leading the party gets the same pass', () => {
    const possessedT3 = { isPM: true, name: 't3-lead' };
    expect(shouldIgnoreCreatureCollision(possessedT3, atton, [possessedT3, atton, exile])).toBe(true);
  });

  test('degenerate inputs never grant the pass', () => {
    expect(shouldIgnoreCreatureCollision(exile, exile, party)).toBe(false);
    expect(shouldIgnoreCreatureCollision(exile, atton, [])).toBe(false);
    expect(shouldIgnoreCreatureCollision(null as unknown as typeof exile, atton, party)).toBe(false);
  });

  test('the collision pass consults the rule for creature collisions', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'engine', 'CollisionManager.ts'), 'utf8');
    const start = source.indexOf('private handleObjectGroupCollisions(');
    const body = source.slice(start, source.indexOf('private detectCreatureCollision(', start));
    expect(body).toContain('shouldIgnoreCreatureCollision(this.object as ModuleCreature, creature, GameState.PartyManager.party)');
  });
});
