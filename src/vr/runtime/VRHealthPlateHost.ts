import * as THREE from 'three';

/**
 * A health readout on the off-hand wrist (critic review, 2026-09-29).
 *
 * There was no way to see hit points in the headset: the flatscreen party
 * portraits are part of the 2D overlay. This is the smallest useful piece of
 * the locked "wrist holo device": a plate on the off-hand wrist, where a watch
 * sits, showing HP and, for a Force user, FP. It shows when the player turns that
 * wrist toward their face, like checking a watch, and stays up on its own
 * while HP is low.
 */

export interface VRPlayerVitals {
  readonly hitPoints: number;
  readonly maxHitPoints: number;
  readonly forcePoints: number;
  readonly maxForcePoints: number;
}

const PLATE_WIDTH_METRES = 0.09;
const PLATE_HEIGHT_METRES = 0.045;
/**
 * Where a watch sits: behind the grip (grip -Z points out of the fist) and on
 * top of it. Needs a headset pass to tune; the glance test below uses the
 * plate's real world orientation, so a wrong guess here only moves it.
 */
const PLATE_LOCAL_OFFSET = new THREE.Vector3(0, 0.02, 0.07);
/** Face turned toward the head more than this (cosine) to count as a glance. */
const GLANCE_COSINE = 0.55;
const GLANCE_MAX_DISTANCE_METRES = 0.8;
/** HP at or below this fraction keeps the plate up. */
export const VR_HEALTH_PLATE_LOW_FRACTION = 0.25;

/** Whether the plate shows, from where it faces and the player's HP. Pure. */
export function shouldShowVRHealthPlate(
  plateNormal: THREE.Vector3,
  plateToHead: THREE.Vector3,
  vitals: VRPlayerVitals | null,
): boolean {
  if (!vitals || !(vitals.maxHitPoints > 0)) return false;
  if (vitals.hitPoints / vitals.maxHitPoints <= VR_HEALTH_PLATE_LOW_FRACTION) return true;
  const distance = plateToHead.length();
  if (!(distance > 0) || distance > GLANCE_MAX_DISTANCE_METRES) return false;
  return plateNormal.dot(plateToHead) / distance >= GLANCE_COSINE;
}

export class VRHealthPlateHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private lastDrawnKey = '';
  private readonly normal = new THREE.Vector3();
  private readonly platePosition = new THREE.Vector3();
  private readonly toHead = new THREE.Vector3();
  private readonly worldQuaternion = new THREE.Quaternion();

  constructor(handAnchor: THREE.Object3D) {
    if (typeof document === 'undefined') throw new Error('VR health plate requires a browser document');
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 128;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('VR health plate canvas context unavailable');
    this.context = context;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.object = new THREE.Mesh(
      new THREE.PlaneGeometry(PLATE_WIDTH_METRES, PLATE_HEIGHT_METRES),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.object.name = 'Kotor2VR.HealthPlate';
    this.object.renderOrder = 1_000_004;
    this.object.position.copy(PLATE_LOCAL_OFFSET);
    // Lying along the forearm, face up out of the top of the wrist.
    this.object.rotation.set(-Math.PI / 2, 0, 0);
    this.object.visible = false;
    handAnchor.add(this.object);
  }

  present(vitals: VRPlayerVitals | null, headPosition: THREE.Vector3 | null): void {
    if (!vitals || !headPosition) {
      this.object.visible = false;
      return;
    }
    this.object.updateWorldMatrix(true, false);
    this.object.getWorldPosition(this.platePosition);
    this.object.getWorldQuaternion(this.worldQuaternion);
    this.normal.set(0, 0, 1).applyQuaternion(this.worldQuaternion);
    this.toHead.copy(headPosition).sub(this.platePosition);
    const visible = shouldShowVRHealthPlate(this.normal, this.toHead, vitals);
    this.object.visible = visible;
    if (!visible) return;
    const key = `${vitals.hitPoints}/${vitals.maxHitPoints}/${vitals.forcePoints}/${vitals.maxForcePoints}`;
    if (key === this.lastDrawnKey) return;
    this.lastDrawnKey = key;
    this.draw(vitals);
  }

  clear(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
    this.texture.dispose();
  }

  private draw(vitals: VRPlayerVitals): void {
    const { width, height } = this.canvas;
    const c = this.context;
    c.clearRect(0, 0, width, height);
    c.fillStyle = 'rgba(8, 18, 24, 0.78)';
    c.fillRect(0, 0, width, height);
    c.strokeStyle = 'rgba(120, 200, 230, 0.8)';
    c.lineWidth = 3;
    c.strokeRect(1.5, 1.5, width - 3, height - 3);

    const hasForce = vitals.maxForcePoints > 0;
    const hpFraction = Math.min(1, Math.max(0, vitals.hitPoints / vitals.maxHitPoints));
    const hpColour = hpFraction <= VR_HEALTH_PLATE_LOW_FRACTION ? '#ff5a4e' : hpFraction <= 0.5 ? '#ffc04d' : '#5cff8f';
    this.bar(hasForce ? 16 : 36, 'HP', hpFraction, hpColour, `${Math.max(0, Math.round(vitals.hitPoints))}/${Math.round(vitals.maxHitPoints)}`);
    if (hasForce) {
      const fpFraction = Math.min(1, Math.max(0, vitals.forcePoints / vitals.maxForcePoints));
      this.bar(70, 'FP', fpFraction, '#62b8ff', `${Math.max(0, Math.round(vitals.forcePoints))}/${Math.round(vitals.maxForcePoints)}`);
    }
    this.texture.needsUpdate = true;
  }

  private bar(y: number, label: string, fraction: number, colour: string, readout: string): void {
    const c = this.context;
    const x = 58;
    const barWidth = 186;
    const barHeight = 40;
    c.fillStyle = '#cfe9f2';
    c.font = 'bold 30px sans-serif';
    c.textBaseline = 'middle';
    c.fillText(label, 10, y + barHeight / 2);
    c.fillStyle = 'rgba(255, 255, 255, 0.15)';
    c.fillRect(x, y, barWidth, barHeight);
    c.fillStyle = colour;
    c.fillRect(x, y, barWidth * fraction, barHeight);
    c.fillStyle = '#081218';
    c.font = 'bold 26px sans-serif';
    c.fillText(readout, x + 8, y + barHeight / 2);
  }
}
