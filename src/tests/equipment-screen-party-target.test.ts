import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Every read on the equipment screen has to resolve to the same character.
 *
 * TSL's screen switches party member with BTN_NEXTNPC/BTN_PREVNPC. It overrode
 * updateSlotIcons, updateCharacterStats and isSlotLocked to follow
 * currentNPCIndex, and its BTN_EQUIP equips onto that character -- but
 * updateList delegates to the K1 base and updateListHover is not overridden at
 * all, and both read PartyManager.party[0] directly. Select any companion and
 * the screen offered party[0]'s equippable items, showed party[0]'s worn row,
 * and then equipped the choice onto the companion.
 *
 * Latent while the party is one character, which is the whole of the Peragus
 * prologue; live the moment Kreia and Atton join, which is the next slice.
 *
 * The fix is a single overridable accessor, so the guard is that neither class
 * reaches past it to index the party array inside the screen's own logic.
 *
 * Source-level for the same reason as the other menu tests here: these classes
 * pull in GameState, the GUI control tree and the whole module graph, and the
 * defect is a direct property read that a grep detects exactly.
 */
const K1 = 'src/game/kotor/menu/MenuEquipment.ts';
const TSL = 'src/game/tsl/menu/MenuEquipment.ts';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const sources: Array<[string, string]> = [[K1, read(K1)], [TSL, read(TSL)]];

describe('the equipment screen resolves one character', () => {
  for (const [name, contents] of sources) {
    describe(name, () => {
      test('declares or inherits a single equipment target accessor', () => {
        expect(contents).toMatch(/getEquipmentTarget\(\)\s*:\s*ModuleCreature\s*\{/);
      });

      test('no character-scoped read reaches past the accessor', () => {
        // party[i] inside a loop over the whole party is a different question
        // and stays allowed; what must not recur is a read that picks out THE
        // character the screen is editing.
        const SCOPED = /GameState\.PartyManager\.party\[(?:0|this\.currentNPCIndex)\]/g;

        const definition = contents.match(
          /getEquipmentTarget\(\)\s*:\s*ModuleCreature\s*\{[\s\S]*?\n  \}/,
        );
        expect(definition).not.toBeNull();

        const inAccessor = (definition as RegExpMatchArray)[0].match(SCOPED) || [];
        const inFile = contents.match(SCOPED) || [];
        expect(inAccessor).toHaveLength(1);
        expect(inFile).toHaveLength(inAccessor.length);
      });
    });
  }

  test('K1 answers the party leader', () => {
    const contents = read(K1);
    expect(contents).toMatch(/getEquipmentTarget\(\)[\s\S]{0,120}?party\[0\]/);
  });

  test('TSL answers the character the screen is showing', () => {
    const contents = read(TSL);
    expect(contents).toMatch(/getEquipmentTarget\(\)[\s\S]{0,120}?party\[this\.currentNPCIndex\]/);
  });

  test('TSL still tracks a selected party member', () => {
    expect(read(TSL)).toMatch(/currentNPCIndex\s*:\s*number/);
  });
});
