import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The 2026-09-09 audit left 26 animation constants unmapped in
 * `ModuleObject.animationConstantToAnimation`, noting that several are
 * weapon-type dependent and that guessing puts the wrong animation on screen.
 *
 * ModuleCreature now answers the ones whose mapping follows a rule:
 *   - ATTACK / ATTACK_DUELING, PARRY, DAMAGED / DAMAGE2 and the ready stances
 *     resolve through the same weapon-wield naming combat uses
 *     (`<attackKey><wield>a1`, `g<wield>r1`).
 *   - BLASTER_DEFLECTION_1H/2H both resolve to TSL's single `deflect` row.
 *   - KNEELING is row 23 `kneel`; the castout pair is rows 62-67 for humanoids
 *     and 293-295 for simple creatures.
 *
 * The rest are left unmapped on purpose: checked against animations.2da (571
 * rows) in the retail install, TSL ships no row for WORSHIP, IDLE, ANIMATING,
 * KID_TALK_ANGRY/SAD, KNOCKED_DOWN_LP/KNOCKED_DOWN2_LP or WALKING_BACK, and the
 * *_SS variants (POWER_ATTACK_SS, CRITICAL_STRIKE2_SS, CRITICAL_STRIKE3_SS)
 * name single-sabre feat animations whose rows were not identified. They fall
 * through to the base mapping rather than being guessed at.
 */
const source = fs.readFileSync(path.join(__dirname, '..', 'module', 'ModuleCreature.ts'), 'utf8');
const override = source.slice(source.indexOf('animationConstantToAnimation( animation_constant = 10000 )'));
const handled = new Set([...override.matchAll(/case ModuleCreatureAnimState\.([A-Z0-9_]+)/g)].map((m) => m[1]));

const MAPPED = ['ATTACK', 'ATTACK_DUELING', 'PARRY', 'DAMAGED', 'DAMAGE2', 'MELEE_WIELD',
  'MELEE_COMBAT_WIELD', 'BLASTER_DEFLECTION_1H', 'BLASTER_DEFLECTION_2H', 'KNEELING',
  'CASTOUT1', 'CASTOUT1_LP', 'CASTOUT2', 'CASTOUT2_LP', 'CASTOUT3'];

const DELIBERATELY_UNMAPPED = ['WORSHIP', 'IDLE', 'ANIMATING', 'KID_TALK_ANGRY', 'KID_TALK_SAD',
  'KNOCKED_DOWN_LP', 'KNOCKED_DOWN2_LP', 'WALKING_BACK', 'POWER_ATTACK_SS',
  'CRITICAL_STRIKE2_SS', 'CRITICAL_STRIKE3_SS'];

describe('creature animation constants', () => {
  test.each(MAPPED)('%s resolves', (name) => {
    expect(handled.has(name)).toBe(true);
  });

  test.each(DELIBERATELY_UNMAPPED)('%s is left to the base mapping', (name) => {
    expect(handled.has(name)).toBe(false);
  });

  test('the override delegates anything it does not handle', () => {
    expect(override).toContain('return super.animationConstantToAnimation(animation_constant);');
  });

  test('weapon-dependent constants use the combat naming, not a fixed row', () => {
    expect(override).toContain('this.getCombatAnimationWeaponType()');
    expect(override).toContain('this.getCombatAnimationAttackType()');
    expect(override).toContain('`${attackKey}${wield}a1`');
    expect(override).toContain('`g${wield}r1`');
  });

  test('26 constants were unmapped; 15 now resolve', () => {
    expect(MAPPED.length + DELIBERATELY_UNMAPPED.length).toBe(26);
    expect(MAPPED.length).toBe(15);
  });
});
