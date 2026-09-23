import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { Dice } from '@/utility/Dice';
import { DiceType } from '@/enums/combat/DiceType';

/**
 * Round 9, measured on the Peragus Plasma Torch: its stun-baton base
 * (baseitems.2da numdice 1, dietoroll 1) rolled 1-8, and its Damage property
 * (iprp_damagecost row 7, "1d6": numdice "1", die "6") also rolled 1-8. 2DA
 * cells are strings, and the die mapping only matched numbers and had no
 * one-sided die, so both fell through to the d8 default — inflating every item
 * damage bonus and creature claw in the game.
 */
describe('die mapping', () => {
  test.each([['6', DiceType.d6], [6, DiceType.d6], ['4', DiceType.d4], ['12', DiceType.d12], ['1', DiceType.d1]])(
    'maps %p to %s', (sides, type) => {
      expect(Dice.intToDiceType(sides as any)).toBe(type);
    },
  );

  test('a one-sided die always rolls its count', () => {
    for (let i = 0; i < 20; i++) expect(Dice.roll(2, DiceType.d1)).toBe(2);
  });

  test('a string d6 stays within 1-6', () => {
    for (let i = 0; i < 200; i++) {
      const value = Dice.roll(1, Dice.intToDiceType('6' as any));
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
    }
  });

  test('base items map dietoroll 1 to the one-sided die', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/engine/BaseItem.ts'), 'utf8');
    expect(source).toMatch(/case 1:\s*this\.die = DiceType\.d1;/);
  });
});
