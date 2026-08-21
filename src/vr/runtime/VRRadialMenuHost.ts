import * as THREE from 'three';
import { TextureLoader } from '@/loaders/TextureLoader';
import { XRWorldPose } from './XRTypes';
import { VRRadialPresentation } from './VRRadialMenuController';
import {
  createVRRadialSectors,
  resolveVRRadialRay,
  resolveVRRadialTouch,
  VR_RADIAL_LAYOUT,
  VRRadialHit,
  VRRadialResolvedHit,
  VRRadialSector,
} from './VRRadialMenuLayout';
import { VRRadialMenuItem } from './VRRadialMenuModel';

export interface VRRadialIconLoader {
  load(resref: string): Promise<THREE.Texture | null>;
}

type CanvasSurface = {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
};

type FallbackIconCategory = 'attack' | 'force' | 'item' | 'inventory' | 'map' | 'party'
  | 'previous' | 'next' | 'generic';

const NORMAL_WEDGE_COLOR = 0x13252c;
const NORMAL_BORDER_COLOR = 0x3d9fb5;
const HOVER_WEDGE_COLOR = 0x9a6819;
const HOVER_BORDER_COLOR = 0xffd15c;
const CANCEL_DISC_COLOR = 0x10191e;
const CANCEL_SYMBOL_COLOR = '#dc2027';
const POINTER_COLOR = 0x66e9ff;
const NORMAL_WEDGE_OPACITY = 0.92;
const HOVER_WEDGE_OPACITY = 0.96;
const MENU_DISTANCE_METRES = 0.85;
const MENU_DROP_METRES = 0.25;
const POINTER_MAX_DISTANCE_METRES = 5;
const MAX_ICON_CACHE_SIZE = 64;
const RENDER_ORDER_BASE = 1_000_004;
const HORIZONTAL_EPSILON = 1e-8;

const DEFAULT_ICON_LOADER: VRRadialIconLoader = {
  async load(resref: string): Promise<THREE.Texture | null> {
    return (await TextureLoader.Load(resref, TextureLoader.NOCACHE)) ?? null;
  },
};

/**
 * World-fixed KOTOR-style radial wheel presentation. Geometry and hit
 * classification both consume VRRadialMenuLayout so visual gaps cannot drift
 * from ray or direct-touch behavior.
 */
export class VRRadialMenuHost {
  readonly object = new THREE.Group();

  private readonly iconLoader: VRRadialIconLoader;
  private readonly pageGroup = new THREE.Group();
  private readonly wedgeById = new Map<string, THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>>();
  private readonly iconMaterialById = new Map<string, THREE.MeshBasicMaterial>();
  private readonly iconCache = new Map<string, THREE.Texture | null>();
  private readonly iconLoads = new Map<string, Promise<THREE.Texture | null>>();
  private readonly currentIconResrefs = new Set<string>();
  private readonly missingIconWarnings = new Set<string>();
  private readonly fallbackTextures = new Map<FallbackIconCategory, THREE.CanvasTexture>();
  private readonly ownedCanvasTextures = new Set<THREE.CanvasTexture>();
  private readonly pageCanvasTextures = new Set<THREE.CanvasTexture>();
  private readonly disposedTextures = new Set<THREE.Texture>();
  private readonly lastHorizontalForward = new THREE.Vector3(0, 1, 0);
  private readonly centerMaterial: THREE.MeshBasicMaterial;
  private readonly plaqueSurface: CanvasSurface;
  private readonly plaquePlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly pageIndicatorSurface: CanvasSurface;
  private readonly pageIndicatorPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly collisionRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly pointerLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;

  private currentMenuId: string | null = null;
  private currentPageKey: string | null = null;
  private currentEntries: readonly VRRadialMenuItem[] = [];
  private presentationToken = 0;
  private disposed = false;

