import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { shouldPresentVRWorldDialoguePlate } from '@/vr/runtime/VRWorldDialoguePlate';

/**
 * Headset round 18, issue 2: large, empty black boxes before, after and
 * during interactions. The world-conversation plate was shown with nothing
 * on it: on a node with no spoken text, and while the line is hidden for the
 * letterbox at the start of a conversation.
 */
describe('the world dialogue plate', () => {
  test('shows while the spoken line is drawn', () => {
    expect(shouldPresentVRWorldDialoguePlate({ messageDrawn: true, replyCount: 0 })).toBe(true);
  });

  test('shows while replies are listed', () => {
    expect(shouldPresentVRWorldDialoguePlate({ messageDrawn: false, replyCount: 2 })).toBe(true);
  });

  test('is not shown with nothing on it', () => {
    expect(shouldPresentVRWorldDialoguePlate({ messageDrawn: false, replyCount: 0 })).toBe(false);
    expect(shouldPresentVRWorldDialoguePlate(null)).toBe(false);
    expect(shouldPresentVRWorldDialoguePlate({ messageDrawn: false, replyCount: Number.NaN })).toBe(false);
  });

  test('the panel context hands no menu to the plate when it would be empty', () => {
    // GameState is heavy to import in Jest; pin the wiring.
    const game = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');
    const at = game.indexOf('getPanelContext: () => {');
    const body = game.slice(at, game.indexOf('getMovieContext:', at));
    expect(body).toContain('shouldPresentVRWorldDialoguePlate(GameState.MenuManager.InGameDialog.getVRWorldDialogueContent())');
    expect(body).toContain('const menu = emptyWorldDialogue ? null : shownMenu;');
  });
});
