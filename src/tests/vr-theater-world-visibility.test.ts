import { describe, expect, test } from '@jest/globals';
import * as THREE from 'three';
import { hideWorldForTheater } from '@/vr/runtime/VRTheaterWorldVisibility';

/**
 * The XR movie path drew the world behind the theater surface, so the Peragus
 * intro played on a screen floating in the cargo bay and the placeholder body
 * was visible until T3-M4 spawned over it. Reported from a headset session.
 */
function scene(...children: THREE.Object3D[]): THREE.Scene {
  const built = new THREE.Scene();
  for (const child of children) built.add(child);
  return built;
}

function object(visible = true): THREE.Object3D {
  const built = new THREE.Object3D();
  built.visible = visible;
  return built;
}

describe('hideWorldForTheater', () => {
  test('hides world objects and leaves the theater surface visible', () => {
    const theater = object();
    const world = object();
    hideWorldForTheater(scene(theater, world), theater);
    expect(theater.visible).toBe(true);
    expect(world.visible).toBe(false);
  });

  test('restores everything it hid', () => {
    const theater = object();
    const a = object();
    const b = object();
    const restore = hideWorldForTheater(scene(theater, a, b), theater);
    expect([a.visible, b.visible]).toEqual([false, false]);
    restore();
    expect([a.visible, b.visible, theater.visible]).toEqual([true, true, true]);
  });

  // Restoring must never turn on something the engine deliberately hid — an
  // object already invisible is not touched, so it stays invisible after.
  test('leaves an already-hidden object hidden on restore', () => {
    const theater = object();
    const alreadyHidden = object(false);
    const restore = hideWorldForTheater(scene(theater, alreadyHidden), theater);
    expect(alreadyHidden.visible).toBe(false);
    restore();
    expect(alreadyHidden.visible).toBe(false);
  });

  test('restore is idempotent', () => {
    const theater = object();
    const world = object();
    const restore = hideWorldForTheater(scene(theater, world), theater);
    restore();
    world.visible = false;
    restore();
    expect(world.visible).toBe(true);
  });

  // Fail open: this function can only remove things from the view, so with no
  // theater surface to show there would be nothing left — an unexplained black
  // void, strictly worse than the world it replaced.
  test('hides nothing when there is no theater surface to keep', () => {
    const a = object();
    const b = object();
    hideWorldForTheater(scene(a, b), null);
    expect([a.visible, b.visible]).toEqual([true, true]);
  });

  // The regression this guard exists for: a movieHost left parented to a scene
  // from before a restart is not in the scene being rendered, so hiding the
  // world would black the headset out entirely.
  test('hides nothing when the theater surface is not in this scene', () => {
    const orphanedTheater = object();
    const a = object();
    hideWorldForTheater(scene(a), orphanedTheater);
    expect(a.visible).toBe(true);
  });

  // A missing scene must not throw out of the XR frame callback: an exception
  // there stops the session presenting and blacks out the headset.
  test.each([
    ['null', null],
    ['undefined', undefined],
  ])('returns a usable restore for a %s scene', (_name, value) => {
    expect(() => hideWorldForTheater(value, null)()).not.toThrow();
  });

  test('tolerates a scene whose children are not an array', () => {
    expect(() => hideWorldForTheater({ children: null as never }, null)()).not.toThrow();
  });

  test('does not disturb descendants, only top-level children', () => {
    const theater = object();
    const parent = object();
    const child = object();
    parent.add(child);
    const restore = hideWorldForTheater(scene(theater, parent), theater);
    expect(parent.visible).toBe(false);
    // The descendant's own flag is untouched; THREE culls it via the parent.
    expect(child.visible).toBe(true);
    restore();
    expect(parent.visible).toBe(true);
  });
});
