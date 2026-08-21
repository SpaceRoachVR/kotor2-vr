import * as THREE from 'three';
import { XRHandRole, XRWorldPose } from './XRTypes';
import { VRPanelPointerHost } from './VRPanelPointerHost';
import { VRWorldPromptEntry } from './VRWorldActionPromptModel';
import { VRWorldPromptPresentation } from './VRWorldActionPromptController';

export type { VRWorldPromptPresentation } from './VRWorldActionPromptController';

interface PromptRegion {
  readonly id: string;
  readonly startX: number;
  readonly endX: number;
  readonly entry: VRWorldPromptEntry;
}

const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 256;
const PANEL_WIDTH_METRES = 0.8;
const PANEL_HEIGHT_METRES = 0.2;
const NAVIGATION_WIDTH_PIXELS = 64;
const ACTION_SLOT_COUNT = 4;
const NAME_LABEL_OFFSET_METRES = 0.32;
const PROMPT_BELOW_NAME_METRES = 0.12;
const RENDER_ORDER = 1_000_000;

/** Canvas-backed, head-facing world prompt with independent rays for both hands. */
export class VRWorldActionPromptHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly pointers: Readonly<Record<XRHandRole, VRPanelPointerHost>>;
  private regions: readonly PromptRegion[] = [];
  private renderKey: string | null = null;
  private currentHoveredId: string | null = null;
  private disposed = false;

  constructor(scene: THREE.Scene) {
    if (!scene || typeof scene.add !== 'function') {
      throw new TypeError('world prompt scene is required');
    }
    if (typeof document === 'undefined') {
      throw new Error('world prompt host requires a browser document');
    }

    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('unable to create the world prompt 2D canvas context');
    this.context = context;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.encoding = THREE.sRGBEncoding;
    this.texture.name = 'Kotor2VR.world-action-prompt';
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.object = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_WIDTH_METRES, PANEL_HEIGHT_METRES),
      material,
    );
    this.object.name = 'Kotor2VR.WorldActionPrompt';
    this.object.visible = false;
    this.object.frustumCulled = false;
    this.object.renderOrder = RENDER_ORDER;
    scene.add(this.object);

    this.pointers = {
      left: new VRPanelPointerHost(scene),
      right: new VRPanelPointerHost(scene),
    };
    this.pointers.left.rayObject.name += '.left';
    this.pointers.left.cursorObject.name += '.left';
    this.pointers.right.rayObject.name += '.right';
    this.pointers.right.cursorObject.name += '.right';
  }

  get hoveredId(): string | null {
    return this.currentHoveredId;
  }

  present(
    presentation: VRWorldPromptPresentation,
    headPose: XRWorldPose,
    hoveredId: string | null,
  ): void {
    if (this.disposed) throw new Error('world prompt host is disposed');
    if (!isValidPresentation(presentation) || !isFinitePose(headPose)) {
      this.clear();
      return;
    }

    const acceptedHover = presentation.page.entries.some((entry) => entry.id === hoveredId)
      ? hoveredId
      : null;
    const renderKey = createRenderKey(presentation, acceptedHover);
    if (renderKey !== this.renderKey) {
      this.regions = createRegions(presentation.page.entries);
      this.draw(presentation.page.entries, acceptedHover);
      this.renderKey = renderKey;
    }
    this.currentHoveredId = acceptedHover;

    this.object.position.copy(presentation.model.anchor);
    this.object.position.z += NAME_LABEL_OFFSET_METRES - PROMPT_BELOW_NAME_METRES;
    this.object.lookAt(headPose.position);
    this.object.visible = true;
    this.object.updateWorldMatrix(true, false);
  }

  resolveRay(hand: XRHandRole, pose: XRWorldPose): string | null {
    if (this.disposed || !this.object.visible || !isHand(hand) || !isFinitePose(pose)) {
      if (isHand(hand)) this.pointers[hand].clear();
      return null;
    }
    try {
      const hit = this.pointers[hand].update(this.object, pose, CANVAS_WIDTH, CANVAS_HEIGHT);
      if (!hit) return null;
      const canvasX = hit.guiPosition.x + CANVAS_WIDTH / 2;
      const canvasY = CANVAS_HEIGHT / 2 - hit.guiPosition.y;
      if (canvasY < 0 || canvasY > CANVAS_HEIGHT) return null;
      return this.regions.find((region) =>
        canvasX >= region.startX && canvasX < region.endX)?.id ?? null;
    } catch {
      this.pointers[hand].clear();
      return null;
    }
  }

  clear(): void {
    if (this.disposed) return;
    this.object.visible = false;
    this.renderKey = null;
    this.currentHoveredId = null;
    this.regions = [];
    this.pointers.left.clear();
    this.pointers.right.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
    this.texture.dispose();
    this.pointers.left.dispose();
    this.pointers.right.dispose();
  }

  private draw(entries: readonly VRWorldPromptEntry[], hoveredId: string | null): void {
    const { context } = this;
    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    context.fillStyle = 'rgba(5, 16, 21, 0.94)';
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    for (const region of this.regions) {
      const hovered = region.id === hoveredId;
      const inset = region.entry.kind === 'action' ? 5 : 3;
      context.fillStyle = hovered ? 'rgba(154, 104, 25, 0.98)' : 'rgba(19, 37, 44, 0.96)';
      context.fillRect(
        region.startX + inset,
        8,
        Math.max(0, region.endX - region.startX - inset * 2),
        CANVAS_HEIGHT - 16,
      );
      context.strokeStyle = hovered ? '#ffd15c' : '#3d9fb5';
      context.lineWidth = hovered ? 5 : 3;
      context.strokeRect(
        region.startX + inset,
        8,
        Math.max(0, region.endX - region.startX - inset * 2),
        CANVAS_HEIGHT - 16,
      );
      if (region.entry.kind === 'action') {
        drawAction(context, region);
      } else {
        drawNavigation(context, region);
      }
    }
    this.texture.needsUpdate = true;
  }
}

