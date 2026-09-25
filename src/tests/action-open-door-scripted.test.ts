import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ActionOpenDoor run by something that is not a creature (a console
 * placeable, a trigger, the door itself) is scripted door control and must
 * open a locked door: 102PER's a_shutdownff opens the four Blast Containment
 * Fields (Locked=1, KeyRequired=1, no key) from the Central Controller.
 * ActionOpenDoor pulls in GameState, so this pins the source.
 */
describe('ActionOpenDoor from a non-creature owner', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'actions', 'ActionOpenDoor.ts'), 'utf8');
  const start = source.indexOf('}else{', source.indexOf('this.target.use(GameState.PartyManager.party[0]);'));
  const branch = source.slice(start, source.indexOf('return ActionStatus.FAILED;', start));

  test('opens the door directly instead of going through use() and its lock check', () => {
    expect(branch).toContain('.openDoor(this.owner)');
    expect(branch).not.toContain('this.target.use(this.owner)');
  });

  test('a creature still goes through use(), so a player without the key is refused', () => {
    const creatureBranch = source.slice(source.indexOf('if(BitWise.InstanceOfObject(this.owner, ModuleObjectType.ModuleCreature))'), start);
    expect(creatureBranch).toContain('this.target.use(GameState.PartyManager.party[0])');
  });
});
