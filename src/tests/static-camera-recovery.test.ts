import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { GFFField } from '@/resource/GFFField';
import { GFFStruct } from '@/resource/GFFStruct';
import { GFFDataType } from '@/enums/resource/GFFDataType';
import {
  isUnplacedStaticCamera,
  matchAuthoredStaticCameras,
  readStaticCameraId,
} from '@/module/StaticCameraRecovery';

/**
 * Round 8, T5: "ebon hawk security console videos did not show at all". The
 * console's camera shots were reprojected correctly, from a camera at the world
 * origin. `ModuleCamera.save()` passed Position and Orientation to
 * `GFFField.setValue`, which stored them in `value`; the writer serialises
 * `vector` / `orientation`, so every static camera in a saved area came back at
 * (0,0,0). Read from the emulator on the 001EBO save the headset run used:
 * camera 12 is authored at (48.29, 28.35, 1.80) and loaded at (0, 0, 0).
 */
describe('GFFField.setValue for vectors and orientations', () => {
  test('a vector is stored where the writer reads it', () => {
    const field = new GFFField(GFFDataType.VECTOR, 'Position');
    field.setValue({ x: 48.29, y: 28.35, z: 1.8 });
    expect(field.getVector()).toEqual({ x: 48.29, y: 28.35, z: 1.8 });
  });

  test('an orientation is stored where the writer reads it', () => {
    const field = new GFFField(GFFDataType.ORIENTATION, 'Orientation');
    field.setValue({ x: 0.837, y: 0, z: 0, w: -0.547 });
    expect(field.getOrientation()).toEqual({ x: 0.837, y: 0, z: 0, w: -0.547 });
  });

  test('matches what the constructor already did with the same value', () => {
    const value = { x: 1, y: 2, z: 3 };
    expect(new GFFField(GFFDataType.VECTOR, 'Position').setValue(value).getVector())
      .toEqual(new GFFField(GFFDataType.VECTOR, 'Position', value).getVector());
  });

  test('a copy is stored, so the caller cannot move the saved camera afterwards', () => {
    const value = { x: 1, y: 2, z: 3 };
    const field = new GFFField(GFFDataType.VECTOR, 'Position').setValue(value);
    value.x = 99;
    expect(field.getVector().x).toBe(1);
  });
});

function camera(id: number, position: { x: number; y: number; z: number } | null): GFFStruct {
  const strt = new GFFStruct(14);
  strt.addField(new GFFField(GFFDataType.INT, 'CameraID', id));
  if (position) strt.addField(new GFFField(GFFDataType.VECTOR, 'Position', position));
  return strt;
}

describe('static camera recovery', () => {
  const ORIGIN = { x: 0, y: 0, z: 0 };

  test('a camera at the exact origin, or with no position, is unplaced', () => {
    expect(isUnplacedStaticCamera(camera(12, ORIGIN))).toBe(true);
    expect(isUnplacedStaticCamera(camera(12, null))).toBe(true);
    expect(isUnplacedStaticCamera(camera(12, { x: 48.29, y: 28.35, z: 1.8 }))).toBe(false);
  });

  test('reads the camera id', () => {
    expect(readStaticCameraId(camera(12, ORIGIN))).toBe(12);
  });

  test('pairs each unplaced camera with the authored camera of the same id', () => {
    const saved12 = camera(12, ORIGIN);
    const saved13 = camera(13, ORIGIN);
    const authored12 = camera(12, { x: 48.29, y: 28.35, z: 1.8 });
    const authored13 = camera(13, { x: 64.9, y: 36.1, z: 1.8 });
    const matches = matchAuthoredStaticCameras([saved12, saved13], [authored13, authored12]);
    expect(matches.get(saved12)).toBe(authored12);
    expect(matches.get(saved13)).toBe(authored13);
  });

  test('an ambiguous or missing id is left alone rather than guessed', () => {
    const saved = camera(12, ORIGIN);
    expect(matchAuthoredStaticCameras([saved], []).size).toBe(0);
    expect(matchAuthoredStaticCameras([saved], [
      camera(12, { x: 1, y: 1, z: 1 }), camera(12, { x: 2, y: 2, z: 2 }),
    ]).size).toBe(0);
  });

  test('an authored camera that is itself unplaced is no source', () => {
    expect(matchAuthoredStaticCameras([camera(12, ORIGIN)], [camera(12, ORIGIN)]).size).toBe(0);
  });
});

/** ModuleArea reaches the whole engine graph, so the wiring is pinned by source. */
describe('ModuleArea camera loading', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/module/ModuleArea.ts'), 'utf8');

  test('restores placements before any camera is built', () => {
    const body = source.slice(source.search(/async loadCameras\(\)\s*\{/));
    const method = body.slice(0, body.indexOf('\n  }'));
    expect(method.indexOf('restoreUnplacedStaticCameras')).toBeGreaterThan(-1);
    expect(method.indexOf('restoreUnplacedStaticCameras')).toBeLessThan(method.indexOf('camera.load()'));
  });
});
