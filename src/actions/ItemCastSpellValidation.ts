export interface ItemCastSpellPropertySource {
  isUseable(): boolean;
  is(propertyType: number): boolean;
  getValue(): unknown;
}

export interface ItemCastSpellSourceItem {
  properties?: readonly ItemCastSpellPropertySource[];
}

export interface ItemCastSpellSourceValidationInput {
  sourceItem: unknown;
  requestedSpellId: unknown;
  isOwnedByCaster(sourceItem: unknown): boolean;
  castSpellPropertyType: number;
}

/**
 * Confirms that a queued item cast still refers to a usable property on an
 * item the caster currently owns. The action queue can outlive inventory and
 * target changes, so this check is intentionally repeated at dispatch.
 */
export function isItemCastSpellSourceUsable(
  input: Readonly<ItemCastSpellSourceValidationInput>,
): boolean {
  if (!input || typeof input !== "object") {
    return false;
  }
  if (!Number.isSafeInteger(input.requestedSpellId) || (input.requestedSpellId as number) < 0) {
    return false;
  }
  if (!Number.isSafeInteger(input.castSpellPropertyType)) {
    return false;
  }
  if (!input.sourceItem || typeof input.sourceItem !== "object") {
    return false;
  }

  try {
    if (typeof input.isOwnedByCaster !== "function" || !input.isOwnedByCaster(input.sourceItem)) {
      return false;
    }

    const properties = (input.sourceItem as ItemCastSpellSourceItem).properties;
    if (!Array.isArray(properties)) {
      return false;
    }

    return properties.some((property) =>
      !!property &&
      typeof property.isUseable === "function" &&
      typeof property.is === "function" &&
      typeof property.getValue === "function" &&
      property.isUseable() &&
      property.is(input.castSpellPropertyType) &&
      property.getValue() === input.requestedSpellId,
    );
  } catch {
    return false;
  }
}