  constructor(scene: THREE.Scene, iconLoader: VRRadialIconLoader = DEFAULT_ICON_LOADER) {
    if (!scene || typeof scene.add !== 'function') throw new TypeError('radial menu scene is required');
    if (!iconLoader || typeof iconLoader.load !== 'function') throw new TypeError('radial icon loader must provide load(resref)');
    if (typeof document === 'undefined') throw new Error('radial menu requires a browser document');

    this.iconLoader = iconLoader;
    this.object.name = 'Kotor2VR.RadialMenu';
    this.object.visible = false;
    this.pageGroup.name = 'Kotor2VR.RadialMenu.Page';
    this.object.add(this.pageGroup);

    this.centerMaterial = new THREE.MeshBasicMaterial({
      color: CANCEL_DISC_COLOR,
      opacity: 0.98,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const centerDisc = new THREE.Mesh(
      new THREE.CircleGeometry(VR_RADIAL_LAYOUT.innerRadiusMetres, 64),
      this.centerMaterial,
    );
    centerDisc.name = 'Kotor2VR.RadialMenu.Center';
    centerDisc.position.z = 0.001;
    centerDisc.renderOrder = RENDER_ORDER_BASE + 200;
    this.object.add(centerDisc);

    const cancelSurface = this.createCanvasSurface(256, 256);
    drawCancelSymbol(cancelSurface);
    const cancelSymbol = new THREE.Mesh(
      new THREE.PlaneGeometry(VR_RADIAL_LAYOUT.innerRadiusMetres * 1.35, VR_RADIAL_LAYOUT.innerRadiusMetres * 1.35),
      this.createCanvasMaterial(cancelSurface.texture),
    );
    cancelSymbol.name = 'Kotor2VR.RadialMenu.CancelSymbol';
    cancelSymbol.position.z = 0.004;
    cancelSymbol.renderOrder = RENDER_ORDER_BASE + 210;
    this.object.add(cancelSymbol);

    this.plaqueSurface = this.createCanvasSurface(768, 128);
    this.plaquePlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.48, 0.08),
      this.createCanvasMaterial(this.plaqueSurface.texture),
    );
    this.plaquePlane.name = 'Kotor2VR.RadialMenu.Plaque';
    this.plaquePlane.position.set(0, 0.415, 0.006);
    this.plaquePlane.renderOrder = RENDER_ORDER_BASE + 220;
    this.object.add(this.plaquePlane);

    this.pageIndicatorSurface = this.createCanvasSurface(384, 96);
    this.pageIndicatorPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.05),
      this.createCanvasMaterial(this.pageIndicatorSurface.texture),
    );
    this.pageIndicatorPlane.name = 'Kotor2VR.RadialMenu.PageIndicator';
    this.pageIndicatorPlane.position.set(0, -0.385, 0.006);
    this.pageIndicatorPlane.renderOrder = RENDER_ORDER_BASE + 220;
    this.pageIndicatorPlane.visible = false;
    this.object.add(this.pageIndicatorPlane);

    const collisionDisc = new THREE.Mesh(
      new THREE.CircleGeometry(VR_RADIAL_LAYOUT.outerRadiusMetres, 64),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        opacity: 0,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    collisionDisc.name = 'Kotor2VR.RadialMenu.CollisionDisc';
    collisionDisc.position.z = -0.002;
    collisionDisc.renderOrder = RENDER_ORDER_BASE;
    this.object.add(collisionDisc);

    this.collisionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.008, 0.014, 32),
      new THREE.MeshBasicMaterial({
        color: POINTER_COLOR,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.collisionRing.name = 'Kotor2VR.RadialMenu.CollisionRing';
    this.collisionRing.visible = false;
    this.collisionRing.renderOrder = RENDER_ORDER_BASE + 240;
    this.object.add(this.collisionRing);

    const pointerGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    this.pointerLine = new THREE.Line(
      pointerGeometry,
      new THREE.LineBasicMaterial({
        color: POINTER_COLOR,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.pointerLine.name = 'Kotor2VR.RadialMenu.Pointer';
    this.pointerLine.visible = false;
    this.pointerLine.frustumCulled = false;
    this.pointerLine.renderOrder = RENDER_ORDER_BASE + 230;

    scene.add(this.object);
    scene.add(this.pointerLine);
  }

  present(presentation: VRRadialPresentation, openingHeadPose: XRWorldPose): void {
    if (this.disposed) throw new Error('radial menu host is disposed');
    if (!isValidPresentation(presentation) || !isFinitePose(openingHeadPose)) {
      this.clear();
      return;
    }

    if (this.currentMenuId !== presentation.menu.id) {
      this.placeAtOpeningHeadPose(openingHeadPose);
      this.currentMenuId = presentation.menu.id;
    }

    const pageKey = createPageKey(presentation);
    if (pageKey !== this.currentPageKey) {
      this.rebuildPage(presentation);
      this.currentPageKey = pageKey;
    }

    this.updatePageIndicator(presentation.pageIndex, presentation.menu.pages.length);
    this.updateHover(presentation);
    this.object.visible = true;
    this.object.updateMatrixWorld(true);
  }

  resolveRay(pose: XRWorldPose): VRRadialHit | null {
    if (!this.object.visible || this.currentEntries.length === 0 || this.disposed) return null;
    try {
      const resolved = resolveVRRadialRay(this.object, pose, this.currentEntries.length);
      const accepted = resolved && resolved.distanceMetres <= POINTER_MAX_DISTANCE_METRES ? resolved : null;
      this.updatePointer(pose, accepted);
      return accepted?.hit ?? null;
    } catch {
      this.clear();
      return null;
    }
  }

  resolveTouch(worldProbe: THREE.Vector3): VRRadialHit | null {
    if (!this.object.visible || this.currentEntries.length === 0 || this.disposed) return null;
    try {
      return resolveVRRadialTouch(this.object, worldProbe, this.currentEntries.length)?.hit ?? null;
    } catch {
      this.clear();
      return null;
    }
  }

  clear(): void {
    if (this.disposed) return;
    this.presentationToken += 1;
    this.currentMenuId = null;
    this.currentPageKey = null;
    this.currentEntries = [];
    this.currentIconResrefs.clear();
    this.object.visible = false;
    this.pointerLine.visible = false;
    this.collisionRing.visible = false;
    this.disposePage();
  }

  dispose(): void {
    if (this.disposed) return;
    this.presentationToken += 1;
    this.disposed = true;
    this.currentEntries = [];
    this.currentIconResrefs.clear();
    this.object.visible = false;
    this.pointerLine.visible = false;
    this.collisionRing.visible = false;

    this.disposePage();
    this.object.removeFromParent();
    this.pointerLine.removeFromParent();
    disposeRenderableResources(this.object);
    disposeRenderableResources(this.pointerLine);

    for (const texture of this.ownedCanvasTextures) this.disposeTexture(texture);
    this.ownedCanvasTextures.clear();
    this.pageCanvasTextures.clear();
    this.fallbackTextures.clear();
    for (const texture of this.iconCache.values()) {
      if (texture) this.disposeTexture(texture);
    }
    this.iconCache.clear();
    this.iconLoads.clear();
  }

  getWedge(itemId: string): THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial> {
    const wedge = this.wedgeById.get(itemId);
    if (!wedge) throw new RangeError(`radial wedge is not presented: ${itemId}`);
    return wedge;
  }

  getIconMaterial(itemId: string): THREE.MeshBasicMaterial {
    const material = this.iconMaterialById.get(itemId);
    if (!material) throw new RangeError(`radial icon is not presented: ${itemId}`);
    return material;
  }

  private placeAtOpeningHeadPose(head: XRWorldPose): void {
    const normalizedOrientation = head.orientation.clone().normalize();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(normalizedOrientation);
    forward.z = 0;
    if (forward.lengthSq() <= HORIZONTAL_EPSILON) {
      forward.copy(this.lastHorizontalForward);
    } else {
      forward.normalize();
      this.lastHorizontalForward.copy(forward);
    }

    this.object.position.copy(head.position).addScaledVector(forward, MENU_DISTANCE_METRES);
    this.object.position.z = head.position.z - MENU_DROP_METRES;
    const normal = forward.clone().negate();
    const right = new THREE.Vector3(0, 0, 1).cross(normal).normalize();
    this.object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      right,
      new THREE.Vector3(0, 0, 1),
      normal,
    ));
  }

  private rebuildPage(presentation: VRRadialPresentation): void {
    this.presentationToken += 1;
    const token = this.presentationToken;
    this.disposePage();
    this.currentEntries = presentation.page.entries;
    this.currentIconResrefs.clear();
    const sectors = createVRRadialSectors(this.currentEntries.length);

    this.currentEntries.forEach((entry, index) => {
      const sector = sectors[index];
      const wedge = this.createWedge(entry, sector, index);
      this.wedgeById.set(entry.id, wedge);
      this.pageGroup.add(wedge);
      this.beginIconLoad(entry, token);
    });
  }

  private createWedge(
    entry: VRRadialMenuItem,
    sector: VRRadialSector,
    index: number,
  ): THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial> {
    const geometry = new THREE.ShapeGeometry(createSectorShape(sector, VR_RADIAL_LAYOUT.innerRadiusMetres, VR_RADIAL_LAYOUT.outerRadiusMetres));
    const material = new THREE.MeshBasicMaterial({
      color: NORMAL_WEDGE_COLOR,
      opacity: NORMAL_WEDGE_OPACITY,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const wedge = new THREE.Mesh(geometry, material);
    wedge.name = `Kotor2VR.RadialMenu.Wedge.${entry.id}`;
    wedge.renderOrder = RENDER_ORDER_BASE + 10 + (index * 4);

    const border = new THREE.Line(
      createSectorBorderGeometry(sector, VR_RADIAL_LAYOUT.innerRadiusMetres, VR_RADIAL_LAYOUT.outerRadiusMetres),
      new THREE.LineBasicMaterial({
        color: NORMAL_BORDER_COLOR,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      }),
    );
    border.name = `Kotor2VR.RadialMenu.Border.${entry.id}`;
    border.position.z = 0.002;
    border.renderOrder = wedge.renderOrder + 1;
    wedge.add(border);

    const centerAngle = (sector.startAngle + sector.endAngle) / 2;
    const iconRadius = 0.225;
    const iconMaterial = this.createCanvasMaterial(this.getFallbackTexture(categoryForEntry(entry)));
    const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.064, 0.064), iconMaterial);
    icon.name = `Kotor2VR.RadialMenu.Icon.${entry.id}`;
    icon.position.set(Math.cos(centerAngle) * iconRadius, Math.sin(centerAngle) * iconRadius + 0.014, 0.004);
    icon.renderOrder = wedge.renderOrder + 2;
    wedge.add(icon);
    this.iconMaterialById.set(entry.id, iconMaterial);

    const labelSurface = this.createCanvasSurface(384, 96, true);
    drawSliceLabel(labelSurface, entry.label);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.135, 0.034),
      this.createCanvasMaterial(labelSurface.texture),
    );
    label.name = `Kotor2VR.RadialMenu.Label.${entry.id}`;
    label.position.set(Math.cos(centerAngle) * iconRadius, Math.sin(centerAngle) * iconRadius - 0.038, 0.004);
    label.renderOrder = wedge.renderOrder + 3;
    wedge.add(label);

    return wedge;
  }

  private beginIconLoad(entry: VRRadialMenuItem, token: number): void {
    const entryIcon = iconForEntry(entry)?.trim();
    if (!entryIcon) return;
    const resref = entryIcon.toLowerCase();
    this.currentIconResrefs.add(resref);
    void this.loadIcon(resref).then((texture) => {
      if (this.disposed || token !== this.presentationToken) return;
      const currentEntry = this.currentEntries.find((candidate) => candidate.id === entry.id);
      if (!currentEntry || iconForEntry(currentEntry)?.trim().toLowerCase() !== resref) return;
      const material = this.iconMaterialById.get(entry.id);
      if (!material) return;
      material.map = texture ?? this.getFallbackTexture(categoryForEntry(currentEntry));
      material.needsUpdate = true;
    });
  }

  private loadIcon(resref: string): Promise<THREE.Texture | null> {
    if (this.iconCache.has(resref)) {
      const cached = this.iconCache.get(resref) ?? null;
      this.iconCache.delete(resref);
      this.iconCache.set(resref, cached);
      return Promise.resolve(cached);
    }
    const inFlight = this.iconLoads.get(resref);
    if (inFlight) return inFlight;

    const load = Promise.resolve()
      .then(() => this.iconLoader.load(resref))
      .then((texture) => texture ?? null)
      .catch((): null => null)
      .then((texture) => {
        if (this.disposed) {
          if (texture) this.disposeTexture(texture);
          return null;
        }
        this.rememberIcon(resref, texture);
        if (!texture) this.warnMissingIcon(resref);
        return texture;
      })
      .finally(() => {
        this.iconLoads.delete(resref);
      });
    this.iconLoads.set(resref, load);
    return load;
  }

  private rememberIcon(resref: string, texture: THREE.Texture | null): void {
    this.iconCache.delete(resref);
    this.iconCache.set(resref, texture);
    while (this.iconCache.size > MAX_ICON_CACHE_SIZE) {
      const evictionKey = this.findEvictionKey();
      if (!evictionKey) break;
      const evicted = this.iconCache.get(evictionKey) ?? null;
      this.iconCache.delete(evictionKey);
      if (evicted && !this.cacheContainsTexture(evicted)) this.disposeTexture(evicted);
    }
  }

  private findEvictionKey(): string | null {
    for (const key of this.iconCache.keys()) {
      if (!this.currentIconResrefs.has(key)) return key;
    }
    return this.iconCache.keys().next().value ?? null;
  }

  private cacheContainsTexture(texture: THREE.Texture): boolean {
    for (const candidate of this.iconCache.values()) {
      if (candidate === texture) return true;
    }
    return false;
  }

  private warnMissingIcon(resref: string): void {
    if (this.missingIconWarnings.has(resref)) return;
    this.missingIconWarnings.add(resref);
    console.warn(`[VRRadialMenuHost] Icon '${resref}' could not be loaded; using a category fallback.`);
  }

  private updateHover(presentation: VRRadialPresentation): void {
    for (const entry of this.currentEntries) {
      const wedge = this.wedgeById.get(entry.id);
      if (!wedge) continue;
      const hovered = presentation.hoveredId === entry.id;
      wedge.position.z = hovered ? VR_RADIAL_LAYOUT.hoverExtrusionMetres : 0;
      wedge.material.color.setHex(hovered ? HOVER_WEDGE_COLOR : NORMAL_WEDGE_COLOR);
      wedge.material.opacity = hovered ? HOVER_WEDGE_OPACITY : NORMAL_WEDGE_OPACITY;
      const border = wedge.getObjectByName(`Kotor2VR.RadialMenu.Border.${entry.id}`) as THREE.Line | undefined;
      const borderMaterial = border?.material as THREE.LineBasicMaterial | undefined;
      borderMaterial?.color.setHex(hovered ? HOVER_BORDER_COLOR : NORMAL_BORDER_COLOR);
    }

    const cancelHovered = presentation.hoveredId === 'cancel';
    this.centerMaterial.color.setHex(cancelHovered ? HOVER_WEDGE_COLOR : CANCEL_DISC_COLOR);
    this.centerMaterial.opacity = cancelHovered ? HOVER_WEDGE_OPACITY : 0.98;
    const hoveredEntry = this.currentEntries.find((entry) => entry.id === presentation.hoveredId);
    this.updatePlaque(cancelHovered ? 'Cancel' : hoveredEntry?.label ?? presentation.menu.title, cancelHovered || Boolean(hoveredEntry));
  }

  private updatePlaque(text: string, hovered: boolean): void {
    const { canvas, context, texture } = this.plaqueSurface;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = hovered ? 'rgba(154,104,25,0.96)' : 'rgba(19,37,44,0.92)';
    context.fillRect(2, 2, canvas.width - 4, canvas.height - 4);
    context.strokeStyle = hovered ? '#ffd15c' : '#3d9fb5';
    context.lineWidth = 6;
    context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
    context.fillStyle = '#ffffff';
    context.font = '600 46px Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 40);
    texture.needsUpdate = true;
    this.plaquePlane.userData.text = text;
  }

  private updatePageIndicator(pageIndex: number, pageCount: number): void {
    const visible = pageCount > 1;
    this.pageIndicatorPlane.visible = visible;
    if (!visible) return;
    const { canvas, context, texture } = this.pageIndicatorSurface;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(16,25,30,0.92)';
    context.fillRect(2, 2, canvas.width - 4, canvas.height - 4);
    context.strokeStyle = '#3d9fb5';
    context.lineWidth = 5;
    context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
    context.fillStyle = '#ffffff';
    context.font = '600 42px Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(`${pageIndex + 1} / ${pageCount}`, canvas.width / 2, canvas.height / 2);
    texture.needsUpdate = true;
    this.pageIndicatorPlane.userData.text = `${pageIndex + 1} / ${pageCount}`;
  }

  private updatePointer(pose: XRWorldPose, resolved: VRRadialResolvedHit | null): void {
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(pose.orientation).normalize();
    const endpoint = resolved?.worldPoint.clone() ?? this.intersectPointerPlane(pose.position, direction)
      ?? pose.position.clone().addScaledVector(direction, POINTER_MAX_DISTANCE_METRES);
    const distance = endpoint.distanceTo(pose.position);
    if (distance > POINTER_MAX_DISTANCE_METRES) {
      endpoint.copy(pose.position).addScaledVector(direction, POINTER_MAX_DISTANCE_METRES);
    }

    const positions = this.pointerLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    positions.setXYZ(0, pose.position.x, pose.position.y, pose.position.z);
    positions.setXYZ(1, endpoint.x, endpoint.y, endpoint.z);
    positions.needsUpdate = true;
    this.pointerLine.geometry.computeBoundingSphere();
    this.pointerLine.visible = true;

    if (resolved) {
      this.collisionRing.position.set(resolved.localPoint.x, resolved.localPoint.y, 0.03);
      this.collisionRing.visible = true;
    } else {
      this.collisionRing.visible = false;
    }
  }

  private intersectPointerPlane(origin: THREE.Vector3, direction: THREE.Vector3): THREE.Vector3 | null {
    this.object.updateWorldMatrix(true, false);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.object.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const point = this.object.getWorldPosition(new THREE.Vector3());
    return new THREE.Ray(origin, direction).intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point), new THREE.Vector3());
  }

  private getFallbackTexture(category: FallbackIconCategory): THREE.CanvasTexture {
    const cached = this.fallbackTextures.get(category);
    if (cached) return cached;
    const surface = this.createCanvasSurface(256, 256);
    drawFallbackIcon(surface, category);
    this.fallbackTextures.set(category, surface.texture);
    return surface.texture;
  }

  private createCanvasSurface(width: number, height: number, pageOwned = false): CanvasSurface {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('radial menu canvas context unavailable');
    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    texture.needsUpdate = true;
    this.ownedCanvasTextures.add(texture);
    if (pageOwned) this.pageCanvasTextures.add(texture);
    return { canvas, context, texture };
  }

  private createCanvasMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      map: texture,
      color: 0xffffff,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  private disposePage(): void {
    for (const child of [...this.pageGroup.children]) {
      child.removeFromParent();
      disposeRenderableResources(child);
    }
    for (const texture of this.pageCanvasTextures) {
      this.disposeTexture(texture);
      this.ownedCanvasTextures.delete(texture);
    }
    this.pageCanvasTextures.clear();
    this.wedgeById.clear();
    this.iconMaterialById.clear();
  }

  private disposeTexture(texture: THREE.Texture): void {
    if (this.disposedTextures.has(texture)) return;
    this.disposedTextures.add(texture);
    texture.dispose();
  }
}

