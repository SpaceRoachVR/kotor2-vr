export interface VRArmedGrenadeDescriptor {
  readonly sourceKey: string;
  readonly itemObjectId: number;
  readonly label: string;
  readonly icon: string;
}

export interface VRArmedGrenadeSnapshot {
  readonly armed?: Readonly<VRArmedGrenadeDescriptor>;
}

export type VRArmedGrenadeCommitRequest =
  | Readonly<{ state: "empty" }>
  | Readonly<{ state: "armed"; grenade: Readonly<VRArmedGrenadeDescriptor> }>;

export interface VRArmedGrenadeCommitResult {
  readonly sourceKey: string;
  readonly engineAccepted: boolean;
}

/**
 * Holds the one grenade selected for an off-hand throw. The state never owns a
 * target, an engine object, or an inventory mutation; those are revalidated by
 * the engine integration immediately before and after the off-hand trigger.
 */
export class VRArmedGrenadeState {
  private armed: Readonly<VRArmedGrenadeDescriptor> | undefined;

  arm(descriptor: Readonly<VRArmedGrenadeDescriptor>): VRArmedGrenadeSnapshot {
    this.armed = normalizeDescriptor(descriptor);
    return this.getSnapshot();
  }

  requestCommit(): VRArmedGrenadeCommitRequest {
    if (!this.armed) {
      return Object.freeze({ state: "empty" as const });
    }
    return Object.freeze({ state: "armed" as const, grenade: this.armed });
  }

  completeCommit(result: Readonly<VRArmedGrenadeCommitResult>): VRArmedGrenadeSnapshot {
    validateNonEmpty(result?.sourceKey, "sourceKey");
    if (typeof result.engineAccepted !== "boolean") {
      throw new TypeError("engineAccepted must be a boolean.");
    }
    if (result.engineAccepted && this.armed?.sourceKey === result.sourceKey) {
      this.armed = undefined;
    }
    return this.getSnapshot();
  }

  cancel(): VRArmedGrenadeSnapshot {
    this.armed = undefined;
    return this.getSnapshot();
  }

  getSnapshot(): VRArmedGrenadeSnapshot {
    return Object.freeze({ armed: this.armed });
  }
}

function normalizeDescriptor(descriptor: Readonly<VRArmedGrenadeDescriptor>): Readonly<VRArmedGrenadeDescriptor> {
  if (!descriptor || typeof descriptor !== "object") {
    throw new TypeError("A grenade descriptor is required.");
  }
  validateNonEmpty(descriptor.sourceKey, "sourceKey");
  validateNonEmpty(descriptor.label, "label");
  validateNonEmpty(descriptor.icon, "icon");
  if (!Number.isSafeInteger(descriptor.itemObjectId) || descriptor.itemObjectId < 0) {
    throw new RangeError("itemObjectId must be a non-negative safe integer.");
  }
  return Object.freeze({
    sourceKey: descriptor.sourceKey,
    itemObjectId: descriptor.itemObjectId,
    label: descriptor.label,
    icon: descriptor.icon,
  });
}

function validateNonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RangeError(`${name} must be a non-empty string.`);
  }
}
