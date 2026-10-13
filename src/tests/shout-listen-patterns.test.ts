import { describe, expect, jest, test, beforeEach } from '@jest/globals';

jest.mock('@/GameState', () => ({ GameState: {
  ModuleObjectManager: { AddObjectById: jest.fn() },
  FactionManager: { AddCreatureToFaction: jest.fn() },
  SWRuleSet: { heads: [] as unknown[] },
  PartyManager: { party: [] as unknown[] },
  module: { area: { creatures: [] as unknown[] } },
  getCurrentPlayer: jest.fn(),
} }));

import * as THREE from 'three';
import { GameState } from '@/GameState';
import { ModuleCreature } from '@/module/ModuleCreature';
import { ModuleObjectScript } from '@/enums/module/ModuleObjectScript';
import { TalkVolume } from '@/enums/engine/TalkVolume';
import { matchListenPattern, takeHeardShout, talkVolumeReach } from '@/module/creature/ListenPatterns';

/**
 * Hive's audit (combat round 17): the shout system was dead for every
 * creature. Spoken strings are lowercased, retail registers its listen patterns
 * as authored (`GEN_I_WAS_ATTACKED`), and an unmatched string at the head of
 * the queue blocked it forever (Kreia held 15 shouts, droids up to 226).
 * SILENT_TALK never reached party members, and the controlled leader never
 * shouted when attacked, so companions joined a fight only once they were hit.
 */

/** k_inc_generic GN_SetListeningPatterns, as retail registers them. */
const RETAIL_PATTERNS = {
  GEN_I_WAS_ATTACKED: 1,
  GEN_I_AM_DEAD: 3,
  GEN_CALL_TO_ARMS: 6,
  GEN_GRENADE_TOSSED: 12,
  GEN_I_SEE_AN_ENEMY: 14,
  GEN_COMBAT_ACTIVE: 15,
};

function creature(position: [number, number, number] = [0, 0, 0]): ModuleCreature {
  const c = Object.create(ModuleCreature.prototype) as ModuleCreature;
  Object.assign(c, {
    position: new THREE.Vector3(...position),
    heardStrings: [],
    listeningPatterns: {},
    isListening: false,
    scripts: {},
    isDead: jest.fn(() => false),
  });
  return c;
}

function listener(position: [number, number, number] = [0, 0, 0]): ModuleCreature {
  const c = creature(position);
  c.setListening(true);
  for(const [pattern, id] of Object.entries(RETAIL_PATTERNS)) c.setListeningPattern(pattern, id);
  (c as any).onDialog = jest.fn(() => true);
  return c;
}

const G = GameState as any;

beforeEach(() => {
  G.PartyManager.party = [];
  G.module.area.creatures = [];
  G.getCurrentPlayer = jest.fn(() => undefined);
});

describe('matchListenPattern', () => {
  test('matches a lowercased shout against the authored pattern', () => {
    expect(matchListenPattern(RETAIL_PATTERNS, 'gen_i_was_attacked')).toBe(1);
    expect(matchListenPattern(RETAIL_PATTERNS, 'GEN_COMBAT_ACTIVE')).toBe(15);
  });

  test('a string no pattern names matches nothing', () => {
    expect(matchListenPattern(RETAIL_PATTERNS, 'hello there')).toBeUndefined();
    expect(matchListenPattern({}, 'gen_i_was_attacked')).toBeUndefined();
    expect(matchListenPattern(undefined, 'gen_i_was_attacked')).toBeUndefined();
  });
});

describe('takeHeardShout', () => {
  test('an unmatched string is consumed and does not block the shout behind it', () => {
    const queue = { isListening: true, listeningPatterns: RETAIL_PATTERNS, heardStrings: [
      { speaker: 'a', string: 'unrelated bark' },
      { speaker: 'b', string: 'gen_i_was_attacked' },
    ] };
    expect(takeHeardShout(queue)).toBeUndefined();
    expect(queue.heardStrings).toHaveLength(1);
    expect(takeHeardShout(queue)).toEqual({ speaker: 'b', pattern: 1 });
    expect(queue.heardStrings).toHaveLength(0);
  });

  test('a creature that is not listening hears nothing and keeps nothing', () => {
    const queue = { isListening: false, listeningPatterns: RETAIL_PATTERNS, heardStrings: [
      { speaker: 'a', string: 'gen_i_was_attacked' },
      { speaker: 'b', string: 'gen_i_was_attacked' },
    ] };
    expect(takeHeardShout(queue)).toBeUndefined();
    expect(queue.heardStrings).toHaveLength(0);
  });
});

