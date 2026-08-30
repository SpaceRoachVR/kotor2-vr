/** Builds a safe screenshot path within the explicit mutable Screenshots mount. */
export interface ScreenshotDirectoryFileSystem {
  mkdir(path: string, options: { recursive: boolean }): Promise<boolean>;
}

/** Ensures every backend has a writable screenshot parent before it is enumerated or written. */
export async function ensureScreenshotDirectory(filesystem: ScreenshotDirectoryFileSystem): Promise<boolean> {
  try {
    return await filesystem.mkdir('Screenshots', { recursive: true });
  } catch {
    return false;
  }
}

export function buildScreenshotPath(filename: string): string {
  if (typeof filename !== 'string') throw new TypeError('Screenshot filename must be a string');
  const normalized = filename.trim();
  if (
    normalized.length === 0 ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.includes('/') ||
    normalized.includes('\\') ||
    normalized.includes('\0')
  ) {
    throw new Error('Invalid screenshot filename');
  }
  return `Screenshots/${normalized}`;
}
