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
  test('does not touch the cutscene or movie theater renders', () => {
    const cutsceneAt = spike.indexOf('private static renderCutscene(');
    expect(cutsceneAt).toBeGreaterThan(-1);
    expect(spike.slice(cutsceneAt)).not.toContain('hidePlayerBodyForFirstPerson');

    const movieAt = spike.indexOf('static renderMovie(');
    const movieEnd = spike.indexOf('private static renderCutscene(', movieAt);
    expect(spike.slice(movieAt, movieEnd)).not.toContain('hidePlayerBodyForFirstPerson');
  });

  test('the engine passes the controlled character, not a fixed one', () => {
    const game = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');
    expect(game).toContain('GameState.PartyManager.Player?.model');
  });
});
