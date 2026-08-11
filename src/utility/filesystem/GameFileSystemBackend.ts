import { IGameFileSystemReadDirOptions } from '@/interface/filesystem/IGameFileSystemReadDirOptions';

export type GameFileSystemMount = 'assets' | 'user';

export interface GameFileSystemHttpHandle {
  readonly backend: 'http';
  readonly mount: GameFileSystemMount;
  readonly path: string;
}

/**
 * The portable subset used by the game engine.  Backends deliberately expose
 * only the mutable user mount; retail assets are always read-only.
 */
export interface GameFileSystemBackend {
  open(filepath: string, mode?: 'r' | 'w'): Promise<GameFileSystemHttpHandle>;
  read(handle: GameFileSystemHttpHandle, output: Uint8Array, offset: number, length: number, position: number): Promise<Uint8Array>;
  close(handle: GameFileSystemHttpHandle): Promise<void>;
  readFile(filepath: string, options?: unknown): Promise<Uint8Array>;
  readdir(filepath: string, options?: IGameFileSystemReadDirOptions, files?: string[]): Promise<string[]>;
  exists(filepath: string): Promise<boolean>;
  writeFile(filepath: string, data: Uint8Array): Promise<boolean>;
  mkdir(filepath: string, options?: IGameFileSystemReadDirOptions): Promise<boolean>;
  rmdir(filepath: string, options?: IGameFileSystemReadDirOptions): Promise<boolean>;
  unlink(filepath: string): Promise<boolean>;
}
