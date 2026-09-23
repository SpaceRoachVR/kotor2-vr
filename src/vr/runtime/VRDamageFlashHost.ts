import * as THREE from 'three';
import type { VRDamageSide } from './VRDamageFeedback';

/**
 * A red wash at the edge of the view on the side a hit came from
 * (ROADMAP 3.14). A sibling of `VRComfortVignetteHost`: the same head-locked
 * plane just in front of the eyes, but one per side so a hit from the left
 * reads on the left. Front, behind and unattributed hits light both edges.
 * Only opacity changes per frame.
 */

const FLASH_DISTANCE_METRES = 0.12;
const FLASH_SIZE_METRES = 0.5;
const FLASH_DURATION_MS = 380;
const PEAK_OPACITY = 0.45;
const CRITICAL_PEAK_OPACITY = 0.8;
const UNATTRIBUTED_PEAK_OPACITY = 0.3;

type Edge = 'left' | 'right';

interface EdgeState {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  peak: number;
  startedAtMs: number;
}

export type VRDamageFlashTextureFactory = (edge: Edge) => THREE.Texture | null;

export class VRDamageFlashHost {
  readonly object: THREE.Group;
  private readonly edges: Record<Edge, EdgeState>;

  constructor(camera: THREE.Object3D, createTexture: VRDamageFlashTextureFactory = createEdgeTexture) {
    if (!camera) throw new TypeError('VR damage flash requires a camera');
    this.object = new THREE.Group();
    this.object.name = 'Kotor2VR.DamageFlash';
    this.object.position.set(0, 0, -FLASH_DISTANCE_METRES);
    camera.add(this.object);
    this.edges = {
      left: this.createEdge('left', createTexture('left')),
      right: this.createEdge('right', createTexture('right')),
    };
  }

  flash(side: VRDamageSide, critical: boolean, nowMs: number): void {
    const peak = side === 'unknown'
      ? UNATTRIBUTED_PEAK_OPACITY
      : critical ? CRITICAL_PEAK_OPACITY : PEAK_OPACITY;
    const edges: Edge[] = side === 'left' ? ['left'] : side === 'right' ? ['right'] : ['left', 'right'];
    for (const edge of edges) {
      const state = this.edges[edge];
      state.peak = Math.max(peak, this.currentOpacity(state, nowMs));
      state.startedAtMs = nowMs;
    }
  }

  update(nowMs: number): void {
    for (const state of Object.values(this.edges)) {
      const opacity = this.currentOpacity(state, nowMs);
      state.mesh.material.opacity = opacity;
      state.mesh.visible = opacity > 0;
    }
  }

  clear(): void {
    for (const state of Object.values(this.edges)) {
      state.peak = 0;
      state.mesh.visible = false;
      state.mesh.material.opacity = 0;
    }
  }

  dispose(): void {
    for (const state of Object.values(this.edges)) {
      state.mesh.geometry.dispose();
      state.mesh.material.map?.dispose();
      state.mesh.material.dispose();
    }
    this.object.removeFromParent();
  }

  private currentOpacity(state: EdgeState, nowMs: number): number {
    if (state.peak <= 0) return 0;
    const elapsed = nowMs - state.startedAtMs;
    if (!Number.isFinite(elapsed) || elapsed >= FLASH_DURATION_MS) return 0;
    const t = Math.max(0, elapsed / FLASH_DURATION_MS);
    // Fast in, slower out: a hit lands, then drains away.
    return state.peak * (1 - t) * (1 - t);
  }

  private createEdge(edge: Edge, texture: THREE.Texture | null): EdgeState {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(FLASH_SIZE_METRES, FLASH_SIZE_METRES),
      new THREE.MeshBasicMaterial({
        color: texture ? 0xffffff : 0xb3000c,
        map: texture,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    mesh.name = `Kotor2VR.DamageFlash.${edge}`;
    // Just above the comfort vignette, so a hit still shows while moving.
    mesh.renderOrder = 1_000_005;
    mesh.visible = false;
    this.object.add(mesh);
    return { mesh, peak: 0, startedAtMs: 0 };
  }
}

/** Red at the outer edge fading to clear by the middle of the view. */
function createEdgeTexture(edge: Edge): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const gradient = edge === 'left'
    ? context.createLinearGradient(0, 0, 128, 0)
    : context.createLinearGradient(256, 0, 128, 0);
  gradient.addColorStop(0, 'rgba(190, 0, 12, 1)');
  gradient.addColorStop(0.55, 'rgba(160, 0, 10, 0.35)');
  gradient.addColorStop(1, 'rgba(120, 0, 8, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}
