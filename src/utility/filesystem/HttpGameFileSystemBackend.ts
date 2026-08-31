import { IGameFileSystemReadDirOptions } from '@/interface/filesystem/IGameFileSystemReadDirOptions';
import {
  GameFileSystemBackend,
  GameFileSystemHttpHandle,
  GameFileSystemMount,
} from '@/utility/filesystem/GameFileSystemBackend';

const USER_DIRECTORIES = new Map<string, string>([
  ['saves', 'Saves'],
  ['gameinprogress', 'gameinprogress'],
  ['screenshots', 'Screenshots'],
  ['cache', 'cache'],
  ['logs', 'logs'],
]);
const USER_ROOT_FILES = new Map<string, string>([
  ['swkotor.ini', 'swkotor.ini'],
  ['swkotor2.ini', 'swkotor2.ini'],
  ['settings.json', 'settings.json'],
]);
const MAX_CONCURRENT_REQUESTS = 24;

export interface ClassifiedGameFileSystemPath {
  mount: GameFileSystemMount;
  path: string;
}

export interface HttpGameFileSystemBackendOptions {
  assetBaseUrl: string;
  fetch?: typeof fetch;
}

export interface HttpGameFileSystemDirectoryEntryMetadata {
  path: string;
  layerId: string;
  layerOrder: number;
}

interface DirectoryEntry {
  name: string;
  directory: boolean;
  layer?: string;
}

interface DirectoryListing {
  isDirectory: boolean;
  entries: DirectoryEntry[];
}

/** Validates a game-relative path and maps the user namespace canonically. */
export function classifyGameFileSystemPath(filepath: string): ClassifiedGameFileSystemPath {
  if (typeof filepath !== 'string') throw new TypeError('Game filesystem path must be a string');
  if (filepath.includes('\0')) throw new Error('Invalid game filesystem path: NUL bytes are not allowed');

  const trimmed = filepath.trim();
  if (/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(trimmed)) {
    throw new Error('Invalid game filesystem path: absolute paths are not allowed');
  }

  const rawSegments = trimmed === '' ? [] : trimmed.split(/[\\/]/);
  if (rawSegments.some((segment) => segment === '' || segment === '.' || segment === '..' || segment.includes('%'))) {
    throw new Error('Invalid game filesystem path: traversal is not allowed');
  }
  if (rawSegments.some((segment) => segment.includes('\0'))) {
    throw new Error('Invalid game filesystem path: NUL bytes are not allowed');
  }

  if (rawSegments.length === 0) return { mount: 'assets', path: '' };

  const firstSegmentKey = rawSegments[0].toLocaleLowerCase();
  const userDirectory = USER_DIRECTORIES.get(firstSegmentKey);
  if (userDirectory) {
    return { mount: 'user', path: [userDirectory, ...rawSegments.slice(1)].join('/') };
  }
  if (rawSegments.length === 1) {
    const userRootFile = USER_ROOT_FILES.get(firstSegmentKey);
    if (userRootFile) return { mount: 'user', path: userRootFile };
  }
  return { mount: 'assets', path: rawSegments.join('/') };
}

class FetchQueue {
  private active = 0;
  private readonly tasks: Array<{
    operation: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }> = [];

