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

  const player = { id: 'player' };
  const companion = { id: 'atton' };

  function suppressForPlayer(): void {
    ActionApproachPolicy.setControlledActorProbe((actor) => actor === player);
    ActionApproachPolicy.setApproachSuppressed(true);
  }

  test('desktop behaviour is the default', () => {
    expect(ActionApproachPolicy.isApproachSuppressedFor(player)).toBe(false);
  });

  test('suppression is explicit and reversible', () => {
    suppressForPlayer();
    expect(ActionApproachPolicy.isApproachSuppressedFor(player)).toBe(true);

    ActionApproachPolicy.setApproachSuppressed(false);
    expect(ActionApproachPolicy.isApproachSuppressedFor(player)).toBe(false);
  });

  test('only the controlled actor stops walking', () => {
    // Party members and NPCs have no headset and no rig. A global suppression
    // would silently break follow, combat approach, and scripted movement for
    // every creature in the module.
    suppressForPlayer();

    expect(ActionApproachPolicy.isApproachSuppressedFor(player)).toBe(true);
    expect(ActionApproachPolicy.isApproachSuppressedFor(companion)).toBe(false);
    expect(ActionApproachPolicy.isApproachSuppressedFor(null)).toBe(false);
  });

  test('a probe that throws leaves the actor walking', () => {
    // Stranding an actor mid-action is worse than an unwanted approach.
    ActionApproachPolicy.setControlledActorProbe(() => { throw new Error('boom'); });
    ActionApproachPolicy.setApproachSuppressed(true);

    expect(ActionApproachPolicy.isApproachSuppressedFor(player)).toBe(false);
  });

  test('rejects a non-function probe', () => {
    expect(() => ActionApproachPolicy.setControlledActorProbe(
      null as unknown as (actor: unknown) => boolean
    )).toThrow(TypeError);
  });

  test('only a strict true suppresses', () => {
    for (const value of [1, 'true', {}, []] as unknown as boolean[]) {
      ActionApproachPolicy.setControlledActorProbe((actor) => actor === player);
      ActionApproachPolicy.setApproachSuppressed(value);

      expect(ActionApproachPolicy.isApproachSuppressedFor(player)).toBe(false);
    }
  });

  test('reset restores desktop behaviour and forgets the probe', () => {
    suppressForPlayer();

    ActionApproachPolicy.reset();

    expect(ActionApproachPolicy.isApproachSuppressedFor(player)).toBe(false);
  });
});
