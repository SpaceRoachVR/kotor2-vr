import { describe, expect, jest, test } from '@jest/globals';
import { ensureScreenshotDirectory } from '@/utility/filesystem/ScreenshotPath';

describe('screenshot workflow', () => {
  test('creates Screenshots recursively before a listing or write', async () => {
    const filesystem = { mkdir: jest.fn<(path: string, options: { recursive: boolean }) => Promise<boolean>>().mockResolvedValue(true) };

    await expect(ensureScreenshotDirectory(filesystem)).resolves.toBe(true);
    expect(filesystem.mkdir).toHaveBeenCalledWith('Screenshots', { recursive: true });
  });

  test('returns false when the directory cannot be created', async () => {
    const filesystem = { mkdir: jest.fn<(path: string, options: { recursive: boolean }) => Promise<boolean>>().mockRejectedValue(new Error('disk unavailable')) };

    await expect(ensureScreenshotDirectory(filesystem)).resolves.toBe(false);
  });
});
