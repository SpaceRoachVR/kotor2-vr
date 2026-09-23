import * as THREE from 'three';
import { InteractionTargetRegistry } from '../InteractionTargetRegistry';
import { XRHandRole, XRInputFrame } from '../XRTypes';

export interface VRInteractionGizmoOptions {
  readonly maxTargetsShown?: number;
  readonly rayLengthMetres?: number;
  readonly velocityScale?: number;
  readonly enabled?: boolean;
}

const DEFAULT_OPTIONS: Required<VRInteractionGizmoOptions> = {
  maxTargetsShown: 32,
  rayLengthMetres: 20,
  velocityScale: 0.2,
  enabled: false,
};

/**
 * 3D spatial debug gizmos rendered in world space for VR development and inspection.
 *
 * Renders:
 * - Interaction target wireframe bounds with availability colors.
 * - Controller target rays with hit state (cyan on hit, red on miss).
 * - Real-time gesture velocity vectors.
 */
export class VRInteractionGizmoHost {
  readonly root: THREE.Group;
  private readonly options: Required<VRInteractionGizmoOptions>;
  private enabled: boolean;

  private readonly targetSpheres: THREE.Mesh[] = [];
  private readonly sphereGeometry: THREE.SphereGeometry;
  private readonly activeMaterial: THREE.MeshBasicMaterial;
  private readonly inactiveMaterial: THREE.MeshBasicMaterial;

  private readonly rayLines: Record<XRHandRole, THREE.Line>;
  private readonly rayGeometries: Record<XRHandRole, THREE.BufferGeometry>;
  private readonly rayHitMaterial: THREE.LineBasicMaterial;
  private readonly rayMissMaterial: THREE.LineBasicMaterial;

  private readonly velocityLines: Record<XRHandRole, THREE.Line>;
  private readonly velocityGeometries: Record<XRHandRole, THREE.BufferGeometry>;
  private readonly velocityActiveMaterial: THREE.LineBasicMaterial;
  private readonly velocityIdleMaterial: THREE.LineBasicMaterial;

  private readonly tempPos = new THREE.Vector3();
  private readonly tempDir = new THREE.Vector3();

