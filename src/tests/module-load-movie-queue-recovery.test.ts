import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `VideoManager.playMovieQueue` rejects when a queue is already active. In
 * LoadModule that call was neither awaited nor caught, so the rejection escaped
 * as an unhandled page exception and the completion callback never ran.
 *
 * That callback is the whole post-load setup — spawn scripts, the in-game
 * overlay, the scene compile — and `loadingModule = false` on its last line.
 * Leaving that flag latched makes LoadModule return immediately from then on, so
 * every later transition becomes a silent no-op. The failure is a hard stop at
 * the next door, not a dropped movie.
 *
 * The sweep caught it once in 82 modules and it did not reproduce on a targeted
 * re-run of the same transition, which is what a timing-dependent race looks
 * like — and why the recovery matters more than the trigger.
 *
 * The boot-path call to playMovieQueue already recovers this way. These tests
 * pin that both call sites do.
 */
describe('LoadModule movie queue recovery', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'GameState.ts'), 'utf8',
  );

  test('the load completion is named, so it can run without the queue', () => {
    expect(source).toContain('const completeModuleLoad = async () => {');
  });

  test('a rejected movie queue still completes the load', () => {
    const at = source.indexOf('VideoManager.playMovieQueue(completeModuleLoad)');
    expect(at).toBeGreaterThan(-1);
    const call = source.slice(at, at + 400);
    expect(call).toContain('.catch(');
    expect(call).toContain('await completeModuleLoad();');
  });

  test('the completion still clears loadingModule', () => {
    // The flag whose latching turns every later module load into a no-op.
    const at = source.indexOf('const completeModuleLoad = async () => {');
    const end = source.indexOf('VideoManager.playMovieQueue(completeModuleLoad)', at);
    expect(source.slice(at, end)).toContain('GameState.loadingModule = false;');
  });

  test('every playMovieQueue call site handles rejection', () => {
    const lines = source.split(/\r?\n/);
    const unguarded: string[] = [];
    lines.forEach((line, index) => {
      if (!line.includes('playMovieQueue(')) return;
      // The guard may sit on the call line or on the closing of its callback.
      const window = lines.slice(index, index + 45).join('\n');
      if (!window.includes('.catch(')) unguarded.push(`${index + 1}: ${line.trim()}`);
    });
    expect(unguarded).toEqual([]);
  });
});
