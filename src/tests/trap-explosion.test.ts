import { jest } from '@jest/globals';
import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('@/audio/AudioEmitter', () => ({ AudioEmitter: class {} }));
jest.mock('@/audio/AudioEngine', () => ({ AudioEngine: { GetAudioEngine: (): object => ({}) } }));

import { resolveTrapExplosionSound } from '@/module/TrapExplosion';

// traps.2da rows 0 and 3 as retail ships them.
const rows = [
  { label: 'TRAP_FLASH_STUN_MINOR', explosionsound: 'cb_gr_stun' },
  {}, {},
  { label: 'TRAP_FRAGMENTATION_MINE_MINOR', explosionsound: 'cb_gr_fragment' },
  { label: 'NO_SOUND', explosionsound: '****' },
];

describe('trap explosion sound', () => {
  test('comes from traps.2da by trap type', () => {
    expect(resolveTrapExplosionSound(rows, 3)).toBe('cb_gr_fragment');
    expect(resolveTrapExplosionSound(rows, 0)).toBe('cb_gr_stun');
  });

  test('is absent for a blank row, a missing row or a bad trap type', () => {
    expect(resolveTrapExplosionSound(rows, 4)).toBeUndefined();
    expect(resolveTrapExplosionSound(rows, 1)).toBeUndefined();
    expect(resolveTrapExplosionSound(rows, 99)).toBeUndefined();
    expect(resolveTrapExplosionSound(rows, -1)).toBeUndefined();
    expect(resolveTrapExplosionSound(undefined, 3)).toBeUndefined();
  });

  test('a fired trap plays it where it fired, not on the trigger that is destroyed', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'events', 'EventSignalEvent.ts'), 'utf8');
    expect(source).toContain('void playTrapExplosion(obj.position, resolveTrapExplosionSound(');
    expect(source).not.toContain('trapExplosionSound)');
  });
});
