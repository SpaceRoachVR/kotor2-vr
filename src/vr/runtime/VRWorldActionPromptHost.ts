import * as THREE from 'three';
import { XRHandRole, XRWorldPose } from './XRTypes';
import { VRPanelPointerHost } from './VRPanelPointerHost';
import {
  VRWorldPromptEntry,
  resolveValidVRWorldPromptPage,
} from './VRWorldActionPromptModel';
import { VRWorldPromptPresentation } from './VRWorldActionPromptController';
import {
  DEFAULT_VR_ACTION_ICON_FALLBACK_FACTORY,
  DEFAULT_VR_ACTION_ICON_TEXTURE_LOADER,
  resolveVRActionIcon,
  VRActionIconTextureLoader,
  VROwnedActionIconTextureCache,
} from './VRActionIconTextureCache';

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
const HORIZONTAL_EPSILON = 1e-8;

/** Canvas-backed, head-facing world prompt with independent rays for both hands. */
export class VRWorldActionPromptHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly pointers: Readonly<Record<XRHandRole, VRPanelPointerHost>>;
  private readonly iconTextures: VROwnedActionIconTextureCache;
  private readonly iconMaterialById = new Map<string, THREE.MeshBasicMaterial>();
  /** Retains the last valid horizontal facing for a head directly above or below. */
  private readonly lastHorizontalNormal = new THREE.Vector3(0, -1, 0);
  private regions: readonly PromptRegion[] = [];
  private renderKey: string | null = null;
  private contentKey: string | null = null;
  private iconPresentationToken = 0;
  private currentHoveredId: string | null = null;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    iconLoader: VRActionIconTextureLoader = DEFAULT_VR_ACTION_ICON_TEXTURE_LOADER,
  ) {
    if (!scene || typeof scene.add !== 'function') {
      throw new TypeError('world prompt scene is required');
    }
    if (typeof document === 'undefined') {
      throw new Error('world prompt host requires a browser document');
    }
    if (!iconLoader || typeof iconLoader.load !== 'function') {
      throw new TypeError('world prompt icon loader must provide load(resref)');
    }

    this.iconTextures = new VROwnedActionIconTextureCache(
      iconLoader,
      DEFAULT_VR_ACTION_ICON_FALLBACK_FACTORY,
      { capacity: 64, ownerLabel: 'VRWorldActionPromptHost' },
    );

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

  getIconMaterial(entryId: string): THREE.MeshBasicMaterial {
    const material = this.iconMaterialById.get(entryId);
    if (!material) throw new RangeError(`world prompt icon is not presented: ${entryId}`);
    return material;
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
    const contentKey = createContentKey(presentation);
    if (contentKey !== this.contentKey) {
      this.regions = createRegions(presentation.page.entries);
      this.rebuildIcons(presentation.page.entries, contentKey);
      this.contentKey = contentKey;
    }
    const renderKey = createRenderKey(presentation, acceptedHover);
    if (renderKey !== this.renderKey) {
      this.draw(presentation.page.entries, acceptedHover);
      this.renderKey = renderKey;
    }
    this.currentHoveredId = acceptedHover;

    this.object.position.copy(presentation.model.anchor);
    this.object.position.z += NAME_LABEL_OFFSET_METRES - PROMPT_BELOW_NAME_METRES;
    this.faceHeadUpright(headPose);
    this.object.visible = true;
    this.object.updateWorldMatrix(true, false);
  }

  /**
   * Yaw-only billboard toward the head. `Object3D.lookAt` cannot be used here:
   * it derives its basis from `Object3D.up`, which defaults to Y-up, while this
   * engine is Z-up. That mismatch rolled the panel onto its side and made the
   * prompt text read vertically. Building the basis explicitly — and keeping
   * world up as the panel's local Y — guarantees the text stays level, and
   * matches the convention `VRRadialMenuHost.placeAtOpeningHeadPose` already
   * uses. Pitch is deliberately dropped so an object below eye level does not
   * tip its own label away from the reader.
   */
  private faceHeadUpright(headPose: XRWorldPose): void {
    const normal = headPose.position.clone().sub(this.object.position);
    normal.z = 0;
    if (normal.lengthSq() <= HORIZONTAL_EPSILON) {
      normal.copy(this.lastHorizontalNormal);
    } else {
      normal.normalize();
      this.lastHorizontalNormal.copy(normal);
    }

    const up = new THREE.Vector3(0, 0, 1);
    const right = up.clone().cross(normal).normalize();
    this.object.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, up, normal),
    );
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
      if (canvasX < 0 || canvasX > CANVAS_WIDTH || canvasY < 0 || canvasY > CANVAS_HEIGHT) return null;
      return this.regions.find((region) =>
        canvasX >= region.startX && (
          canvasX < region.endX ||
          (canvasX === CANVAS_WIDTH && region.endX === CANVAS_WIDTH)
        ))?.id ?? null;
    } catch {
      this.pointers[hand].clear();
      return null;
    }
  }

  clear(): void {
    if (this.disposed) return;
    this.object.visible = false;
    this.renderKey = null;
    this.contentKey = null;
    this.iconPresentationToken += 1;
    this.currentHoveredId = null;
    this.regions = [];
    this.disposeIconMeshes();
    this.iconTextures.setActiveDescriptors([]);
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
    this.iconTextures.dispose();
    this.pointers.left.dispose();
    this.pointers.right.dispose();
  }

  private rebuildIcons(entries: readonly VRWorldPromptEntry[], contentKey: string): void {
    this.iconPresentationToken += 1;
    const token = this.iconPresentationToken;
    this.disposeIconMeshes();
    const actionRegions = this.regions.filter((region) => region.entry.kind === 'action');
    const descriptors = actionRegions.map((region) => resolveIconForEntry(region.entry));
    this.iconTextures.setActiveDescriptors(descriptors);

    actionRegions.forEach((region, index) => {
      const descriptor = descriptors[index];
      const material = new THREE.MeshBasicMaterial({
        map: this.iconTextures.getFallback(descriptor),
        color: 0xffffff,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.066), material);
      icon.name = `Kotor2VR.WorldActionPrompt.Icon.${region.id}`;
      icon.position.set(canvasXToLocal((region.startX + region.endX) / 2), 0.025, 0.003);
      icon.renderOrder = RENDER_ORDER + 1;
      this.object.add(icon);
      this.iconMaterialById.set(region.id, material);

      if (!descriptor.resref) return;
      void this.iconTextures.load(descriptor).then((texture) => {
        if (this.disposed || token !== this.iconPresentationToken || contentKey !== this.contentKey) return;
        const currentMaterial = this.iconMaterialById.get(region.id);
        if (currentMaterial !== material) return;
        currentMaterial.map = texture;
        currentMaterial.needsUpdate = true;
      }).catch(() => {
        // Disposal may reject a late load; no visible prompt remains to update.
      });
    });
  }

  private disposeIconMeshes(): void {
    for (const [entryId, material] of this.iconMaterialById) {
      const icon = this.object.getObjectByName(`Kotor2VR.WorldActionPrompt.Icon.${entryId}`) as THREE.Mesh | undefined;
      if (icon) {
        icon.removeFromParent();
        icon.geometry.dispose();
      }
      material.dispose();
    }
    this.iconMaterialById.clear();
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
  context.font = '600 27px Arial, sans-serif';
  context.fillText(ellipsize(region.entry.label, 20), centerX, 190, availableWidth);
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

function createContentKey(presentation: VRWorldPromptPresentation): string {
  return [
    presentation.model.id,
    presentation.pageIndex,
    ...presentation.page.entries.map((entry) =>
      `${entry.kind}:${entry.id}:${entry.label}:${entry.kind === 'action' ? entry.icon ?? '' : ''}`),
  ].join('|');
}

function resolveIconForEntry(entry: VRWorldPromptEntry) {
  return resolveVRActionIcon({
    kind: entry.kind,
    id: entry.id,
    label: entry.label,
    icon: entry.kind === 'action' ? entry.icon : undefined,
  });
}

function canvasXToLocal(canvasX: number): number {
  return (canvasX / CANVAS_WIDTH - 0.5) * PANEL_WIDTH_METRES;
}

function isValidPresentation(presentation: VRWorldPromptPresentation): boolean {
  if (!presentation || typeof presentation !== 'object') return false;
  const page = resolveValidVRWorldPromptPage(presentation.model, presentation.pageIndex);
  return page !== null && page === presentation.page;
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
