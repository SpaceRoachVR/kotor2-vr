import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Reported from the headset on the custom character-creation Attributes step:
 * the `+` buttons played their click sound but nothing changed — attributes
 * stayed at 8, the pool stayed at 30 — and the column between each attribute
 * name and its score read `00` for every row.
 *
 * Confirmed live: `CharGenAbilities.creature` was **unset** while
 * `CharGenManager.selectedCreature` was set. `CharGenCustomPanel` step 2 passed
 * `GameState.getCurrentPlayer()`, which is undefined during character creation
 * because no player exists in the world yet. Every `+`/`-` handler is guarded on
 * `this.creature`, so all of them no-opped, and `updateButtonStates` then threw
 * on `this.creature.str` partway through the redraw.
 *
 * Step 4 never called `setCreature` at all, leaving `CharGenFeats` unable to
 * grant or list anything for the same reason.
 *
 * The `00` column is the ability modifier — `LBL_BONUS_*`, declared in TSL and
 * written nowhere, so every row showed its authored placeholder.
 */
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const PANEL = read('src/game/kotor/menu/CharGenCustomPanel.ts');
const ABILITIES = read('src/game/kotor/menu/CharGenAbilities.ts');

describe('the steps receive the creature being built', () => {
  test('Attributes gets CharGenManager.selectedCreature, not the world player', () => {
    expect(PANEL).toMatch(/CharGenAbilities\.setCreature\(GameState\.CharGenManager\.selectedCreature\)/);
    expect(PANEL).not.toMatch(/CharGenAbilities\.setCreature\(GameState\.getCurrentPlayer\(\)\)/);
  });

  test('Feats receives one at all', () => {
    expect(PANEL).toMatch(/CharGenFeats\.setCreature\(GameState\.CharGenManager\.selectedCreature\)/);
  });
});

describe('the modifier column is written', () => {
  test('every attribute row gets its modifier', () => {
    for (const stat of ['STR', 'DEX', 'CON', 'WIS', 'INT', 'CHA']) {
      expect(ABILITIES).toMatch(new RegExp(`LBL_BONUS_${stat}\\?\\.setText\\(`));
    }
  });

  test('the modifier is computed, not the score', () => {
    expect(ABILITIES).toMatch(/formatAbilityModifier/);
    expect(ABILITIES).toMatch(/Math\.floor\(\(Number\(score\) - 10\) \/ 2\)/);
  });
});

describe('the refresh survives a missing creature', () => {
  test('the guard sits before the first this.creature dereference', () => {
    const at = ABILITIES.indexOf('updateButtonStates(){');
    const body = ABILITIES.slice(at);
    const guard = body.indexOf('if(!this.creature) return;');
    const firstDeref = body.indexOf('this.creature.str');
    expect(guard).toBeGreaterThan(-1);
    expect(firstDeref).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstDeref);
  });

  test('and after the show() calls, so buttons are not left hidden', () => {
    const at = ABILITIES.indexOf('updateButtonStates(){');
    const body = ABILITIES.slice(at);
    expect(body.indexOf('this.STR_PLUS_BTN.show()'))
      .toBeLessThan(body.indexOf('if(!this.creature) return;'));
  });
});

/** The formatting rule, exercised directly rather than asserted from the source. */
describe('ability modifier values', () => {
  const format = (score: number) => {
    const modifier = Math.floor((Number(score) - 10) / 2);
    return `${modifier < 0 ? '-' : '+'}${Math.abs(modifier).toString().padStart(2, '0')}`;
  };

  test.each([
    [8, '-01'],
    [10, '+00'],
    [12, '+01'],
    [16, '+03'],
    [18, '+04'],
    [7, '-02'],
  ])('a score of %i reads %s', (score, expected) => {
    expect(format(score as number)).toBe(expected);
  });
});
