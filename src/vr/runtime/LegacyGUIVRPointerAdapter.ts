import * as THREE from 'three';
import { VRPanelPointerSink } from './VRPanelInputController';

export interface LegacyGUIVRPointerControl {
  readonly name: string;
  isVisible(): boolean;
  isClickable(): boolean;
  click(): void;
}

/** A list-owned action resolved from the exact row or scroll affordance under the pointer. */
export interface LegacyGUIVRPointerSemanticTarget {
  readonly name: string;
  readonly control: LegacyGUIVRPointerControl;
  isAvailable(): boolean;
  activate(): void;
}

export interface LegacyGUIVRPointerAdapterDependencies {
  readonly getViewportSize: () => { readonly width: number; readonly height: number };
  readonly getControlsAtPointer: () => readonly LegacyGUIVRPointerControl[];
  readonly getSemanticTargetsAtPointer?: () => readonly LegacyGUIVRPointerSemanticTarget[];
  readonly setPointerVisible: (visible: boolean) => void;
  readonly applyPointerCoordinates: (coordinates: LegacyGUIVRPointerCoordinates) => void;
  readonly beforeControlActivation?: (control: LegacyGUIVRPointerControl) => void;
  readonly afterControlActivation?: (control: LegacyGUIVRPointerControl) => void;
}

export interface LegacyGUIVRPointerCoordinates {
  readonly ui: THREE.Vector2;
  readonly viewport: THREE.Vector2;
  readonly normalized: THREE.Vector2;
}

/** Bridges a panel-space XR pointer into the existing mouse-driven GUI model. */
export class LegacyGUIVRPointerAdapter implements VRPanelPointerSink {
  private hasPointerHit = false;

  constructor(private readonly dependencies: LegacyGUIVRPointerAdapterDependencies) {}

  setPointerPosition(position: THREE.Vector2 | null): void {
    if (!position) {
      this.hasPointerHit = false;
      this.dependencies.setPointerVisible(false);
      return;
    }
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      throw new RangeError('VR GUI pointer position must be finite');
    }

    const viewport = this.dependencies.getViewportSize();
    LegacyGUIVRPointerAdapter.validateViewport(viewport.width, viewport.height);
    const viewportX = position.x + viewport.width / 2;
    const viewportY = viewport.height / 2 - position.y;

    this.dependencies.applyPointerCoordinates({
      ui: position.clone(),
      viewport: new THREE.Vector2(viewportX, viewportY),
      normalized: new THREE.Vector2(
        position.x / (viewport.width / 2),
        position.y / (viewport.height / 2)
      ),
    });
    this.hasPointerHit = true;
    this.dependencies.setPointerVisible(true);
  }

  activatePointer(): boolean {
    if (!this.hasPointerHit) {
      LegacyGUIVRPointerAdapter.reportMiss('pointer is not over the panel');
      return false;
    }
    const semanticTarget = this.dependencies.getSemanticTargetsAtPointer?.().find(
      (candidate) => candidate.isAvailable() && candidate.control.isVisible()
    );
    if (semanticTarget) {
      this.dependencies.beforeControlActivation?.(semanticTarget.control);
      semanticTarget.activate();
      this.dependencies.afterControlActivation?.(semanticTarget.control);
      return true;
    }
    const candidates = this.dependencies.getControlsAtPointer();
    const control = candidates.find(
      (candidate) => candidate.isVisible() && candidate.isClickable()
    );
    if (!control) {
      // A panel that renders but never activates anything (reported in the
      // headset for the galaxy map) is indistinguishable from a dead pointer
      // without knowing whether the hit-test found controls at all, and if so
      // why each was rejected.
      LegacyGUIVRPointerAdapter.reportMiss(
        candidates.length === 0
          ? 'hit-test returned no controls under the pointer'
          : `no clickable control among [${candidates
            .map((candidate) => `${candidate.name}(visible=${candidate.isVisible()},clickable=${candidate.isClickable()})`)
            .join(', ')}]`
      );
      return false;
    }

    this.dependencies.beforeControlActivation?.(control);
    control.click();
    this.dependencies.afterControlActivation?.(control);
    return true;
  }

  private static reportedMisses = new Set<string>();

  private static reportMiss(reason: string): void {
    if (LegacyGUIVRPointerAdapter.reportedMisses.has(reason)) return;
    LegacyGUIVRPointerAdapter.reportedMisses.add(reason);
    // console.error, not warn: this is reported from a headset where the only
    // way it reaches anyone is a console log read afterwards, and default
    // DevTools filtering hides warnings.
    console.error(`[LegacyGUIVRPointerAdapter] panel activation did nothing: ${reason}`);
  }

  private static validateViewport(width: number, height: number): void {
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw new RangeError('VR GUI viewport dimensions must be finite positive numbers');
    }
  }
}
