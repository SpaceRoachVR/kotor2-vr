import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { shouldPlayEngineCombatSound } from '@/engine/rules/EngineCombatSoundGate';

// Critic run 9: the gates read combatData.combatAction, which nothing
// assigns, so no creature's impact played (flatscreen too) and the VR
// de-duplication did nothing.
describe('engine combat sounds', () => {
  const base = { landed: true, swingerIsPlayer: false, vrVoices: false };
  test('flatscreen and NPC fights: a landed blow sounds; a miss has no impact', () => {
    expect(shouldPlayEngineCombatSound({ ...base, event: 'hit' })).toBe(true);
    expect(shouldPlayEngineCombatSound({ ...base, event: 'hit', landed: false })).toBe(false);
    expect(shouldPlayEngineCombatSound({ ...base, event: 'swing', landed: false })).toBe(true);
    expect(shouldPlayEngineCombatSound({ ...base, event: 'parry' })).toBe(true);
  });
  test('VR voices the player\'s blows and parries, not an enemy\'s missed swing', () => {
    const vr = { ...base, vrVoices: true };
    expect(shouldPlayEngineCombatSound({ ...vr, event: 'hit' })).toBe(false);
    expect(shouldPlayEngineCombatSound({ ...vr, event: 'parry' })).toBe(false);
    expect(shouldPlayEngineCombatSound({ ...vr, event: 'swing', landed: false, swingerIsPlayer: true })).toBe(false);
    expect(shouldPlayEngineCombatSound({ ...vr, event: 'swing', landed: false, swingerIsPlayer: false })).toBe(true);
    // Part D (Spark Finding 4): the hidden body's whooshes trailed every
    // landed hit and read as misses. VR plays one whoosh at the stroke.
    expect(shouldPlayEngineCombatSound({ ...vr, event: 'swing', landed: true, swingerIsPlayer: true })).toBe(false);
    expect(shouldPlayEngineCombatSound({ ...vr, event: 'swing', landed: true, swingerIsPlayer: false })).toBe(true);
  });
  test('the gates read the round\'s live action, not the unassigned field', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'module', 'ModuleCreature.ts'), 'utf8');
    const playEvent = source.slice(source.indexOf('  playEvent(event: THREE.Event){'));
    const body = playEvent.slice(0, playEvent.indexOf('\n  }\n'));
    expect(body).not.toMatch(/combatData\.combatAction\?\.hits/);
    expect(source).toContain('const action: any = this.combatRound?.action;');
  });
});

// Critic run 10: retail models send 'hit' (Peragus mining droids) and
// 'contact' (every parry); exact matching left them silent.
import { canonicalAnimationEvent } from '@/engine/rules/EngineCombatSoundGate';
test('animation events match whatever case the model used', () => {
  expect(canonicalAnimationEvent('hit')).toBe('Hit');
  expect(canonicalAnimationEvent('Hit')).toBe('Hit');
  expect(canonicalAnimationEvent('contact')).toBe('Contact');
  expect(canonicalAnimationEvent('HITPARRY')).toBe('HitParry');
  expect(canonicalAnimationEvent('snd_footstep')).toBe('snd_footstep');
  expect(canonicalAnimationEvent('custom')).toBe('custom');
});
