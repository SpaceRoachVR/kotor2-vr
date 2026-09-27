import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { VRCutsceneMoveHold } from '@/vr/runtime/VRCutsceneMoveHold';

/**
 * Allen, 2026-09-26 (round P1, the Fuel Depot HK-50 conversation): a scripted
 * walk during a conversation dragged the view across the level and left the
 * replies behind. The walk plays on the theater, then the view jumps.
 */
const at = (x: number, y = 0) => ({ x, y, z: 0 });

describe('VRCutsceneMoveHold', () => {
  test('small shuffles during a conversation never hold the rig', () => {
    const hold = new VRCutsceneMoveHold();
    expect(hold.update(true, at(0), 0).moving).toBe(false);
    expect(hold.update(true, at(0.3), 100)).toEqual({ heldPosition: null, moving: false, arrived: false });
  });

  test('a scripted walk holds the rig at the start, then arrives once it settles', () => {
    const hold = new VRCutsceneMoveHold();
    hold.update(true, at(0), 0);
    const walking = hold.update(true, at(1), 100);
    expect(walking.moving).toBe(true);
    expect(walking.heldPosition).toEqual(at(0));
    expect(hold.update(true, at(4), 1000).heldPosition).toEqual(at(0));
    expect(hold.update(true, at(8), 2000).moving).toBe(true);
    expect(hold.update(true, at(8), 2300).arrived).toBe(false);
    const arrived = hold.update(true, at(8.01), 2700);
    expect(arrived).toEqual({ heldPosition: null, moving: false, arrived: true });
    // The new spot is the anchor now: standing there is not another move.
    expect(hold.update(true, at(8), 2800)).toEqual({ heldPosition: null, moving: false, arrived: false });
  });

  test('a conversation that ends mid-walk arrives wherever the character is', () => {
    const hold = new VRCutsceneMoveHold();
    hold.update(true, at(0), 0);
    hold.update(true, at(2), 100);
    expect(hold.update(false, at(3), 200)).toEqual({ heldPosition: null, moving: false, arrived: true });
    expect(hold.update(false, at(3), 300).arrived).toBe(false);
  });

  test('outside a cutscene nothing is held', () => {
    const hold = new VRCutsceneMoveHold();
    expect(hold.update(false, at(0), 0)).toEqual({ heldPosition: null, moving: false, arrived: false });
    expect(hold.update(false, at(10), 100).moving).toBe(false);
  });
});

describe('wiring', () => {
  const game = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');
  test('the rig stands on the held point, a moving character goes to the theater, and arrival re-anchors', () => {
    // Updated every frame from getCutsceneContext: syncRig skips theater frames.
    expect(game).toMatch(/getCutsceneContext: \(\) => \{\s*observeVRCutsceneMove\(\);/);
    expect(game).toContain('return resolveVRRigStandingPoint(GameState.getCurrentPlayer()?.position ?? null);');
    expect(game).toMatch(/function resolveCurrentVRCutscenePresentation\(\): VRCutscenePresentation \{[\s\S]{0,200}if \(vrCutsceneMoveHold\.isMoving\) return 'theater';/);
    expect(game).toMatch(/if \(state\.arrived\) \{[\s\S]{0,160}VRSpike\.requestRigReanchor\(\);/);
  });
});
