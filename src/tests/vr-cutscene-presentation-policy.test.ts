import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import {
  isVRCutscenePointRemote,
  resolveVRCutscenePresentation,
  type VRCutsceneShot,
} from '@/vr/runtime/VRCutscenePresentationPolicy';

/**
 * Positions measured on the 001EBO prologue intro in the emulator: T3-M4 in
 * the cockpit at (54.7, 79.6), placed cameras 6 (55.2, 82.1) and 7
 * (49.4, 79.3) in the cockpit, and 25 (55, 40.8), 30 (45.5, 38.8) and 23
 * (48.4, 16) on the exterior, medbay and hyperdrive.
 */
const PLAYER = new THREE.Vector3(54.7, 79.6, 1.8);
/** The cockpit floor footprint; a stand-in for the engine's walkmesh lookup. */
const COCKPIT = new THREE.Box3(new THREE.Vector3(50, 76, -10), new THREE.Vector3(58, 84, 10));
const overCockpit = (point: THREE.Vector3) => COCKPIT.containsPoint(point);

function shot(overrides: Partial<VRCutsceneShot> = {}): VRCutsceneShot {
  return {
    animatedCutscene: false,
    cameraKind: 'dialog',
    cameraPosition: null,
    participantPositions: [],
    playerPosition: PLAYER,
    isOverPlayerRoom: overCockpit,
    theaterAlreadyShown: false,
    ...overrides,
  };
}

describe('resolveVRCutscenePresentation', () => {
  // Round 11: "movie still shows in kreia introduction scene and in first
  // peragus 'awaken' scene when they shouldn't." Both were sent to the theater
  // by being cinematic, not by being somewhere the player cannot see.
  test('an animated cutscene filmed in the player room stays in the world (101awake)', () => {
    expect(resolveVRCutscenePresentation(shot({
      animatedCutscene: true, cameraKind: 'placeable', cameraPosition: new THREE.Vector3(55.2, 82.1, 4.8),
    }))).toBe('world');
  });

  test('an animated cutscene of a remote place is still shown', () => {
    expect(resolveVRCutscenePresentation(shot({
      animatedCutscene: true, cameraKind: 'placeable', cameraPosition: new THREE.Vector3(55, 40.8, 3.1),
    }))).toBe('theater');
  });

  test('an animated camera moving around the player conversation stays in the world (101kreia)', () => {
    expect(resolveVRCutscenePresentation(shot({
      cameraKind: 'animated', cameraPosition: new THREE.Vector3(52.1, 80.4, 3.9),
    }))).toBe('world');
  });

  test('an animated camera somewhere the player cannot see goes to the theater', () => {
    expect(resolveVRCutscenePresentation(shot({
      cameraKind: 'animated', cameraPosition: new THREE.Vector3(48.4, 16, 4.7),
    }))).toBe('theater');
  });

  test('an animated camera with no known position is shown rather than lost', () => {
    expect(resolveVRCutscenePresentation(shot({ cameraKind: 'animated' }))).toBe('theater');
  });

  test.each([
    ['the exterior (camera 25)', new THREE.Vector3(55, 40.8, 3.1)],
    ['the medbay (camera 30)', new THREE.Vector3(45.5, 38.8, 4.7)],
    ['the hyperdrive (camera 23)', new THREE.Vector3(48.4, 16, 4.7)],
  ])('a placed camera on %s is shown, not skipped', (_name, cameraPosition) => {
    expect(resolveVRCutscenePresentation(shot({ cameraKind: 'placeable', cameraPosition }))).toBe('theater');
  });

  test('a placed camera in the room the player stands in stays in the world', () => {
    expect(resolveVRCutscenePresentation(shot({
      cameraKind: 'placeable',
      cameraPosition: new THREE.Vector3(55.2, 82.1, 4.8),
    }))).toBe('world');
  });

  test('once a conversation is on the theater its cockpit shots stay there', () => {
    expect(resolveVRCutscenePresentation(shot({
      cameraKind: 'placeable',
      cameraPosition: new THREE.Vector3(49.4, 79.3, 4.6),
      theaterAlreadyShown: true,
    }))).toBe('theater');
  });

  test('a direct conversation with someone in the room is held in the world', () => {
    expect(resolveVRCutscenePresentation(shot({
      participantPositions: [new THREE.Vector3(56, 80, 1.8)],
    }))).toBe('world');
  });

  test('engine framing returns to the world after a remote cut, when the speaker is here', () => {
    expect(resolveVRCutscenePresentation(shot({
      participantPositions: [new THREE.Vector3(56, 80, 1.8)],
      theaterAlreadyShown: true,
    }))).toBe('world');
  });

  test('a conversation between people nowhere near the player goes to the theater', () => {
    expect(resolveVRCutscenePresentation(shot({
      participantPositions: [new THREE.Vector3(10, 10, 0), new THREE.Vector3(12, 10, 0)],
    }))).toBe('theater');
  });

  test('a conversation with only the player and nobody placed is held in the world', () => {
    expect(resolveVRCutscenePresentation(shot())).toBe('world');
  });
});

