import * as THREE from 'three';
import { describe, expect, jest, test } from '@jest/globals';
import {
  getRandomWalkableDestination,
  RandomDestinationCreature,
  RandomDestinationFace,
} from '@/nwscript/actions/GetRandomDestination';

function createFace(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
): RandomDestinationFace {
  return {
    triangle: new THREE.Triangle(a, b, c),
    adjacentWalkableFaces: {},
  };
}

function createCreature(
  position: THREE.Vector3,
  faces: RandomDestinationFace[],
  groundFace?: RandomDestinationFace,
): RandomDestinationCreature {
  return {
    position,
    collisionManager: { groundFace },
    room: {
      collisionManager: {
        walkmesh: { walkableFaces: faces },
      },
    },
  };
}

describe('getRandomWalkableDestination', () => {
  test('returns a zero vector for an invalid creature', () => {
    expect(getRandomWalkableDestination(undefined, 6)).toEqual(new THREE.Vector3());
  });

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'returns a copy of the creature position for invalid range %p',
    (range) => {
      const position = new THREE.Vector3(1, 2, 3);
      const result = getRandomWalkableDestination(createCreature(position, []), range);

      expect(result).toEqual(position);
      expect(result).not.toBe(position);
    },
  );

  test('returns a deterministic walkable point within the requested horizontal range', () => {
    const face = createFace(
      new THREE.Vector3(-10, -10, 2),
      new THREE.Vector3(10, -10, 2),
      new THREE.Vector3(0, 10, 2),
    );
    const position = new THREE.Vector3(0, 0, 2);
    const randomValues = [0.25, 0];
    const random = jest.fn(() => randomValues.shift() ?? 0);

    const result = getRandomWalkableDestination(
      createCreature(position, [face], face),
      6,
      { random },
    );

    expect(result).toEqual(new THREE.Vector3(3, 0, 2));
    expect(Math.hypot(result.x - position.x, result.y - position.y)).toBeLessThanOrEqual(6);
    expect(position).toEqual(new THREE.Vector3(0, 0, 2));
  });

  test('interpolates height on a sloped walkable face', () => {
    const face = createFace(
      new THREE.Vector3(-10, -10, 0),
      new THREE.Vector3(10, -10, 10),
      new THREE.Vector3(0, 10, 5),
    );
    const position = new THREE.Vector3(0, 0, 5);
    const randomValues = [0.25, 0];

    const result = getRandomWalkableDestination(
      createCreature(position, [face], face),
      6,
      { random: () => randomValues.shift() ?? 0 },
    );

    expect(result.x).toBeCloseTo(3);
    expect(result.y).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(6.5);
  });

  test('does not select a disconnected walkmesh island', () => {
    const groundFace = createFace(
      new THREE.Vector3(-1, -1, 0),
      new THREE.Vector3(1, -1, 0),
      new THREE.Vector3(0, 1, 0),
    );
    const disconnectedFace = createFace(
      new THREE.Vector3(3, -1, 0),
      new THREE.Vector3(5, -1, 0),
      new THREE.Vector3(4, 1, 0),
    );
    const position = new THREE.Vector3(0, 0, 0);
    const randomValues = [4 / 9, 0];

    const result = getRandomWalkableDestination(
      createCreature(position, [groundFace, disconnectedFace], groundFace),
      6,
      { random: () => randomValues.shift() ?? 0, maxAttempts: 1 },
    );

    expect(result).toEqual(position);
  });

  test('can select a face connected to the creature ground face', () => {
    const groundFace = createFace(
      new THREE.Vector3(-1, -1, 0),
      new THREE.Vector3(1, -1, 0),
      new THREE.Vector3(0, 1, 0),
    );
    const connectedFace = createFace(
      new THREE.Vector3(2, -2, 0),
      new THREE.Vector3(6, -2, 0),
      new THREE.Vector3(4, 2, 0),
    );
    groundFace.adjacentWalkableFaces.a = connectedFace;
    connectedFace.adjacentWalkableFaces.a = groundFace;
    const randomValues = [4 / 9, 0];

    const result = getRandomWalkableDestination(
      createCreature(new THREE.Vector3(0, 0, 0), [groundFace, connectedFace], groundFace),
      6,
      { random: () => randomValues.shift() ?? 0 },
    );

    expect(result).toEqual(new THREE.Vector3(4, 0, 0));
  });

  test('bounds sampling attempts and falls back to the current position', () => {
    const face = createFace(
      new THREE.Vector3(-0.1, -0.1, 0),
      new THREE.Vector3(0.1, -0.1, 0),
      new THREE.Vector3(0, 0.1, 0),
    );
    const random = jest.fn(() => 0.25);
    const position = new THREE.Vector3(0, 0, 0);

    const result = getRandomWalkableDestination(
      createCreature(position, [face], face),
      6,
      { random, maxAttempts: 3 },
    );

    expect(result).toEqual(position);
    expect(random).toHaveBeenCalledTimes(6);
  });

  test('clamps malformed random values instead of returning a non-finite vector', () => {
    const face = createFace(
      new THREE.Vector3(-10, -10, 0),
      new THREE.Vector3(10, -10, 0),
      new THREE.Vector3(0, 10, 0),
    );

    const result = getRandomWalkableDestination(
      createCreature(new THREE.Vector3(0, 0, 0), [face], face),
      6,
      { random: () => Number.NaN },
    );

    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
    expect(Number.isFinite(result.z)).toBe(true);
  });
});
