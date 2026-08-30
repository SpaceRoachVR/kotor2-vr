export interface XRLayerDimensions {
  width: number;
  height: number;
}

interface XRLayerDimensionSource {
  framebufferWidth?: unknown;
  framebufferHeight?: unknown;
  textureWidth?: unknown;
  textureHeight?: unknown;
}

/** Normalize dimensions from legacy XRWebGLLayer and WebXR Layers projection layers. */
export function resolveXRLayerDimensions(layer: XRLayerDimensionSource): XRLayerDimensions {
  if (!layer || typeof layer !== 'object') {
    throw new RangeError('XR layer must be an object');
  }
  const usesFramebufferDimensions =
    layer.framebufferWidth !== undefined || layer.framebufferHeight !== undefined;
  const width = usesFramebufferDimensions ? layer.framebufferWidth : layer.textureWidth;
  const height = usesFramebufferDimensions ? layer.framebufferHeight : layer.textureHeight;
  if (!Number.isInteger(width) || Number(width) <= 0) {
    throw new RangeError('XR layer width must be a positive integer');
  }
  if (!Number.isInteger(height) || Number(height) <= 0) {
    throw new RangeError('XR layer height must be a positive integer');
  }
  return { width: Number(width), height: Number(height) };
}
