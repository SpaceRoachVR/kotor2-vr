import { describe, expect, test } from '@jest/globals';
import { resolveVRMenuRegion } from '@/vr/runtime/VRMenuRegion';

// Round 14: "The menus and computer console screens should also be trimmed,
// as they have excess outside of the menu in the form of black or gradient boxes."
describe('trimming a menu to its own panel', () => {
  test('an 800x600 menu in a 1280x960 viewport keeps only its centre', () => {
    const r = resolveVRMenuRegion([{ width: 800, height: 600 }], 1280, 960)!;
    expect(r.uMin).toBeCloseTo(0.5 - 406 / 1280, 6);
    expect(r.uMax).toBeCloseTo(0.5 + 406 / 1280, 6);
    expect(r.vMin).toBeCloseTo(0.5 - 306 / 960, 6);
    expect(r.vMax).toBeCloseTo(0.5 + 306 / 960, 6);
  });

  test('the tab bar shown with a screen is kept too', () => {
    const r = resolveVRMenuRegion([{ width: 640, height: 480 }, { width: 800, height: 600 }], 1280, 960)!;
    expect(r.uMax - r.uMin).toBeCloseTo(812 / 1280, 6);
  });

  test('a menu that already fills the viewport is shown whole', () => {
    expect(resolveVRMenuRegion([{ width: 1280, height: 960 }], 1280, 960)).toBeNull();
  });

  test('nothing measurable, nothing trimmed', () => {
    expect(resolveVRMenuRegion([null, undefined], 1280, 960)).toBeNull();
  });
});

// Round 14: "After testing R2, I selected close game from the menu ... It loads
// with VR spike active but the screen is black."
test('the main menu clears the fade and shows the world scene the VR panels live in', () => {
  const fs = require('fs');
  const path = require('path');
  const src: string = fs.readFileSync(path.join(__dirname, '..', 'game', 'kotor', 'menu', 'MainMenu.ts'), 'utf8');
  const start = src.indexOf('  Start(){');
  const body = src.slice(start, src.indexOf('AudioLoader.LoadMusic', start));
  expect(body).toContain('GameState.FadeOverlayManager?.Clear?.();');
  expect(body).toContain('GameState.scene.visible = true;');
});
