import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Two defects behind the headset menu reports.
 *
 * 1. `GameMenu.getActiveControls` did `controls.concat(controls, child)`, which
 *    appends this menu's own controls a second time. Every hit-test result came
 *    back duplicated — the headset logs show it plainly, e.g. a single label
 *    reported as "[LBL_BAR3(...), LBL_BAR3(...)]". On the legacy mouse path
 *    that means each control receives mouseDown twice.
 *
 * 2. `BTN_LEVELUP` is hidden during MenuCharacter setup alongside `BTN_AUTO`,
 *    and nothing ever showed it again — `updateCharacterStats` revealed only
 *    Auto. The Level Up button was therefore permanently invisible, which is
 *    what "the level up button still does nothing" was describing: a handler
 *    had already been added for it, but the control could never be pointed at.
 */
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('the GUI hit test does not duplicate a menu\'s own controls', () => {
  const source = read('src/gui/GameMenu.ts');

  test('the child-menu concat does not re-append controls', () => {
    expect(source).not.toMatch(/controls\.concat\(\s*controls\s*,/);
  });

  test('it still includes the child menu', () => {
    expect(source).toMatch(/controls\.concat\(\s*this\.childMenu\.getActiveControls\(\)\s*\)/);
  });
});

describe('the Level Up button can be seen when it can be used', () => {
  const source = read('src/game/kotor/menu/MenuCharacter.ts');
  const at = source.indexOf('if (character.canLevelUp())');
  const branch = source.slice(at, at + 400);

  test('canLevelUp shows both Auto and Level Up', () => {
    expect(at).toBeGreaterThan(-1);
    expect(branch).toMatch(/BTN_AUTO\?\.show\(\)/);
    expect(branch).toMatch(/BTN_LEVELUP\?\.show\(\)/);
  });

  test('and hides both when the character cannot level', () => {
    expect(branch).toMatch(/BTN_AUTO\?\.hide\(\)/);
    expect(branch).toMatch(/BTN_LEVELUP\?\.hide\(\)/);
  });

  test('the button still carries a click handler in both games', () => {
    expect(source).toMatch(/BTN_LEVELUP\?\.addEventListener\('click'/);
    expect(read('src/game/tsl/menu/MenuCharacter.ts'))
      .toMatch(/BTN_LEVELUP\?\.addEventListener\('click'/);
  });
});
