import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  AttackBarkGate,
  EVERY_ATTACK_BARK_POLICY,
  SPARSE_ATTACK_BARK_POLICY,
} from '@/engine/rules/AttackBarkGate';

describe('AttackBarkGate', () => {
  test('the default policy voices every attack, as the engine always has', () => {
    const gate = new AttackBarkGate();
    const creature = {};
    for (let t = 0; t < 10_000; t += 1000) expect(gate.shouldBark(creature, t)).toBe(true);
    expect(gate.shouldBark(creature, 10_000, EVERY_ATTACK_BARK_POLICY, () => 0.99)).toBe(true);
  });

  test('the sparse policy never voices one creature twice within 4 s', () => {
    const gate = new AttackBarkGate();
    const creature = {};
    const always = () => 0;
    expect(gate.shouldBark(creature, 0, SPARSE_ATTACK_BARK_POLICY, always)).toBe(true);
    expect(gate.shouldBark(creature, 3000, SPARSE_ATTACK_BARK_POLICY, always)).toBe(false);
    expect(gate.shouldBark(creature, 3999, SPARSE_ATTACK_BARK_POLICY, always)).toBe(false);
    expect(gate.shouldBark(creature, 4000, SPARSE_ATTACK_BARK_POLICY, always)).toBe(true);
  });

  test('each creature keeps its own interval', () => {
    const gate = new AttackBarkGate();
    const a = {}, b = {};
    expect(gate.shouldBark(a, 0, SPARSE_ATTACK_BARK_POLICY, () => 0)).toBe(true);
    expect(gate.shouldBark(b, 100, SPARSE_ATTACK_BARK_POLICY, () => 0)).toBe(true);
  });

  test('a skipped roll does not start the interval', () => {
    const gate = new AttackBarkGate();
    const creature = {};
    expect(gate.shouldBark(creature, 0, SPARSE_ATTACK_BARK_POLICY, () => 0.9)).toBe(false);
    expect(gate.shouldBark(creature, 3000, SPARSE_ATTACK_BARK_POLICY, () => 0.1)).toBe(true);
  });

  test('three troopers firing every 3 s for a minute: about one shot in three is voiced', () => {
    const gate = new AttackBarkGate();
    let seed = 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const troopers = [{}, {}, {}];
    let shots = 0, barks = 0;
    for (let t = 0; t < 60_000; t += 3000) {
      for (const trooper of troopers) {
        shots += 1;
        if (gate.shouldBark(trooper, t, SPARSE_ATTACK_BARK_POLICY, random)) barks += 1;
      }
    }
    expect(barks / shots).toBeGreaterThan(0.15);
    expect(barks / shots).toBeLessThan(0.4);
  });
});

describe('ActionPhysicalAttacks wiring', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/actions/ActionPhysicalAttacks.ts'), 'utf8');

  test('the attack line goes through the gate, with the host policy', () => {
    expect(source).toContain('GameState.attackBarkGate.shouldBark(owner, performance.now(), GameState.attackBarkPolicy?.(owner)');
  });
});
