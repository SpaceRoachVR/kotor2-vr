import * as THREE from 'three';

/**
 * A health watch on the off-hand wrist (critic review 2026-09-29; made a
 * watch after round 14: "works perfectly, but it would look better as a
 * watch").
 *
 * There was no way to see hit points in the headset: the flatscreen party
 * portraits are part of the 2D overlay. This is the smallest useful piece of
 * the locked "wrist holo device": a band round the off-hand wrist with a
 * round face. HP runs round the bezel and, for a Force user, FP on an inner
 * ring, with the HP number in the middle. The face sits dim until the player
 * turns the wrist toward their face, like checking a watch, and stays lit on
 * its own while HP is low.
 */

export interface VRPlayerVitals {
  readonly hitPoints: number;
  readonly maxHitPoints: number;
  readonly forcePoints: number;
  readonly maxForcePoints: number;
}

const FACE_DIAMETER_METRES = 0.05;
/**
 * Where a watch sits: behind the grip (grip -Z points out of the fist) and on
 * top of it. The glance test uses the face's real world orientation, so a
 * wrong guess here only moves it.
 */
const WATCH_LOCAL_OFFSET = new THREE.Vector3(0, 0, 0.075);
const BAND_RADIUS_METRES = 0.032;
const FACE_LIFT_METRES = BAND_RADIUS_METRES + 0.004;
/** Face turned toward the head more than this (cosine) to count as a glance. */
const GLANCE_COSINE = 0.55;
const GLANCE_MAX_DISTANCE_METRES = 0.8;
/** HP at or below this fraction keeps the face lit. */
export const VR_HEALTH_PLATE_LOW_FRACTION = 0.25;
const DIM_OPACITY = 0.35;

/** Whether the face is lit, from where it faces and the player's HP. Pure. */
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
  /** The whole watch, a child of the off-hand anchor. */
  readonly object: THREE.Group;
  private readonly face: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly band: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private lastDrawnKey = '';
  private readonly normal = new THREE.Vector3();
  private readonly facePosition = new THREE.Vector3();
  private readonly toHead = new THREE.Vector3();
  private readonly worldQuaternion = new THREE.Quaternion();

  constructor(handAnchor: THREE.Object3D) {
    if (typeof document === 'undefined') throw new Error('VR health watch requires a browser document');
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 256;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('VR health watch canvas context unavailable');
    this.context = context;
    this.texture = new THREE.CanvasTexture(this.canvas);

    this.object = new THREE.Group();
    this.object.name = 'Kotor2VR.HealthWatch';
    this.object.position.copy(WATCH_LOCAL_OFFSET);
    this.object.visible = false;

    // The band circles the forearm, which runs along the grip's Z axis; a
    // torus lies in its XY plane, so it already wraps that axis.
    this.band = new THREE.Mesh(
      new THREE.TorusGeometry(BAND_RADIUS_METRES, 0.0045, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x1b2a30 }),
    );
    this.band.name = 'Kotor2VR.HealthWatchBand';
    this.object.add(this.band);

    this.face = new THREE.Mesh(
      new THREE.CircleGeometry(FACE_DIAMETER_METRES / 2, 40),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.face.name = 'Kotor2VR.HealthWatchFace';
    this.face.position.set(0, FACE_LIFT_METRES, 0);
    // Face up out of the top of the wrist.
    this.face.rotation.set(-Math.PI / 2, 0, 0);
    this.face.renderOrder = 1_000_004;
    this.object.add(this.face);
    handAnchor.add(this.object);
  }

  present(vitals: VRPlayerVitals | null, headPosition: THREE.Vector3 | null): void {
    if (!vitals || !headPosition || !(vitals.maxHitPoints > 0)) {
      this.object.visible = false;
      return;
    }
    this.object.visible = true;
    this.face.updateWorldMatrix(true, false);
    this.face.getWorldPosition(this.facePosition);
    this.face.getWorldQuaternion(this.worldQuaternion);
    this.normal.set(0, 0, 1).applyQuaternion(this.worldQuaternion);
    this.toHead.copy(headPosition).sub(this.facePosition);
    const lit = shouldShowVRHealthPlate(this.normal, this.toHead, vitals);
    this.face.material.opacity = lit ? 1 : DIM_OPACITY;
    const key = `${vitals.hitPoints}/${vitals.maxHitPoints}/${vitals.forcePoints}/${vitals.maxForcePoints}`;
    if (key === this.lastDrawnKey) return;
    this.lastDrawnKey = key;
    this.draw(vitals);
  }

  /** Whether the face is lit (being looked at, or HP is low). */
  get isLit(): boolean {
    return this.object.visible && this.face.material.opacity === 1;
  }

  clear(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.band.geometry.dispose();
    this.band.material.dispose();
    this.face.geometry.dispose();
    this.face.material.dispose();
    this.texture.dispose();
  }

  private draw(vitals: VRPlayerVitals): void {
    const c = this.context;
    const size = this.canvas.width;
    const centre = size / 2;
    c.clearRect(0, 0, size, size);

    c.fillStyle = '#081218';
    c.beginPath(); c.arc(centre, centre, centre - 2, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#7f9aa3';
    c.lineWidth = 6;
    c.beginPath(); c.arc(centre, centre, centre - 5, 0, Math.PI * 2); c.stroke();

    const hpFraction = Math.min(1, Math.max(0, vitals.hitPoints / vitals.maxHitPoints));
    const hpColour = hpFraction <= VR_HEALTH_PLATE_LOW_FRACTION ? '#ff5a4e' : hpFraction <= 0.5 ? '#ffc04d' : '#5cff8f';
    this.ring(centre - 22, 20, hpFraction, hpColour);
    if (vitals.maxForcePoints > 0) {
      const fpFraction = Math.min(1, Math.max(0, vitals.forcePoints / vitals.maxForcePoints));
      this.ring(centre - 46, 12, fpFraction, '#62b8ff');
    }

    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = hpColour;
    c.font = 'bold 72px sans-serif';
    c.fillText(String(Math.max(0, Math.round(vitals.hitPoints))), centre, centre - 6);
    c.fillStyle = '#cfe9f2';
    c.font = 'bold 26px sans-serif';
    c.fillText(`/ ${Math.round(vitals.maxHitPoints)} HP`, centre, centre + 44);
    this.texture.needsUpdate = true;
  }

  /** A ring filled clockwise from twelve o'clock. */
  private ring(radius: number, width: number, fraction: number, colour: string): void {
    const c = this.context;
    const centre = this.canvas.width / 2;
    c.lineWidth = width;
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    c.beginPath(); c.arc(centre, centre, radius, 0, Math.PI * 2); c.stroke();
    if (fraction <= 0) return;
    c.strokeStyle = colour;
    c.beginPath();
    c.arc(centre, centre, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fraction);
    c.stroke();
  }
}
