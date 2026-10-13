import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const gameState: any = {};
jest.mock('@/GameState', () => ({ GameState: gameState }));
jest.mock('@/audio/AudioEngine', () => ({
  AudioEngine: { GetAudioEngine: () => ({ dialogMusicAudioEmitter: { stop: () => {} } }) },
}));
jest.mock('@/three/odyssey/OdysseyModel3D', () => ({ OdysseyModel3D: class {} }));

import { CutsceneManager } from '@/managers/CutsceneManager';

/**
 * TSL's Lab Station opens its crafting screen from a conversation reply script,
 * while the conversation is still active; the dialogue teardown then hides the
 * menu. runAfterConversation lets that script wait for the teardown.
 */
describe('CutsceneManager.runAfterConversation', () => {
  const manager = CutsceneManager as any;

  beforeEach(() => {
    gameState.MenuManager = { InGameDialog: { close: jest.fn() } };
    gameState.VideoEffectManager = { SetVideoEffect: jest.fn() };
    gameState.FadeOverlayManager = { holdForScript: true, FadeInFromCutscene: jest.fn() };
    gameState.RestoreEnginePlayMode = jest.fn();
    manager.audioEmitter = { stop: jest.fn() };
    manager.dialog = undefined;
    manager.paused = false;
    manager.active = false;
  });

  afterEach(() => {
    manager.active = false;
    manager.dialog = undefined;
  });

  test('runs immediately when no conversation is active', () => {
    const callback = jest.fn();
    CutsceneManager.runAfterConversation(callback);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test('queues while a conversation is active and runs once after endConversation', () => {
    const callback = jest.fn();
    manager.active = true;
    CutsceneManager.runAfterConversation(callback);
    expect(callback).not.toHaveBeenCalled();

    CutsceneManager.endConversation();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(manager.active).toBe(false);

    CutsceneManager.endConversation();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test('runs after an aborted endConversation too', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const callback = jest.fn();
    manager.active = true;
    CutsceneManager.runAfterConversation(callback);
    CutsceneManager.endConversation(true);
    expect(callback).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('runs queued callbacks in order, after the dialog is torn down', () => {
    const order: string[] = [];
    manager.active = true;
    CutsceneManager.runAfterConversation(() => order.push(`a:${manager.dialog === undefined}`));
    CutsceneManager.runAfterConversation(() => order.push('b'));
    CutsceneManager.endConversation();
    expect(order).toEqual(['a:true', 'b']);
  });

  test('a throwing callback is logged and does not stop a later one', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const later = jest.fn();
    manager.active = true;
    CutsceneManager.runAfterConversation(() => { throw new Error('boom'); });
    CutsceneManager.runAfterConversation(later);
    CutsceneManager.endConversation();
    expect(later).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  test('clearAfterConversationQueue drops queued callbacks so they never run', () => {
    const stale = jest.fn();
    manager.active = true;
    CutsceneManager.runAfterConversation(stale);
    CutsceneManager.clearAfterConversationQueue();
    CutsceneManager.endConversation();
    expect(stale).not.toHaveBeenCalled();
  });

  /**
   * A module load abandons any conversation in flight, so a callback queued in
   * the outgoing module (the Lab Station opening) must not fire later in another
   * module. Source-level, as in movie-queue-abandoned-on-unload.test.ts: importing
   * GameState does not load under jest.
   */
  test('module teardown (GameState.UnloadModule) clears the queue', () => {
    const game = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');
    const at = game.indexOf('static UnloadModule(){');
    expect(at).toBeGreaterThan(-1);
    const body = game.slice(at, game.indexOf('\n  }', at));
    expect(body).toContain('GameState.CutsceneManager.clearAfterConversationQueue();');
  });
});
