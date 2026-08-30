import { describe, expect, jest, test } from '@jest/globals';
import { WindowsXRRuntimePreflight } from '@/electron/XRRuntimePreflight';

describe('WindowsXRRuntimePreflight', () => {
  test('reports an expected-runtime mismatch without mutating registry state', async () => {
    const queryRegistryValue = jest.fn<(key: string, name: string) => Promise<string | null>>()
      .mockImplementation(async (key) => key.includes('WOW6432Node') ? null : 'C:\\SteamVR\\steamxr_win64.json');
    const preflight = new WindowsXRRuntimePreflight({
      platform: 'win32',
      environment: { PROGRAMFILES: 'C:\\Program Files' },
      queryRegistryValue,
      readTextFile: async () => JSON.stringify({ runtime: { name: 'SteamVR' } }),
      fileExists: async (filePath) => filePath.endsWith('msedge.exe'),
    });

    const result = await preflight.inspect({ browser: 'edge', expectedRuntime: 'vdxr' });

    expect(result.activeRuntime.kind).toBe('steamvr');
    expect(result.browser.found).toBe(true);
    expect(result.ready).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'runtime-mismatch' }),
    ]));
    expect(queryRegistryValue).toHaveBeenCalledTimes(2);
  });

  test('reports absent browser and runtime data with actionable diagnostics', async () => {
    const preflight = new WindowsXRRuntimePreflight({
      platform: 'win32',
      environment: {},
      queryRegistryValue: async () => null,
      readTextFile: async () => '',
      fileExists: async () => false,
    });

    const result = await preflight.inspect({ browser: 'chrome', expectedRuntime: 'steamvr' });

    expect(result.activeRuntime.kind).toBe('unknown');
    expect(result.browser.found).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'active-runtime-missing',
      'browser-missing',
    ]);
  });

  test('validates preflight request values at the launcher boundary', async () => {
    const preflight = new WindowsXRRuntimePreflight({
      platform: 'win32',
      environment: {},
      queryRegistryValue: async () => null,
      readTextFile: async () => '',
      fileExists: async () => false,
    });

    await expect(preflight.inspect({ browser: 'firefox' as 'chrome', expectedRuntime: 'steamvr' }))
      .rejects.toThrow('Unsupported XR browser');
  });

  test('fails closed when an installed active runtime cannot be identified', async () => {
    const preflight = new WindowsXRRuntimePreflight({
      platform: 'win32',
      environment: { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' },
      queryRegistryValue: async (key): Promise<string | null> =>
        key.includes('WOW6432Node') ? null : 'C:\\OpenXR\\runtime.json',
      readTextFile: async () => JSON.stringify({ runtime: { name: 'Unrecognized runtime' } }),
      fileExists: async (): Promise<boolean> => true,
    });

    const result = await preflight.inspect({ browser: 'chrome', expectedRuntime: 'steamvr' });

    expect(result.ready).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'runtime-unrecognized' }),
    ]));
  });
});