describe('talkVolumeReach', () => {
  test('both silent volumes reach party members as well as area creatures', () => {
    expect(talkVolumeReach(TalkVolume.SILENT_TALK)).toEqual({ range: 20, creatures: true, party: true });
    expect(talkVolumeReach(TalkVolume.SILENT_SHOUT)).toEqual({ range: 1000, creatures: true, party: true });
  });

  test('the audible volumes are unchanged: no listener is notified', () => {
    for(const volume of [TalkVolume.TALK, TalkVolume.WHISPER, TalkVolume.SHOUT]){
      expect(talkVolumeReach(volume)).toMatchObject({ creatures: false, party: false });
    }
  });
});

describe('a companion hears a silent-talk shout and answers it', () => {
  test('SILENT_TALK reaches a party member within 20 m, not one beyond it', () => {
    const leader = creature([0, 0, 0]);
    const near = listener([3, 0, 0]);
    const far = listener([25, 0, 0]);
    G.PartyManager.party = [leader, near, far];

    leader.speakString('GEN_I_WAS_ATTACKED', TalkVolume.SILENT_TALK);

    expect(near.heardStrings).toHaveLength(1);
    expect(far.heardStrings).toHaveLength(0);
    expect(leader.heardStrings).toHaveLength(0);
  });

  test('a creature in both lists hears a shout once', () => {
    const speaker = creature([0, 0, 0]);
    const both = listener([1, 0, 0]);
    G.PartyManager.party = [speaker, both];
    G.module.area.creatures = [both];

    speaker.speakString('GEN_I_WAS_ATTACKED', TalkVolume.SILENT_SHOUT);

    expect(both.heardStrings).toHaveLength(1);
  });

  test('the companion runs its OnDialog with the matched pattern number', () => {
    const leader = creature([0, 0, 0]);
    const kreia = listener([2, 0, 0]);
    G.PartyManager.party = [leader, kreia];

    leader.speakString('GEN_I_WAS_ATTACKED', TalkVolume.SILENT_TALK);
    kreia.updateListeningPatterns();

    expect((kreia as any).onDialog).toHaveBeenCalledWith(leader, 1);
    expect(kreia.heardStrings).toHaveLength(0);
  });

  test('an unmatched string never jams the queue', () => {
    const speaker = creature([0, 0, 0]);
    const atton = listener([2, 0, 0]);
    G.PartyManager.party = [speaker, atton];

    speaker.speakString('something nobody listens for', TalkVolume.SILENT_TALK);
    speaker.speakString('GEN_I_WAS_ATTACKED', TalkVolume.SILENT_TALK);
    atton.updateListeningPatterns();
    atton.updateListeningPatterns();

    expect((atton as any).onDialog).toHaveBeenCalledTimes(1);
    expect((atton as any).onDialog).toHaveBeenCalledWith(speaker, 1);
    expect(atton.heardStrings).toHaveLength(0);
  });
});

describe('the controlled leader is attacked', () => {
  function leaderWithAttackedScript(){
    const leader = creature([0, 0, 0]);
    const run = jest.fn();
    (leader as any).scripts = { [ModuleObjectScript.CreatureOnAttacked]: { newInstance: () => ({ run }) } };
    G.getCurrentPlayer = jest.fn(() => leader);
    return { leader, run };
  }

  test('shouts GEN_I_WAS_ATTACKED as a silent shout and runs no AI script', () => {
    const { leader, run } = leaderWithAttackedScript();
    const kreia = listener([10, 0, 0]);
    G.PartyManager.party = [leader, kreia];

    leader.onAttacked(0 as any);

    expect(run).not.toHaveBeenCalled();
    expect(kreia.heardStrings).toHaveLength(1);
    expect(kreia.heardStrings[0]).toMatchObject({ speaker: leader, volume: TalkVolume.SILENT_SHOUT });
    kreia.updateListeningPatterns();
    expect((kreia as any).onDialog).toHaveBeenCalledWith(leader, 1);
  });

  test('a leader with no OnAttacked script stays silent, as retail would', () => {
    const leader = creature([0, 0, 0]);
    G.getCurrentPlayer = jest.fn(() => leader);
    const kreia = listener([2, 0, 0]);
    G.PartyManager.party = [leader, kreia];

    leader.onAttacked(0 as any);

    expect(kreia.heardStrings).toHaveLength(0);
  });

  test('a companion that is attacked still runs its own script (2005), unchanged', () => {
    const { leader } = leaderWithAttackedScript();
    const atton = listener([2, 0, 0]);
    const run = jest.fn();
    (atton as any).scripts = { [ModuleObjectScript.CreatureOnAttacked]: { newInstance: () => ({ run }) } };
    G.PartyManager.party = [leader, atton];

    atton.onAttacked(0 as any);

    expect(run).toHaveBeenCalledWith(atton, 2005);
  });
});