function isValidPresentation(presentation: VRRadialPresentation): boolean {
  if (!presentation || typeof presentation !== 'object') return false;
  if (!presentation.menu || typeof presentation.menu.id !== 'string' || presentation.menu.id.trim().length === 0) return false;
  if (!Array.isArray(presentation.menu.pages) || !Number.isInteger(presentation.pageIndex)) return false;
  if (presentation.pageIndex < 0 || presentation.pageIndex >= presentation.menu.pages.length) return false;
  if (presentation.page !== presentation.menu.pages[presentation.pageIndex]) return false;
  if (!Array.isArray(presentation.page.entries) || presentation.page.entries.length < 1 || presentation.page.entries.length > 8) return false;
  const ids = new Set<string>();
  for (const entry of presentation.page.entries) {
    if (!entry || typeof entry.id !== 'string' || entry.id.trim().length === 0 || ids.has(entry.id)) return false;
    if (typeof entry.label !== 'string' || entry.label.trim().length === 0) return false;
    ids.add(entry.id);
  }
  return presentation.hoveredId === null || presentation.hoveredId === 'cancel' || ids.has(presentation.hoveredId);
}

function isFinitePose(pose: XRWorldPose): boolean {
  if (!pose || typeof pose !== 'object' || !isFiniteVector3(pose.position) || !pose.orientation) return false;
  const quaternion = pose.orientation;
  return Number.isFinite(quaternion.x) && Number.isFinite(quaternion.y)
    && Number.isFinite(quaternion.z) && Number.isFinite(quaternion.w)
    && quaternion.lengthSq() > HORIZONTAL_EPSILON;
}

