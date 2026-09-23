import { expect, jest, test } from '@jest/globals';
import * as THREE from 'three';
import {
  VRWeaponStanceHost,
  VRWeaponStanceTextureRenderer,
} from '@/vr/runtime/VRWeaponStanceHost';
import {
  formatVRAttackStanceReadout,
  VRAttackStance,
} from '@/vr/runtime/VRAttackStanceController';

const FLURRY: VRAttackStance = { featId: 17, label: 'Flurry' };
const POWER_ATTACK: VRAttackStance = { featId: 22, label: 'Power Attack' };

function renderer(): VRWeaponStanceTextureRenderer & { readonly rendered: string[] } {
  const rendered: string[] = [];
  return {
    rendered,
    render: jest.fn((text: string) => {
      rendered.push(text);
      return new THREE.Texture();
    }) as unknown as (text: string) => THREE.Texture,
    dispose: jest.fn() as unknown as () => void,
  };
}

function anchor(): THREE.Object3D {
  return new THREE.Object3D();
}

test('mounts on the hand anchor and starts hidden', () => {
  // It belongs to the weapon in your hand, so it is a child of the grip anchor
  // and tracks it with no per-frame transform work.
  const handAnchor = anchor();
  const host = new VRWeaponStanceHost(handAnchor, renderer());

  expect(handAnchor.children).toContain(host.object);
  expect(host.isVisible).toBe(false);
});

test('presenting text shows the plaque and renders once per distinct text', () => {
  const textures = renderer();
  const host = new VRWeaponStanceHost(anchor(), textures);

  host.present('FLURRY');
  host.present('FLURRY');
  host.present('FLURRY');

  expect(host.isVisible).toBe(true);
  expect(textures.rendered).toEqual(['FLURRY']);

  host.present('POWER ATTACK');

  expect(textures.rendered).toEqual(['FLURRY', 'POWER ATTACK']);
});

test('blank text hides the plaque instead of drawing an empty quad', () => {
  const textures = renderer();
  const host = new VRWeaponStanceHost(anchor(), textures);
  host.present('FLURRY');

  host.present('   ');

  expect(host.isVisible).toBe(false);
  expect(textures.rendered).toEqual(['FLURRY']);
});

test('clearing then re-presenting the same text does not redraw', () => {
  // Clearing is a visibility change, not a content change.
  const textures = renderer();
  const host = new VRWeaponStanceHost(anchor(), textures);
  host.present('FLURRY');

  host.clear();
  expect(host.isVisible).toBe(false);

  host.present('FLURRY');

  expect(host.isVisible).toBe(true);
  expect(textures.rendered).toEqual(['FLURRY']);
});

test('a replaced texture is disposed but the live one never is', () => {
  // The canvas renderer reuses a single texture, so disposing whatever the
  // material already held would blank the plaque.
  const shared = new THREE.Texture();
  const disposeSpy = jest.spyOn(shared, 'dispose');
  const host = new VRWeaponStanceHost(anchor(), {
    render: () => shared,
    dispose: () => undefined,
  });

  host.present('FLURRY');
  host.present('POWER ATTACK');

  expect(disposeSpy).not.toHaveBeenCalled();
});

test('rejects a non-positive or non-finite geometry', () => {
  for (const options of [
    { widthMetres: 0 },
    { heightMetres: -0.01 },
    { widthMetres: Number.NaN },
  ]) {
    expect(() => new VRWeaponStanceHost(anchor(), renderer(), options))
      .toThrow(RangeError);
  }
  expect(() => new VRWeaponStanceHost(
    anchor(),
    renderer(),
    { localOffset: new THREE.Vector3(0, Number.POSITIVE_INFINITY, 0) },
  )).toThrow(RangeError);
});

test('rejects a missing hand anchor rather than silently never showing', () => {
  expect(() => new VRWeaponStanceHost(undefined as unknown as THREE.Object3D, renderer()))
    .toThrow(TypeError);
});

test('the readout names the active stance, and both when a change is queued', () => {
  // Until the round turns over you are still attacking as the ACTIVE stance, so
  // a readout that switched immediately would misreport the next swing.
  expect(formatVRAttackStanceReadout({ active: null, pending: undefined })).toBe('Attack');
  expect(formatVRAttackStanceReadout({ active: FLURRY, pending: undefined })).toBe('Flurry');
  expect(formatVRAttackStanceReadout({ active: FLURRY, pending: POWER_ATTACK }))
    .toBe('Flurry → Power Attack');
  // A queued return to the plain attack still names both sides.
  expect(formatVRAttackStanceReadout({ active: FLURRY, pending: null }))
    .toBe('Flurry → Attack');
});

// Round 11 (K6): "it shows the next special +1 on the hilt when it should show
// all queued actions in a stack."
import { formatVRCombatQueueReadout, VR_WEAPON_STANCE_MAX_LINES } from '@/vr/runtime/VRWeaponStanceHost';

test('the queue readout lists every queued action, next first', () => {
  expect(formatVRCombatQueueReadout(['Critical Strike', 'Power Attack', 'Flurry']))
    .toBe('Critical Strike\nPower Attack\nFlurry');
  expect(formatVRCombatQueueReadout(['Critical Strike'])).toBe('Critical Strike');
  expect(formatVRCombatQueueReadout([])).toBe('');
});

test('the queue readout skips blanks and never exceeds the queue size', () => {
  expect(formatVRCombatQueueReadout(['A', '', null, undefined, ' B ', 'C', 'D'])).toBe('A\nB\nC');
  expect(VR_WEAPON_STANCE_MAX_LINES).toBe(3);
});

test('the plaque grows a row per queued action and keeps its top edge', () => {
  const host = new VRWeaponStanceHost(anchor(), renderer());
  host.present('Critical Strike');
  const oneRowTop = host.object.position.y + (host.object.geometry.parameters.height * host.object.scale.y) / 2;
  expect(host.rowCount).toBe(1);

  host.present('Critical Strike\nPower Attack\nFlurry');
  const threeRowTop = host.object.position.y + (host.object.geometry.parameters.height * host.object.scale.y) / 2;
  expect(host.rowCount).toBe(3);
  expect(threeRowTop).toBeCloseTo(oneRowTop, 6);
  expect(host.object.position.y).toBeLessThan(oneRowTop);
});

test('the engine feeds the whole queue to the hilt, not the head and a count', () => {
  const fs = require('fs');
  const path = require('path');
  const game = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');
  expect(game).toContain('stanceReadout: formatVRCombatQueueReadout(');
  expect(game).not.toMatch(/entries\.length - 1\}/);
});