  async run<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.tasks.push({ operation, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    while (this.active < MAX_CONCURRENT_REQUESTS && this.tasks.length > 0) {
      const task = this.tasks.shift();
      if (!task) return;
      this.active += 1;
      void task.operation().then(task.resolve, task.reject).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }
}

/** Browser backend for the authenticated, same-origin Phase 0 asset service. */
export class HttpGameFileSystemBackend implements GameFileSystemBackend {
  private readonly assetBaseUrl: URL;
  private readonly origin: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly fetchQueue = new FetchQueue();

  constructor(options: HttpGameFileSystemBackendOptions) {
    if (!options || typeof options.assetBaseUrl !== 'string' || options.assetBaseUrl.length === 0) {
      throw new TypeError('An asset service URL is required');
    }
    this.assetBaseUrl = new URL(options.assetBaseUrl);
    this.assetBaseUrl.pathname = this.assetBaseUrl.pathname.replace(/\/+$/, '') || '/assets';
    this.assetBaseUrl.search = '';
    this.assetBaseUrl.hash = '';
    this.origin = this.assetBaseUrl.origin;
    const fetchImplementation = options.fetch || globalThis.fetch;
    if (typeof fetchImplementation !== 'function') {
      throw new Error('HTTP game filesystem requires the Fetch API');
    }
    // Browser-native fetch is brand checked and throws "Illegal invocation"
    // when retained as an instance property and called with this backend as
    // its receiver. Bind it to the global object once at construction time.
    this.fetchImplementation = fetchImplementation.bind(globalThis);
  }

  async open(filepath: string, mode: 'r' | 'w' = 'r'): Promise<GameFileSystemHttpHandle> {
    if (mode !== 'r' && mode !== 'w') throw new Error(`Unsupported HTTP file mode '${mode}'`);
    const classified = classifyGameFileSystemPath(filepath);
    if (mode === 'w') this.assertUserMount(classified, 'open for writing');
    return { backend: 'http', mount: classified.mount, path: classified.path };
  }

  async read(handle: GameFileSystemHttpHandle, output: Uint8Array, offset: number, length: number, position: number): Promise<Uint8Array> {
    this.validateHandle(handle);
    this.validateReadArguments(output, offset, length, position);
    if (length === 0) return output;

    const end = position + length - 1;
    try {
      const bytes = await this.requestWithBody(this.fileUrl(handle.mount, handle.path), {
        headers: { Range: `bytes=${position}-${end}` },
      }, async (response) => {
        if (response.status !== 206) {
          throw this.readError(handle.path, position, length, `expected HTTP 206, received ${response.status}`);
        }
        this.validateContentRange(response.headers.get('Content-Range'), handle.path, position, length);
        return new Uint8Array(await response.arrayBuffer());
      });
      if (bytes.byteLength !== length) {
        throw this.readError(handle.path, position, length, `expected ${length} bytes, received ${bytes.byteLength}`);
      }
      output.set(bytes, offset);
      return output;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('GameFileSystem.read:')) throw error;
      throw this.readError(handle.path, position, length, 'request failed');
    }
  }

  async close(handle: GameFileSystemHttpHandle): Promise<void> {
    this.validateHandle(handle);
  }

  async readFile(filepath: string, _options: unknown = {}): Promise<Uint8Array> {
    const classified = classifyGameFileSystemPath(filepath);
    try {
      return await this.requestWithBody(this.fileUrl(classified.mount, classified.path), {}, async (response) => {
        if (!response.ok) throw new Error(`GameFileSystem.readFile: HTTP ${response.status} for '${classified.path}'`);
        return new Uint8Array(await response.arrayBuffer());
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('GameFileSystem.readFile:')) throw error;
      throw new Error(`GameFileSystem.readFile: request failed for '${classified.path}'`);
    }
  }

  async readdir(filepath: string = '', options: IGameFileSystemReadDirOptions = {}, files: string[] = []): Promise<string[]> {
    const classified = classifyGameFileSystemPath(filepath);
    if (classified.path === '') {
      const [assetEntries, userEntries] = await Promise.all([
        this.readdirMount('assets', '', options),
        this.readdirMount('user', '', options, true),
      ]);
      const readOnlyEntries = assetEntries.filter((entry) => classifyGameFileSystemPath(entry).mount === 'assets');
      const merged = [...readOnlyEntries, ...userEntries];
      const unique = new Map<string, string>();
      for (const entry of merged) unique.set(entry.toLocaleLowerCase(), entry);
      return [...files, ...[...unique.values()].sort((left, right) => left.localeCompare(right))];
    }

    const missingUserDirectoryIsEmpty = classified.mount === 'user' && USER_DIRECTORIES.has(classified.path.split('/')[0].toLocaleLowerCase());
    return [...files, ...await this.readdirMount(classified.mount, classified.path, options, missingUserDirectoryIsEmpty)];
  }

  async readdirWithMetadata(filepath: string): Promise<readonly HttpGameFileSystemDirectoryEntryMetadata[]> {
    const classified = classifyGameFileSystemPath(filepath);
    if (classified.mount !== 'assets' || classified.path === '') {
      throw new Error('GameFileSystem.readdirWithMetadata requires a non-root read-only asset directory');
    }
    const listing = await this.getDirectoryListing(classified.mount, classified.path);
    if (!listing || !listing.isDirectory) {
      return [];
    }
    return Object.freeze(listing.entries
      .filter((entry) => this.isValidDirectoryEntry(entry) && !entry.directory)
      .map((entry) => {
        const layerId = this.resolveLayerId(entry.layer);
        return Object.freeze({
          path: this.joinRelativePath(classified.path, entry.name),
          layerId,
          layerOrder: this.getLayerOrder(layerId),
        });
      }));
  }

  async exists(filepath: string): Promise<boolean> {
    const classified = classifyGameFileSystemPath(filepath);
    if (classified.path === '') return true;

    try {
      const fileResponse = await this.request(this.fileUrl(classified.mount, classified.path), { method: 'HEAD' });
      if (fileResponse.ok) return true;
      const listing = await this.getDirectoryListing(classified.mount, classified.path);
      return listing !== undefined && listing.isDirectory;
    } catch {
      return false;
    }
  }

  async writeFile(filepath: string, data: Uint8Array): Promise<boolean> {
    if (!(data instanceof Uint8Array)) throw new TypeError('GameFileSystem.writeFile requires a Uint8Array');
    const classified = classifyGameFileSystemPath(filepath);
    this.assertUserMount(classified, 'write');
    const response = await this.request(this.fileUrl('user', classified.path), { method: 'PUT', body: data as unknown as BodyInit });
    return response.ok;
  }

  async mkdir(filepath: string, _options: IGameFileSystemReadDirOptions = {}): Promise<boolean> {
    const classified = classifyGameFileSystemPath(filepath);
    this.assertUserMount(classified, 'mkdir');
    if (classified.path === '') throw new Error('Cannot create the game filesystem root');
    // The service creates parents atomically on PUT; issuing MKCOL would be unsupported.
    return true;
  }

  async rmdir(filepath: string, _options: IGameFileSystemReadDirOptions = {}): Promise<boolean> {
    return this.deleteUserPath(filepath, 'rmdir');
  }

  async unlink(filepath: string): Promise<boolean> {
    return this.deleteUserPath(filepath, 'unlink');
  }

  private async deleteUserPath(filepath: string, operation: string): Promise<boolean> {
    const classified = classifyGameFileSystemPath(filepath);
    this.assertUserMount(classified, operation);
    if (classified.path === '') throw new Error('Cannot delete the game filesystem root');
    const response = await this.request(this.fileUrl('user', classified.path), { method: 'DELETE' });
    return response.ok;
  }

  private async readdirMount(
    mount: GameFileSystemMount,
    filepath: string,
    options: IGameFileSystemReadDirOptions,
    missingDirectoryIsEmpty = false,
    depth = 0,
  ): Promise<string[]> {
    const listing = await this.getDirectoryListing(mount, filepath);
    if (listing === undefined) {
      if (missingDirectoryIsEmpty) return [];
      return options.list_dirs ? [] : [filepath];
    }
    if (!listing.isDirectory) return options.list_dirs ? [] : [filepath];

    const results: string[] = [];
    if (options.list_dirs && depth > 0) results.push(filepath);
    if (depth >= 1 && !options.recursive) return results;

    const subdirectories: Promise<string[]>[] = [];
    for (const entry of listing.entries) {
      if (!this.isValidDirectoryEntry(entry)) continue;
      const childPath = this.joinRelativePath(filepath, entry.name);
      if (entry.directory) {
        if (options.recursive) {
          subdirectories.push(this.readdirMount(mount, childPath, options, false, depth + 1));
        } else {
          results.push(childPath);
        }
      } else if (!options.list_dirs) {
        results.push(childPath);
      }
    }
    for (const descendants of await Promise.all(subdirectories)) results.push(...descendants);
    return results;
  }

  private async getDirectoryListing(mount: GameFileSystemMount, filepath: string): Promise<DirectoryListing | undefined> {
    const url = new URL('/directories', this.origin);
    url.searchParams.set('root', mount);
    url.searchParams.set('path', filepath);
    return await this.requestWithBody(url, {}, async (response) => {
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`GameFileSystem.readdir: HTTP ${response.status} for '${filepath}'`);
      const body: unknown = await response.json();
      if (!this.isDirectoryListing(body)) throw new Error(`GameFileSystem.readdir: invalid directory response for '${filepath}'`);
      return body;
    });
  }

  private fileUrl(mount: GameFileSystemMount, filepath: string): URL {
    const base = mount === 'assets' ? this.assetBaseUrl : new URL('/user', this.origin);
    const url = new URL(base.toString());
    if (filepath) url.pathname = `${url.pathname.replace(/\/$/, '')}/${filepath.split('/').map(encodeURIComponent).join('/')}`;
    return url;
  }

  private request(url: URL, init: RequestInit = {}): Promise<Response> {
    return this.fetchQueue.run(() => this.fetchImplementation(url.toString(), { ...init, credentials: 'same-origin' }));
  }

  private requestWithBody<T>(url: URL, init: RequestInit, consume: (response: Response) => Promise<T>): Promise<T> {
    return this.fetchQueue.run(async () => {
      const response = await this.fetchImplementation(url.toString(), { ...init, credentials: 'same-origin' });
      return await consume(response);
    });
  }

  private assertUserMount(classified: ClassifiedGameFileSystemPath, operation: string): void {
    if (classified.mount !== 'user') {
      throw new Error(`GameFileSystem.${operation}: retail assets are read-only ('${classified.path}')`);
    }
  }

  private validateHandle(handle: GameFileSystemHttpHandle): void {
    if (!handle || handle.backend !== 'http' || (handle.mount !== 'assets' && handle.mount !== 'user') || typeof handle.path !== 'string') {
      throw new TypeError('GameFileSystem.read requires an HTTP file handle');
    }
  }

  private validateReadArguments(output: Uint8Array, offset: number, length: number, position: number): void {
    if (!(output instanceof Uint8Array)) throw new TypeError('GameFileSystem.read requires a Uint8Array output buffer');
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > output.byteLength) throw new RangeError('Invalid output offset');
    if (!Number.isSafeInteger(length) || length < 0) throw new RangeError('Invalid read length');
    if (offset + length > output.byteLength) throw new RangeError('Read exceeds the output buffer');
    if (!Number.isSafeInteger(position) || position < 0) throw new RangeError('Invalid read position');
  }

