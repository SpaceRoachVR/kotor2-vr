import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Custom character creation was hidden by a single upstream `hide()` call
 * commented "very incomplete". The screens behind it are largely built: of
 * `CharGenCustomPanel`'s six steps, Portrait (270 lines), Attributes (347),
 * Skills (167), Name (61) and Play are all wired.
 *
 * Only step 4, Feats, had no handlers on any of its four buttons — Back
 * included — so entering it stranded the player inside character creation with
 * no way out. That trap is what made hiding the whole flow the safer option.
 *
 * Feats is now escapable, and `addGrantedFeats()` already runs on `show()` and
 * grants every feat the character's class entitles it to, so a custom character
 * leaves the flow valid. Manual feat *selection* stays unimplemented.
 */
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const QUICK_OR_CUSTOM = [
  'src/game/kotor/menu/CharGenQuickOrCustom.ts',
  'src/game/tsl/menu/CharGenQuickOrCustom.ts',
];

describe('the custom character button is offered', () => {
  for (const file of QUICK_OR_CUSTOM) {
    test(`${file} does not hide CUST_CHAR_BTN`, () => {
      expect(read(file)).not.toMatch(/this\.CUST_CHAR_BTN\.hide\(\);/);
    });

    test(`${file} still wires it to the custom panel`, () => {
      const source = read(file);
      expect(source).toMatch(/CUST_CHAR_BTN\.addEventListener\('click'/);
      expect(source).toMatch(/CharGenCustomPanel/);
    });
  }
});

describe('the Feats step is not a dead end', () => {
  const k1 = read('src/game/kotor/menu/CharGenFeats.ts');
  const tsl = read('src/game/tsl/menu/CharGenFeats.ts');

  test('Back and Accept are wired in the shared helper', () => {
    const at = k1.indexOf('wireStepNavigation()');
    expect(at).toBeGreaterThan(-1);
    const body = k1.slice(at, k1.indexOf('\n  async menuControlInitializer', at));
    expect(body).toMatch(/BTN_BACK\?\.addEventListener\('click'/);
    expect(body).toMatch(/BTN_ACCEPT\?\.addEventListener\('click'/);
  });

  test('both games reach the helper', () => {
    // TSL calls super with skipInit, so it must call the helper itself or the
    // buttons stay dead there even though K1 works.
    expect(k1).toMatch(/this\.wireStepNavigation\(\);/);
    expect(tsl).toMatch(/this\.wireStepNavigation\(\);/);
  });

  test('class feats are still granted when the screen opens', () => {
    expect(k1).toMatch(/show\(\)\s*\{[\s\S]{0,200}addGrantedFeats\(\)/);
  });
});