function createRegions(entries: readonly VRWorldPromptEntry[]): readonly PromptRegion[] {
  const previous = entries.find((entry) => entry.kind === 'previous-page');
  const next = entries.find((entry) => entry.kind === 'next-page');
  const actions = entries.filter((entry) => entry.kind === 'action').slice(0, ACTION_SLOT_COUNT);
  const actionStart = NAVIGATION_WIDTH_PIXELS;
  const actionEnd = CANVAS_WIDTH - NAVIGATION_WIDTH_PIXELS;
  const actionWidth = (actionEnd - actionStart) / ACTION_SLOT_COUNT;
  const regions: PromptRegion[] = [];

  if (previous) {
    regions.push({ id: previous.id, startX: 0, endX: NAVIGATION_WIDTH_PIXELS, entry: previous });
  }
  actions.forEach((entry, index) => {
    regions.push({
      id: entry.id,
      startX: actionStart + actionWidth * index,
      endX: actionStart + actionWidth * (index + 1),
      entry,
    });
  });
  if (next) {
    regions.push({
      id: next.id,
      startX: CANVAS_WIDTH - NAVIGATION_WIDTH_PIXELS,
      endX: CANVAS_WIDTH,
      entry: next,
    });
  }
  return regions;
}

function drawAction(context: CanvasRenderingContext2D, region: PromptRegion): void {
  const centerX = (region.startX + region.endX) / 2;
  const availableWidth = Math.max(20, region.endX - region.startX - 24);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  context.font = '700 42px Arial, sans-serif';
  const iconText = region.entry.kind === 'action'
    ? compactIconLabel(region.entry.icon ?? region.entry.label)
    : '';
  context.fillText(iconText, centerX, 84, availableWidth);
  context.font = '600 27px Arial, sans-serif';
  context.fillText(ellipsize(region.entry.label, 20), centerX, 174, availableWidth);
}

function drawNavigation(context: CanvasRenderingContext2D, region: PromptRegion): void {
  const centerX = (region.startX + region.endX) / 2;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  context.font = '700 54px Arial, sans-serif';
  context.fillText(region.entry.kind === 'previous-page' ? '‹' : '›', centerX, 112, 48);
  context.font = '600 17px Arial, sans-serif';
  context.fillText(region.entry.kind === 'previous-page' ? 'PREV' : 'NEXT', centerX, 190, 58);
}

function compactIconLabel(value: string): string {
  const words = value.trim().split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (words.length === 0) return '•';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function ellipsize(value: string, maximumCharacters: number): string {
  const normalized = value.trim();
  if (normalized.length <= maximumCharacters) return normalized;
  return `${normalized.slice(0, maximumCharacters - 1)}…`;
}

function createRenderKey(presentation: VRWorldPromptPresentation, hoveredId: string | null): string {
  return [
    presentation.model.id,
    presentation.pageIndex,
    hoveredId ?? '',
    ...presentation.page.entries.map((entry) =>
      `${entry.kind}:${entry.id}:${entry.label}:${entry.kind === 'action' ? entry.icon ?? '' : ''}`),
  ].join('|');
}

function isValidPresentation(presentation: VRWorldPromptPresentation): boolean {
  return Boolean(presentation) &&
    Boolean(presentation.model) &&
    typeof presentation.model.id === 'string' &&
    presentation.model.id.trim().length > 0 &&
    presentation.model.anchor instanceof THREE.Vector3 &&
    isFiniteVector3(presentation.model.anchor) &&
    Number.isInteger(presentation.pageIndex) &&
    presentation.pageIndex >= 0 &&
    Boolean(presentation.page) &&
    presentation.model.pages[presentation.pageIndex] === presentation.page &&
    Array.isArray(presentation.page.entries) &&
    presentation.page.entries.length > 0;
}

function isFinitePose(pose: XRWorldPose): boolean {
  return Boolean(pose) &&
    pose.position instanceof THREE.Vector3 &&
    isFiniteVector3(pose.position) &&
    pose.orientation instanceof THREE.Quaternion &&
    Number.isFinite(pose.orientation.x) &&
    Number.isFinite(pose.orientation.y) &&
    Number.isFinite(pose.orientation.z) &&
    Number.isFinite(pose.orientation.w) &&
    pose.orientation.lengthSq() > 1e-10;
}

function isFiniteVector3(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function isHand(hand: string): hand is XRHandRole {
  return hand === 'left' || hand === 'right';
}
