import { expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Autobalance state has to survive a save/load, under the names and types a
 * retail SAVEGAME.sav uses (tools/parity/save_schema.py): MultiplierSet and
 * PCLevelAtSpawn, both BYTE. Without them a loaded enemy re-rolled its
 * autobalance against the player's current level.
 */
const source = fs.readFileSync(path.join(__dirname, '..', 'module', 'ModuleCreature.ts'), 'utf8');

test.each(['MultiplierSet', 'PCLevelAtSpawn'])('ModuleCreature.save writes BYTE %s', (label) => {
  expect(source).toContain(`new GFFField(GFFDataType.BYTE, '${label}') ).setValue(`);
});

test('PCLevelAtSpawn is read back', () => {
  expect(source).toContain("hasField('PCLevelAtSpawn')");
});