/**
 * Round 8, T5. On the Ebon Hawk the corridor room 001ebo5 has a bounding box of
 * (14.8, 2.4, 0)–(88.7, 75.1, 8.1): the whole ship. T3-M4 at the security
 * console (47.6, 46.2) stands in it, and the Outer Garage Door camera 12 sits at
 * (48.3, 28.4) over room 001ebo7's floor. A box test held that feed in the world.
 */
describe('security console camera feeds', () => {
  const T3_AT_CONSOLE = new THREE.Vector3(47.6, 46.2, 1.8);
  const GARAGE_CAMERA = new THREE.Vector3(48.3, 28.4, 4.45);
  const CORRIDOR_BOX = new THREE.Box3(new THREE.Vector3(14.8, 2.4, 0), new THREE.Vector3(88.7, 75.1, 8.1));

  test('a feed from over another room floor goes to the theater', () => {
    expect(resolveVRCutscenePresentation(shot({
      cameraKind: 'placeable',
      cameraPosition: GARAGE_CAMERA,
      playerPosition: T3_AT_CONSOLE,
      isOverPlayerRoom: () => false,
    }))).toBe('theater');
  });

  test('which is exactly what the corridor bounding box got wrong', () => {
    expect(CORRIDOR_BOX.containsPoint(GARAGE_CAMERA)).toBe(true);
  });

  test('a camera with no floor under it is judged by distance alone', () => {
    expect(isVRCutscenePointRemote(GARAGE_CAMERA, T3_AT_CONSOLE, () => null)).toBe(true);
    expect(isVRCutscenePointRemote(new THREE.Vector3(49, 48, 4), T3_AT_CONSOLE, () => null)).toBe(false);
  });
});

describe('isVRCutscenePointRemote', () => {
  test('a point over another room but beside the player is not remote', () => {
    expect(isVRCutscenePointRemote(new THREE.Vector3(58.5, 80, 2), PLAYER, () => false)).toBe(false);
  });

  test('a point over the player room floor is not remote however far', () => {
    expect(isVRCutscenePointRemote(new THREE.Vector3(57.9, 76.1, 2), new THREE.Vector3(0, 0, 0), overCockpit)).toBe(false);
  });

  test('a nearby point counts even when the engine resolved no room', () => {
    expect(isVRCutscenePointRemote(new THREE.Vector3(57, 81, 2), PLAYER, null)).toBe(false);
  });

  test('with no idea where the player is, every point is remote', () => {
    expect(isVRCutscenePointRemote(new THREE.Vector3(57, 81, 2), null, null)).toBe(true);
  });
});

describe('the engine hands the policy every camera position it has', () => {
  test('placed and animated cameras both report where they are', () => {
    const fs = require('fs');
    const path = require('path');
    const game = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');
    expect(game).toContain("const cameraPosition = cameraKind !== 'dialog' && camera");
  });
});
