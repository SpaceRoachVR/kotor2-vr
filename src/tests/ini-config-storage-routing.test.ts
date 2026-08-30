import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { INIConfig } from '@/engine/INIConfig';
import { ApplicationEnvironment } from '@/enums/ApplicationEnvironment';
import { ApplicationProfile } from '@/utility/ApplicationProfile';
import { GameFileSystem } from '@/utility/GameFileSystem';

const defaults = { Graphics: { FullScreen: '1' } };

describe('INI config storage routing', () => {
  const originalEnvironment = ApplicationProfile.ENV;
  const originalAssets = ApplicationProfile.assetBaseUrl;

  afterEach(() => {
    ApplicationProfile.ENV = originalEnvironment;
    ApplicationProfile.assetBaseUrl = originalAssets;
    jest.restoreAllMocks();
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  test('uses GameFileSystem for HTTP assets and therefore the mutable user INI route', async () => {
    ApplicationProfile.ENV = ApplicationEnvironment.BROWSER;
    ApplicationProfile.assetBaseUrl = 'http://127.0.0.1:8479/assets';
    const readFile = jest.spyOn(GameFileSystem, 'readFile').mockResolvedValue(new TextEncoder().encode('[Graphics]\nFullScreen=0\n'));
    const writeFile = jest.spyOn(GameFileSystem, 'writeFile').mockResolvedValue(true);
    const config = new INIConfig('swkotor2.ini', defaults);

    await config.load();
    await config.save();

    expect(config.getProperty('Graphics.FullScreen')).toBe(0);
    expect(readFile).toHaveBeenCalledWith('swkotor2.ini');
    expect(writeFile).toHaveBeenCalledWith('swkotor2.ini', expect.any(Uint8Array));
  });

  test('preserves Electron GameFileSystem storage and ordinary browser localStorage storage', async () => {
    const readFile = jest.spyOn(GameFileSystem, 'readFile').mockResolvedValue(new TextEncoder().encode('[Graphics]\nFullScreen=0\n'));
    const writeFile = jest.spyOn(GameFileSystem, 'writeFile').mockResolvedValue(true);
    ApplicationProfile.ENV = ApplicationEnvironment.ELECTRON;
    ApplicationProfile.assetBaseUrl = '';
    const electronConfig = new INIConfig('swkotor.ini', defaults);

    await electronConfig.load();
    await electronConfig.save();

    expect(readFile).toHaveBeenCalledWith('swkotor.ini');
    expect(writeFile).toHaveBeenCalledWith('swkotor.ini', expect.any(Uint8Array));

    const localStorage = { getItem: jest.fn().mockReturnValue('[Graphics]\nFullScreen=0\n'), setItem: jest.fn() };
    (globalThis as unknown as { localStorage?: Storage }).localStorage = localStorage as unknown as Storage;
    ApplicationProfile.ENV = ApplicationEnvironment.BROWSER;
    const browserConfig = new INIConfig('swkotor.ini', defaults);

    await browserConfig.load();
    await browserConfig.save();

    expect(localStorage.getItem).toHaveBeenCalled();
    expect(localStorage.setItem).toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  test('falls back to defaults when HTTP user INI reading fails', async () => {
    ApplicationProfile.ENV = ApplicationEnvironment.BROWSER;
    ApplicationProfile.assetBaseUrl = 'http://127.0.0.1:8479/assets';
    jest.spyOn(GameFileSystem, 'readFile').mockRejectedValue(new Error('request failed'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const config = new INIConfig('swkotor2.ini', defaults);

    await config.load();

    expect(config.getProperty('Graphics.FullScreen')).toBe('1');
    expect(consoleError).toHaveBeenCalled();
  });
});