  constructor(
    private readonly worldScene: THREE.Object3D,
    options: VRInteractionGizmoOptions = {}
  ) {
    if (!worldScene) throw new TypeError('VRInteractionGizmoHost requires a worldScene');
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.enabled = this.options.enabled;

    this.root = new THREE.Group();
    this.root.name = 'VRInteractionGizmoRoot';
    this.root.visible = this.enabled;
    this.worldScene.add(this.root);

    // 1. Target spheres pool
    this.sphereGeometry = new THREE.SphereGeometry(1, 12, 8);
    this.activeMaterial = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
    });
    this.inactiveMaterial = new THREE.MeshBasicMaterial({
      color: 0x666666,
      wireframe: true,
      transparent: true,
      opacity: 0.2,
    });

    for (let i = 0; i < this.options.maxTargetsShown; i++) {
      const mesh = new THREE.Mesh(this.sphereGeometry, this.activeMaterial);
      mesh.visible = false;
      this.targetSpheres.push(mesh);
      this.root.add(mesh);
    }

    // 2. Controller rays
    this.rayHitMaterial = new THREE.LineBasicMaterial({ color: 0x00ff88, depthTest: false, transparent: true, opacity: 0.8 });
    this.rayMissMaterial = new THREE.LineBasicMaterial({ color: 0xff3344, depthTest: false, transparent: true, opacity: 0.4 });

    const createRayLine = () => {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geom, this.rayMissMaterial);
      line.frustumCulled = false;
      line.renderOrder = 999;
      line.visible = false;
      this.root.add(line);
      return { line, geom };
    };

    const leftRay = createRayLine();
    const rightRay = createRayLine();
    this.rayLines = { left: leftRay.line, right: rightRay.line };
    this.rayGeometries = { left: leftRay.geom, right: rightRay.geom };

    // 3. Velocity indicators
    this.velocityActiveMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, depthTest: false });
    this.velocityIdleMaterial = new THREE.LineBasicMaterial({ color: 0xffff44, depthTest: false });

    const createVelocityLine = () => {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geom, this.velocityIdleMaterial);
      line.frustumCulled = false;
      line.renderOrder = 999;
      line.visible = false;
      this.root.add(line);
      return { line, geom };
    };

    const leftVel = createVelocityLine();
    const rightVel = createVelocityLine();
    this.velocityLines = { left: leftVel.line, right: rightVel.line };
    this.velocityGeometries = { left: leftVel.geom, right: rightVel.geom };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.root.visible = enabled;
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  update(
    inputFrame: XRInputFrame | null,
    targetRegistry: InteractionTargetRegistry
  ): void {
    if (!this.enabled) return;

    // 1. Update targets wireframes
    const targets = targetRegistry.getTargets();
    for (let i = 0; i < this.targetSpheres.length; i++) {
      const sphere = this.targetSpheres[i];
      if (i < targets.length) {
        const target = targets[i];
        const pos = target.getWorldPosition(this.tempPos);
        sphere.position.copy(pos);
        sphere.scale.setScalar(Math.max(0.05, target.radiusMetres));
        sphere.material = target.isAvailable() ? this.activeMaterial : this.inactiveMaterial;
        sphere.visible = true;
      } else {
        sphere.visible = false;
      }
    }

    if (!inputFrame) {
      for (const role of ['left', 'right'] as const) {
        this.rayLines[role].visible = false;
        this.velocityLines[role].visible = false;
      }
      return;
    }

    // 2. Update rays and velocity indicators for each hand
    for (const role of ['left', 'right'] as const) {
      const hand = inputFrame.hands[role];
      const rayLine = this.rayLines[role];
      const rayGeom = this.rayGeometries[role];
      const velLine = this.velocityLines[role];
      const velGeom = this.velocityGeometries[role];

      if (!hand || hand.pose.trackingState === 'unavailable') {
        rayLine.visible = false;
        velLine.visible = false;
        continue;
      }

      // Controller ray
      const rayOrigin = hand.targetRayPose.position;
      this.tempDir.set(0, 0, -1).applyQuaternion(hand.targetRayPose.orientation).normalize();

      const rayHit = targetRegistry.resolveRay(rayOrigin, this.tempDir, this.options.rayLengthMetres);
      const hitDist = rayHit ? rayHit.distanceMetres : this.options.rayLengthMetres;
      const rayEnd = rayOrigin.clone().addScaledVector(this.tempDir, hitDist);

      const rayAttr = rayGeom.getAttribute('position') as THREE.BufferAttribute;
      const rayPositions = rayAttr.array as Float32Array;
      rayPositions[0] = rayOrigin.x; rayPositions[1] = rayOrigin.y; rayPositions[2] = rayOrigin.z;
      rayPositions[3] = rayEnd.x;    rayPositions[4] = rayEnd.y;    rayPositions[5] = rayEnd.z;
      rayAttr.needsUpdate = true;
      rayLine.material = rayHit ? this.rayHitMaterial : this.rayMissMaterial;
      rayLine.visible = true;

      // Controller velocity vector
      const vel = hand.pose.linearVelocity;
      if (vel && vel.lengthSq() > 0.01) {
        const velEnd = hand.pose.position.clone().addScaledVector(vel, this.options.velocityScale);
        const velAttr = velGeom.getAttribute('position') as THREE.BufferAttribute;
        const velPositions = velAttr.array as Float32Array;
        velPositions[0] = hand.pose.position.x; velPositions[1] = hand.pose.position.y; velPositions[2] = hand.pose.position.z;
        velPositions[3] = velEnd.x;             velPositions[4] = velEnd.y;             velPositions[5] = velEnd.z;
        velAttr.needsUpdate = true;
        // Green if above flick threshold (1.2 m/s), yellow otherwise
        velLine.material = vel.length() >= 1.2 ? this.velocityActiveMaterial : this.velocityIdleMaterial;
        velLine.visible = true;
      } else {
        velLine.visible = false;
      }
    }
  }

  dispose(): void {
    this.worldScene.remove(this.root);
    this.sphereGeometry.dispose();
    this.activeMaterial.dispose();
    this.inactiveMaterial.dispose();
    this.rayHitMaterial.dispose();
    this.rayMissMaterial.dispose();
    this.velocityActiveMaterial.dispose();
    this.velocityIdleMaterial.dispose();
    for (const geom of Object.values(this.rayGeometries)) geom.dispose();
    for (const geom of Object.values(this.velocityGeometries)) geom.dispose();
  }
}
