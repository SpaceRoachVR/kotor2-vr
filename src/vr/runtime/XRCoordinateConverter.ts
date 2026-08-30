import * as THREE from 'three';

/**
 * The single coordinate-system boundary between WebXR and KOTOR world space.
 *
 * WebXR is right-handed and Y-up. KOTOR is right-handed and Z-up. Rotating
 * +90 degrees around X maps `(x, y, z)` to `(x, -z, y)`. Callers receive new
 * values so tracked poses owned by the browser are never mutated.
 */
export class XRCoordinateConverter {
  private static readonly xrToGameBasis = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
    .normalize();

  private static readonly gameToXRBasis = XRCoordinateConverter.xrToGameBasis
    .clone()
    .invert();

  static xrPositionToGame(position: THREE.Vector3): THREE.Vector3 {
    return position.clone().applyQuaternion(XRCoordinateConverter.xrToGameBasis);
  }

  static gamePositionToXR(position: THREE.Vector3): THREE.Vector3 {
    return position.clone().applyQuaternion(XRCoordinateConverter.gameToXRBasis);
  }

  static xrOrientationToGame(orientation: THREE.Quaternion): THREE.Quaternion {
    return XRCoordinateConverter.xrToGameBasis
      .clone()
      .multiply(orientation)
      .normalize();
  }

  static gameOrientationToXR(orientation: THREE.Quaternion): THREE.Quaternion {
    return XRCoordinateConverter.gameToXRBasis
      .clone()
      .multiply(orientation)
      .normalize();
  }

  static applyXRToGameBasis(object: THREE.Object3D): void {
    object.quaternion.copy(XRCoordinateConverter.xrToGameBasis);
  }
}
