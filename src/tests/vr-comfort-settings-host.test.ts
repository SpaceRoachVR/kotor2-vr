import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import * as THREE from 'three';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Round 13: opening Comfort Settings froze the game with no menu. 3.18 added
 * Damage Flash and Unpause on Wheel Close, the model handed the panel six rows,
 * and the panel - fixed at four - threw every frame while owning input.
 */

// A canvas stand-in: the host only draws on it.
const context = new Proxy({}, { get: (): (() => void) => (): void => undefined, set: (): boolean => true }) as unknown as CanvasRenderingContext2D;
let previousDocument: unknown;
beforeAll(() => {
  previousDocument = (globalThis as any).document;
  (globalThis as any).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  };
});
afterAll(() => { (globalThis as any).document = previousDocument; });

const head = { position: new THREE.Vector3(0, 0, 1.6), orientation: new THREE.Quaternion() } as any;
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Row ${i}`, value: 'On' }));

describe('VRComfortSettingsHost', () => {
  const load = () => require('@/vr/runtime/VRComfortSettingsHost');

  test('presents the six rows the settings model produces', () => {
    const { VRComfortSettingsHost } = load();
    const host = new VRComfortSettingsHost(new THREE.Scene());
    expect(() => host.present(head, rows(6))).not.toThrow();
    expect(host.object.visible).toBe(true);
    expect(host.rows).toBe(6);
  });

  test('keeps each row the same height as it grows', () => {
    const { VRComfortSettingsHost } = load();
    const host = new VRComfortSettingsHost(new THREE.Scene());
    host.present(head, rows(4));
    const four = host.object.scale.y;
    host.present(head, rows(6));
    expect(host.object.scale.y).toBeCloseTo(four * 6 / 4, 6);
  });

  test('rejects an empty or oversized row list instead of drawing nonsense', () => {
    const { VRComfortSettingsHost, VR_COMFORT_SETTINGS_MAX_ROWS } = load();
    const host = new VRComfortSettingsHost(new THREE.Scene());
    expect(() => host.present(head, [])).toThrow(RangeError);
    expect(() => host.present(head, rows(VR_COMFORT_SETTINGS_MAX_ROWS + 1))).toThrow(RangeError);
  });

  test('the engine offers no more rows than the panel can show', () => {
    const game = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');
    const labels = ['Movement', 'Turning', 'Snap Turn Angle', 'Comfort Vignette', 'Damage Flash', 'Unpause on Wheel Close',
      'Combat Sounds', 'Wrist Health', 'Dominant Hand', 'Controls Guide', 'Dialogue Text'];
    for (const label of labels) expect(game).toContain(`label: '${label}'`);
    const { VR_COMFORT_SETTINGS_MAX_ROWS } = load();
    expect(labels.length).toBeLessThanOrEqual(VR_COMFORT_SETTINGS_MAX_ROWS);
  });
});

// Round 14 (R1): "the ray pointer needs to collide with the menu so players
// can see what they are pointing and clicking". Panels skip the depth test, so
// whatever is ordered later is drawn on top.
describe('pointer over panels', () => {
  test('the ray and cursor draw over every panel', () => {
    const { VRComfortSettingsHost } = require('@/vr/runtime/VRComfortSettingsHost');
    const { VRPanelPointerHost } = require('@/vr/runtime/VRPanelPointerHost');
    const scene = new THREE.Scene();
    const panel = new VRComfortSettingsHost(scene);
    const pointer = new VRPanelPointerHost(scene);
    expect(pointer.rayObject.renderOrder).toBeGreaterThan(panel.object.renderOrder);
    expect(pointer.cursorObject.renderOrder).toBeGreaterThan(panel.object.renderOrder);
  });

  test('the row under the pointer is highlighted', () => {
    const { VRComfortSettingsHost } = require('@/vr/runtime/VRComfortSettingsHost');
    const host = new VRComfortSettingsHost(new THREE.Scene());
    host.present(head, rows(8));
    const before = host.object.material.map.version;
    host.setHighlightedRow(2);
    expect(host.object.material.map.version).toBeGreaterThan(before);
  });
});
