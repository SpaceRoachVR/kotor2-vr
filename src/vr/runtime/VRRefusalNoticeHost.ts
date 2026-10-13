import * as THREE from 'three';

/**
 * Says why something was refused (critic runs 4-5). The refusal sound
 * (retail gui_error) was the same for "out of range", "no target" and "can't
 * save now", and a player who cannot hear it got nothing. A short line of text
 * sits low in the view for a moment, styled like the PAUSED plate, head-locked
 * and below the horizon so it never covers what the player is aiming at.
 */

// Nearer than most walls a player stands at, scaled to keep the same size in
// view: drawn without depth test, at 0.9 m it showed "through" a wall closer
// than that (critic run 6).
const DISTANCE_METRES = 0.5;
const WIDTH_METRES = 0.19;
const HEIGHT_METRES = 0.031;
// 0.12 sat on the target's nameplate when looking at a fighter (critic run 17).
const DROP_METRES = 0.17;
const SHOW_MS = 1800;
const RENDER_ORDER = 1_000_002;
const MERGE_MS = 400;
/** A queued notice replaces the one on screen after this long. */
const PENDING_AFTER_MS = 1300;

export type VRNoticeTone = 'refusal' | 'info';

/** The player-facing reason for a refusal shape ('refused: ...', 'cancelled: ...'), or null to stay quiet. */
export function describeVRRefusal(shape: string): string | null {
  const s = String(shape || '').toLowerCase();
  if (!s.startsWith('refused') && !s.startsWith('cancelled')) return null;
  if (s.includes('force range')) return 'Out of Force range';
  // Say why (critic run 14: the medpac refusal said only "Can't do that").
  if (s.includes('full health')) return 'Already at full health';
  if (s.includes('not enough force points')) return 'Not enough Force points';
  if (s.includes('attack is queued before the power')) return 'An attack is queued first';
  if (s.includes('throw range')) return 'Out of throwing range';
  if (s.includes('no locked hostile') || s.includes('no target')) return 'No target';
  if (s.includes('quick save failed')) return 'Save failed';
  if (s.includes('quick save')) return "Can't save now";
  // A swing or stroke that does nothing shows no text (round 18: "Swing
  // expired" and "Target lost" broke immersion). It whooshes, or at most
  // plays the soft refused tick.
  if (s.includes('swing') || s.includes('stroke')) return null;
  if (s.includes('target gone')) return 'Target gone';
  if (s.includes('item unavailable')) return 'Item no longer in your pack';
  if (s.includes('item cast rejected')) return "Couldn't use that";
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
  private shownTone: VRNoticeTone = 'refusal';
  private shownAt = Number.NEGATIVE_INFINITY;
  /** The text of the notice on screen, before merging. */
  private shownParts: string[] = [];
  private readonly pending: { text: string; holdMs: number; tone: VRNoticeTone }[] = [];

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
    // No mipmaps: a 768x124 canvas is then uploaded as is, not resized to a
    // power of two (round 15 console warning).
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
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

  show(text: string, nowMs: number, holdMs: number = SHOW_MS, tone: VRNoticeTone = 'refusal'): void {
    // Two notices in the same instant ("Droid saved", "You saved") were drawn
    // over each other, and only the last could be read (critic run 18).
    // Within 400 ms they share the plate.
    const merging = this.object.visible && nowMs - this.shownAt < MERGE_MS;
    if (merging && this.shownParts.includes(text)) return;
    if (merging && this.shownParts.length >= 2) {
      // A third and fourth at once waited for nothing and were lost (critic
      // run 19: "Atton saved" never showed). They follow in turn.
      if (!this.pending.some((p) => p.text === text) && this.pending.length < 4) this.pending.push({ text, holdMs, tone });
      return;
    }
    if (merging) {
      this.shownParts = [...this.shownParts, text];
    } else {
      this.shownParts = [text];
    }
    this.shownAt = nowMs;
    const merged = this.shownParts.join(' · ');
    if (merged !== this.shownText || tone !== this.shownTone) {
      this.draw(merged, tone);
      this.shownText = merged;
      this.shownTone = tone;
    }
    this.hideAt = Math.max(this.hideAt, nowMs + holdMs);
    if (holdMs === SHOW_MS) this.hideAt = nowMs + SHOW_MS;
    this.object.visible = true;
  }

  update(nowMs: number): void {
    if (this.pending.length && (nowMs >= this.hideAt || nowMs - this.shownAt > PENDING_AFTER_MS)) {
      const next = this.pending.shift()!;
      this.object.visible = false;
      this.show(next.text, nowMs, next.holdMs, next.tone);
      return;
    }
    if (this.object.visible && nowMs >= this.hideAt) this.object.visible = false;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
    this.texture.dispose();
  }

  private draw(text: string, tone: VRNoticeTone = 'refusal'): void {
    const c = this.context;
    const w = this.canvas.width, h = this.canvas.height;
    c.clearRect(0, 0, w, h);
    // Refusals and warnings in the error colours; outcomes and hints in the
    // menus' teal (critic run 18: "saved" and the first-play hint read as errors).
    c.fillStyle = tone === 'info' ? 'rgba(8, 24, 28, 0.85)' : 'rgba(28, 10, 8, 0.82)';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = tone === 'info' ? '#5fd3c4' : '#ff8a62';
    c.lineWidth = 6;
    c.strokeRect(3, 3, w - 6, h - 6);
    c.fillStyle = '#fff1ea';
    c.font = 'bold 54px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // Two notices that don't fit side by side go on two lines rather than
    // being squeezed to 60% width (critic run 19).
    const parts = text.split(' · ');
    if (parts.length === 2 && c.measureText(text).width > w - 40) {
      c.font = 'bold 44px sans-serif';
      c.fillText(parts[0], w / 2, h * 0.3 + 2, w - 40);
      c.fillText(parts[1], w / 2, h * 0.72 + 2, w - 40);
    } else {
      c.fillText(text, w / 2, h / 2 + 2, w - 40);
    }
    this.texture.needsUpdate = true;
  }
}
