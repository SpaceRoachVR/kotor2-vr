import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { MovieModeOwnership } from '@/managers/video/MovieModeOwnership';

/**
 * Movie-mode ownership is taken in `playMovieQueue` and released in exactly one
 * place — `playNextMovie`, when the queue drains. Nothing released it when a
 * queue was *abandoned* instead, and a module transition abandons one every time
 * it happens while a movie is still playing: `UnloadModule` reset the audio
 * engine, lights, wind, cursor and module objects, and left the VideoManager
 * alone.
 *
 * The leaked flag was only the visible half. `LoadModule` pushes the incoming
 * module's movies onto the same static queue a few lines after calling
 * `UnloadModule`, so an outgoing queue still draining would have swallowed them
 * and played them as part of the outgoing module — and the outgoing
 * `onQueueComplete`, the previous load's completion, was still armed to fire
 * against the new module.
 *
 * Observed as `VideoManager.playMovieQueue: A movie queue is already active`
 * thrown out of LoadModule, at roughly one module in 82 and not tied to any
 * particular module. The recovery in module-load-movie-queue-recovery.test.ts
 * keeps it non-fatal; this removes the trigger.
 *
 * These are source-level assertions because importing VideoManager pulls in
 * GameState and the whole GUI tree, which does not load under jest. The
 * ownership semantics the fix depends on are exercised directly below.
 */
const source = (relative: string) =>
  fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

describe('a module transition abandons the outgoing movie queue', () => {
  test('VideoManager exposes an abandon path', () => {
    const video = source('managers/VideoManager.ts');
    const at = video.indexOf('static reset(): void {');
    expect(at).toBeGreaterThan(-1);
    const body = video.slice(at, video.indexOf('\n  }', at));
    // Every piece of abandoned state: the movies, the arming completion, the
    // decoder, and the ownership flag itself.
    expect(body).toContain('this.movieQueue.length = 0;');
    expect(body).toContain('this.onQueueComplete = undefined;');
    expect(body).toContain('this.cleanup(false);');
    expect(body).toContain('this.modeOwnership.endQueue();');
  });

  test('module teardown calls it', () => {
    const game = source('GameState.ts');
    const at = game.indexOf('static UnloadModule(){');
    expect(at).toBeGreaterThan(-1);
    const body = game.slice(at, game.indexOf('\n  }', at));
    expect(body).toContain('GameState.VideoManager.reset();');
  });

  test('teardown happens before the incoming module queues its own movies', () => {
    // LoadModule calls UnloadModule and then pushes sMovie1..6 onto the same
    // static queue. If that order ever inverts, the reset eats the new module's
    // movies instead of the old module's.
    const game = source('GameState.ts');
    const unload = game.indexOf('GameState.UnloadModule();');
    const firstQueue = game.indexOf('GameState.VideoManager.queueMovie(sMovie1', unload);
    expect(unload).toBeGreaterThan(-1);
    expect(firstQueue).toBeGreaterThan(unload);
  });

  /**
   * The semantics the fix relies on: ownership released by endQueue can be
   * taken again. Without the release, the second acquisition fails and
   * playMovieQueue throws — which is the reported defect.
   */
  test('released ownership can be re-acquired by the next load', () => {
    const ownership = new MovieModeOwnership();

    expect(ownership.beginQueue()).toBe(true);
    expect(ownership.beginQueue()).toBe(false);

    ownership.endQueue();

    expect(ownership.beginQueue()).toBe(true);
  });

  test('abandoning a queue that was never begun is harmless', () => {
    const ownership = new MovieModeOwnership();

    ownership.endQueue();

    expect(ownership.isQueueActive()).toBe(false);
    expect(ownership.beginQueue()).toBe(true);
  });
});