function isFiniteVector3(vector: THREE.Vector3): boolean {
  return Boolean(vector) && Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function createPageKey(presentation: VRRadialPresentation): string {
  const entries = presentation.page.entries
    .map((entry) => `${entry.kind}:${entry.id}:${entry.label}:${iconForEntry(entry) ?? ''}`)
    .join('|');
  return `${presentation.menu.id}:${presentation.pageIndex}:${entries}`;
}

function createSectorShape(sector: VRRadialSector, innerRadius: number, outerRadius: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(Math.cos(sector.startAngle) * innerRadius, Math.sin(sector.startAngle) * innerRadius);
  shape.lineTo(Math.cos(sector.startAngle) * outerRadius, Math.sin(sector.startAngle) * outerRadius);
  shape.absarc(0, 0, outerRadius, sector.startAngle, sector.endAngle, false);
  shape.lineTo(Math.cos(sector.endAngle) * innerRadius, Math.sin(sector.endAngle) * innerRadius);
  shape.absarc(0, 0, innerRadius, sector.endAngle, sector.startAngle, true);
  shape.closePath();
  return shape;
}

function createSectorBorderGeometry(sector: VRRadialSector, innerRadius: number, outerRadius: number): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  appendArc(points, outerRadius, sector.startAngle, sector.endAngle, 20);
  appendArc(points, innerRadius, sector.endAngle, sector.startAngle, 10);
  points.push(points[0].clone());
  return new THREE.BufferGeometry().setFromPoints(points);
}

