import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SwitchPlayerCharacter must snapshot the OUTGOING player before it assigns
 * the incoming member. It used to assign first and then test
 * `PartyManager.Player.isPlayer` - the incoming NPC - so the real player's
 * template was never written, and switching back (-1) rebuilt the player
 * from the character-creation template: the Exile came back from T3-M4's
 * Peragus errand at level 1 with 12 HP and no experience.
 */
describe('SwitchPlayerCharacter saves the outgoing player', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'managers', 'PartyManager.ts'), 'utf8');
  const start = source.indexOf('static SwitchPlayerCharacter(');
  const body = source.slice(start, source.indexOf('static Save()', start));

  test('snapshots oldPC before PartyManager.Player is reassigned', () => {
    const snapshot = body.indexOf('PartyManager.ActualPlayerTemplate = oldPC.save()');
    const assign = body.indexOf('PartyManager.Player = partyMember;');
    expect(snapshot).toBeGreaterThan(0);
    expect(assign).toBeGreaterThan(snapshot);
    expect(body).toContain('if(oldPC && oldPC.isPlayer && npcId >= 0)');
    expect(body).not.toContain('PartyManager.ActualPlayerTemplate = PartyManager.Player.save()');
  });
});
