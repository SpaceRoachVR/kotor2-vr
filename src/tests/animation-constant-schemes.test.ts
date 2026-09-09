import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { ModuleCreatureAnimState } from '@/enums/module/ModuleCreatureAnimState';

/**
 * Two numbering schemes reach `animationConstantToAnimation`.
 *
 * The named constants are the engine's own: PAUSE is 10000 and resolves to row 6
 * (`pause1`), SCANNING is 10412 and resolves to row 471 (`scanning`). Dialogue
 * and script data also carry a second form — the animations.2da row index plus
 * 10000 — and those matched no case, so the creature reported "Animation
 * Missing" and froze to PAUSE while the authored animation never played.
 *
 * Three sightings in one 82-module sweep, each of which reads correctly only
 * under the row reading: 10074 on beasts hit by Force Horror (row 74 `horror`),
 * 10459 on a Sith Drexl trainer (row 459 `forcecrush`), and 10471 on a droid NPC
 * (row 471 `scanning`). The last is the cross-check — the switch independently
 * maps SCANNING to that same row 471.
 *
 * The fallback is deliberately restricted to constants that are not
 * ModuleCreatureAnimState members, because for a named constant the row reading
 * is actively wrong. These tests pin that premise: if a future edit gives one of
 * these values a name, the fallback stops applying to it silently.
 */
describe('animation constant schemes', () => {
  test.each([
    ['horror', 10074],
    ['forcecrush', 10459],
    ['scanning', 10471],
  ])('%s (%i) is a row reference, not a creature constant', (_name, value) => {
    expect(typeof (ModuleCreatureAnimState as any)[value]).not.toBe('string');
  });

  test.each([
    ['SCANNING', 10412],
    ['MEDITATE', 10032],
    ['PARRY', 10012],
    ['PAUSE', 10000],
  ])('%s (%i) is a named engine constant and must not take the row reading', (name, value) => {
    expect((ModuleCreatureAnimState as any)[value]).toBe(name);
  });

  /**
   * The concrete hazard the restriction exists to avoid: PARRY is 10012 and
   * row 12 is `pausesh`, so an unrestricted fallback would replace a missing
   * animation with a visibly wrong one.
   */
  test('the guard is restricted to non-member constants', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'module', 'ModuleObject.ts'), 'utf8',
    );
    expect(source).toContain(
      "typeof (ModuleCreatureAnimState as any)[animation_constant] !== 'string'");
    expect(source).toContain('animations2DA.rows[animation_constant - 10000]');
  });

  test('MEDITATE resolves to the meditate row', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'module', 'ModuleObject.ts'), 'utf8',
    );
    const at = source.indexOf('case ModuleCreatureAnimState.MEDITATE:');
    expect(at).toBeGreaterThan(-1);
    expect(source.slice(at, at + 120)).toContain('animations2DA.rows[24]');
  });
});
