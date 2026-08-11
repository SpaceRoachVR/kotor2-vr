import { describe, expect, test } from '@jest/globals';
import { parseHttpAssetBaseUrl } from '@/utility/ApplicationProfile';

describe('HTTP asset URL parsing', () => {
  test('canonicalizes a same-origin assets URL', () => {
    expect(parseHttpAssetBaseUrl('?assets=/assets/', 'http://127.0.0.1:8479')).toEqual({
      assetBaseUrl: 'http://127.0.0.1:8479/assets',
    });
  });

  test.each([
    '?assets=https://untrusted.invalid/assets',
    '?assets=/user',
    '?assets=/assets?token=secret',
  ])('disables HTTP assets for invalid or cross-origin URL %s', (search) => {
    const result = parseHttpAssetBaseUrl(search, 'http://127.0.0.1:8479');

    expect(result.assetBaseUrl).toBe('');
    expect(result.diagnostic).toMatch(/assets|origin/i);
  });
});
