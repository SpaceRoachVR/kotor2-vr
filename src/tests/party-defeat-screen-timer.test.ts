import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { PartyDefeatScreenTimer } from '@/module/creature/PartyDefeatScreenTimer';

/**
 * Round 8 ended in "a full freeze while encountering a mining droid on
 * Peragus". The log: a Critical Hit from a Damaged Mining Droid, "[Party] every
 * party member is down; opening Load Game", then `SetEngineMode: 1` four
 * seconds later — the screen was closed — and nothing after it but refused
 * swings from a dead Exile.
 */
describe('PartyDefeatScreenTimer', () => {
  // Critic run 6: the screen snapped open on the first frame; it now waits a
  // beat so the last blow is seen landing.
  const open = (timer: PartyDefeatScreenTimer) => timer.defeated(PartyDefeatScreenTimer.OPEN_DELAY_SECONDS);

  test('a defeat opens the screen after a short beat, not on the first frame', () => {
    const timer = new PartyDefeatScreenTimer();
    expect(timer.defeated(0.016)).toBeNull();
    expect(timer.defeated(PartyDefeatScreenTimer.OPEN_DELAY_SECONDS)).toBe('open');
  });

  test('closing the screen brings it back after the player has been in the game a moment', () => {
    const timer = new PartyDefeatScreenTimer();
    open(timer);
    let result: string | null = null;
    let seconds = 0;
    while (result === null && seconds < 10) {
      seconds += 0.1;
      result = timer.defeated(0.1);
    }
    expect(result).toBe('reopen');
    expect(seconds).toBeCloseTo(PartyDefeatScreenTimer.REOPEN_SECONDS, 5);
  });

  test('it keeps coming back for as long as the party stays down', () => {
    const timer = new PartyDefeatScreenTimer();
    open(timer);
    expect(timer.defeated(PartyDefeatScreenTimer.REOPEN_SECONDS)).toBe('reopen');
    expect(timer.defeated(0.5)).toBeNull();
    expect(timer.defeated(PartyDefeatScreenTimer.REOPEN_SECONDS)).toBe('reopen');
  });

  test('a bad frame delta never counts toward reopening', () => {
    const timer = new PartyDefeatScreenTimer();
    open(timer);
    expect(timer.defeated(Number.NaN)).toBeNull();
    expect(timer.defeated(-5)).toBeNull();
  });

  test('once someone stands, the next defeat starts over with the same beat', () => {
    const timer = new PartyDefeatScreenTimer();
    open(timer);
    timer.reset();
    expect(timer.defeated(0)).toBeNull();
    expect(open(timer)).toBe('open');
  });
});

/** ModuleCreature reaches the engine graph, so the wiring is pinned by source. */
describe('ModuleCreature party defeat wiring', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/module/ModuleCreature.ts'), 'utf8');
  const body = source.slice(source.indexOf('updateDownedPartyMember(delta = 0){'));
  const method = body.slice(0, body.indexOf('\n  }\n'));

  test('the screen is driven by the timer, not a one-shot flag', () => {
    expect(method).toContain('ModuleCreature.partyDefeatScreen.defeated(delta)');
    expect(source).not.toContain('partyDefeatHandled');
  });

  test('only the first downed member advances it, so two downed members do not double the clock', () => {
    const firstDownAt = method.indexOf('if(firstDown !== this) return;');
    expect(firstDownAt).toBeGreaterThan(-1);
    expect(firstDownAt).toBeLessThan(method.indexOf('partyDefeatScreen.defeated(delta)'));
  });

  test('a member standing again resets it', () => {
    expect(method.split('ModuleCreature.partyDefeatScreen.reset()').length - 1).toBeGreaterThanOrEqual(2);
  });
});
