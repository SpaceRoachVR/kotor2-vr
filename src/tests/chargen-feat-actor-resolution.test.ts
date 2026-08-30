import { describe, expect, test } from '@jest/globals';
import { resolveGUIFeatActor } from '@/game/kotor/gui/resolveGUIFeatActor';

const chargenCreature = { getHasFeat: (id: number) => id === 10 };
const worldPlayer = { getHasFeat: (id: number) => id === 20 };

describe('GUI feat actor resolution', () => {
  test('prefers the creature supplied by a character-generation menu', () => {
    expect(resolveGUIFeatActor({ creature: chargenCreature }, worldPlayer)).toBe(chargenCreature);
  });

  test('uses the normal world player when no menu creature is present', () => {
    expect(resolveGUIFeatActor({}, worldPlayer)).toBe(worldPlayer);
  });

  test('rejects objects that do not implement the feat actor contract', () => {
    expect(resolveGUIFeatActor({ creature: {} }, { getHasFeat: 'nope' })).toBeUndefined();
  });
});
