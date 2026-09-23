import * as THREE from 'three';

/**
 * Destruction burst for droids (headset R4).
 *
 * The player was told to destroy the training droids and, once they could
 * finally be killed, they simply stopped — no explosion. This is NOT the engine
 * dropping an authored effect: `Droid_SensorBall`'s appearance row carries
 * `deathfx: -1` and an empty `deathfxnode`, so the game data specifies no death
 * visual for it at all. The burst is therefore ours to author, and it is scoped
 * to droids so that people keep dying the way the game intends.
 *
 * Built from primitives rather than an MDL: there is no authored asset to load,
 * and a shader-free expanding shell plus a flash costs nothing on a mobile
 * headset GPU where this has to fit inside an already-tight frame budget.
 */

const MAX_CONCURRENT_EXPLOSIONS = 8;
// Long and large enough to register in peripheral vision. The first version
// (0.52 s, 1.45 m, a 110 ms flash) was easy to miss entirely mid-fight.
const EXPLOSION_DURATION_MS = 900;
const START_RADIUS_METRES = 0.2;
const END_RADIUS_METRES = 1.8;
const FLASH_DURATION_MS = 220;
const FLASH_RADIUS_METRES = 0.9;
const SHELL_COLOUR = 0xff7a2a;
const FLASH_COLOUR = 0xffe6b0;

interface ActiveExplosion {
  readonly shell: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  readonly flash: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  startedAtMs: number;
  active: boolean;
}

export class VRDroidExplosionHost {
  readonly object: THREE.Group;
  private readonly pool: ActiveExplosion[] = [];
  private readonly shellGeometry: THREE.SphereGeometry;
  private readonly flashGeometry: THREE.SphereGeometry;

  constructor(worldScene: THREE.Object3D) {
    if (!worldScene) throw new TypeError('VR droid explosion host requires a world scene');
    this.object = new THREE.Group();
    this.object.name = 'Kotor2VR.DroidExplosions';
    this.object.frustumCulled = false;
    worldScene.add(this.object);

    this.shellGeometry = new THREE.SphereGeometry(1, 16, 12);
    this.flashGeometry = new THREE.SphereGeometry(1, 12, 8);
  }

  /** Starts a burst centred on `at`. Silently ignored if the pool is full. */
  detonate(at: THREE.Vector3, nowMs: number): void {
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y) || !Number.isFinite(at.z)) return;
    const explosion = this.acquire();
    if (!explosion) return;

    explosion.startedAtMs = nowMs;
    explosion.active = true;
    explosion.shell.position.copy(at);
    explosion.flash.position.copy(at);
    explosion.shell.scale.setScalar(START_RADIUS_METRES);
    explosion.flash.scale.setScalar(FLASH_RADIUS_METRES);
    explosion.shell.material.opacity = 0.9;
    explosion.flash.material.opacity = 1;
    explosion.shell.visible = true;
    explosion.flash.visible = true;
  }

  update(nowMs: number): void {
    for (const explosion of this.pool) {
      if (!explosion.active) continue;
      const elapsed = nowMs - explosion.startedAtMs;
      if (!Number.isFinite(elapsed) || elapsed >= EXPLOSION_DURATION_MS) {
        this.retire(explosion);
        continue;
      }

      const t = Math.max(0, elapsed / EXPLOSION_DURATION_MS);
      // Ease-out: a blast decelerates as it dissipates. Linear growth reads as
      // an inflating balloon rather than a detonation.
      const eased = 1 - (1 - t) * (1 - t);
      explosion.shell.scale.setScalar(
        START_RADIUS_METRES + (END_RADIUS_METRES - START_RADIUS_METRES) * eased,
      );
      explosion.shell.material.opacity = 0.9 * (1 - t);

      const flashT = Math.min(1, Math.max(0, elapsed / FLASH_DURATION_MS));
      explosion.flash.material.opacity = 1 - flashT;
      explosion.flash.visible = flashT < 1;
    }
  }

  clear(): void {
    for (const explosion of this.pool) this.retire(explosion);
  }

  dispose(): void {
    for (const explosion of this.pool) {
      explosion.shell.removeFromParent();
      explosion.flash.removeFromParent();
      explosion.shell.material.dispose();
      explosion.flash.material.dispose();
    }
    this.pool.length = 0;
    this.shellGeometry.dispose();
    this.flashGeometry.dispose();
    this.object.removeFromParent();
  }

  private retire(explosion: ActiveExplosion): void {
    explosion.active = false;
    explosion.shell.visible = false;
    explosion.flash.visible = false;
  }

  private acquire(): ActiveExplosion | null {
    for (const explosion of this.pool) {
      if (!explosion.active) return explosion;
    }
    if (this.pool.length >= MAX_CONCURRENT_EXPLOSIONS) return null;

    const shell = new THREE.Mesh(
      this.shellGeometry,
      new THREE.MeshBasicMaterial({
        color: SHELL_COLOUR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    shell.name = 'Kotor2VR.DroidExplosionShell';

    const flash = new THREE.Mesh(
      this.flashGeometry,
      new THREE.MeshBasicMaterial({
        color: FLASH_COLOUR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    flash.name = 'Kotor2VR.DroidExplosionFlash';

    for (const mesh of [shell, flash]) {
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.object.add(mesh);
    }

    const explosion: ActiveExplosion = { shell, flash, startedAtMs: 0, active: false };
    this.pool.push(explosion);
    return explosion;
  }
}
