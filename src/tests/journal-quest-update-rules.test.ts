import { describe, expect, test } from '@jest/globals';
import { resolveJournalQuestUpdate } from '../engine/JournalQuestUpdateRules';

/**
 * nwscript.nss 367 AddJournalQuestEntry: "bAllowOverrideHigher: If this is
 * TRUE, you can set the state to a lower number than the one it is currently
 * on". Retail scripts lean on the call being a no-op when nothing changes:
 * 106PER's JournalRescue trigger runs k_rescuejrl
 * (AddJournalQuestEntry("RescuePC", 10, 0)) from its heartbeat, and the
 * journal chime played on every heartbeat for as long as the area was loaded.
 */
describe('AddJournalQuestEntry state rules', () => {
  test('a first entry is added and announced', () => {
    expect(resolveJournalQuestUpdate(undefined, 10, false)).toEqual({ state: 10, changed: true });
  });

  test('re-adding the same state changes nothing and is silent', () => {
    expect(resolveJournalQuestUpdate(10, 10, false)).toEqual({ state: 10, changed: false });
    expect(resolveJournalQuestUpdate(10, 10, true)).toEqual({ state: 10, changed: false });
  });

  test('a higher state advances the quest', () => {
    expect(resolveJournalQuestUpdate(10, 20, false)).toEqual({ state: 20, changed: true });
  });

  test('a lower state is refused unless bAllowOverrideHigher', () => {
    expect(resolveJournalQuestUpdate(30, 10, false)).toEqual({ state: 30, changed: false });
    expect(resolveJournalQuestUpdate(30, 10, true)).toEqual({ state: 10, changed: true });
  });
});
