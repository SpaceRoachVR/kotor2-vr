export type VRCombatIntentKind = "attack-feat" | "force-power";
export type VRCombatRequiredInput =
  | "dominant-swing"
  | "dominant-trigger"
  | "directional-force-gesture";

export interface VRCombatIntent {
  readonly sourceKey: string;
  readonly label: string;
  readonly icon: string;
  readonly kind: VRCombatIntentKind;
  readonly requiredInput: VRCombatRequiredInput;
  readonly weaponSignature: string;
}

export interface VRCombatIntentQueueSnapshot {
  readonly entries: readonly Readonly<VRCombatIntent>[];
}

export interface VRCombatIntentQueueEnqueueResult {
  readonly accepted: boolean;
  readonly reason?: "full";
  readonly snapshot: VRCombatIntentQueueSnapshot;
}

export interface VRCombatIntentQueueConsumeResult {
  readonly consumed?: Readonly<VRCombatIntent>;
  readonly snapshot: VRCombatIntentQueueSnapshot;
}

export type VRCombatIntentHeadStatus =
  | Readonly<{ state: "empty" }>
  | Readonly<{ state: "ready"; intent: Readonly<VRCombatIntent> }>
  | Readonly<{ state: "weapon-mismatch"; intent: Readonly<VRCombatIntent> }>
  | Readonly<{ state: "input-mismatch"; intent: Readonly<VRCombatIntent> }>;

export interface VRCombatIntentHeadStatusInput {
  readonly currentWeaponSignature: string;
  readonly input: VRCombatRequiredInput;
}

const MAXIMUM_ENTRIES = 3;
const REQUIRED_INPUTS = new Set<VRCombatRequiredInput>([
  "dominant-swing",
  "dominant-trigger",
  "directional-force-gesture",
]);
const KINDS = new Set<VRCombatIntentKind>(["attack-feat", "force-power"]);

/**
 * A presentation-only FIFO queue for the upcoming player-selected combat
 * actions. It deliberately has no engine dependency and cannot dispatch an
 * action on selection.
 */
export class VRCombatIntentQueue {
  private readonly entries: Readonly<VRCombatIntent>[] = [];

  enqueue(intent: Readonly<VRCombatIntent>): VRCombatIntentQueueEnqueueResult {
    const normalizedIntent = normalizeIntent(intent);
    if (this.entries.length >= MAXIMUM_ENTRIES) {
      return Object.freeze({
        accepted: false,
        reason: "full" as const,
        snapshot: this.getSnapshot(),
      });
    }

    this.entries.push(normalizedIntent);
    return Object.freeze({
      accepted: true,
      snapshot: this.getSnapshot(),
    });
  }

  getHead(): Readonly<VRCombatIntent> | undefined {
    return this.entries[0];
  }

  getHeadStatus(input: Readonly<VRCombatIntentHeadStatusInput>): VRCombatIntentHeadStatus {
    validateNonEmpty(input.currentWeaponSignature, "currentWeaponSignature");
    if (!REQUIRED_INPUTS.has(input.input)) {
      throw new RangeError("input must be a supported combat input.");
    }

    const intent = this.getHead();
    if (!intent) {
      return Object.freeze({ state: "empty" as const });
    }
    if (intent.weaponSignature !== "any" && intent.weaponSignature !== input.currentWeaponSignature) {
      return Object.freeze({ state: "weapon-mismatch" as const, intent });
    }
    if (intent.requiredInput !== input.input) {
      return Object.freeze({ state: "input-mismatch" as const, intent });
    }
    return Object.freeze({ state: "ready" as const, intent });
  }

  consumeHead(): VRCombatIntentQueueConsumeResult {
    const consumed = this.entries.shift();
    return Object.freeze({
      consumed,
      snapshot: this.getSnapshot(),
    });
  }

  clear(): VRCombatIntentQueueSnapshot {
    this.entries.splice(0, this.entries.length);
    return this.getSnapshot();
  }

  clearForWeaponChange(): VRCombatIntentQueueSnapshot {
    return this.clear();
  }

  getSnapshot(): VRCombatIntentQueueSnapshot {
    return Object.freeze({
      entries: Object.freeze([...this.entries]),
    });
  }
}

function normalizeIntent(intent: Readonly<VRCombatIntent>): Readonly<VRCombatIntent> {
  if (!intent || typeof intent !== "object") {
    throw new RangeError("intent must be an object.");
  }
  validateNonEmpty(intent.sourceKey, "sourceKey");
  validateNonEmpty(intent.label, "label");
  validateNonEmpty(intent.icon, "icon");
  validateNonEmpty(intent.weaponSignature, "weaponSignature");
  if (!KINDS.has(intent.kind)) {
    throw new RangeError("kind must be a supported combat intent kind.");
  }
  if (!REQUIRED_INPUTS.has(intent.requiredInput)) {
    throw new RangeError("requiredInput must be a supported combat input.");
  }

  return Object.freeze({
    sourceKey: intent.sourceKey,
    label: intent.label,
    icon: intent.icon,
    kind: intent.kind,
    requiredInput: intent.requiredInput,
    weaponSignature: intent.weaponSignature,
  });
}

function validateNonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RangeError(`${name} must be a non-empty string.`);
  }
}
