import * as THREE from 'three';
import { jest, test, expect } from '@jest/globals';
jest.mock('@/three/odyssey/windPowerContext', () => ({ ODYSSEY_AREA_WIND_DIRECTION: new THREE.Vector3(1, 1, 0) }));
import { WindManager } from '@/managers/WindManager';

/** Independent copy of the pre-optimization vector algorithm. */
function legacyRotation(v: THREE.Vector3, horizontal: number, vertical: number): THREE.Vector3 {
  const step = Math.PI / 16;
  const h = Math.round(horizontal / step) & 31;
  const t = Math.round(vertical / step) & 31;
  const hc = Math.cos(h * step), hs = Math.sin(h * step);
  const vc = Math.cos(t * step), vs = Math.sin(t * step);
  const qw = vc * hc;
  const u = new THREE.Vector3(vc * hs, vs * hc, -vs * hs);
  return new THREE.Vector3().copy(u).multiplyScalar(2 * u.dot(v))
    .addScaledVector(v, qw * qw - u.dot(u))
    .add(new THREE.Vector3().crossVectors(u, v).multiplyScalar(2 * qw));
}

function manager(): WindManager {
  const wind = new WindManager();
  for (let i = 0; i < wind.currentNoiseField.length; i++) {
    wind.currentNoiseField[i] = (i % 17) / 17;
    wind.nextNoiseField[i] = (i % 11) / 11;
  }
  wind.noiseAlpha = 0.37;
  wind.globalWind.set(1, -2, 0.5);
  wind.windMaxDeviation.set(1.7, 0.3);
  return wind;
}

test('matches legacy rotation for every angle pair and quantization boundaries', () => {
  const wind = manager();
  const v = new THREE.Vector3(1.7, -2.4, 0.35);
  const rotate = (wind as any).rotateVectorByTrigLookup.bind(wind);
  for (let h = -32; h < 32; h++) for (let t = 0; t < 32; t++) {
    for (const offset of [0, 0.5 - 1e-10, 0.5, 0.5 + 1e-10]) {
      const horizontal = (h + offset) * Math.PI / 16;
      const vertical = t * Math.PI / 16;
      expect(rotate(v, horizontal, vertical).toArray()).toEqual(legacyRotation(v, horizontal, vertical).toArray());
    }
  }
  expect(v.toArray()).toEqual([1.7, -2.4, 0.35]);
});

test('global sampling writes caller storage while retaining fresh-result ownership by default', () => {
  const wind = manager();
  const position = new THREE.Vector3(-10.3, 4.1, 7);
  const output = new THREE.Vector3(90, 90, 90);
  const first = wind.getGlobalWindNoPoint(position, 1);
  const second = wind.getGlobalWindNoPoint(position, 1);
  expect(first).not.toBe(second);
  expect((wind.getGlobalWindNoPoint as any)(position, 1, output)).toBe(output);
  expect(output.toArray()).toEqual(first.toArray());
  wind.globalWind.set(0, 0, 0);
  expect((wind.getGlobalWindNoPoint as any)(position, 1, output)).toBe(output);
  expect(output.toArray()).toEqual([0, 0, 0]);
  expect(first.toArray()).toEqual(second.toArray());
});

test('point gusts retain falloff, zero-distance and radius boundaries with aliased output', () => {
  const wind = manager();
  wind.addPointSourceWind(new THREE.Vector3(1, 2, 3), 4, 2, 3);
  wind.addPointSourceWind(new THREE.Vector3(-2, 1, 0), 7, 2, -1);
  for (const position of [new THREE.Vector3(1, 2, 3), new THREE.Vector3(5, 2, 3), new THREE.Vector3(0, 0, 0), new THREE.Vector3(50, 0, 0)]) {
    const expected = new THREE.Vector3();
    for (const source of wind.pointSourceWinds) {
      const delta = position.clone().sub(source.position);
      const distance = Math.max(Math.abs(delta.x), Math.abs(delta.y), Math.abs(delta.z));
      const length = delta.length();
      if (distance < source.radius && length > 1e-8) expected.addScaledVector(delta, ((source.radius - distance) / source.radius) * source.strength / length);
    }
    const alias = position.clone();
    expect((wind.getGlobalPointWind as any)(alias, undefined, alias)).toBe(alias);
    expect(alias.toArray()).toEqual(expected.toArray());
  }
});

test('grass trajectories match existing sampling across noise transitions, gusts and delta clamp', () => {
  const wind = manager();
  wind.addPointSourceWind(new THREE.Vector3(2, 1, 0), 5, 100, 3);
  const output = new THREE.Vector3();
  const gust = new THREE.Vector3();
  const position = new THREE.Vector3(-1.3, 0.8, 0.2);
  const expected = new THREE.Vector2(), actual = new THREE.Vector2();
  for (const delta of Array.from({ length: 80 }, (_, i) => [0, 1 / 90, 1 / 30, 0.2][i % 4])) {
    wind.update(delta);
    const noise = (wind as any).sampleBlendedNoise(position.x, position.y);
    const noiseV = (wind as any).sampleBlendedNoise(position.y, position.x);
    const h = ((noise * 2) * wind.windMaxDeviation.x - wind.windMaxDeviation.x) * 0.5;
    const v = ((noiseV * 2) * wind.windMaxDeviation.y - wind.windMaxDeviation.y) * 0.5;
    const legacy = legacyRotation(wind.globalWind.clone().multiplyScalar(noise), h, v).multiplyScalar(wind.getGlobalWindCapScale());
    const legacyGust = wind.getGlobalPointWind(position);
    (wind.getGlobalWindNoPoint as any)(position, 1, output).multiplyScalar(wind.getGlobalWindCapScale());
    (wind.getGlobalPointWind as any)(position, undefined, gust);
    const dt = Math.min(delta, 0.1);
    expected.x += (legacy.x + legacyGust.x - expected.x) * 0.25 * dt;
    expected.y += (legacy.y + legacyGust.y - expected.y) * 0.25 * dt;
    actual.x += (output.x + gust.x - actual.x) * 0.25 * dt;
    actual.y += (output.y + gust.y - actual.y) * 0.25 * dt;
    expect(actual.toArray()).toEqual(expected.toArray());
  }
});

test('rejects invalid sampling inputs before mutating caller output', () => {
  const wind = manager();
  const output = new THREE.Vector3(1, 2, 3);
  expect(() => wind.getGlobalWindNoPoint(new THREE.Vector3(NaN, 0, 0), 1, output)).toThrow(RangeError);
  expect(() => wind.getGlobalWindNoPoint(new THREE.Vector3(), Infinity, output)).toThrow(RangeError);
  expect(() => wind.getGlobalPointWind(new THREE.Vector3(0, 0, Infinity), undefined, output)).toThrow(RangeError);
  expect(() => wind.getGlobalWindNoPoint(new THREE.Vector3(), 1, {} as THREE.Vector3)).toThrow(TypeError);
  expect(output.toArray()).toEqual([1, 2, 3]);
});
