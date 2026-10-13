import * as THREE from 'three';
import { normalizeVRRoundAttackPips, type VRRoundAttackPips } from './VRRoundStrokeBudget';

const RING_SIZE_METRES = 0.05;
const RING_LOCAL_OFFSET = new THREE.Vector3(0, 0, -0.12);

/**
 * Diegetic round-timer indicator (ROADMAP 3.5): a small ring on the weapon
 * hilt itself rather than a HUD element, filling as the next roll-eligible
 * swing/shot becomes available. Presented as a child of the right-hand
 * controller anchor so it tracks the weapon with no extra per-frame
 * transform work.
 */
export class VRHiltTimerHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private lastDrawnReadiness = -1;
  private lastDrawnArmed = false;
  private lastDrawnPips = '';

  constructor(private readonly handAnchor: THREE.Object3D) {
    if (typeof document === 'undefined') throw new Error('VR hilt timer requires a browser document');
    this.canvas = document.createElement('canvas');
    this.canvas.width = 128;
    this.canvas.height = 128;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('VR hilt timer canvas context unavailable');
    this.context = context;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.object = new THREE.Mesh(
      new THREE.PlaneGeometry(RING_SIZE_METRES, RING_SIZE_METRES),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.object.name = 'Kotor2VR.HiltTimer';
    this.object.renderOrder = 1_000_004;
    this.object.position.copy(RING_LOCAL_OFFSET);
    this.object.visible = false;
    handAnchor.add(this.object);
  }

  /**
   * `readiness` is clamped to [0, 1]; hides the ring entirely at 1 (ready,
   * nothing to show). `armed` (ROADMAP 3.12) draws a full amber ring while a
   * buffered swing waits for the round to open. `pips` (T-B) are the attacks
   * the running round still holds: white for the weapon hand, violet for the
   * off hand's weapon.
   */
  present(readiness: number, armed = false, pips: VRRoundAttackPips | null = null): void {
    const clamped = Number.isFinite(readiness) ? Math.min(1, Math.max(0, readiness)) : 1;
    const attackPips = normalizeVRRoundAttackPips(pips);
    const pipsKey = `${attackPips.main}/${attackPips.off}`;
    if (clamped >= 1 && !armed && pipsKey === '0/0') {
      this.object.visible = false;
      return;
    }
    this.object.visible = true;
    if (armed === this.lastDrawnArmed && pipsKey === this.lastDrawnPips &&
      Math.abs(clamped - this.lastDrawnReadiness) < 0.02) return;
    this.lastDrawnReadiness = clamped;
    this.lastDrawnArmed = armed;
    this.lastDrawnPips = pipsKey;
    this.draw(clamped, armed, attackPips);
  }

  /** What the ring shows now, for probes. */
  get drawnState(): Readonly<{ visible: boolean; readiness: number; armed: boolean; pips: string }> {
    return { visible: this.object.visible, readiness: this.lastDrawnReadiness, armed: this.lastDrawnArmed, pips: this.lastDrawnPips };
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

  private draw(readiness: number, armed: boolean, pips: VRRoundAttackPips): void {
    const size = this.canvas.width;
    const center = size / 2;
    const radius = size * 0.4;
    this.context.clearRect(0, 0, size, size);

    this.context.strokeStyle = 'rgba(40, 40, 40, 0.65)';
    this.context.lineWidth = size * 0.12;
    this.context.beginPath();
    this.context.arc(center, center, radius, 0, Math.PI * 2);
    this.context.stroke();

    // An armed swing keeps the countdown visible, drawn in amber, with an
    // amber centre dot for "a swing is waiting". A full amber ring hid how
    // long the wait was (critic run 4).
    this.context.strokeStyle = armed ? '#ffb347' : readiness >= 1 ? '#5cffb1' : '#62e8ff';
    this.context.lineWidth = size * 0.12;
    this.context.beginPath();
    this.context.arc(center, center, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * readiness);
    this.context.stroke();
    if (armed) {
      this.context.fillStyle = '#ffb347';
      this.context.beginPath();
      this.context.arc(center, center, size * 0.14, 0, Math.PI * 2);
      this.context.fill();
    }
    // One dot per attack the round still holds, in a row under the centre:
    // a stroke spends the leftmost of its hand's colour.
    const dots = [
      ...Array.from({ length: pips.main }, () => '#f4f8ff'),
      ...Array.from({ length: pips.off }, () => '#c79bff'),
    ];
    const spacing = size * 0.17;
    const y = center + radius * 0.5;
    dots.forEach((colour, i) => {
      const x = center + (i - (dots.length - 1) / 2) * spacing;
      this.context.fillStyle = 'rgba(20, 20, 20, 0.85)';
      this.context.beginPath();
      this.context.arc(x, y, size * 0.075, 0, Math.PI * 2);
      this.context.fill();
      this.context.fillStyle = colour;
      this.context.beginPath();
      this.context.arc(x, y, size * 0.055, 0, Math.PI * 2);
      this.context.fill();
    });

    this.texture.needsUpdate = true;
  }
}
