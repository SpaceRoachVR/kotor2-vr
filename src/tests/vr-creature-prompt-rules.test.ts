import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  describeVRCreaturePromptAction,
  hasCreatureWorldPromptAction,
  readVRCreaturePromptState,
  VRCreaturePromptState,
} from '@/vr/runtime/VRCreaturePromptRules';

/**
 * Creatures were absent from the world-prompt type mask, so none could ever
 * become a candidate: walking up to 3C-FD or the Peragus medbay dummy produced
 * a reticle and a name label but no prompt, and the trigger did nothing.
 * Reported from a headset session.
 */
function state(overrides: Partial<VRCreaturePromptState> = {}): VRCreaturePromptState {
  return {
    isSelf: false,
    isDead: false,
    isHostile: false,
    hasConversation: true,
    isUseable: true,
    ...overrides,
  };
}

describe('hasCreatureWorldPromptAction', () => {
  test('offers a prompt for a living friendly creature with a conversation', () => {
    expect(hasCreatureWorldPromptAction(state())).toBe(true);
  });

  test('never targets the actor driving the prompt', () => {
    expect(hasCreatureWorldPromptAction(state({ isSelf: true }))).toBe(false);
  });

  // Living hostiles belong to VR combat targeting, which owns its own reticle
  // and attack routing; a Talk prompt would offer an affordance combat overrides.
  test('declines a living hostile even when it has a conversation', () => {
    expect(hasCreatureWorldPromptAction(state({ isHostile: true }))).toBe(false);
  });

  test('declines a living creature with no conversation', () => {
    expect(hasCreatureWorldPromptAction(state({ hasConversation: false }))).toBe(false);
  });

  // A corpse is a container: onClick routes to actionUseObject, and this is the
  // one case where hostility does not disqualify.
  test('offers a useable corpse regardless of hostility or conversation', () => {
    expect(hasCreatureWorldPromptAction(
      state({ isDead: true, isHostile: true, hasConversation: false }),
    )).toBe(true);
  });

  test('declines a corpse that is not useable', () => {
    expect(hasCreatureWorldPromptAction(state({ isDead: true, isUseable: false }))).toBe(false);
  });
});

describe('readVRCreaturePromptState', () => {
  const actor = { id: 1 };

  test('reads the live flags off an engine creature', () => {
    const target = {
      isDead: () => false,
      isHostile: () => false,
      isUseable: () => true,
      getConversation: () => ({ resref: '3cfd' }),
    };
    expect(readVRCreaturePromptState(actor, target)).toEqual({
      isSelf: false,
      isDead: false,
      isHostile: false,
      isUseable: true,
      hasConversation: true,
    });
  });

  test('an empty conversation resref is not a conversation', () => {
    const target = { getConversation: () => ({ resref: '' }) };
    expect(readVRCreaturePromptState(actor, target).hasConversation).toBe(false);
  });

  test('a missing conversation is not a conversation', () => {
    expect(readVRCreaturePromptState(actor, {}).hasConversation).toBe(false);
  });

  // Runs for every selectable object every frame: a creature mid-destruction
  // must degrade to "no prompt", never throw and suppress the candidate list.
  test('a throwing accessor degrades to false rather than propagating', () => {
    const target = {
      isDead: () => { throw new Error('destroyed'); },
      isHostile: () => { throw new Error('destroyed'); },
      isUseable: () => { throw new Error('destroyed'); },
      getConversation: () => { throw new Error('destroyed'); },
    };
    expect(readVRCreaturePromptState(actor, target)).toEqual({
      isSelf: false,
      isDead: false,
      isHostile: false,
      isUseable: false,
      hasConversation: false,
    });
  });

  test('detects the actor itself', () => {
    expect(readVRCreaturePromptState(actor, actor as never).isSelf).toBe(true);
  });
});

describe('describeVRCreaturePromptAction', () => {
  test('labels a living creature as Talk', () => {
    expect(describeVRCreaturePromptAction(state(), 42, '3C-FD')).toEqual({
      id: 'creature-use:42',
      label: 'Talk: 3C-FD',
    });
  });

  test('labels a corpse as Use, matching the actionUseObject route', () => {
    expect(describeVRCreaturePromptAction(state({ isDead: true }), 7, 'Dead Miner')?.label)
      .toBe('Use: Dead Miner');
  });

  test('returns null for a creature that does not qualify', () => {
    expect(describeVRCreaturePromptAction(state({ hasConversation: false }), 42, '3C-FD'))
      .toBeNull();
  });

  test('falls back to a generic name rather than an empty label', () => {
    expect(describeVRCreaturePromptAction(state(), 42, '   ')?.label).toBe('Talk: Creature');
  });
});

/**
 * The live 001EBO creature list, read out of a running session over CDP. These
 * are the exact objects the headset report was about, so the rule is pinned
 * against real authored data rather than invented shapes.
 */
describe('the real 001EBO creatures', () => {
  test.each([
    ['3C-FD', '3cfd', false, true],
    ['medbay dummy', 'dummy_pc', false, true],
    ['Sensor Droid', 'sens_drd', false, true],
    // HK-50 carries no conversation at this point in the prologue.
    ['HK Protocol Droid', '', false, false],
  ])('%s qualifies=%s', (_name, resref, isHostile, expected) => {
    const target = {
      isDead: () => false,
      isHostile: () => isHostile,
      isUseable: () => true,
      getConversation: () => ({ resref }),
    };
    expect(hasCreatureWorldPromptAction(readVRCreaturePromptState({}, target))).toBe(expected);
  });
});

/**
 * The wiring. GameState cannot be imported here — its module graph reaches the
 * whole engine — so these pin the two edits that make the rule reachable.
 */
describe('GameState world-prompt wiring', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/GameState.ts'), 'utf8');

  test('creatures are in the structural type mask', () => {
    const body = source.slice(source.search(/function isStructurallyValidVRWorldPromptTarget/));
    const method = body.slice(0, body.indexOf('\n}'));
    expect(method).toContain('ModuleObjectType.ModuleCreature');
  });

  test('a qualifying creature contributes a prompt action', () => {
    expect(source).toContain('describeVRCreaturePromptAction');
    expect(source).toMatch(/onClick\?\.\(actor\)/);
  });
});
