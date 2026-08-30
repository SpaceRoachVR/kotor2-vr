/**
 * Synchronizes a door walkmesh across the engine's collision registries.
 *
 * Doors are saved by logical open state, while the scene, area, and global
 * walkmesh collections are reconstructed during module load. Keeping these
 * collections synchronized prevents an open saved door from remaining a
 * physical/pathfinding barrier after a load.
 */
export interface DoorWalkmeshCollisionState<Mesh, Walkmesh extends { mesh?: Mesh }> {
  isPassable: boolean;
  walkmesh: Walkmesh | undefined;
  roomWalkmeshes: { add(mesh: Mesh): unknown; remove(mesh: Mesh): unknown } | undefined;
  doorWalkmeshes: Walkmesh[] | undefined;
  walkmeshList: Mesh[] | undefined;
}

function removeAll<T>(items: T[], value: T): void {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index] === value) items.splice(index, 1);
  }
}

function addOnce<T>(items: T[], value: T): void {
  if (!items.includes(value)) items.push(value);
}

export function synchronizeDoorWalkmeshCollisionState<Mesh, Walkmesh extends { mesh?: Mesh }>(
  state: DoorWalkmeshCollisionState<Mesh, Walkmesh>,
): void {
  const { walkmesh, roomWalkmeshes, doorWalkmeshes, walkmeshList, isPassable } = state;
  const mesh = walkmesh?.mesh;
  if (!walkmesh || !mesh) return;

  if (isPassable) {
    roomWalkmeshes?.remove(mesh);
    if (doorWalkmeshes) removeAll(doorWalkmeshes, walkmesh);
    if (walkmeshList) removeAll(walkmeshList, mesh);
    return;
  }

  roomWalkmeshes?.add(mesh);
  if (doorWalkmeshes) addOnce(doorWalkmeshes, walkmesh);
  if (walkmeshList) addOnce(walkmeshList, mesh);
}
