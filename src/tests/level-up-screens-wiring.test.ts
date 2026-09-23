import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/**
 * How the level-up screens hang together. Source-shape assertions, as in
 * `chargen-feat-selection.test.ts`: the menus import the GUI barrel, which Jest
 * cannot load. The rules and the session carry behavioural tests of their own.
 */
describe('Level Up opens the real level-up steps', () => {
  const k1Character = read('src/game/kotor/menu/MenuCharacter.ts');
  const tslCharacter = read('src/game/tsl/menu/MenuCharacter.ts');

  test('Level Up opens the step panel and Auto spends through the same session, in both games', () => {
    for (const source of [k1Character, tslCharacter]) {
      expect(source).toMatch(/MenuLevelUp\?\.beginLevelUp\(character\)/);
      expect(source).toMatch(/MenuLevelUp\?\.autoLevelUp\(character\)/);
      expect(source).not.toMatch(/\.autoLevelUp\(\);/);
    }
  });

  test('TSL wires the panel and the powers screen its K1 parents define', () => {
    expect(read('src/game/tsl/menu/MenuLevelUp.ts')).toMatch(/this\.wireLevelUpPanel\(\)/);
    expect(read('src/game/tsl/menu/MenuPowerLevelUp.ts')).toMatch(/this\.wirePowerControls\(\)/);
    expect(read('src/game/tsl/menu/CharGenAbilities.ts')).toMatch(/this\.wireAbilityControls\(\)/);
  });

  test('the panel loads its screens, which a save loaded from the main menu never did', () => {
    expect(read('src/game/kotor/menu/MenuLevelUp.ts')).toMatch(/this\.manager\.LoadLevelUpMenus\(\)/);
    expect(read('src/managers/MenuManager.ts')).toMatch(/static async LoadLevelUpMenus\(\)/);
  });

  test('closing the panel without Accept abandons the level', () => {
    const panel = read('src/game/kotor/menu/MenuLevelUp.ts');
    expect(panel).toMatch(/close\(\)\{\s*this\.endSession\(\);\s*super\.close\(\);/);
    expect(panel).toMatch(/if\(session\.isActive\) session\.cancel\(\);/);
  });
});

describe('the reused character-creation screens report level-up steps', () => {
  test('each Accept completes its own step', () => {
    expect(read('src/game/kotor/menu/CharGenAbilities.ts')).toMatch(/levelUp\.completeStep\('attributes'\)/);
    expect(read('src/game/kotor/menu/CharGenSkills.ts')).toMatch(/levelUp\?\.completeStep\('skills'\)/);
    expect(read('src/game/kotor/menu/CharGenFeats.ts')).toMatch(/levelUp\?\.completeStep\('feats'\)/);
    expect(read('src/game/kotor/menu/MenuPowerLevelUp.ts')).toMatch(/levelUp\?\.completeStep\('powers'\)/);
  });

  test('a level-up point costs one and cannot refund a score owned before the level', () => {
    const abilities = read('src/game/kotor/menu/CharGenAbilities.ts');
    expect(abilities).toMatch(/if\(GameState\.CharGenManager\.levelUp\) return 1;/);
    expect(abilities).toMatch(/if\(levelUp\) return levelUp\.baseline\.abilities\[field\];/);
  });

  test('the character-creation main screen is only updated outside a level-up', () => {
    expect(read('src/game/kotor/menu/CharGenAbilities.ts')).toMatch(/\}else\{\s*this\.manager\.CharGenMain\?\.updateAttributes\(\);/);
  });

  test('skills Recommended in a level-up does not zero ranks already owned', () => {
    const skills = read('src/game/kotor/menu/CharGenSkills.ts');
    expect(skills).toMatch(/if\(levelUp\)\{[\s\S]{0,300}this\.primeLevelUpSkills\(\);/);
  });

  test('feat picks in a level-up are the level\'s own allowance', () => {
    expect(read('src/game/kotor/menu/CharGenFeats.ts'))
      .toMatch(/if\(levelUp\) return Math\.max\(0, levelUp\.allowances\.featPicks - this\.selectedFeatIds\.size\);/);
  });
});
