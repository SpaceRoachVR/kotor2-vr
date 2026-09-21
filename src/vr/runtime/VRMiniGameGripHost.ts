import * as THREE from 'three';

/**
 * Visible handlebar grips for the swoop, so the rider has a fixed centre to
 * hold to.
 *
 * The bike ships none. Every node of v_supertrike01 was searched and there is
 * nothing named for a handle, a bar or a grip anywhere in its 340 nodes — in
 * retail the rider is a single baked mesh (`trider`, 994 vertices) whose hands
 * are modelled in place, and the flatscreen game steers with arrow keys, so a
 * handle never had to exist as its own object.
 *
 * Without one, steering in VR is measured between two hands floating in empty space
 * with nothing to align them to, and any bias in how the rider holds them reads
 * as a permanent pull to one side. These grips sit exactly where the bike's own
 * rider holds, derived from that rider's bounds: ±0.24 either side, 1.2 forward
 * and 0.85 above the bike origin.
 *
 * Presentation only. Nothing here is collided with, scripted or saved, and the
 * geometry is parented to the bike so it rides with it.
 */

/**
 * Grip placement relative to the bike origin, in game units (Z up).
 *
 * Measured, not guessed. The bike carries an authored rider - `trider`, 994
 * vertices - posed holding the bars, so its hands say exactly where the bars
 * are. Taking the centroid of the forward-most vertices either side of centre
 * gives (+/-0.103, 1.45, 0.813), with the outermost hand vertex at +/-0.165.
 *
 * Two earlier attempts were placed by eye and both were wrong: 1.2 forward was
 * short of the bars, and 0.45 wide put them outboard of the cockpit past the
 * orange struts, where they could not be reached at all. The rider's own hands
 * were the answer the whole time.
 */
export const SWOOP_GRIP_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [-0.103, 1.45, 0.813],
  [0.103, 1.45, 0.813],
];

/** Matching the hand span the rider's own grip covers. */
export const SWOOP_GRIP_LENGTH = 0.12;
export const SWOOP_GRIP_RADIUS = 0.025;

export const SWOOP_GRIP_GROUP_NAME = 'vr-swoop-grips';

export interface VRMiniGameGripOptions {
  /** Grip cylinder length, along the bike's X axis. */
  readonly length?: number;
  readonly radius?: number;
  readonly colour?: number;
}

/**
 * Builds the grip geometry. Kept separate from attachment so the shape can be
 * unit-tested without a scene.
 */
export function buildSwoopGrips(options: VRMiniGameGripOptions = {}): THREE.Object3D {
  const length = options.length ?? SWOOP_GRIP_LENGTH;
  const radius = options.radius ?? SWOOP_GRIP_RADIUS;
  const group = new THREE.Group();
  group.name = SWOOP_GRIP_GROUP_NAME;

  const geometry = new THREE.CylinderGeometry(radius, radius, length, 12);
  // A cylinder is Y-up in three; the grips run across the bike, which is X.
  geometry.rotateZ(Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({ color: options.colour ?? 0x2b2f36 });

  for (const [x, y, z] of SWOOP_GRIP_OFFSETS) {
    const grip = new THREE.Mesh(geometry, material);
    grip.position.set(x, y, z);
    grip.frustumCulled = false;
    group.add(grip);
  }
  return group;
}

/**
 * Attaches the grips to the bike once, and returns the group. Calling again
 * with the same container returns the group already attached rather than
 * stacking a second set.
 */
export function attachSwoopGrips(
  container: THREE.Object3D | null | undefined,
  options: VRMiniGameGripOptions = {},
): THREE.Object3D | null {
  if (!container) return null;
  const existing = container.getObjectByName(SWOOP_GRIP_GROUP_NAME);
  if (existing) return existing;
  const grips = buildSwoopGrips(options);
  container.add(grips);
  return grips;
}

/** Removes the grips, so leaving the minigame leaves the bike as it was. */
export function detachSwoopGrips(container: THREE.Object3D | null | undefined): void {
  if (!container) return;
  const existing = container.getObjectByName(SWOOP_GRIP_GROUP_NAME);
  if (!existing) return;
  container.remove(existing);
  existing.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[];
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}
