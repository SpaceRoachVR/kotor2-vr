import { afterEach, describe, expect, test } from '@jest/globals';
import { ActionApproachPolicy } from '@/engine/interaction/ActionApproachPolicy';

/**
 * The approach walk is correct on desktop and wrong in VR, so both directions
 * matter: suppressing it must not leak out of an immersive session, and failing
 * to suppress it drags the player through the world.
 */
describe('ActionApproachPolicy', () => {
  afterEach(() => {
    ActionApproachPolicy.reset();
  });

  test('desktop behaviour is the default', () => {
    expect(ActionApproachPolicy.isApproachSuppressed()).toBe(false);
  });

  test('suppression is explicit and reversible', () => {
    ActionApproachPolicy.setApproachSuppressed(true);
    expect(ActionApproachPolicy.isApproachSuppressed()).toBe(true);

    ActionApproachPolicy.setApproachSuppressed(false);
    expect(ActionApproachPolicy.isApproachSuppressed()).toBe(false);
  });

  test('only a strict true suppresses', () => {
    // Guards against a truthy value from a hook or config silently disabling
    // click-to-walk for desktop players.
    for (const value of [1, 'true', {}, []] as unknown as boolean[]) {
      ActionApproachPolicy.setApproachSuppressed(value);

      expect(ActionApproachPolicy.isApproachSuppressed()).toBe(false);
    }
  });

  test('reset restores desktop behaviour', () => {
    ActionApproachPolicy.setApproachSuppressed(true);

    ActionApproachPolicy.reset();

    expect(ActionApproachPolicy.isApproachSuppressed()).toBe(false);
  });
});
