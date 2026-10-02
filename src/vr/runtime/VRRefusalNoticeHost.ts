import * as THREE from 'three';

/**
 * Says why something was refused (critic runs 4-5). The refusal sound
 * (retail gui_error) was the same for "out of range", "no target" and "can't
 * save now", and a player who cannot hear it got nothing. A short line of text
 * sits low in the view for a moment, styled like the PAUSED plate, head-locked
 * and below the horizon so it never covers what the player is aiming at.
 */

const DISTANCE_METRES = 0.9;
const WIDTH_METRES = 0.34;
const HEIGHT_METRES = 0.055;
const DROP_METRES = 0.22;
const SHOW_MS = 1800;
const RENDER_ORDER = 1_000_002;

/** The player-facing reason for a refusal shape ('refused: ...', 'cancelled: ...'), or null to stay quiet. */
export function describeVRRefusal(shape: string): string | null {
  const s = String(shape || '').toLowerCase();
  if (!s.startsWith('refused') && !s.startsWith('cancelled')) return null;
  if (s.includes('force range')) return 'Out of Force range';
  if (s.includes('throw range')) return 'Out of throwing range';
  if (s.includes('no locked hostile') || s.includes('no target')) return 'No target';
  if (s.includes('quick save failed')) return 'Save failed';
  if (s.includes('quick save')) return "Can't save now";
  if (s.includes('swing target lost')) return 'Target lost';
  if (s.includes('rejected at release')) return 'Out of range';
  if (s.includes('cannot act')) return "Can't act now";
  if (s.includes('no longer in the inventory')) return 'Item no longer in your pack';
  if (s.startsWith('cancelled')) return 'Cancelled';
  return "Can't do that";
}

export class VRRefusalNoticeHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private hideAt = 0;
  private shownText = '';

  constructor(camera: THREE.Object3D) {
    if (!camera) throw new TypeError('VR refusal notice requires a camera');
    if (typeof document === 'undefined') throw new Error('VR refusal notice requires a browser document');
    this.canvas = document.createElement('canvas');
    this.canvas.width = 768;
    this.canvas.height = 124;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('VR refusal notice canvas context unavailable');
    this.context = context;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.object = new THREE.Mesh(
      new THREE.PlaneGeometry(WIDTH_METRES, HEIGHT_METRES),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.object.name = 'Kotor2VR.RefusalNotice';
    this.object.renderOrder = RENDER_ORDER;
    this.object.position.set(0, -DROP_METRES, -DISTANCE_METRES);
    this.object.visible = false;
    camera.add(this.object);
  }

  show(text: string, nowMs: number): void {
    if (text !== this.shownText) {
      this.draw(text);
      this.shownText = text;
    }
    this.hideAt = nowMs + SHOW_MS;
    this.object.visible = true;
  }

  update(nowMs: number): void {
    if (this.object.visible && nowMs >= this.hideAt) this.object.visible = false;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
    this.texture.dispose();
  }

  private draw(text: string): void {
    const c = this.context;
    const w = this.canvas.width, h = this.canvas.height;
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(28, 10, 8, 0.82)';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#ff8a62';
    c.lineWidth = 6;
    c.strokeRect(3, 3, w - 6, h - 6);
    c.fillStyle = '#fff1ea';
    c.font = 'bold 54px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2 + 2, w - 40);
    this.texture.needsUpdate = true;
  }
}
