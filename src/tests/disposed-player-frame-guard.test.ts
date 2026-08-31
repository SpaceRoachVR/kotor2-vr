import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/**
 * `ModuleObject.dispose` sets `forceVector = undefined`, and `PartyManager`
 * still points at the outgoing module's party for a frame after a transition.
 * So a non-null player is not proof of a live vector.
 *
 * `UpdateIngame` read it behind only a player-exists check and threw every
 * frame — which stops the world advancing and presents as a freeze rather than
 * a crash. Ordinary play hides the window behind a loading screen; the module
 * sweep warps straight between areas and blocked on 5 of its first 17 modules.
 */
describe('the frame loop tolerates a disposed player', () => {
  const gameState = read('src/GameState.ts');
  const moduleObject = read('src/module/ModuleObject.ts');

  test('dispose keeps the small value objects a respawn needs', () => {
    // A disposed object is not always a discarded one: party members are
    // disposed on module unload and respawned into the next module on the SAME
    // instance. Nulling these left it a corpse — `onSpawn` calls
    // `computeBoundingBox`, which does `this.box.setFromObject(...)`, so the
    // module never finished loading and the sweep timed it out at 300s.
    for (const field of ['forceVector', 'box', 'sphere', 'v20', 'v21', 'actionQueue']) {
      expect(moduleObject).not.toMatch(new RegExp(`^\s*this\.${field} = undefined;`, 'm'));
    }
  });

  test('the action queue is emptied even though the queue survives', () => {
    // `clear()` is what releases the actions; nulling the queue on top froze
    // `actionQueueToActionList` on a respawned party member.
    expect(moduleObject).toMatch(/this\.actionQueue\.clear\(\);/);
  });

  test('references to other objects are still dropped', () => {
    // The distinction that matters: a reference to ANOTHER object must be
    // cleared or the outgoing module's graph is retained. Only the instance's
    // own small components survive.
    for (const field of ['area', 'room', 'lookAtObject', 'conversation', 'linkedToObject']) {
      expect(moduleObject).toMatch(new RegExp(`this\.${field} = undefined;`));
    }
  });

  test('the heavy resources are still released', () => {
    expect(moduleObject).toMatch(/this\.inventory\.length = 0;/);
    expect(moduleObject).toMatch(/this\.rooms\.length = 0;/);
    expect(moduleObject).toMatch(/this\.objectsInside\.length = 0;/);
  });

  test('UpdateIngame guards the vector, not merely the player', () => {
    expect(gameState).toMatch(/currentPlayer\?\.forceVector/);
    // The old form: a player-exists check followed by an unguarded read.
    expect(gameState).not.toMatch(
      /if\(GameState\.getCurrentPlayer\(\)\)\{\s*\n\s*GameState\.forwardVector\.copy\(GameState\.getCurrentPlayer\(\)\.forceVector\)/,
    );
  });

  test('the player is resolved once per frame, not twice', () => {
    expect(gameState).toMatch(/const currentPlayer = GameState\.getCurrentPlayer\(\);/);
  });
});
