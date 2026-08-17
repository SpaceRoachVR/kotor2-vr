import * as THREE from 'three';
import { XRWorldPose } from './XRTypes';
import { VRRadialMenuItem } from './VRRadialMenuController';

/** In-world canvas presentation for the controller radial menu. */
export class VRRadialMenuHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;

  constructor(scene: THREE.Scene) {
    if (typeof document === 'undefined') throw new Error('radial menu requires a browser document');
    this.canvas = document.createElement('canvas'); this.canvas.width = 800; this.canvas.height = 800;
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.encoding = THREE.sRGBEncoding;
    this.object = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, side: THREE.DoubleSide, depthTest: false }));
    this.object.name = 'Kotor2VR.RadialMenu'; this.object.visible = false; this.object.renderOrder = 1_000_004; scene.add(this.object);
  }

  present(anchor: XRWorldPose, head: XRWorldPose, items: readonly VRRadialMenuItem[], selected: number): void {
    // The menu belongs to the off hand, but remains legible from the head.
    // This reproduces the familiar wrist/device radial interaction without
    // turning the menu into a head-locked overlay.
    const awayFromHead = anchor.position.clone().sub(head.position); awayFromHead.z = 0;
    if (awayFromHead.lengthSq() < 1e-8) {
      awayFromHead.set(0, 1, 0);
    } else {
      awayFromHead.normalize();
    }
    this.object.position.copy(anchor.position).addScaledVector(awayFromHead, 0.38);
    this.object.position.z = anchor.position.z + 0.12;
    const normal = awayFromHead.clone().negate();
    const right = new THREE.Vector3(0, 0, 1).cross(normal).normalize();
    this.object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 0, 1), normal));
    this.object.scale.set(0.38, 0.38, 1);
    this.draw(items, selected);
    this.object.visible = true;
  }
  clear(): void { this.object.visible = false; }
  dispose(): void { this.object.removeFromParent(); this.object.geometry.dispose(); this.object.material.dispose(); this.texture.dispose(); }
  private draw(items: readonly VRRadialMenuItem[], selected: number): void {
    const c = this.canvas.getContext('2d'); if (!c) throw new Error('radial menu canvas context unavailable');
    c.clearRect(0, 0, 800, 800);
    const positions = [[650,400],[400,150],[150,400],[400,650]];
    items.forEach((item,index) => {
      const [x,y] = positions[index];
      const start = -Math.PI / 4 + index * Math.PI / 2;
      const end = start + Math.PI / 2;
      c.fillStyle = index === selected ? 'rgba(154, 190, 39, .82)' : 'rgba(7, 34, 42, .92)';
      c.beginPath(); c.moveTo(400, 400); c.arc(400, 400, 360, start, end); c.closePath(); c.fill();
      c.strokeStyle = index === selected ? '#d7f45b' : '#66e9ff'; c.lineWidth = 5; c.stroke();
      c.fillStyle='#071317'; c.beginPath(); c.arc(x, y - 34, 30, 0, Math.PI * 2); c.fill();
      c.fillStyle = index === selected ? '#eaff84' : '#66e9ff'; c.font='bold 28px Arial'; c.textAlign='center'; c.textBaseline='middle';
      c.fillText(VRRadialMenuHost.iconGlyph(item.icon), x, y - 34);
      c.fillStyle='#fff'; c.font='bold 24px Arial'; c.fillText(item.label,x,y + 38, 190);
    });
    c.fillStyle='rgba(2,12,16,.96)'; c.beginPath(); c.arc(400,400,108,0,Math.PI*2); c.fill();
    c.strokeStyle='#66e9ff'; c.lineWidth=5; c.stroke(); c.fillStyle='#d9fbff'; c.font='bold 26px Arial'; c.fillText('CANCEL',400,400);
    this.texture.needsUpdate=true;
  }

  private static iconGlyph(icon: string | undefined): string {
    const normalized = icon?.toLowerCase() ?? '';
    if (normalized.includes('attack') || normalized.includes('bash')) return '⚔';
    if (normalized.includes('force')) return '✦';
    if (normalized.includes('mine') || normalized.includes('grenade')) return '◈';
    if (normalized.includes('security') || normalized.includes('unlock')) return '⌘';
    if (normalized.includes('blaster')) return '➤';
    return '•';
  }
}
