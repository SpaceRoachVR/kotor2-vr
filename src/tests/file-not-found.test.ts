import { describe, expect, test } from '@jest/globals';
import { isFileNotFoundError } from '@/utility/filesystem/FileNotFound';

/**
 * Six modules in the 82-module sweep logged a read failure for a lip-sync
 * archive that the retail install does not ship: 154HAR, 211TEL, 371NAR,
 * 421DXN, 505OND and 510OND. 77 archives exist for 82 modules, so those six
 * have no lip-sync and never did. The loader handled the absence correctly and
 * then reported it through console.error, which presents a shipping install's
 * normal state as a fault.
 *
 * The point of this helper is that a *genuine* read failure must still be an
 * error, so the tests below care as much about what it refuses as what it
 * accepts.
 */
describe('isFileNotFoundError', () => {

  test('accepts a 404 from the HTTP backend', () => {
    const error = Object.assign(new Error('GameFileSystem.read: failed'), { status: 404 });
    expect(isFileNotFoundError(error)).toBe(true);
  });

  test('accepts ENOENT from the node and electron backends', () => {
    const error = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    expect(isFileNotFoundError(error)).toBe(true);
  });

  test('refuses other failures, which must stay loud', () => {
    // A truncated read, a server error and a permission failure are real
    // problems; silencing them is how a broken install looks like a working one.
    for (const status of [200, 206, 403, 416, 500, 503]) {
      const error = Object.assign(new Error('GameFileSystem.read: failed'), { status });
      expect(isFileNotFoundError(error)).toBe(false);
    }
    expect(isFileNotFoundError(Object.assign(new Error('denied'), { code: 'EACCES' }))).toBe(false);
  });

  test('refuses a plain error with no cause attached', () => {
    // Absence has to be proven, not assumed from a bare throw.
    expect(isFileNotFoundError(new Error('expected HTTP 206, received 404'))).toBe(false);
  });

  test('survives non-error values', () => {
    for (const value of [undefined, null, 'not found', 404, {}]) {
      expect(isFileNotFoundError(value)).toBe(false);
    }
  });

});