function appendArc(points: THREE.Vector3[], radius: number, start: number, end: number, segments: number): void {
  for (let index = 0; index <= segments; index += 1) {
    const angle = THREE.MathUtils.lerp(start, end, index / segments);
    points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
  }
}

function categoryForEntry(entry: VRRadialMenuItem): FallbackIconCategory {
  if (entry.kind === 'previous-page') return 'previous';
  if (entry.kind === 'next-page') return 'next';
  const identity = `${entry.id} ${entry.label} ${iconForEntry(entry) ?? ''}`.toLowerCase();
  if (/attack|bash|blaster|weapon|saber/.test(identity)) return 'attack';
  if (/force|power/.test(identity)) return 'force';
  if (/medpac|item|stim|grenade|mine|recover|disarm/.test(identity)) return 'item';
  if (/inventory/.test(identity)) return 'inventory';
  if (/map/.test(identity)) return 'map';
  if (/party|companion|leader/.test(identity)) return 'party';
  return 'generic';
}

function iconForEntry(entry: VRRadialMenuItem): string | undefined {
  return entry.kind === 'action' || entry.kind === 'submenu' ? entry.icon : undefined;
}

function drawSliceLabel(surface: CanvasSurface, label: string): void {
  const { canvas, context, texture } = surface;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ffffff';
  context.font = '600 34px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, canvas.width / 2, canvas.height / 2, canvas.width - 12);
  texture.needsUpdate = true;
}

