import { describe, expect, jest, test, afterEach } from '@jest/globals';
import { ResourceLoader, ResourceNotFoundError } from '@/loaders';
import { LIPObject } from '@/resource/LIPObject';

/**
 * A missing `.lip` is ordinary retail data, not a fault.
 *
 * The install ships 77 lip archives for 82 modules, and plenty of voiced lines
 * carry no `.lip` even inside a module that has one — `303303han001` and its
 * siblings are absent from every archive in the install. The engine already
 * degrades correctly: `Load` resolves undefined, `setLIP(undefined)` is a valid
 * state, and every consumer guards on `instanceof LIPObject`, so the line simply
 * plays unlipped.
 *
 * The only cost was the report. `Load` called `console.error` once per line,
 * which made this the single largest console-error signature in the 82-module
 * sweep — 15 to 25 modules per run, and the top-ranked root cause by module
 * count. That volume buries the errors that do mean something, which is the
 * actual harm.
 *
 * A file that exists and will not read is a different event and must still be
 * reported, so the distinction is carried by a typed error rather than by
 * matching on a message.
 */
describe('lip-sync absence', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('ResourceNotFoundError keeps the original message and names the miss', () => {
    const error = new ResourceNotFoundError('303303han001', 3004);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Resource not found: ResRef: 303303han001 ResId: 3004');
    expect(error.resRef).toBe('303303han001');
    expect(error.resId).toBe(3004);
  });

  test('an absent lip resolves undefined without an error', async () => {
    jest.spyOn(ResourceLoader, 'loadResource').mockRejectedValue(
      new ResourceNotFoundError('303303han001', 3004) as never,
    );
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'debug').mockImplementation(() => {});

    await expect(LIPObject.Load('303303han001')).resolves.toBeUndefined();
    expect(errors).not.toHaveBeenCalled();
  });

  test('reports an absent resref once, however many lines request it', async () => {
    jest.spyOn(ResourceLoader, 'loadResource').mockRejectedValue(
      new ResourceNotFoundError('303303han002', 3004) as never,
    );
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => {});

    await LIPObject.Load('303303han002');
    await LIPObject.Load('303303han002');
    await LIPObject.Load('303303han002');

    expect(debug).toHaveBeenCalledTimes(1);
  });

  /**
   * The half that must not regress: a lip that is present and unreadable is a
   * real fault, and silencing it along with the absences would trade one blind
   * spot for another.
   */
  test('a lip that exists and will not read is still an error', async () => {
    jest.spyOn(ResourceLoader, 'loadResource').mockRejectedValue(
      new Error('Unexpected end of buffer') as never,
    );
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(LIPObject.Load('221carthend057')).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String((errors.mock.calls[0] as unknown[])[0])).toContain('Unexpected end of buffer');
  });
});
