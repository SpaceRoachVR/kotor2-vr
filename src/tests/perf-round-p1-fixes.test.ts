import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Headset round P1 (2026-09-26) measured every conversation drawing the whole
 * module (66/66 rooms in 101PER, ~3,000 draw calls in 102PER), and heard every
 * placed sound object in a module at ~10% volume from anywhere (the "ding" and
 * "clicking" reports).
 */
const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('conversation room culling', () => {
  const area = read('module/ModuleArea.ts');

  test('a VIS file that loads is attached to the rooms, not only a failed one', () => {
    const at = area.indexOf('async loadVis(){');
    const body = area.slice(at, area.indexOf('async loadLayout(){', at));
    expect(body).toContain('this.visObject.read();');
    expect(body).not.toMatch(/this\.visObject\.read\(\);\s*return;/);
    // After the try/catch, so both the loaded and the fallback VIS attach.
    expect(body.indexOf('this.visObject.attachArea(this);')).toBeGreaterThan(body.indexOf('}catch(e){'));
  });

  test('in VR a conversation keeps the rooms around the wearer\'s head', () => {
    const at = area.indexOf('case EngineMode.DIALOG:');
    const body = area.slice(at, area.indexOf('case EngineMode.MINIGAME:', at));
    expect(body).toContain('GameState.renderer?.xr?.isPresenting && dialogPlayer?.room');
    expect(body).toContain('headRooms.add(dialogPlayer.room);');
    expect(body).toContain('|| headRooms.has(room));');
  });
});

describe('placed sound objects fall silent at MaxDistance', () => {
  test('ModuleSound asks for the linear distance model', () => {
    expect(read('module/ModuleSound.ts')).toContain("this.audioEmitter.distanceModel = 'linear';");
  });

  test('the emitter builds a linear panner from MinDistance to MaxDistance', () => {
    const emitter = read('audio/AudioEmitter.ts');
    expect(emitter).toContain("distanceModel: DistanceModelType = 'inverse';");
    expect(emitter).toContain('(this.mainNode as PannerNode).distanceModel = this.distanceModel;');
    expect(emitter).toMatch(/refDistance = Math\.min\(Math\.max\(this\.minDistance, 0\), maxDistance \* 0\.99\)/);
  });
});

describe('closed doors block movement', () => {
  test('door collision rays are cast above the feet, not along the floor', () => {
    // DWK slabs start at floor height; a ray at the soles grazed their bottom
    // edge and every closed door could be walked through (round P1).
    const collision = read('engine/CollisionManager.ts');
    const at = collision.indexOf('private handleDoorCollisions(): void {');
    const body = collision.slice(at, collision.indexOf('private handleRoomCollisions', at));
    expect(body).toContain('this.playerFeetRay.z += CollisionManager.DOOR_RAY_HEIGHT;');
    expect(body.indexOf('DOOR_RAY_HEIGHT')).toBeLessThan(body.indexOf('raycaster.ray.origin.copy(this.playerFeetRay);'));
    expect(collision).toMatch(/static DOOR_RAY_HEIGHT: number = 0\.5;/);
  });
});
