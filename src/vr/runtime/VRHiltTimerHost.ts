import * as THREE from 'three';
import { normalizeVRRoundAttackPips, type VRRoundAttackPips } from './VRRoundStrokeBudget';

const RING_SIZE_METRES = 0.05;
const RING_LOCAL_OFFSET = new THREE.Vector3(0, 0, -0.12);

/**
 * Diegetic round indicator (ROADMAP 3.5): a small ring on the weapon hilt
 * itself rather than a HUD element. Presented as a child of the right-hand
 * controller anchor so it tracks the weapon with no extra per-frame
 * transform work.
 *
 * Round 18 (player-paced rounds): it is a quiet "ready" glow, not a clock to
 * wait on. The player's stroke begins the round, so while the next round is
 * ready in a fight the ring glows softly; while a round runs it is gone,
 * apart from the T-B pips for attacks the round still holds.
 */
export class VRHiltTimerHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private lastDrawnReady: boolean | null = null;
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
   * `ready` draws the soft glow (the next round is ready, in a fight). `pips`
   * (T-B) are the attacks the running round still holds: white for the
   * weapon hand, violet for the off hand's weapon. Neither: hidden.
   */
  present(ready: boolean, pips: VRRoundAttackPips | null = null): void {
    const attackPips = normalizeVRRoundAttackPips(pips);
    const pipsKey = `${attackPips.main}/${attackPips.off}`;
    if (ready !== true && pipsKey === '0/0') {
      this.object.visible = false;
      return;
    }
    this.object.visible = true;
    if (ready === this.lastDrawnReady && pipsKey === this.lastDrawnPips) return;
    this.lastDrawnReady = ready === true;
    this.lastDrawnPips = pipsKey;
    this.draw(ready === true, attackPips);
  }

  /** What the ring shows now, for probes. */
  get drawnState(): Readonly<{ visible: boolean; ready: boolean; pips: string }> {
    const visible = this.object.visible;
    return { visible, ready: visible && this.lastDrawnReady === true, pips: visible ? this.lastDrawnPips : '0/0' };
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

  private draw(ready: boolean, pips: VRRoundAttackPips): void {
    const size = this.canvas.width;
    const center = size / 2;
    const radius = size * 0.4;
    this.context.clearRect(0, 0, size, size);

    if (ready) {
      // Quiet: a thin, soft-edged green ring at low strength, no countdown.
      this.context.save();
      this.context.shadowColor = 'rgba(92, 255, 177, 0.55)';
      this.context.shadowBlur = size * 0.12;
      this.context.strokeStyle = 'rgba(92, 255, 177, 0.42)';
      this.context.lineWidth = size * 0.07;
      this.context.beginPath();
      this.context.arc(center, center, radius, 0, Math.PI * 2);
      this.context.stroke();
      this.context.restore();
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
