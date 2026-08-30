/**
 * Moves every item stack from a placeable inventory into a destination.
 *
 * A stack is already a single inventory item with its quantity encoded in its
 * stack size. Calling the destination once per unit duplicates that quantity.
 */
export function transferPlaceableInventory<T>(inventory: T[], addItem: (item: T) => unknown): void {
  if (!Array.isArray(inventory)) {
    throw new TypeError('placeable inventory must be an array');
  }
  if (typeof addItem !== 'function') {
    throw new TypeError('placeable inventory destination must be a function');
  }

  while (inventory.length > 0) {
    const item = inventory[inventory.length - 1];
    addItem(item);
    inventory.pop();
  }
}
