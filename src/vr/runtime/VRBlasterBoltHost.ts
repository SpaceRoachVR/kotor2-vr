import * as THREE from 'three';

/**
 * Visible blaster bolts (headset R4).
 *
 * Nothing in this engine has ever drawn a projectile for a ranged attack — the
 * only `EventBroadcastSafeProjectile` construction is save rehydration. On a
 * flat screen the attack animation carries the shot; in first person the
 * player's own body is hidden, so without a bolt a blaster fires with no visual
 * at all. Reported from a headset session for T3-M4's mining laser, and it
 * applies to every ranged attack in the game, the player's and NPCs' alike.
 *
 * A short travelling streak rather than a static beam: a beam reads as a laser
 * sight (which this game already has, on the ray anchor) and gives no sense of
 * a discrete shot. Travel time is what makes a volley legible as individual
 * rounds.
 *
 * Bolts are pooled. A firefight can put several in the air at once and
 * allocating geometry per shot on the frame path is exactly the kind of churn
 * the rest of this runtime avoids.
 */

export interface VRBlasterBoltRequest {
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  /** Engine `AttackResult`; only used to colour the bolt. */
  readonly attackResult: number;
}

interface ActiveBolt {
  readonly mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  startedAtMs: number;
  active: boolean;
}

const MAX_CONCURRENT_BOLTS = 24;
const BOLT_TRAVEL_MS = 160;
const BOLT_LENGTH_METRES = 0.55;
const BOLT_RADIUS_METRES = 0.035;
/** Red for hostile fire is the series convention; deflected bolts read green. */
const BOLT_COLOUR = 0xff3b1f;
const DEFLECTED_BOLT_COLOUR = 0x54ff8a;
const DEFLECTED = 9;

export class VRBlasterBoltHost {
  readonly object: THREE.Group;
  private readonly pool: ActiveBolt[] = [];
  private readonly geometry: THREE.CylinderGeometry;

  constructor(worldScene: THREE.Object3D) {
    if (!worldScene) throw new TypeError('VR blaster bolt host requires a world scene');
    this.object = new THREE.Group();
    this.object.name = 'Kotor2VR.BlasterBolts';
    // Bolts are light sources in spirit; never let one be culled out because
    // its pooled origin sits somewhere else.
    this.object.frustumCulled = false;
    worldScene.add(this.object);

    // Authored along +Y then rotated onto the path, so one shared geometry
    // serves every bolt regardless of direction.
    this.geometry = new THREE.CylinderGeometry(
      BOLT_RADIUS_METRES,
      BOLT_RADIUS_METRES,
      BOLT_LENGTH_METRES,
      6,
      1,
      true,
    );
  }

  /** Adds a bolt travelling `from` → `to`. Silently ignored if the pool is full. */
  fire(request: VRBlasterBoltRequest, nowMs: number): void {
    const { from, to } = request;
    if (!isFiniteVector(from) || !isFiniteVector(to)) return;
    if (from.distanceToSquared(to) < 1e-6) return;

    const bolt = this.acquire();
    if (!bolt) return;

    bolt.from.copy(from);
    bolt.to.copy(to);
    bolt.startedAtMs = nowMs;
    bolt.active = true;
    bolt.mesh.material.color.setHex(
      request.attackResult === DEFLECTED ? DEFLECTED_BOLT_COLOUR : BOLT_COLOUR,
    );
    bolt.mesh.material.opacity = 1;

    // Orient once at spawn: the path does not change while the bolt travels.
    const direction = to.clone().sub(from).normalize();
    bolt.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    bolt.mesh.position.copy(from);
    bolt.mesh.visible = true;
  }

  /** Advances every live bolt and retires the ones that have landed. */
  update(nowMs: number): void {
    for (const bolt of this.pool) {
      if (!bolt.active) continue;
      const elapsed = nowMs - bolt.startedAtMs;
      if (!Number.isFinite(elapsed) || elapsed >= BOLT_TRAVEL_MS) {
        bolt.active = false;
        bolt.mesh.visible = false;
        continue;
      }
      const t = Math.max(0, elapsed / BOLT_TRAVEL_MS);
      bolt.mesh.position.lerpVectors(bolt.from, bolt.to, t);
      // Fade only at the very end, so the streak stays solid in flight and
      // does not read as a fading smear for its whole life.
      bolt.mesh.material.opacity = t > 0.75 ? Math.max(0, (1 - t) / 0.25) : 1;
    }
  }

  clear(): void {
    for (const bolt of this.pool) {
      bolt.active = false;
      bolt.mesh.visible = false;
    }
  }

  dispose(): void {
    for (const bolt of this.pool) {
      bolt.mesh.removeFromParent();
      bolt.mesh.material.dispose();
    }
    this.pool.length = 0;
    this.geometry.dispose();
    this.object.removeFromParent();
  }

  private acquire(): ActiveBolt | null {
    for (const bolt of this.pool) {
      if (!bolt.active) return bolt;
    }
    if (this.pool.length >= MAX_CONCURRENT_BOLTS) return null;

    const mesh = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({
        color: BOLT_COLOUR,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    mesh.name = 'Kotor2VR.BlasterBolt';
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.object.add(mesh);

    const bolt: ActiveBolt = {
      mesh,
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      startedAtMs: 0,
      active: false,
    };
    this.pool.push(bolt);
    return bolt;
  }
}

function isFiniteVector(vector: THREE.Vector3 | null | undefined): vector is THREE.Vector3 {
  return !!vector &&
    Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}
