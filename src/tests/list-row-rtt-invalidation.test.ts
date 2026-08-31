import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/**
 * `GUIListBox` draws its rows into a render target that is published once. A
 * texture load that completes after that publish leaves the row showing its
 * pre-load frame indefinitely, and nothing ever corrects it.
 *
 * This was found on the chargen feats screen, where every feat icon rendered as
 * a white square: hiding all 132 unmapped meshes in the list live changed the
 * picture not at all, because the visible image was a stale RTT. The fix is for
 * a late texture to mark the list dirty, exactly as hover and content changes
 * already do.
 *
 * Any row class that loads a texture asynchronously needs it, so this guards
 * the whole family rather than the one screen that exposed it.
 */
const ROW_CLASSES = [
  'src/game/kotor/gui/GUIFeatItem.ts',
  'src/game/tsl/gui/GUIFeatItem.ts',
  'src/game/tsl/gui/GUISpellItem.ts',
  'src/game/tsl/gui/GUIInventoryItem.ts',
  'src/game/tsl/gui/GUICreatureSkill.ts',
];

describe('list rows invalidate their render target on a late texture', () => {
  test.each(ROW_CLASSES)('%s marks the list dirty', (file) => {
    const source = read(file);
    const asyncLoads = (source.match(/TextureLoader\.(enQueue|Load(GUI)?)\(/g) || []).length;
    const invalidations = (source.match(/markListRttDirty/g) || []).length;
    expect(asyncLoads).toBeGreaterThan(0);
    // One invalidation per async load: each completes independently, and any
    // uncovered one is a row that silently keeps its pre-load frame.
    expect(invalidations).toBeGreaterThanOrEqual(asyncLoads);
  });

  test('icons are sized from their slot, not the loaded texture', () => {
    // Retail icons are 32x32 so texture-derived sizing happened to agree, but a
    // texture-replacement mod ships the same icon larger and it then drew far
    // outside its slot.
    for (const file of ROW_CLASSES) {
      expect(read(file)).not.toMatch(/iconSprite\.scale\.x = texture\.image\.width/);
    }
  });

  test('the journal is text-only, so it is not part of this family', () => {
    const journal = read('src/game/tsl/gui/GUIJournalItem.ts');
    expect(journal).not.toMatch(/TextureLoader\.(enQueue|Load)/);
  });
});
