/**
 * Whether a model's mesh node is drawn at all.
 *
 * A trimesh whose diffuse texture is empty or "NULL" is not drawn by the
 * retail engine. In rooms those nodes are occluders and shadow casters, not
 * surfaces: the Ebon Hawk lounge (001ebo15 `Line01`, render flag set, bitmap
 * NULL) has one behind its cockpit monitors, and drawing it as plain diffuse
 * geometry put flat grey-white panes wherever the monitors failed to draw.
 * reone's MeshSceneNode::shouldRender has the same rule: render flag set, not
 * an AABB, and a non-empty diffuse map.
 *
 * A texture override is the exception. Creature models such as n_duros and
 * n_mandalorian leave their body parts' bitmap NULL and take the texture from
 * appearance.2da, so a NULL node with an override is drawn with the override.
 */
export function isMeshTextureNull(textureName: string | null | undefined): boolean {
  if (typeof textureName !== 'string') return true;
  const name = textureName.trim().toLowerCase();
  return name === '' || name === 'null';
}

export interface MeshRenderNode {
  readonly flagRender: boolean;
  readonly textureMap1: string | null | undefined;
}

export function shouldDrawMeshNode(
  node: MeshRenderNode,
  isAabb: boolean,
  textureOverride?: string | null,
): boolean {
  if (isAabb) return true; // walkmesh debug geometry has its own visibility
  if (!node.flagRender) return false;
  if (!isMeshTextureNull(node.textureMap1)) return true;
  return !isMeshTextureNull(textureOverride);
}
