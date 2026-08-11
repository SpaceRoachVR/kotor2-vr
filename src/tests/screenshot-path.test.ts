import { describe, expect, test } from '@jest/globals';
import { buildScreenshotPath } from '@/utility/filesystem/ScreenshotPath';

describe('screenshot paths', () => {
  test('places browser screenshots in the explicit Screenshots user mount', () => {
    expect(buildScreenshotPath('K2_00001.tga')).toBe('Screenshots/K2_00001.tga');
  });

  test.each(['../escape.tga', '/absolute.tga', 'nested/file.tga', 'bad\0file.tga'])
  ('rejects unsafe screenshot filenames: %s', (filename) => {
    expect(() => buildScreenshotPath(filename)).toThrow(/invalid/i);
  });
});
