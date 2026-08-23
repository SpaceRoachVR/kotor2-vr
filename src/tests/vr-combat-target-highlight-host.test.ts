import { expect, test } from '@jest/globals';
import * as THREE from 'three';
import { VRCombatTargetHighlightHost } from '@/vr/runtime/VRCombatTargetHighlightHost';

function scene(): THREE.Scene {
  return new THREE.Scene();
}

test('joins the world scene and starts hidden', () => {
  const worldScene = scene();
  const host = new VRCombatTargetHighlightHost(worldScene);

  expect(worldScene.children).toContain(host.object);
  expect(host.isVisible).toBe(false);
});

test('sits at the target, lifted clear of the floor along the engine up axis', () => {
  // World up is +Z in this engine, and ring geometry is authored in the XY
  // plane — so it is already the ground plane and must not be rotated.
  const host = new VRCombatTargetHighlightHost(scene(), { groundClearanceMetres: 0.05 });

  host.present({ id: '42', position: new THREE.Vector3(3, -7, 1.25) });

  expect(host.isVisible).toBe(true);
  expect(host.object.position.x).toBeCloseTo(3);
  expect(host.object.position.y).toBeCloseTo(-7);
  expect(host.object.position.z).toBeCloseTo(1.3);
  expect(host.object.rotation.x).toBeCloseTo(0);
  expect(host.object.rotation.y).toBeCloseTo(0);
  expect(host.object.rotation.z).toBeCloseTo(0);
});

test('a null target hides the ring', () => {
  const host = new VRCombatTargetHighlightHost(scene());
  host.present({ id: '42', position: new THREE.Vector3(1, 1, 0) });

  host.present(null);

  expect(host.isVisible).toBe(false);
});

test('a non-finite position hides rather than marking the world origin', () => {
  // Falling back to (0,0,0) would draw a convincing highlight on nothing.
  const host = new VRCombatTargetHighlightHost(scene());

  for (const position of [
    new THREE.Vector3(Number.NaN, 0, 0),
    new THREE.Vector3(0, Number.POSITIVE_INFINITY, 0),
    new THREE.Vector3(0, 0, Number.NaN),
  ]) {
    host.present({ id: '42', position: new THREE.Vector3(1, 1, 0) });
    expect(host.isVisible).toBe(true);

    host.present({ id: '42', position });

    expect(host.isVisible).toBe(false);
  }
});

test('draws through geometry, because an occluded target is when it matters most', () => {
  const host = new VRCombatTargetHighlightHost(scene());

  expect(host.object.material.depthTest).toBe(false);
  expect(host.object.material.depthWrite).toBe(false);
});

test('rejects a degenerate ring rather than drawing an invisible one', () => {
  for (const options of [
    { innerRadiusMetres: 0 },
    { outerRadiusMetres: Number.NaN },
    // Outer must exceed inner or the ring has no area at all.
    { innerRadiusMetres: 0.6, outerRadiusMetres: 0.6 },
    { innerRadiusMetres: 0.7, outerRadiusMetres: 0.5 },
    { groundClearanceMetres: -0.01 },
  ]) {
    expect(() => new VRCombatTargetHighlightHost(scene(), options)).toThrow(RangeError);
  }
});

test('rejects a missing world scene rather than silently never showing', () => {
  expect(() => new VRCombatTargetHighlightHost(undefined as unknown as THREE.Scene))
    .toThrow(TypeError);
});

test('dispose removes the ring from the scene', () => {
  const worldScene = scene();
  const host = new VRCombatTargetHighlightHost(worldScene);

  host.dispose();

  expect(worldScene.children).not.toContain(host.object);
});
