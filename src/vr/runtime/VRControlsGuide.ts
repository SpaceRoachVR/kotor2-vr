import * as THREE from 'three';
import type { XRHandRole } from './XRTypes';

/**
 * The VR controls guide (round 14: "there should be a VR controls guide
 * available from the comfort menu").
 *
 * Written from the quest-touch binding table in XRInputRouter and the gesture
 * routes, with the hands swapped for a left-handed player: the weapon hand is
 * the dominant one, the other hand moves and opens the wheel.
 */
export interface VRControlsGuideSection {
  readonly title: string;
  readonly lines: readonly (readonly [string, string])[];
}

export function describeVRControls(dominant: XRHandRole): readonly VRControlsGuideSection[] {
  const body: VRControlsGuideSection = {
    title: 'Your body',
    lines: [
      ['Swing a weapon', 'Attack the ringed enemy, on the round timer'],
      ['Both grips on a saber', 'Two-handed grip'],
      ['Medpac or stim to the neck', 'Use it (arm it from the wheel)'],
      ['Grip and flick', 'Force push / pull'],
      ['Turn your wrist', 'Check your health watch'],
    ],
  };
  // The Quest profile pins the wheel and party switch to the physical left
  // X and Y, whichever hand is dominant.
  if (dominant === 'right') {
    return [
      {
        title: 'Left hand',
        lines: [
          ['Stick', 'Move'],
          ['Stick click', 'Walk / run'],
          ['X', 'Action wheel (inventory, map, party, save, settings)'],
          ['Y', 'Switch party member'],
          ['Trigger', 'Throw an armed grenade'],
        ],
      },
      {
        title: 'Right hand',
        lines: [
          ['Trigger', 'Select, talk, shoot'],
          ['Stick', 'Turn (or scroll a menu list)'],
          ['Stick click, hold', 'Recenter'],
          ['A', 'Use what you point at'],
          ['B', 'Back / pause'],
        ],
      },
      body,
    ];
  }
  return [
    {
      title: 'Left hand (weapon)',
      lines: [
        ['Trigger', 'Select, talk, shoot'],
        ['Stick', 'Turn (or scroll a menu list)'],
        ['Stick click, hold', 'Recenter'],
        ['X', 'Action wheel; also Use'],
        ['Y', 'Switch party member; also Back / pause'],
      ],
    },
    {
      title: 'Right hand',
      lines: [
        ['Stick', 'Move'],
        ['Stick click', 'Walk / run'],
        ['Trigger', 'Throw an armed grenade'],
      ],
    },
    body,
  ];
}

const WIDTH_METRES = 0.75;
const PIXELS_PER_METRE = 1200;
const GAP_METRES = 0.05;

export class VRControlsGuideHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private drawnFor: XRHandRole | null = null;

  constructor(scene: THREE.Scene) {
    if (typeof document === 'undefined') throw new Error('VR controls guide requires a browser document');
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(WIDTH_METRES * PIXELS_PER_METRE);
    this.canvas.height = 1000;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('VR controls guide canvas context unavailable');
    this.context = context;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.object = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false }),
    );
    this.object.name = 'Kotor2VR.ControlsGuide';
    this.object.renderOrder = 1_000_004;
    this.object.visible = false;
    scene.add(this.object);
  }

  /** Shows the guide beside `panel` (the comfort settings), facing the same way. */
  present(panel: THREE.Object3D, dominant: XRHandRole): void {
    if (this.drawnFor !== dominant) {
      this.draw(describeVRControls(dominant));
      this.drawnFor = dominant;
    }
    const height = WIDTH_METRES * this.canvas.height / this.canvas.width;
    this.object.scale.set(WIDTH_METRES, height, 1);
    panel.updateWorldMatrix(true, false);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(panel.quaternion);
    this.object.quaternion.copy(panel.quaternion);
    this.object.position.copy(panel.position)
      .addScaledVector(right, panel.scale.x / 2 + GAP_METRES + WIDTH_METRES / 2);
    this.object.visible = true;
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

  private draw(sections: readonly VRControlsGuideSection[]): void {
    const c = this.context;
    const { width, height } = this.canvas;
    c.clearRect(0, 0, width, height);
    c.fillStyle = 'rgba(2, 12, 16, 0.94)';
    c.fillRect(0, 0, width, height);
    c.strokeStyle = '#62e8ff';
    c.lineWidth = 3;
    c.strokeRect(2, 2, width - 4, height - 4);
    c.textBaseline = 'middle';
    let y = 50;
    c.fillStyle = '#f4feff';
    c.font = 'bold 40px Arial';
    c.fillText('Controls', 30, y);
    y += 30;
    for (const section of sections) {
      y += 34;
      c.fillStyle = '#62e8ff';
      c.font = 'bold 30px Arial';
      c.fillText(section.title, 30, y);
      for (const [input, effect] of section.lines) {
        y += 40;
        c.fillStyle = '#d7f45b';
        c.font = 'bold 25px Arial';
        c.fillText(input, 40, y);
        c.fillStyle = '#f4feff';
        c.font = '25px Arial';
        c.fillText(effect, 320, y, width - 350);
      }
      y += 10;
    }
    this.texture.needsUpdate = true;
  }
}
