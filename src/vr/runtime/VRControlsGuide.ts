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
      ['Off-hand grip on the hilt', 'Two-handed grip, any melee weapon'],
      ['Arm an item', 'Action wheel, Items page: a medpac, stim or grenade goes to your off hand'],
      ['Armed medpac or stim to the neck', 'Use it'],
      ['Turn your wrist', 'Check your health watch'],
    ],
  };
  // Round 15: the guide never said how to use a Force power.
  const weaponHand = dominant === 'right' ? 'right' : 'left';
  const otherHand = dominant === 'right' ? 'left' : 'right';
  const force: VRControlsGuideSection = {
    title: 'Force powers',
    lines: [
      ['Choose a power', 'Action wheel, Force page: it joins your queue'],
      ['Cast it', `Thrust your open ${otherHand} hand at the ringed target, or pull the ${weaponHand} trigger`],
      // TSL has Force Push but no Pull (critic run 13).
      ['Force Push, if known', `Hold the ${weaponHand} grip and flick forward`],
    ],
  };
  // The wheel and party switch sit on the off hand's face buttons, so a
  // left-hander has them on A and B and keeps X and Y for Use and Back.
  if (dominant === 'right') {
    return [
      {
        title: 'Left hand',
        lines: [
          ['Stick', 'Move'],
          ['Stick click', 'Walk / run'],
          ['X, hold', 'Action wheel: point at a choice with either hand and pull its trigger; let go to close (attacks, Force powers, items, menu, VR Menu; Quick Save out of combat, Clear Actions in it)'],
          ['Y', 'Switch party member'],
          ['Trigger', 'Throw an armed grenade'],
        ],
      },
      {
        title: 'Right hand',
        lines: [
          ['Trigger', 'Select; use what you point at; talk; shoot'],
          ['Stick', 'Turn (or scroll a menu list)'],
          ['Stick click, hold', 'Recenter'],
          ['B, tap', 'Back / pause'],
          ['B, hold', 'Stop attacking'],
        ],
      },
      body,
      force,
    ];
  }
  return [
    {
      title: 'Left hand (weapon)',
      lines: [
        ['Trigger', 'Select; use what you point at; talk; shoot'],
        ['Stick', 'Turn (or scroll a menu list)'],
        ['Stick click, hold', 'Recenter'],
        ['Y, tap', 'Back / pause'],
        ['Y, hold', 'Stop attacking'],
      ],
    },
    {
      title: 'Right hand',
      lines: [
        ['Stick', 'Move'],
        ['Stick click', 'Walk / run'],
        ['A, hold', 'Action wheel: point at a choice with either hand and pull its trigger; let go to close (attacks, Force powers, items, menu, VR Menu; Quick Save out of combat, Clear Actions in it)'],
        ['B', 'Switch party member'],
        ['Trigger', 'Throw an armed grenade'],
      ],
    },
    body,
    force,
  ];
}

const WIDTH_METRES = 0.9;
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
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
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

  /**
   * Lays the guide out before drawing: the effect column starts after the
   * widest input, and a long effect wraps instead of being squeezed. A long
   * input ("Medpac or stim to the neck") ran into its effect (round 15).
   */
  private draw(sections: readonly VRControlsGuideSection[]): void {
    const c = this.context;
    const width = this.canvas.width;
    // As large as the VR Menu's rows beside it: the guide was half their size
    // (critic run 11).
    const inputFont = 'bold 32px Arial';
    const effectFont = '32px Arial';
    c.font = inputFont;
    const inputWidth = Math.max(...sections.flatMap((section) => section.lines.map(([input]) => c.measureText(input).width)));
    const effectX = Math.min(40 + inputWidth + 24, width * 0.5);
    const effectWidth = width - effectX - 30;
    c.font = effectFont;
    const wrap = (text: string, maxWidth: number, font: string): string[] => {
      c.font = font;
      const out: string[] = [];
      let line = '';
      for (const word of text.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (line && c.measureText(next).width > maxWidth) { out.push(line); line = word; } else { line = next; }
      }
      if (line) out.push(line);
      return out;
    };
    type Row = { input: string[]; effect: string[] };
    const laid = sections.map((section) => ({
      title: section.title,
      rows: section.lines.map(([input, effect]): Row => ({
        input: wrap(input, effectX - 40 - 16, inputFont),
        effect: wrap(effect, effectWidth, effectFont),
      })),
    }));
    const lineHeight = 39;
    let height = 80;
    for (const section of laid) {
      height += 44;
      for (const row of section.rows) height += 9 + lineHeight * Math.max(row.input.length, row.effect.length);
      height += 10;
    }
    height += 24;
    if (this.canvas.height !== height) {
      this.canvas.height = height;
      // WebGL2 textures are allocated at a fixed size: reallocate.
      this.texture.dispose();
    }

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
    for (const section of laid) {
      y += 44;
      c.fillStyle = '#62e8ff';
      c.font = 'bold 30px Arial';
      c.fillText(section.title, 30, y - 10);
      for (const row of section.rows) {
        y += 9;
        const lines = Math.max(row.input.length, row.effect.length);
        for (let i = 0; i < lines; i++) {
          const lineY = y + lineHeight * (i + 0.5);
          if (row.input[i]) { c.fillStyle = '#d7f45b'; c.font = inputFont; c.fillText(row.input[i], 40, lineY); }
          if (row.effect[i]) { c.fillStyle = '#f4feff'; c.font = effectFont; c.fillText(row.effect[i], effectX, lineY); }
        }
        y += lineHeight * lines;
      }
      y += 10;
    }
    this.texture.needsUpdate = true;
  }
}
