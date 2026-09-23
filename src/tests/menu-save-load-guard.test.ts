import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

// Round 13: a stale second Load click disposed the level mid-load (black screen).
describe('Load Game runs one load at a time, from a visible menu', () => {
  for (const game of ['tsl', 'kotor']) {
    test(`${game} MenuSaveLoad guards the load`, () => {
      const src = fs.readFileSync(path.join(__dirname, '..', 'game', game, 'menu', 'MenuSaveLoad.ts'), 'utf8');
      const at = src.indexOf('if (!this.bVisible || GameState.loadingModule) return;');
      expect(at).toBeGreaterThan(-1);
      // The guard comes before anything is cleared or disposed.
      expect(at).toBeLessThan(src.indexOf('this.manager.ClearMenus();', at - 800));
      expect(at).toBeLessThan(src.indexOf('.dispose();', at));
    });
  }
});
