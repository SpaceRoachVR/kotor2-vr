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

  test('dispose really does clear the vector the frame loop reads', () => {
    expect(moduleObject).toMatch(/this\.forceVector = undefined;/);
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