  private readError(filepath: string, position: number, length: number, reason: string): Error {
    return new Error(`GameFileSystem.read: failed reading '${filepath}' at offset ${position} for ${length} bytes: ${reason}`);
  }

  private validateContentRange(contentRange: string | null, filepath: string, position: number, length: number): void {
    const expectedEnd = position + length - 1;
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange || '');
    if (!match) throw this.readError(filepath, position, length, 'invalid Content-Range response');
    const start = Number(match[1]);
    const end = Number(match[2]);
    const total = Number(match[3]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      !Number.isSafeInteger(total) ||
      total <= 0 ||
      start !== position ||
      end !== expectedEnd ||
      end >= total
    ) {
      throw this.readError(filepath, position, length, 'invalid Content-Range response');
    }
  }

  private joinRelativePath(parent: string, child: string): string {
    const combined = parent ? `${parent}/${child}` : child;
    return classifyGameFileSystemPath(combined).path;
  }

  private isValidDirectoryEntry(value: unknown): value is DirectoryEntry {
    return typeof value === 'object' && value !== null &&
      typeof (value as DirectoryEntry).name === 'string' &&
      (value as DirectoryEntry).name.length > 0 &&
      !(value as DirectoryEntry).name.includes('/') &&
      !(value as DirectoryEntry).name.includes('\\') &&
      !(value as DirectoryEntry).name.includes('\0') &&
      typeof (value as DirectoryEntry).directory === 'boolean';
  }

  private resolveLayerId(layer: unknown): string {
    if (layer === undefined) return 'retail';
    if (typeof layer !== 'string' || !/^(?:retail|mod-[1-9]\d*)$/.test(layer)) {
      throw new Error('GameFileSystem.readdirWithMetadata: invalid asset layer metadata');
    }
    return layer;
  }

  private getLayerOrder(layerId: string): number {
    if (layerId === 'retail') return 0;
    const layerOrder = Number(layerId.slice('mod-'.length));
    if (!Number.isSafeInteger(layerOrder) || layerOrder < 1) {
      throw new Error('GameFileSystem.readdirWithMetadata: invalid asset layer order');
    }
    return layerOrder;
  }

  private isDirectoryListing(value: unknown): value is DirectoryListing {
    return typeof value === 'object' && value !== null &&
      typeof (value as DirectoryListing).isDirectory === 'boolean' &&
      Array.isArray((value as DirectoryListing).entries);
  }
}
