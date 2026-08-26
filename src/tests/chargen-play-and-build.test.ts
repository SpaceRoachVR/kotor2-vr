import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/**
 * Play from the custom panel hung on the loading screen forever. TSL overrides
 * CharGenQuickPanel to load `001EBO` but does not override CharGenCustomPanel,
 * so the custom path ran K1's step 6 and asked for `end_m01aa` — K1's Endar
 * Spire module, which is not among the TSL install's 246 modules.
 */
describe('the finished character is dropped into a module that exists', () => {
  test('the K1 panel exposes an overridable start module', () => {
    expect(read('src/game/kotor/menu/CharGenCustomPanel.ts'))
      .toMatch(/protected getStartModule\(\): string \{[\s\S]{0,80}'end_m01aa'/);
  });

  test('TSL overrides it to the Ebon Hawk', () => {
    expect(read('src/game/tsl/menu/CharGenCustomPanel.ts'))
      .toMatch(/getStartModule\(\): string \{[\s\S]{0,60}'001EBO'/);
  });

  test('step 6 loads it rather than a hard-coded name', () => {
    expect(read('src/game/kotor/menu/CharGenCustomPanel.ts'))
      .toMatch(/LoadModule\(this\.getStartModule\(\)\)/);
  });
});

/**
 * The feats list rendered as an empty box. Only a prerequisite-free feat roots
 * a chain and gets anything pushed into its group, but a group was appended
 * regardless — so the sort read `groupa[0].toolsCategories` off undefined and
 * threw, aborting before setItems.
 */
describe('the feat list survives feats that have prerequisites', () => {
  const source = read('src/game/kotor/menu/CharGenFeats.ts');

  test('only populated groups are collected', () => {
    const guardAt = source.indexOf('if (!prereqfeat1 && !prereqfeat2) {');
    const sortAt = source.indexOf('groups.sort(');
    expect(guardAt).toBeGreaterThan(-1);
    expect(sortAt).toBeGreaterThan(guardAt);

    // Exactly one push, and it sits inside the prerequisite-free branch.
    const pushes = source.match(/groups\.push\(group\);/g) || [];
    expect(pushes).toHaveLength(1);

    const branch = source.slice(guardAt, sortAt);
    expect(branch).toContain('groups.push(group);');
    // Indented one level deeper than the loop body, i.e. inside the guard.
    expect(branch).toMatch(/\n {8}groups\.push\(group\);/);
  });

  test('the comparator tolerates a missing head', () => {
    expect(source).toMatch(/groupa\[0\]\?\.toolsCategories/);
    expect(source).toMatch(/groupb\[0\]\?\.toolsCategories/);
  });

  test('the list is still applied to the control', () => {
    expect(source).toMatch(/this\.LB_FEATS\.setItems\(groups\)/);
  });
});

/**
 * Quick creation is Portrait -> Name -> Play and never opens the attributes or
 * skills screens — and CharGenSkills' Accept button is the only writer of
 * skills[i].rank in the engine. So a quick character kept the class template's
 * base skills and discarded every point it was owed.
 */
describe('a quick character actually spends its points', () => {
  const manager = read('src/managers/CharGenManager.ts');

  test('applyRecommendedBuild commits attributes to the creature', () => {
    expect(manager).toMatch(/creature\.str = CharGenManager\.str/);
    expect(manager).toMatch(/creature\.cha = CharGenManager\.cha/);
  });

  test('and commits skill ranks, which nothing else on that path does', () => {
    expect(manager).toMatch(/creature\.skills\[i\]\.rank = \(CharGenManager as any\)\[fields\[i\]\]/);
  });

  test('the distribution cannot spin forever on an empty recommended order', () => {
    // The Recommended handlers decrement only when skillIndex >= 0, so an order
    // of all -1 loops indefinitely.
    expect(manager).toMatch(/guard-- > 0/);
    expect(manager).toMatch(/if\(!spent\) break;/);
  });

  test.each([
    ['src/game/kotor/menu/CharGenQuickPanel.ts'],
    ['src/game/tsl/menu/CharGenQuickPanel.ts'],
  ])('%s applies it before saving', (file) => {
    const source = read(file);
    const applied = source.indexOf('applyRecommendedBuild()');
    const saved = source.indexOf('selectedCreature.save()');
    expect(applied).toBeGreaterThan(-1);
    expect(applied).toBeLessThan(saved);
  });
});
