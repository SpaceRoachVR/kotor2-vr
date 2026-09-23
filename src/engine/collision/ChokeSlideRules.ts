import * as THREE from 'three';

/**
 * Evaluates opposing normals at a choke point / corner collision to determine
 * whether a forward slide direction exists along the passage or edge tangents.
 *
 * If a safe direction exists (moving along it does not drive steeply into either
 * opposing face), returns that projected slide velocity. If all forward directions
 * penetrate steeply into an opposing surface, returns null (true dead-end wedge).
 */
export function getChokeSlideVelocity(
  n1: THREE.Vector3,
  n2: THREE.Vector3,
  velocity: THREE.Vector3
): THREE.Vector3 | null {
  // Candidate 1: Tangent along wall 1 (horizontal plane z = 0)
  const t1 = new THREE.Vector3(-n1.y, n1.x, 0).normalize();
  if (t1.dot(velocity) < 0) t1.negate();

  // Candidate 2: Tangent along wall 2 (horizontal plane z = 0)
  const t2 = new THREE.Vector3(-n2.y, n2.x, 0).normalize();
  if (t2.dot(velocity) < 0) t2.negate();

  // Candidate 3: Centerline / corridor tangent between opposing walls
  const d = new THREE.Vector3().subVectors(n1, n2);
  const tCorridor = new THREE.Vector3(-d.y, d.x, 0).normalize();
  if (tCorridor.dot(velocity) < 0) tCorridor.negate();

  const candidates = [tCorridor, t1, t2];
  let bestCandidate: THREE.Vector3 | null = null;
  let maxDot = 0;

  // Max penetration tolerance for a slide direction (allows slight tapers <= ~14 deg)
  const PENETRATION_THRESHOLD = -0.25;

  for (const t of candidates) {
    if (t.lengthSq() < 1e-6) continue;
    const dot1 = t.dot(n1);
    const dot2 = t.dot(n2);
    // Direction is safe if it doesn't drive steeply into either wall
    if (dot1 >= PENETRATION_THRESHOLD && dot2 >= PENETRATION_THRESHOLD) {
      const vDot = t.dot(velocity);
      if (vDot > maxDot) {
        maxDot = vDot;
        bestCandidate = t;
      }
    }
  }

  if (bestCandidate && maxDot > 0) {
    return bestCandidate.clone().multiplyScalar(maxDot);
  }

  return null;
}
