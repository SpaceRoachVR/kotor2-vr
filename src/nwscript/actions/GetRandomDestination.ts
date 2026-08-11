import * as THREE from 'three';

export interface RandomDestinationFace {
  triangle: THREE.Triangle;
  adjacentWalkableFaces?: {
    a?: unknown;
    b?: unknown;
    c?: unknown;
  };
}

export interface RandomDestinationCreature {
  position: THREE.Vector3;
  collisionManager?: {
    groundFace?: RandomDestinationFace;
  };
  room?: {
    collisionManager?: {
      walkmesh?: {
        walkableFaces?: RandomDestinationFace[];
      };
    };
  };
}

export interface RandomDestinationOptions {
  random?: () => number;
  maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 32;
const MAX_ALLOWED_ATTEMPTS = 256;
const TWO_PI = Math.PI * 2;
const BARYCENTRIC_EPSILON = 1e-7;

function isFiniteVector3(value: unknown): value is THREE.Vector3 {
  if (!value || typeof value !== 'object') return false;
  const vector = value as { x?: unknown; y?: unknown; z?: unknown };
  return typeof vector.x === 'number' && Number.isFinite(vector.x)
    && typeof vector.y === 'number' && Number.isFinite(vector.y)
    && typeof vector.z === 'number' && Number.isFinite(vector.z);
}

function isUsableFace(face: unknown): face is RandomDestinationFace {
  if (!face || typeof face !== 'object') return false;
  const triangle = (face as RandomDestinationFace).triangle;
  return triangle instanceof THREE.Triangle
    && isFiniteVector3(triangle.a)
    && isFiniteVector3(triangle.b)
    && isFiniteVector3(triangle.c);
}

function getBarycentricCoordinates2d(
  pointX: number,
  pointY: number,
  triangle: THREE.Triangle,
): [number, number, number] | undefined {
  const denominator = ((triangle.b.y - triangle.c.y) * (triangle.a.x - triangle.c.x))
    + ((triangle.c.x - triangle.b.x) * (triangle.a.y - triangle.c.y));
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= Number.EPSILON) {
    return undefined;
  }

  const weightA = (((triangle.b.y - triangle.c.y) * (pointX - triangle.c.x))
    + ((triangle.c.x - triangle.b.x) * (pointY - triangle.c.y))) / denominator;
  const weightB = (((triangle.c.y - triangle.a.y) * (pointX - triangle.c.x))
    + ((triangle.a.x - triangle.c.x) * (pointY - triangle.c.y))) / denominator;
  const weightC = 1 - weightA - weightB;

  if (weightA < -BARYCENTRIC_EPSILON
    || weightB < -BARYCENTRIC_EPSILON
    || weightC < -BARYCENTRIC_EPSILON) {
    return undefined;
  }
  return [weightA, weightB, weightC];
}

function findFaceAtPoint(
  faces: RandomDestinationFace[],
  point: THREE.Vector3,
): RandomDestinationFace | undefined {
  return faces.find((face) => getBarycentricCoordinates2d(point.x, point.y, face.triangle));
}

function collectReachableFaces(
  faces: RandomDestinationFace[],
  originFace: RandomDestinationFace,
): RandomDestinationFace[] {
  const availableFaces = new Set(faces);
  const reachableFaces: RandomDestinationFace[] = [];
  const visited = new Set<RandomDestinationFace>();
  const queue = [originFace];

  while (queue.length > 0) {
    const face = queue.shift();
    if (!face || visited.has(face) || !availableFaces.has(face)) continue;
    visited.add(face);
    reachableFaces.push(face);

    const adjacentFaces = face.adjacentWalkableFaces;
    if (!adjacentFaces) continue;
    for (const adjacentFace of [adjacentFaces.a, adjacentFaces.b, adjacentFaces.c]) {
      if (isUsableFace(adjacentFace)
        && !visited.has(adjacentFace)
        && availableFaces.has(adjacentFace)) {
        queue.push(adjacentFace);
      }
    }
  }

  return reachableFaces;
}

function normalizeRandomValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1 - Number.EPSILON);
}

function normalizeAttemptCount(value: number | undefined): number {
  if (!Number.isFinite(value) || (value as number) <= 0) return DEFAULT_MAX_ATTEMPTS;
  return Math.min(Math.floor(value as number), MAX_ALLOWED_ATTEMPTS);
}

/**
 * Samples a destination from the creature's connected room walkmesh. Sampling
 * is bounded because this action can be called every AI update by many actors.
 */
export function getRandomWalkableDestination(
  creature: RandomDestinationCreature | undefined,
  range: number,
  options: RandomDestinationOptions = {},
): THREE.Vector3 {
  if (!creature || !isFiniteVector3(creature.position)) return new THREE.Vector3();

  const origin = creature.position.clone();
  if (!Number.isFinite(range) || range <= 0) return origin;

  const walkableFaces = creature.room?.collisionManager?.walkmesh?.walkableFaces;
  if (!Array.isArray(walkableFaces)) return origin;
  const validFaces = walkableFaces.filter(isUsableFace);
  if (validFaces.length === 0) return origin;

  const reportedGroundFace = creature.collisionManager?.groundFace;
  const originFace = reportedGroundFace && validFaces.includes(reportedGroundFace)
    ? reportedGroundFace
    : findFaceAtPoint(validFaces, origin);
  if (!originFace) return origin;

  const reachableFaces = collectReachableFaces(validFaces, originFace);
  if (reachableFaces.length === 0) return origin;

  const random = typeof options.random === 'function' ? options.random : Math.random;
  const maxAttempts = normalizeAttemptCount(options.maxAttempts);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const radius = range * Math.sqrt(normalizeRandomValue(random()));
    const angle = TWO_PI * normalizeRandomValue(random());
    const pointX = origin.x + (Math.cos(angle) * radius);
    const pointY = origin.y + (Math.sin(angle) * radius);

    for (const face of reachableFaces) {
      const barycentric = getBarycentricCoordinates2d(pointX, pointY, face.triangle);
      if (!barycentric) continue;
      const [weightA, weightB, weightC] = barycentric;
      const pointZ = (face.triangle.a.z * weightA)
        + (face.triangle.b.z * weightB)
        + (face.triangle.c.z * weightC);
      if (!Number.isFinite(pointZ)) continue;
      return new THREE.Vector3(pointX, pointY, pointZ);
    }
  }

  return origin;
}
