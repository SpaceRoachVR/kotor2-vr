import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { VRPanelStickScroll } from '@/vr/runtime/VRPanelStickScroll';

// Round 14 (S2): the feat list "needs to be scrollable with the right stick",
// and "when selecting a feat the menu jumps back to the top".
describe('thumbstick list scrolling', () => {
  test('one row on the push, nothing inside the deadzone', () => {
    const s = new VRPanelStickScroll();
    expect(s.update(0.3, 0.016)).toBe(0);
    expect(s.update(0.9, 0.016)).toBe(1);
    expect(s.update(0.9, 0.016)).toBe(0);
  });

  test('pushed forward scrolls up', () => {
    expect(new VRPanelStickScroll().update(-0.9, 0.016)).toBe(-1);
  });

  test('held, it repeats like a key', () => {
    const s = new VRPanelStickScroll();
    s.update(0.9, 0);
    let rows = 0;
    for (let i = 0; i < 60; i++) rows += s.update(0.9, 1 / 60);
    // 1 s held: first repeat at 0.35 s, then every 0.12 s.
    expect(rows).toBe(6);
  });

  test('releasing and pushing again scrolls again at once', () => {
    const s = new VRPanelStickScroll();
    s.update(0.9, 0);
    s.update(0, 0.016);
    expect(s.update(0.9, 0.016)).toBe(1);
  });
});

test('the feat grid keeps its scroll position when a pick rebuilds it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'game', 'kotor', 'menu', 'CharGenFeats.ts'), 'utf8');
  expect(src).toContain('this.LB_FEATS.setItems(groups, { keepScroll: true });');
});
