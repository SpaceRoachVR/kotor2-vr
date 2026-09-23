import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { hidePlayerBodyForFirstPerson } from '@/vr/runtime/VRFirstPersonBody';

/**
 * The rig is welded to the avatar at a calibrated eye height, so the model the
 * engine animates for the player sits exactly where the player's body would be —
 * and it was being drawn. Measured in a settled module with the headset
 * presenting: 15 of 15 meshes of the player model drawn, all 15 in front of the
 * camera in camera space, 11 inside the view frustum, nearest part 1.16 m from
 * the eye. It reads as a broken object in front of the face, in every module,
 * because the player is always there.
 *
 * The engine never suppressed it because nothing ever had to — flatscreen KOTOR
 * is third-person, where drawing the player is the point.
 */
const visible = (v: boolean) => ({ visible: v }) as any;

describe('hidePlayerBodyForFirstPerson', () => {
  test('hides a visible body for the render', () => {
    const body = visible(true);

    hidePlayerBodyForFirstPerson(body);

    expect(body.visible).toBe(false);
  });

  test('restores it afterwards', () => {
    const body = visible(true);

    const restore = hidePlayerBodyForFirstPerson(body);
    restore();

    expect(body.visible).toBe(true);
  });

  /**
   * The rule the theater helper established: restoring must never turn on
   * something the engine deliberately hid — a creature mid-spawn, or a player
   * hidden by a script.
   */
  test('never turns on a body the engine had hidden', () => {
    const body = visible(false);

    const restore = hidePlayerBodyForFirstPerson(body);
    restore();

    expect(body.visible).toBe(false);
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
  ])('tolerates a %s body', (_name, value) => {
    expect(() => hidePlayerBodyForFirstPerson(value as any)()).not.toThrow();
  });

  test('the restore is idempotent enough to call twice', () => {
    const body = visible(true);
    const restore = hidePlayerBodyForFirstPerson(body);
    restore();
    restore();
    expect(body.visible).toBe(true);
  });
});

describe('first-person body suppression is wired to the right render', () => {
  const spike = fs.readFileSync(
    path.join(__dirname, '..', 'vr', 'VRSpike.ts'), 'utf8',
  );

  test('applies to the first-person world submission', () => {
    const at = spike.indexOf('const restoreBody = hidePlayerBodyForFirstPerson(playerBody);');
    expect(at).toBeGreaterThan(-1);
    const block = spike.slice(at, at + 300);
    expect(block).toContain('renderer.render(scene, VRSpike.camera);');
    // Restored in a finally, so a throwing render cannot leave the player
    // permanently invisible to every other camera.
    expect(block).toContain('} finally {');
    expect(block).toContain('restoreBody();');
  });

  /**
   * The paths that must keep drawing the body. An authored cutscene reprojects
   * a shot while the player stands in the real room; the prerendered-movie path
   * already hides the whole world behind its screen.
   */
  test('keeps the body in cutscene theater shots unless the camera is inside it', () => {
    // Round 12: at Atton's cell the authored camera stood where the player
    // stood, and the shot was filmed from inside the Exile. Only that case hides.
    const cutsceneAt = spike.indexOf('private static renderCutscene(');
    expect(cutsceneAt).toBeGreaterThan(-1);
    const cutscene = spike.slice(cutsceneAt);
    expect(cutscene.split('hidePlayerBodyForFirstPerson(').length - 1).toBe(1);
    expect(cutscene).toMatch(/isCameraInsideBody\(cameraPosition, feet\)\s*\?\s*hidePlayerBodyForFirstPerson\(playerBody\)/);

    const movieAt = spike.indexOf('static renderMovie(');
    const movieEnd = spike.indexOf('private static renderCutscene(', movieAt);
    expect(spike.slice(movieAt, movieEnd)).not.toContain('hidePlayerBodyForFirstPerson');
  });

  /**
   * This test's rule was right and its assertion was not: it pinned
   * `PartyManager.Player`, which is the *fixed* main-PC slot — the very thing
   * the title forbids. The rig is welded to whichever creature the player is
   * driving, i.e. `party[0]`, and the main-PC slot stops tracking that the
   * moment the party leader changes. Reported from a headset session: switching
   * to 3C-FD made T3-M4 — standing across the room — turn invisible, while the
   * controlled droid was drawn into the player's face.
   */
  test('the engine passes the controlled character, not a fixed one', () => {
    const game = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');
    const at = game.indexOf('VRSpike.render(');
    expect(at).toBeGreaterThan(-1);
    const call = game.slice(at, game.indexOf(');', at));
    // The call delegates to getFirstPersonHiddenBody() (a minigame hides the
    // vehicle's rider instead); outside a minigame that is the controlled
    // character.
    expect(call).toContain('GameState.getFirstPersonHiddenBody()');
    expect(call).not.toContain('PartyManager.Player');
    const helperAt = game.indexOf('public static getFirstPersonHiddenBody()');
    const helper = game.slice(helperAt, game.indexOf('public static getMiniGameSeat()', helperAt));
    expect(helper).toContain('GameState.getCurrentPlayer()?.model');
    expect(helper).not.toContain('PartyManager.Player');
  });
});

describe('isCameraInsideBody', () => {
  const { isCameraInsideBody } = require('@/vr/runtime/VRFirstPersonBody');
  const feet = { x: 76.2, y: -13.0, z: 9.06 };

  test('a camera standing where the player stands is inside the body (camera 21 at the cell)', () => {
    expect(isCameraInsideBody({ x: 76.1, y: -13.1, z: 10.6 }, feet)).toBe(true);
  });

  test('a camera a step away, above the head or below the floor is not', () => {
    expect(isCameraInsideBody({ x: 77.2, y: -13.1, z: 10.6 }, feet)).toBe(false);
    expect(isCameraInsideBody({ x: 76.1, y: -13.1, z: 12.0 }, feet)).toBe(false);
    expect(isCameraInsideBody({ x: 76.1, y: -13.1, z: 8.0 }, feet)).toBe(false);
  });

  test('bad numbers never hide the body', () => {
    expect(isCameraInsideBody({ x: NaN, y: 0, z: 0 }, feet)).toBe(false);
  });
});
