import * as THREE from 'three';

/**
 * Where the hand closes on a held lightsaber.
 *
 * Retail saber models are authored for the creature's hand bone, which grips
 * the hilt right under the emitter: `w_lghtsbr_001` runs its hilt from
 * z -0.204 to 0.132 with the emitter at 0.121, so in VR the fist sat under the
 * emitter head and 16 cm of shaft and pommel hung below it — the "silver
 * hilt" the replay critics mistook for a grey, unlit blade (Hive, run 2).
 * Allen: the fist belongs on the grip with only a short pommel showing.
 *
 * Measured, not tabled, from the model's own geometry: the blade meshes
 * (Odyssey saber nodes) start at their emitters and point out of the hilt,
 * and every other mesh is hilt. Retail (all in model space, metres):
 *   single  w_lghtsbr_001  hilt -0.204..0.132  emitter  0.121 (+Z)
 *   short   w_shortsbr_001 hilt -0.156..0.176  emitter  0.104 (+Z)
 *   double  w_dblsbr_001   hilt -0.119..0.475  emitters 0.406 (+Z), -0.050 (-Z)
 *
 * The generic WebXR fist, closed on the grip, spans grip-space z -0.044 (thumb
 * side) to 0.041 (little-finger side) round the grip origin.
 */

/** The closed fist's reach from the grip origin toward the little finger (pommel side). */
export const VR_FIST_POMMEL_SIDE_METRES = 0.041;
/** ... and toward the thumb (emitter side). */
export const VR_FIST_EMITTER_SIDE_METRES = 0.044;
/** How much pommel shows below the fist on a single-bladed hilt. */
export const VR_SABER_POMMEL_SHOWN_METRES = 0.04;
/** The fist never closes over the emitter: at least this much hilt stays clear under it. */
export const VR_SABER_EMITTER_CLEARANCE_METRES = 0.01;

export interface VRSaberEmitter {
  /** Emitter position along the model's Z axis. */
  readonly z: number;
  /** The blade's direction along model Z: +1 or -1. */
  readonly direction: 1 | -1;
}

/**
 * The point on the model's Z axis the fist should close round, or null when
 * the model has no blade or no hilt. Pure.
 *
 * Single-bladed: the fist sits with its little finger just above the pommel,
 * so only {@link VR_SABER_POMMEL_SHOWN_METRES} of hilt shows below it, and the
 * off hand of a two-handed grip — which the combat detector expects ahead of
 * the dominant hand, toward the blade — has the shaft above it. A short hilt
 * moves the fist down until it clears the emitter.
 *
 * Double-bladed: the fist sits between the two emitters.
 */
export function resolveVRSaberGripCentre(
  hiltMinZ: number,
  hiltMaxZ: number,
  emitters: readonly VRSaberEmitter[],
): number | null {
  if (!Number.isFinite(hiltMinZ) || !Number.isFinite(hiltMaxZ) || !(hiltMaxZ > hiltMinZ)) return null;
  const valid = emitters.filter((emitter) => Number.isFinite(emitter.z) && (emitter.direction === 1 || emitter.direction === -1));
  if (valid.length === 0) return null;
  const up = valid.filter((emitter) => emitter.direction === 1);
  const down = valid.filter((emitter) => emitter.direction === -1);
  if (up.length > 0 && down.length > 0) {
    const top = Math.min(...up.map((emitter) => emitter.z));
    const bottom = Math.max(...down.map((emitter) => emitter.z));
    return (top + bottom) / 2;
  }
  const direction = up.length > 0 ? 1 : -1;
  // Work along the blade: t grows from the pommel toward the emitter.
  const emitterT = Math.min(...valid.map((emitter) => emitter.z * direction));
  const pommelT = Math.min(hiltMinZ * direction, hiltMaxZ * direction);
  const wanted = pommelT + VR_SABER_POMMEL_SHOWN_METRES + VR_FIST_POMMEL_SIDE_METRES;
  const highest = emitterT - VR_FIST_EMITTER_SIDE_METRES - VR_SABER_EMITTER_CLEARANCE_METRES;
  const lowest = pommelT + VR_FIST_POMMEL_SIDE_METRES;
  const centreT = Math.max(lowest, Math.min(wanted, highest));
  return centreT * direction;
}

/** Odyssey node type flag for a lightsaber blade mesh (OdysseyModelNodeType.Saber). */
const ODYSSEY_SABER_NODE_FLAG = 0x0800;

function isSaberBlade(mesh: THREE.Object3D): boolean {
  const node = (mesh as { odysseyNode?: { nodeType?: unknown } }).odysseyNode
    ?? (mesh.userData?.odysseyModelNode as { nodeType?: unknown } | undefined);
  const type = node?.nodeType;
  return typeof type === 'number' && (type & ODYSSEY_SABER_NODE_FLAG) === ODYSSEY_SABER_NODE_FLAG;
}

/**
 * Measures a lightsaber model and returns its grip centre on the model's Z
 * axis (see {@link resolveVRSaberGripCentre}); null for anything without
 * saber blades, so blasters and melee weapons are untouched. Blade meshes are
 * read by their origin and axis only: their length is animated (0 while the
 * saber is off), the emitter is not.
 */
export function measureVRSaberGripCentre(model: THREE.Object3D): number | null {
  model.updateWorldMatrix(true, true);
  const toModel = model.matrixWorld.clone().invert();
  const local = new THREE.Matrix4();
  const vertex = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const blades: { z: number; axisZ: number }[] = [];
  let hiltMinZ = Infinity;
  let hiltMaxZ = -Infinity;
  model.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!(mesh as { isMesh?: boolean }).isMesh) return;
    local.multiplyMatrices(toModel, mesh.matrixWorld);
    if (isSaberBlade(mesh)) {
      // The node's own Z column; a blade scaled to nothing has none, and its
      // side of the hilt decides below.
      axis.setFromMatrixColumn(local, 2);
      const length = axis.length();
      blades.push({ z: local.elements[14], axisZ: length > 1e-6 ? axis.z / length : Number.NaN });
      return;
    }
    const positions = mesh.geometry?.getAttribute?.('position');
    if (!positions) return;
    for (let index = 0; index < positions.count; index++) {
      vertex.fromBufferAttribute(positions as THREE.BufferAttribute, index).applyMatrix4(local);
      hiltMinZ = Math.min(hiltMinZ, vertex.z);
      hiltMaxZ = Math.max(hiltMaxZ, vertex.z);
    }
  });
  const hiltMiddle = (hiltMinZ + hiltMaxZ) / 2;
  const emitters: VRSaberEmitter[] = [];
  for (const blade of blades) {
    if (Number.isFinite(blade.axisZ) && Math.abs(blade.axisZ) >= 0.5) {
      emitters.push({ z: blade.z, direction: blade.axisZ > 0 ? 1 : -1 });
    } else if (Number.isFinite(blade.axisZ) || !Number.isFinite(hiltMiddle) || blade.z === hiltMiddle) {
      continue;
    } else {
      emitters.push({ z: blade.z, direction: blade.z > hiltMiddle ? 1 : -1 });
    }
  }
  return resolveVRSaberGripCentre(hiltMinZ, hiltMaxZ, emitters);
}
