import * as THREE from 'three';

/**
 * A short burst of sparks where blades meet or a bolt strikes a blade
 * (ROADMAP 3.13). Presentation only: it is spawned from an attack result the
 * engine has already rolled, never from a physics contact.
 *
 * Each burst is a handful of line segments radiating from one point that grow
 * and fade over a fifth of a second. Pooled, like the bolts and explosions, so
 * a long saber duel does not allocate geometry on the frame path.
 */

interface ActiveBurst {
  readonly lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  startedAtMs: number;
  active: boolean;
}

const MAX_CONCURRENT_BURSTS = 8;
const SPARKS_PER_BURST = 12;
const BURST_DURATION_MS = 220;
const START_SCALE_METRES = 0.03;
const END_SCALE_METRES = 0.22;
const SPARK_COLOUR = 0xfff1b8;

export class VRBladeSparkHost {
  readonly object: THREE.Group;
  private readonly pool: ActiveBurst[] = [];

  constructor(worldScene: THREE.Object3D, private readonly random: () => number = Math.random) {
    if (!worldScene) throw new TypeError('VR blade spark host requires a world scene');
    this.object = new THREE.Group();
    this.object.name = 'Kotor2VR.BladeSparks';
    this.object.frustumCulled = false;
    worldScene.add(this.object);
  }

  /** Bursts at `at`, `delayMs` from now (so a spark can wait for a bolt to arrive). */
  spark(at: THREE.Vector3, nowMs: number, delayMs = 0): void {
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y) || !Number.isFinite(at.z)) return;
    const burst = this.acquire();
    if (!burst) return;
    this.scatter(burst.lines.geometry);
    burst.lines.position.copy(at);
    burst.lines.scale.setScalar(START_SCALE_METRES);
    burst.lines.material.opacity = 1;
    burst.lines.visible = false;
    burst.startedAtMs = nowMs + Math.max(0, Number.isFinite(delayMs) ? delayMs : 0);
    burst.active = true;
  }

  update(nowMs: number): void {
    for (const burst of this.pool) {
      if (!burst.active) continue;
      const elapsed = nowMs - burst.startedAtMs;
      if (elapsed < 0) continue;
      if (!Number.isFinite(elapsed) || elapsed >= BURST_DURATION_MS) {
        burst.active = false;
        burst.lines.visible = false;
        continue;
      }
      const t = elapsed / BURST_DURATION_MS;
      const eased = 1 - (1 - t) * (1 - t);
      burst.lines.visible = true;
      burst.lines.scale.setScalar(START_SCALE_METRES + (END_SCALE_METRES - START_SCALE_METRES) * eased);
      burst.lines.material.opacity = 1 - t;
    }
  }

  clear(): void {
    for (const burst of this.pool) {
      burst.active = false;
      burst.lines.visible = false;
    }
  }

  dispose(): void {
    for (const burst of this.pool) {
      burst.lines.removeFromParent();
      burst.lines.geometry.dispose();
      burst.lines.material.dispose();
    }
    this.pool.length = 0;
    this.object.removeFromParent();
  }

  /** Unit-length streaks in random directions, each starting a little off centre. */
  private scatter(geometry: THREE.BufferGeometry): void {
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    const direction = new THREE.Vector3();
    for (let i = 0; i < SPARKS_PER_BURST; i++) {
      direction.set(this.random() * 2 - 1, this.random() * 2 - 1, this.random() * 2 - 1);
      if (direction.lengthSq() < 1e-4) direction.set(0, 0, 1);
      direction.normalize();
      const inner = 0.15 + this.random() * 0.25;
      const outer = 0.55 + this.random() * 0.45;
      positions.setXYZ(i * 2, direction.x * inner, direction.y * inner, direction.z * inner);
      positions.setXYZ(i * 2 + 1, direction.x * outer, direction.y * outer, direction.z * outer);
    }
    positions.needsUpdate = true;
  }

  private acquire(): ActiveBurst | null {
    for (const burst of this.pool) {
      if (!burst.active) return burst;
    }
    if (this.pool.length >= MAX_CONCURRENT_BURSTS) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS_PER_BURST * 2 * 3), 3));
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: SPARK_COLOUR,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    lines.name = 'Kotor2VR.BladeSpark';
    lines.frustumCulled = false;
    lines.visible = false;
    this.object.add(lines);
    const burst: ActiveBurst = { lines, startedAtMs: 0, active: false };
    this.pool.push(burst);
    return burst;
  }
}
