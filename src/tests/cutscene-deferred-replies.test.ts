import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * A reply script that plays a movie (104PER 104atton, a_playpermov before the
 * Harbinger arrives) flips the engine out of DIALOG mode; showReplies() then
 * returned with the state already WAITING_FOR_PC_CHOICE and nothing ever
 * showed the replies again, so the conversation hung on its continue node.
 * CutsceneManager pulls in GameState, so this pins the source.
 */
describe('conversation replies deferred by a movie', () => {
  const cutscene = fs.readFileSync(path.join(__dirname, '..', 'managers', 'CutsceneManager.ts'), 'utf8');
  const gameState = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');

  test('showReplies remembers the entry instead of dropping it when the mode is not DIALOG', () => {
    const start = cutscene.indexOf('static showReplies(entry: DLGNode) {');
    const body = cutscene.slice(start, cutscene.indexOf('//Get First Reply', start));
    expect(body).toContain('this.repliesDeferredForEntry = entry;');
    expect(body).toContain('this.repliesDeferredForEntry = undefined;');
  });

  test('showEntry defers an entry shown while a movie owns the mode, and resume shows it again', () => {
    const start = cutscene.indexOf('static showEntry(entry: DLGNode) {');
    const body = cutscene.slice(start, cutscene.indexOf('GameState.VideoEffectManager.SetVideoEffect', start));
    expect(body).toContain('this.entryDeferredForMovie = entry;');
    const resume = cutscene.slice(cutscene.indexOf('static resumeDeferredReplies(): boolean {'), cutscene.indexOf('static isWaitingForPCChoice'));
    expect(resume).toContain('this.showEntry(deferredEntry);');
  });

  test('resumeDeferredReplies shows them only for a live conversation back in DIALOG mode', () => {
    const start = cutscene.indexOf('static resumeDeferredReplies(): boolean {');
    const body = cutscene.slice(start, cutscene.indexOf('static isWaitingForPCChoice', start));
    expect(body).toContain('!this.active || GameState.Mode != EngineMode.DIALOG');
    expect(body).toContain('this.showReplies(entry);');
  });

  test('showReplies judges continue/end on the replies whose conditions pass', () => {
    // 101PER hk50.dlg E26: R28 and R30 are both continue rows under opposite conditions.
    const start = cutscene.indexOf('static showReplies(entry: DLGNode) {');
    const body = cutscene.slice(start, cutscene.indexOf('//Continue Dialog', start));
    expect(body).toContain('const available = this.dialog.getAvailableReplies(entry);');
    expect(body).toContain('const reply = available[0];');
    expect(body).toContain('available.length == 1 && reply.isContinueDialog()');
    expect(body).not.toContain('entry.replies[0]?.index');
  });

  test('RestoreEnginePlayMode resumes them after restoring DIALOG', () => {
    const start = gameState.indexOf('static RestoreEnginePlayMode(): void {');
    const body = gameState.slice(start, gameState.indexOf('static SetEngineMode(', start));
    const restore = body.indexOf('GameState.SetEngineMode(EngineMode.DIALOG);');
    expect(restore).toBeGreaterThan(0);
    expect(body.slice(restore)).toContain('GameState.CutsceneManager.resumeDeferredReplies();');
  });
});
