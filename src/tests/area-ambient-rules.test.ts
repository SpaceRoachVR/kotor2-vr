import { describe, expect, test } from '@jest/globals';
import { resolveAreaAmbientSlot } from '../engine/AreaAmbientRules';

/**
 * An area's ARE carries a day and a night ambient bed (AmbientSndDay /
 * AmbientSndNight) and IsNight, "meaningful only if DayNightCycle is FALSE".
 * One bed plays: the one for the area's time of day. Both used to play, and
 * since most areas name the same bed twice (002EBO: bed_002ebo, 106PER:
 * bed_106per) every area sounded its bed doubled, a few milliseconds apart.
 */
describe('which ambient bed an area plays', () => {
  test('an always-day area plays its day bed', () => {
    expect(resolveAreaAmbientSlot({ dayNightCycle: false, isNight: false })).toBe('day');
  });

  test('an always-night area plays its night bed', () => {
    expect(resolveAreaAmbientSlot({ dayNightCycle: false, isNight: true })).toBe('night');
  });

  test('a cycling area plays the day bed (the engine keeps no clock of its own)', () => {
    expect(resolveAreaAmbientSlot({ dayNightCycle: true, isNight: true })).toBe('day');
  });

  test('missing flags read as day', () => {
    expect(resolveAreaAmbientSlot({})).toBe('day');
  });
});
