import { describe, expect, test } from '@jest/globals';
import { resolveDisplayName } from '@/vr/runtime/resolveDisplayName';

describe('resolveDisplayName', () => {
  test('strips designer lock-difficulty annotations', () => {
    expect(resolveDisplayName('Blast Door{Impossible}')).toBe('Blast Door');
  });

  test('strips helper-object annotations while keeping engine-appended suffixes', () => {
    expect(resolveDisplayName('Body{Invis container} (Empty)')).toBe('Body (Empty)');
  });

  test('collapses the gap left by a mid-name annotation', () => {
    expect(resolveDisplayName('Foot {Locker} Locker')).toBe('Foot Locker');
  });

  test('leaves ordinary names untouched', () => {
    expect(resolveDisplayName('Plasteel Cylinder')).toBe('Plasteel Cylinder');
    expect(resolveDisplayName('Galaxy Map')).toBe('Galaxy Map');
  });

  test('handles multiple annotations', () => {
    expect(resolveDisplayName('Door{Locked}{Plot}')).toBe('Door');
  });

  test('returns an empty string for missing or non-string names', () => {
    expect(resolveDisplayName(null)).toBe('');
    expect(resolveDisplayName(undefined)).toBe('');
    expect(resolveDisplayName(42 as unknown as string)).toBe('');
  });

  test('does not leave stray whitespace when the whole name is an annotation', () => {
    expect(resolveDisplayName('{Invis container}')).toBe('');
  });
});
