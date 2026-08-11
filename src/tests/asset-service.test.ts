import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

const { createAssetService, normalizeHttpOrigin } = require('../../tools/asset-http/asset-service');

interface RunningService {
  baseUrl: string;
  start: () => Promise<RunningService>;
  close: () => Promise<void>;
}

describe('asset service', () => {
  let tempRoot: string;
  let assetRoot: string;
  let userRoot: string;
  let distRoot: string;
  let service: RunningService | undefined;
  const token = 'test-session-token';

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kotor2-vr-assets-'));
    assetRoot = path.join(tempRoot, 'game');
    userRoot = path.join(tempRoot, 'user');
    distRoot = path.join(tempRoot, 'dist');
    fs.mkdirSync(path.join(assetRoot, 'data'), { recursive: true });
    fs.mkdirSync(userRoot, { recursive: true });
    fs.mkdirSync(path.join(distRoot, 'game'), { recursive: true });
    fs.writeFileSync(path.join(assetRoot, 'chitin.key'), Buffer.from('0123456789'));
    fs.writeFileSync(path.join(assetRoot, 'data', 'models.bif'), Buffer.from('abcdefghij'));
    fs.writeFileSync(path.join(distRoot, 'game', 'index.html'), '<!doctype html><title>KOTOR II VR</title>');
    fs.writeFileSync(path.join(distRoot, 'KotOR.js'), 'globalThis.KotOR = {};');
    fs.writeFileSync(path.join(distRoot, 'three.min.js'), 'globalThis.THREE = {};');
  });

  afterEach(async () => {
    await service?.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  async function start(maxBodyBytes = 1024, extraOptions: Record<string, unknown> = {}): Promise<void> {
    service = await createAssetService({
      assetRoot,
      userRoot,
      distRoot,
      token,
      host: '127.0.0.1',
      port: 0,
      version: 'test-version',
      maxBodyBytes,
      ...extraOptions,
    }).start();
  }

  function request(pathname: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${service?.baseUrl}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    });
  }

  test('rejects requests without the per-launch token', async () => {
    await start();

    const response = await fetch(`${service?.baseUrl}/health`);

    expect(response.status).toBe(401);
  });

  test('bootstraps an authenticated browser session only through the launch route', async () => {
    await start();

    const launch = await fetch(`${service?.baseUrl}/launch?token=${token}`, {
      redirect: 'manual',
    });
    const sessionCookie = launch.headers.get('set-cookie');
    const queriedHealth = await fetch(`${service?.baseUrl}/health?token=${token}`);
    const cookieHealth = await fetch(`${service?.baseUrl}/health`, {
      headers: { Cookie: sessionCookie || '' },
    });

    expect(launch.status).toBe(302);
    expect(launch.headers.get('location')).toBe('/game/index.html?key=tsl&assets=/assets');
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Strict');
    expect(sessionCookie).toContain('Path=/');
    expect(queriedHealth.status).toBe(401);
    expect(cookieHealth.status).toBe(200);
  });

  test('rejects cross-origin requests before authentication but permits the launch bootstrap', async () => {
    await start();

    const crossOriginHealth = await fetch(`${service?.baseUrl}/health`, {
      headers: { Origin: 'http://untrusted.invalid' },
    });
    const crossOriginLaunch = await fetch(`${service?.baseUrl}/launch?token=${token}`, {
      headers: { Origin: 'http://untrusted.invalid' },
      redirect: 'manual',
    });

    expect(crossOriginHealth.status).toBe(403);
    expect(crossOriginLaunch.status).toBe(302);
    expect(crossOriginHealth.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('reports validated roots without exposing their absolute paths', async () => {
    await start();

    const response = await request('/health');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      version: 'test-version',
      gameDetected: true,
      userDataWritable: true,
    });
    expect(JSON.stringify(body)).not.toContain(tempRoot);
  });

  test('serves complete and ranged retail assets read-only', async () => {
    await start();

    const complete = await request('/assets/chitin.key');
    const ranged = await request('/assets/chitin.key', {
      headers: { Range: 'bytes=2-5' },
    });
    const writeAttempt = await request('/assets/chitin.key', {
      method: 'PUT',
      body: 'changed',
    });

    expect(complete.status).toBe(200);
    expect(await complete.text()).toBe('0123456789');
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await ranged.text()).toBe('2345');
    expect(writeAttempt.status).toBe(405);
    expect(fs.readFileSync(path.join(assetRoot, 'chitin.key'), 'utf8')).toBe('0123456789');
  });

  test('supports HEAD, open-ended, and suffix byte ranges', async () => {
    await start();

    const head = await request('/assets/chitin.key', { method: 'HEAD' });
    const openEnded = await request('/assets/chitin.key', { headers: { Range: 'bytes=7-' } });
    const suffix = await request('/assets/chitin.key', { headers: { Range: 'bytes=-3' } });

    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('10');
    expect(await head.text()).toBe('');
    expect(openEnded.status).toBe(206);
    expect(openEnded.headers.get('content-range')).toBe('bytes 7-9/10');
    expect(await openEnded.text()).toBe('789');
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get('content-range')).toBe('bytes 7-9/10');
    expect(await suffix.text()).toBe('789');
  });

  test('rejects ranges against an empty file', async () => {
    fs.writeFileSync(path.join(assetRoot, 'empty.bin'), '');
    await start();

    const response = await request('/assets/empty.bin', { headers: { Range: 'bytes=0-0' } });

    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */0');
  });

  test.each(['bytes=20-30', 'bytes=3-2', 'bytes=0-1,4-5', 'not-a-range'])(
    'rejects invalid range %s',
    async (range: string) => {
      await start();

      const response = await request('/assets/chitin.key', { headers: { Range: range } });

      expect(response.status).toBe(416);
      expect(response.headers.get('content-range')).toBe('bytes */10');
    }
  );

  test('returns typed directory entries for asset and user roots', async () => {
    await start();
    fs.writeFileSync(path.join(userRoot, 'settings.json'), '{}');

    const assets = await request('/directories?root=assets&path=');
    const user = await request('/directories?root=user&path=');

    expect(await assets.json()).toEqual({
      isDirectory: true,
      entries: expect.arrayContaining([
        { name: 'chitin.key', directory: false },
        { name: 'data', directory: true },
      ]),
    });
    expect(await user.json()).toEqual({
      isDirectory: true,
      entries: [{ name: 'settings.json', directory: false }],
    });
  });

  test('writes, reads, and deletes files only in the user-data root', async () => {
    await start();

    const write = await request('/user/saves/slot1/save.sav', {
      method: 'PUT',
      body: 'save-data',
    });
    const read = await request('/user/saves/slot1/save.sav');
    const remove = await request('/user/saves/slot1/save.sav', { method: 'DELETE' });

    expect(write.status).toBe(204);
    expect(read.status).toBe(200);
    expect(await read.text()).toBe('save-data');
    expect(remove.status).toBe(204);
    expect(fs.existsSync(path.join(userRoot, 'saves', 'slot1', 'save.sav'))).toBe(false);
    expect(fs.existsSync(path.join(assetRoot, 'saves', 'slot1', 'save.sav'))).toBe(false);
  });

  test('atomically overwrites an existing user file', async () => {
    fs.writeFileSync(path.join(userRoot, 'settings.json'), 'old-value');
    await start();

    const write = await request('/user/settings.json', { method: 'PUT', body: 'new-value' });

    expect(write.status).toBe(204);
    expect(fs.readFileSync(path.join(userRoot, 'settings.json'), 'utf8')).toBe('new-value');
  });

  test('recursively deletes a contained user directory without deleting the user root', async () => {
    fs.mkdirSync(path.join(userRoot, 'gameinprogress', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(userRoot, 'gameinprogress', 'nested', 'state.sav'), 'state');
    await start();

    const removeDirectory = await request('/user/gameinprogress', { method: 'DELETE' });
    const removeRoot = await request('/user/', { method: 'DELETE' });

    expect(removeDirectory.status).toBe(204);
    expect(fs.existsSync(path.join(userRoot, 'gameinprogress'))).toBe(false);
    expect(removeRoot.status).toBe(404);
    expect(fs.existsSync(userRoot)).toBe(true);
  });

  test.each([
    '/assets/%252e%252e%252fchitin.key',
    '/user/%252e%252e%252fescape.txt',
    '/directories?root=user&path=..%2Fgame',
  ])('rejects decoded traversal attempt %s with forbidden status', async (pathname: string) => {
    await start();

    const response = await request(pathname, { method: pathname.startsWith('/user/') ? 'PUT' : 'GET', body: pathname.startsWith('/user/') ? 'escape' : undefined });

    expect(response.status).toBe(403);
    expect(fs.existsSync(path.join(tempRoot, 'escape.txt'))).toBe(false);
  });

  test('rejects URL-normalized traversal without reaching a mounted route', async () => {
    await start();

    const response = await request('/assets/%2e%2e/chitin.key');

    expect(response.status).toBe(404);
  });

  test('rejects a retail path when an existing symlink escapes its configured root', async () => {
    const outsideFile = path.join(tempRoot, 'outside.txt');
    const symlinkPath = path.join(assetRoot, 'escaped.key');
    fs.writeFileSync(outsideFile, 'must not leak');
    fs.symlinkSync(outsideFile, symlinkPath, 'file');
    await start();

    const response = await request('/assets/escaped.key');

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('must not leak');
  });

  test('rejects user symlink escapes for read, write, delete, and directory listing', async () => {
    const outsideRoot = path.join(tempRoot, 'outside');
    fs.mkdirSync(outsideRoot);
    fs.writeFileSync(path.join(outsideRoot, 'secret.sav'), 'must not leak');
    fs.symlinkSync(outsideRoot, path.join(userRoot, 'escape'), 'junction');
    await start();

    const read = await request('/user/escape/secret.sav');
    const write = await request('/user/escape/new.sav', { method: 'PUT', body: 'must not write' });
    const remove = await request('/user/escape/secret.sav', { method: 'DELETE' });
    const list = await request('/directories?root=user&path=escape');

    expect(read.status).toBe(403);
    expect(write.status).toBe(403);
    expect(remove.status).toBe(403);
    expect(list.status).toBe(403);
    expect(fs.readFileSync(path.join(outsideRoot, 'secret.sav'), 'utf8')).toBe('must not leak');
    expect(fs.existsSync(path.join(outsideRoot, 'new.sav'))).toBe(false);
  });

  test('fails closed when a validated file is replaced before it is opened', async () => {
    const protectedFile = path.join(assetRoot, 'chitin.key');
    const outsideFile = path.join(tempRoot, 'outside.txt');
    fs.writeFileSync(outsideFile, 'must not leak');
    await start(1024, {
      onBeforeFileOpen: () => {
        fs.unlinkSync(protectedFile);
        fs.symlinkSync(outsideFile, protectedFile, 'file');
      },
    });

    const response = await request('/assets/chitin.key');

    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain('must not leak');
  });

  test('rejects oversized writes without leaving a partial file', async () => {
    await start(4);

    const response = await request('/user/settings.json', {
      method: 'PUT',
      body: '12345',
    });

    expect(response.status).toBe(413);
    expect(fs.existsSync(path.join(userRoot, 'settings.json'))).toBe(false);
  });

  test('serves the app only to an authenticated session', async () => {
    await start();

    const authorized = await request('/game/index.html');
    const unauthorized = await fetch(`${service?.baseUrl}/game/index.html`);

    expect(authorized.status).toBe(200);
    expect(await authorized.text()).toContain('KOTOR II VR');
    expect(unauthorized.status).toBe(401);
  });

  test('serves authenticated root-level runtime bundles from dist read-only', async () => {
    await start();

    const engineBundle = await request('/KotOR.js');
    const threeBundle = await request('/three.min.js');
    const writeAttempt = await request('/KotOR.js', { method: 'PUT', body: 'changed' });
    const unauthorized = await fetch(`${service?.baseUrl}/KotOR.js`);

    expect(engineBundle.status).toBe(200);
    expect(await engineBundle.text()).toBe('globalThis.KotOR = {};');
    expect(engineBundle.headers.get('cache-control')).toBe('no-store');
    expect(threeBundle.status).toBe(200);
    expect(await threeBundle.text()).toBe('globalThis.THREE = {};');
    expect(writeAttempt.status).toBe(405);
    expect(unauthorized.status).toBe(401);
    expect(fs.readFileSync(path.join(distRoot, 'KotOR.js'), 'utf8')).toBe('globalThis.KotOR = {};');
  });

  test('supports idempotent start and close, then restarts on the same service instance', async () => {
    const reusableService: RunningService = createAssetService({
      assetRoot,
      userRoot,
      distRoot,
      token,
      host: '127.0.0.1',
      port: 0,
      version: 'test-version',
    });
    service = reusableService;

    const firstStart = await reusableService.start();
    const firstBaseUrl = firstStart.baseUrl;
    expect(await reusableService.start()).toBe(reusableService);
    await reusableService.close();
    await reusableService.close();
    const restarted = await reusableService.start();

    expect(firstBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(restarted.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect((await fetch(`${restarted.baseUrl}/health`)).status).toBe(401);
  });
});

describe('asset service origin normalization', () => {
  test('serializes default-port configured and incoming origins without binding port 80', () => {
    const configuredOrigin = normalizeHttpOrigin('http://127.0.0.1:80');
    const incomingOrigin = normalizeHttpOrigin('http://127.0.0.1:80/');

    expect(configuredOrigin).toBe('http://127.0.0.1');
    expect(incomingOrigin).toBe(configuredOrigin);
  });
});
