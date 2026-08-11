import { describe, expect, jest, test } from '@jest/globals';
import {
  HttpGameFileSystemBackend,
  classifyGameFileSystemPath,
} from '@/utility/filesystem/HttpGameFileSystemBackend';

const origin = 'http://127.0.0.1:8479';

function response(status: number, body: BodyInit | null = null, headers: HeadersInit = {}): Response {
  return new Response(body, { status, headers });
}

function createBackend(fetchImplementation: typeof fetch) {
  return new HttpGameFileSystemBackend({
    assetBaseUrl: `${origin}/assets`,
    fetch: fetchImplementation,
  });
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('HTTP game filesystem mount routing', () => {
  test.each([
    ['Saves/000001 - Game0/savegame.sav', 'user'],
    ['gameinprogress/currentgame.sav', 'user'],
    ['SCREENSHOTS/K2_00001.tga', 'user'],
    ['cache/shaders.bin', 'user'],
    ['logs/engine.log', 'user'],
    ['SWKOTOR.INI', 'user'],
    ['settings.json', 'user'],
    ['data/models.bif', 'assets'],
  ])('classifies %s as %s', (filePath, mount) => {
    expect(classifyGameFileSystemPath(filePath).mount).toBe(mount);
  });

  test.each(['../chitin.key', '/chitin.key', '\\chitin.key', 'C:\\chitin.key', 'data/../../chitin.key', 'data/%2e%2e/chitin.key', 'data/\0secret'])
  ('rejects absolute, traversal, and NUL paths: %s', (filePath) => {
    expect(() => classifyGameFileSystemPath(filePath)).toThrow(/invalid/i);
  });

  test('encodes every path segment and sends authenticated same-origin requests', async () => {
    const fetchImplementation = jest.fn<typeof fetch>().mockResolvedValue(response(200, 'ok'));
    const backend = createBackend(fetchImplementation);

    await backend.readFile('Override/a b#?.uti');

    expect(fetchImplementation).toHaveBeenCalledWith(
      `${origin}/assets/Override/a%20b%23%3F.uti`,
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  test('names the requested path without leaking request details when a whole-file request fails', async () => {
    const fetchImplementation = jest.fn<typeof fetch>().mockRejectedValue(new Error('connection failed with token=secret'));
    const backend = createBackend(fetchImplementation);

    await expect(backend.readFile('chitin.key')).rejects.toThrow("GameFileSystem.readFile: request failed for 'chitin.key'");
  });

  test('uses a 206 response with exact bytes for ranged reads and reports mismatches with context', async () => {
    const fetchImplementation = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(206, new Uint8Array([4, 5]), { 'Content-Range': 'bytes 16-17/128' }))
      .mockResolvedValueOnce(response(200, new Uint8Array([4, 5])));
    const backend = createBackend(fetchImplementation);
    const handle = await backend.open('data/models.bif');
    const output = new Uint8Array(4);

    await expect(backend.read(handle, output, 1, 2, 16)).resolves.toEqual(new Uint8Array([0, 4, 5, 0]));
    await expect(backend.read(handle, output, 0, 2, 18)).rejects.toThrow(/data\/models\.bif.*18.*2/i);
    expect(fetchImplementation.mock.calls[0][1]).toEqual(expect.objectContaining({
      credentials: 'same-origin',
      headers: { Range: 'bytes=16-17' },
    }));
  });

  test.each([
    [undefined, 'missing'],
    ['invalid', 'malformed'],
    ['bytes 15-16/128', 'wrong start'],
    ['bytes 16-17/*', 'invalid total'],
  ])('rejects a %s Content-Range even when the ranged body has the expected byte count', async (contentRange) => {
    const headers = contentRange === undefined ? {} : { 'Content-Range': contentRange };
    const fetchImplementation = jest.fn<typeof fetch>().mockResolvedValue(response(206, new Uint8Array([4, 5]), headers));
    const backend = createBackend(fetchImplementation);
    const handle = await backend.open('data/models.bif');

    await expect(backend.read(handle, new Uint8Array(2), 0, 2, 16)).rejects.toThrow(/data\/models\.bif.*16.*2.*content-range/i);
  });

  test('validates range output, offsets, lengths, and positions before fetching', async () => {
    const fetchImplementation = jest.fn<typeof fetch>();
    const backend = createBackend(fetchImplementation);
    const handle = await backend.open('data/models.bif');

    await expect(backend.read(handle, new Uint8Array(1), 1, 1, 0)).rejects.toThrow(/output/i);
    await expect(backend.read(handle, new Uint8Array(1), 0, -1, 0)).rejects.toThrow(/length/i);
    await expect(backend.read(handle, new Uint8Array(1), 0, 1, -1)).rejects.toThrow(/position/i);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  test('limits requests to 24 and releases queued work after a rejection', async () => {
    let active = 0;
    let peak = 0;
    let calls = 0;
    const fetchImplementation = jest.fn<typeof fetch>(() => {
      const callNumber = ++calls;
      active += 1;
      peak = Math.max(peak, active);
      return new Promise<Response>((resolve, reject) => {
        setTimeout(() => {
          active -= 1;
          if (callNumber === 1) reject(new Error('network failed'));
          else resolve(response(200, 'ok'));
        }, 1);
      });
    });
    const backend = createBackend(fetchImplementation);

    const results = await Promise.allSettled(Array.from({ length: 49 }, () => backend.readFile('chitin.key')));

    expect(peak).toBeLessThanOrEqual(24);
    expect(calls).toBe(49);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  test('holds all 24 permits through body consumption and releases queued work after a body rejection', async () => {
    const bodies: Array<Deferred<ArrayBuffer>> = [];
    const fetchImplementation = jest.fn<typeof fetch>(() => {
      const body = deferred<ArrayBuffer>();
      bodies.push(body);
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => body.promise,
      } as unknown as Response);
    });
    const backend = createBackend(fetchImplementation);
    const operations = Array.from({ length: 25 }, () => backend.readFile('chitin.key'));

    await Promise.resolve();
    await Promise.resolve();
    expect(fetchImplementation).toHaveBeenCalledTimes(24);
    bodies[0].reject(new Error('body failed'));
    await expect(operations[0]).rejects.toThrow(/chitin\.key/i);
    await Promise.resolve();
    expect(fetchImplementation).toHaveBeenCalledTimes(25);
    for (const body of bodies.slice(1)) body.resolve(new Uint8Array([1]).buffer);
    await expect(Promise.all(operations.slice(1))).resolves.toHaveLength(24);
  });

  test('shares body-lifetime permits between ranged reads and directory JSON parsing', async () => {
    const rangeBodies: Array<Deferred<ArrayBuffer>> = [];
    const directoryBody = deferred<unknown>();
    const fetchImplementation = jest.fn<typeof fetch>((url: string) => {
      if (url.startsWith(`${origin}/directories`)) {
        return Promise.resolve({ ok: true, status: 200, json: () => directoryBody.promise } as unknown as Response);
      }
      const body = deferred<ArrayBuffer>();
      rangeBodies.push(body);
      return Promise.resolve({
        ok: true,
        status: 206,
        headers: new Headers({ 'Content-Range': 'bytes 0-0/1' }),
        arrayBuffer: () => body.promise,
      } as unknown as Response);
    });
    const backend = createBackend(fetchImplementation);
    const handle = await backend.open('data/models.bif');
    const reads = Array.from({ length: 24 }, () => backend.read(handle, new Uint8Array(1), 0, 1, 0));
    const listing = backend.readdir('Override');

    await Promise.resolve();
    await Promise.resolve();
    expect(fetchImplementation).toHaveBeenCalledTimes(24);
    rangeBodies[0].resolve(new Uint8Array([1]).buffer);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchImplementation.mock.calls[24][0]).toBe(`${origin}/directories?root=assets&path=Override`);
    for (const body of rangeBodies.slice(1)) body.resolve(new Uint8Array([1]).buffer);
    directoryBody.resolve({ isDirectory: true, entries: [] });
    await expect(Promise.all(reads)).resolves.toHaveLength(24);
    await expect(listing).resolves.toEqual([]);
  });

  test('starts queued requests in FIFO order when a newcomer arrives during a release', async () => {
    const bodies: Array<Deferred<ArrayBuffer>> = [];
    const startedPaths: string[] = [];
    const fetchImplementation = jest.fn<typeof fetch>((url: string) => {
      startedPaths.push(url);
      const body = deferred<ArrayBuffer>();
      bodies.push(body);
      return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => body.promise } as unknown as Response);
    });
    const backend = createBackend(fetchImplementation);
    const firstBatch = Array.from({ length: 25 }, (_, index) => backend.readFile(`cache/file-${index}`));

    await Promise.resolve();
    await Promise.resolve();
    const newcomer = backend.readFile('cache/newcomer');
    bodies[0].resolve(new Uint8Array([1]).buffer);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(startedPaths[24]).toContain('/user/cache/file-24');
    expect(startedPaths).not.toContain(`${origin}/user/cache/newcomer`);
    for (const body of bodies.slice(1)) body.resolve(new Uint8Array([1]).buffer);
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const body of bodies.slice(25)) body.resolve(new Uint8Array([1]).buffer);
    await Promise.all([...firstBatch, newcomer]);
  });

  test('rejects asset writes and deletes, and routes allowed user mutations to /user', async () => {
    const fetchImplementation = jest.fn<typeof fetch>().mockResolvedValue(response(204));
    const backend = createBackend(fetchImplementation);

    await expect(backend.writeFile('Override/new.uti', new Uint8Array([1]))).rejects.toThrow(/read-only/i);
    await expect(backend.unlink('data/models.bif')).rejects.toThrow(/read-only/i);
    await expect(backend.writeFile('Saves/slot/file.sav', new Uint8Array([1]))).resolves.toBe(true);
    await expect(backend.rmdir('gameinprogress')).resolves.toBe(true);

    expect(fetchImplementation.mock.calls.map(([url]) => url)).toEqual([
      `${origin}/user/Saves/slot/file.sav`,
      `${origin}/user/gameinprogress`,
    ]);
  });

  test('accepts a validated user mkdir lazily without an unsupported network method', async () => {
    const fetchImplementation = jest.fn<typeof fetch>();
    const backend = createBackend(fetchImplementation);

    await expect(backend.mkdir('Saves/new-slot', { recursive: true })).resolves.toBe(true);
    await expect(backend.mkdir('Override/new')).rejects.toThrow(/read-only/i);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  test('distinguishes files, directories, and missing paths', async () => {
    const fetchImplementation = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200, JSON.stringify({ isDirectory: true, entries: [] })))
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(404));
    const backend = createBackend(fetchImplementation);

    await expect(backend.exists('chitin.key')).resolves.toBe(true);
    await expect(backend.exists('Saves')).resolves.toBe(true);
    await expect(backend.exists('missing.file')).resolves.toBe(false);
    expect(fetchImplementation.mock.calls.map(([url]) => url)).toEqual([
      `${origin}/assets/chitin.key`,
      `${origin}/user/Saves`,
      `${origin}/directories?root=user&path=Saves`,
      `${origin}/assets/missing.file`,
      `${origin}/directories?root=assets&path=missing.file`,
    ]);
  });

  test('preserves recursive, list_dirs, file fallback, missing user directory, and root overlay semantics', async () => {
    const fetchImplementation = jest.fn<typeof fetch>((url: string) => {
      const listings: Record<string, unknown> = {
        [`${origin}/directories?root=assets&path=`]: { isDirectory: true, entries: [
          { name: 'Override', directory: true }, { name: 'chitin.key', directory: false }, { name: 'Saves', directory: true },
          { name: 'gameinprogress', directory: true }, { name: 'Screenshots', directory: true }, { name: 'cache', directory: true },
          { name: 'logs', directory: true }, { name: 'swkotor.ini', directory: false }, { name: 'swkotor2.ini', directory: false }, { name: 'settings.json', directory: false },
        ] },
        [`${origin}/directories?root=user&path=`]: { isDirectory: true, entries: [
          { name: 'Saves', directory: true }, { name: 'settings.json', directory: false },
        ] },
        [`${origin}/directories?root=user&path=Saves`]: { isDirectory: true, entries: [{ name: '000001', directory: true }] },
        [`${origin}/directories?root=user&path=Saves%2F000001`]: { isDirectory: true, entries: [{ name: 'SAVEGAME.sav', directory: false }] },
        [`${origin}/directories?root=assets&path=chitin.key`]: { isDirectory: false, entries: [] },
        [`${origin}/directories?root=user&path=Screenshots`]: undefined,
      };
      const listing = listings[url];
      return Promise.resolve(listing === undefined ? response(404) : response(200, JSON.stringify(listing)));
    });
    const backend = createBackend(fetchImplementation);

    await expect(backend.readdir('', { recursive: false })).resolves.toEqual(expect.arrayContaining([
      'Override', 'Saves', 'chitin.key', 'settings.json',
    ]));
    await expect(backend.readdir('saves', { recursive: true })).resolves.toEqual(['Saves/000001/SAVEGAME.sav']);
    await expect(backend.readdir('Saves', { recursive: true, list_dirs: true })).resolves.toEqual(['Saves/000001']);
    await expect(backend.readdir('chitin.key')).resolves.toEqual(['chitin.key']);
    await expect(backend.readdir('Screenshots', { recursive: true })).resolves.toEqual([]);
  });

  test('never exposes reserved user mounts from retail root listings, including recursive fresh-user enumeration', async () => {
    const fetchImplementation = jest.fn<typeof fetch>((url: string) => {
      const listings: Record<string, unknown> = {
        [`${origin}/directories?root=assets&path=`]: { isDirectory: true, entries: [
          { name: 'Saves', directory: true }, { name: 'swkotor.ini', directory: false }, { name: 'Override', directory: true },
        ] },
        [`${origin}/directories?root=assets&path=Override`]: { isDirectory: true, entries: [{ name: 'visible.uti', directory: false }] },
        [`${origin}/directories?root=user&path=`]: { isDirectory: true, entries: [] },
      };
      const listing = listings[url];
      return Promise.resolve(listing === undefined ? response(404) : response(200, JSON.stringify(listing)));
    });
    const backend = createBackend(fetchImplementation);

    await expect(backend.readdir('', { recursive: false })).resolves.toEqual(['Override']);
    await expect(backend.readdir('', { recursive: true })).resolves.toEqual(['Override/visible.uti']);
  });
});