function drawCancelSymbol(surface: CanvasSurface): void {
  const { canvas, context, texture } = surface;
  const center = canvas.width / 2;
  const radius = canvas.width * 0.3;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = CANCEL_SYMBOL_COLOR;
  context.lineWidth = canvas.width * 0.075;
  context.lineCap = 'round';
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.moveTo(center - radius * 0.72, center - radius * 0.72);
  context.lineTo(center + radius * 0.72, center + radius * 0.72);
  context.stroke();
  texture.needsUpdate = true;
}

function drawFallbackIcon(surface: CanvasSurface, category: FallbackIconCategory): void {
  const { canvas, context, texture } = surface;
  const size = canvas.width;
  const center = size / 2;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#ffffff';
  context.fillStyle = '#ffffff';
  context.lineWidth = size * 0.055;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  if (category === 'attack') {
    context.beginPath();
    context.moveTo(size * 0.28, size * 0.22); context.lineTo(size * 0.72, size * 0.78);
    context.moveTo(size * 0.72, size * 0.22); context.lineTo(size * 0.28, size * 0.78);
    context.moveTo(size * 0.22, size * 0.68); context.lineTo(size * 0.38, size * 0.84);
    context.moveTo(size * 0.78, size * 0.68); context.lineTo(size * 0.62, size * 0.84);
    context.stroke();
  } else if (category === 'force') {
    context.beginPath();
    for (let ray = 0; ray < 8; ray += 1) {
      const angle = (ray / 8) * Math.PI * 2;
      context.moveTo(center + Math.cos(angle) * size * 0.15, center + Math.sin(angle) * size * 0.15);
      context.lineTo(center + Math.cos(angle) * size * 0.36, center + Math.sin(angle) * size * 0.36);
    }
    context.stroke();
    context.beginPath(); context.arc(center, center, size * 0.11, 0, Math.PI * 2); context.fill();
  } else if (category === 'item') {
    context.strokeRect(size * 0.25, size * 0.22, size * 0.5, size * 0.58);
    context.fillRect(size * 0.44, size * 0.32, size * 0.12, size * 0.38);
    context.fillRect(size * 0.31, size * 0.45, size * 0.38, size * 0.12);
  } else if (category === 'inventory') {
    context.strokeRect(size * 0.22, size * 0.31, size * 0.56, size * 0.48);
    context.beginPath();
    context.moveTo(size * 0.36, size * 0.31); context.quadraticCurveTo(center, size * 0.08, size * 0.64, size * 0.31);
    context.stroke();
    context.fillRect(size * 0.46, size * 0.5, size * 0.08, size * 0.14);
  } else if (category === 'map') {
    context.beginPath();
    context.moveTo(size * 0.2, size * 0.28); context.lineTo(size * 0.4, size * 0.2);
    context.lineTo(size * 0.6, size * 0.3); context.lineTo(size * 0.8, size * 0.22);
    context.lineTo(size * 0.8, size * 0.72); context.lineTo(size * 0.6, size * 0.8);
    context.lineTo(size * 0.4, size * 0.7); context.lineTo(size * 0.2, size * 0.78);
    context.closePath(); context.stroke();
    context.beginPath(); context.moveTo(size * 0.4, size * 0.2); context.lineTo(size * 0.4, size * 0.7);
    context.moveTo(size * 0.6, size * 0.3); context.lineTo(size * 0.6, size * 0.8); context.stroke();
  } else if (category === 'party') {
    context.beginPath();
    context.arc(center, size * 0.36, size * 0.13, 0, Math.PI * 2);
    context.arc(size * 0.29, size * 0.47, size * 0.1, 0, Math.PI * 2);
    context.arc(size * 0.71, size * 0.47, size * 0.1, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(center, size * 0.78, size * 0.27, Math.PI, Math.PI * 2);
    context.arc(size * 0.24, size * 0.76, size * 0.18, Math.PI, Math.PI * 2);
    context.arc(size * 0.76, size * 0.76, size * 0.18, Math.PI, Math.PI * 2);
    context.stroke();
  } else if (category === 'previous' || category === 'next') {
    const direction = category === 'previous' ? -1 : 1;
    context.beginPath();
    context.moveTo(center - direction * size * 0.25, center);
    context.lineTo(center + direction * size * 0.18, center);
    context.moveTo(center + direction * size * 0.02, center - size * 0.18);
    context.lineTo(center + direction * size * 0.2, center);
    context.lineTo(center + direction * size * 0.02, center + size * 0.18);
    context.stroke();
  } else {
    context.beginPath();
    context.moveTo(center, size * 0.19); context.lineTo(size * 0.81, center);
    context.lineTo(center, size * 0.81); context.lineTo(size * 0.19, center);
    context.closePath(); context.stroke();
    context.beginPath(); context.arc(center, center, size * 0.07, 0, Math.PI * 2); context.fill();
  }
  texture.needsUpdate = true;
}

function disposeRenderableResources(root: THREE.Object3D): void {
  root.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    renderable.geometry?.dispose();
    if (Array.isArray(renderable.material)) {
      renderable.material.forEach((material) => material.dispose());
    } else {
      renderable.material?.dispose();
    }
  });
}
