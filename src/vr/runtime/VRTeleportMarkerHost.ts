import * as THREE from 'three';

const VALID_COLOR = 0x66e9ff;
const BLOCKED_COLOR = 0xdc2027;
const MARKER_RADIUS_METRES = 0.35;
const MARKER_LIFT_METRES = 0.02;
/** Segments in the aim curve. Enough to read as a curve, few enough to be free. */
const ARC_SEGMENTS = 24;

/**
 * The blink-teleport landing marker and its aim curve.
 *
 * The original blink drew nothing at all, so the player committed a relocation
 * without ever seeing where it would put them. The marker is the whole point of
 * the feature: it turns the teleport from a guess into a choice.
 *
 * Colour carries validity rather than a separate label — a blocked destination
 * reads instantly as red without anything to parse. The world is Z-up, so the
 * marker disc lies in XY, lifted slightly to avoid z-fighting with the floor.
 */
export class VRTeleportMarkerHost {
  readonly markerObject: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  readonly arcObject: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly arcPositions: THREE.BufferAttribute;

  constructor(scene: THREE.Scene) {
    this.markerObject = new THREE.Mesh(
      new THREE.RingGeometry(MARKER_RADIUS_METRES * 0.72, MARKER_RADIUS_METRES, 40),
      new THREE.MeshBasicMaterial({
        color: VALID_COLOR,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      })
    );
    this.markerObject.name = 'Kotor2VR.VRTeleportMarker';
    this.markerObject.visible = false;
    this.markerObject.frustumCulled = false;
    this.markerObject.renderOrder = 1_000_003;

    const arcGeometry = new THREE.BufferGeometry();
    this.arcPositions = new THREE.BufferAttribute(new Float32Array((ARC_SEGMENTS + 1) * 3), 3);
    arcGeometry.setAttribute('position', this.arcPositions);
    this.arcObject = new THREE.Line(
      arcGeometry,
      new THREE.LineBasicMaterial({
        color: VALID_COLOR,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        depthWrite: false,
      })
    );
    this.arcObject.name = 'Kotor2VR.VRTeleportArc';
    this.arcObject.visible = false;
    this.arcObject.frustumCulled = false;
    this.arcObject.renderOrder = 1_000_003;

    scene.add(this.markerObject, this.arcObject);
  }

  /** Shows the marker at `destination`, with an arc back to the aiming hand. */
  present(origin: THREE.Vector3, destination: THREE.Vector3, walkable: boolean): void {
    const color = walkable ? VALID_COLOR : BLOCKED_COLOR;
    this.markerObject.material.color.setHex(color);
    this.arcObject.material.color.setHex(color);

    this.markerObject.position.set(destination.x, destination.y, destination.z + MARKER_LIFT_METRES);
    // RingGeometry is authored in XY, which is already the ground plane here.
    this.markerObject.quaternion.identity();
    this.markerObject.visible = true;

    this.updateArc(origin, destination);
    this.arcObject.visible = true;
  }

  clear(): void {
    this.markerObject.visible = false;
    this.arcObject.visible = false;
  }

  dispose(): void {
    this.markerObject.removeFromParent();
    this.arcObject.removeFromParent();
    this.markerObject.geometry.dispose();
    this.markerObject.material.dispose();
    this.arcObject.geometry.dispose();
    this.arcObject.material.dispose();
  }

  /**
   * A sagging curve rather than a straight line: it reads as a thrown path, and
   * its apex keeps the far end of the aim visible instead of foreshortening it
   * into the floor.
   */
  private updateArc(origin: THREE.Vector3, destination: THREE.Vector3): void {
    const sag = Math.min(origin.distanceTo(destination) * 0.18, 0.6);
    for (let i = 0; i <= ARC_SEGMENTS; i += 1) {
      const t = i / ARC_SEGMENTS;
      const lift = Math.sin(t * Math.PI) * sag;
      this.arcPositions.setXYZ(
        i,
        origin.x + (destination.x - origin.x) * t,
        origin.y + (destination.y - origin.y) * t,
        origin.z + (destination.z - origin.z) * t + lift
      );
    }
    this.arcPositions.needsUpdate = true;
  }
}
