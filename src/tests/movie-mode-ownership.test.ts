import { describe, expect, test } from '@jest/globals';
import { MovieModeOwnership } from '../managers/video/MovieModeOwnership';

describe('MovieModeOwnership', () => {
  test('holds movie mode while a queue is between individual movies', () => {
    const ownership = new MovieModeOwnership();

    expect(ownership.beginQueue()).toBe(true);
    expect(ownership.shouldDeferRestore(false)).toBe(true);
  });

  test('releases movie mode only after the queue ends', () => {
    const ownership = new MovieModeOwnership();
    ownership.beginQueue();

    ownership.endQueue();

    expect(ownership.shouldDeferRestore(false)).toBe(false);
  });

  test('defers restoration during a directly played movie', () => {
    const ownership = new MovieModeOwnership();

    expect(ownership.shouldDeferRestore(true)).toBe(true);
    expect(ownership.shouldDeferRestore(false)).toBe(false);
  });

  test('rejects concurrent queue ownership', () => {
    const ownership = new MovieModeOwnership();

    expect(ownership.beginQueue()).toBe(true);
    expect(ownership.beginQueue()).toBe(false);
  });

  test('defers direct non-movie mode changes while playback owns the mode', () => {
    const ownership = new MovieModeOwnership();

    expect(ownership.shouldDeferModeChange(true, false)).toBe(true);
    expect(ownership.shouldDeferModeChange(true, true)).toBe(false);
    expect(ownership.shouldDeferModeChange(false, false)).toBe(false);
  });

  test('defers non-movie mode changes between queued movies', () => {
    const ownership = new MovieModeOwnership();
    ownership.beginQueue();

    expect(ownership.shouldDeferModeChange(false, false)).toBe(true);
  });
});
