/**
 * Whether a filesystem error means "this file does not exist".
 *
 * Some game resources are genuinely optional. Per-module lip-sync archives are
 * the clearest case: the retail install ships 77 of them for 82 modules, so
 * 154HAR, 211TEL, 371NAR, 421DXN, 505OND and 510OND simply have no lip-sync and
 * never did. The loader already treated the absence correctly - it catches and
 * returns undefined - but logged it through `console.error`, which reports a
 * shipping install's normal state as a fault.
 *
 * Distinguishing that from a real failure needs the cause, not the message.
 * Matching on error text would break the moment the wording changed, so the
 * HTTP backend attaches `status` to the errors it raises and this reads it.
 *
 * Deliberately import-free so it can be tested directly.
 *
 * @file FileNotFound.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */

/** An error carrying an HTTP status, as raised by the HTTP filesystem backend. */
export interface StatusCarryingError extends Error {
  status?: number;
  code?: string;
}

/**
 * @param error - the caught value, which need not be an Error at all
 * @returns true only when the cause is a genuine absence
 */
export function isFileNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as StatusCarryingError;
  if (candidate.status === 404) {
    return true;
  }
  // Node and the Electron build surface absence as ENOENT rather than a status.
  return candidate.code === 'ENOENT';
}
