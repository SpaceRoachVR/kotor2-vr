import { ModuleTriggerType } from "@/enums/module/ModuleTriggerType";

export interface TriggerFiringState {
  readonly type: ModuleTriggerType | number;
  /** Set once the trigger has fired its enter event at least once. */
  readonly triggered: boolean;
  /** A trap that springs only once. */
  readonly trapOneShot: boolean;
}

/**
 * Whether a trigger may fire OnEnter for an object that has just come inside.
 *
 * Only a one-shot trap latches after its first firing. Every other trigger
 * fires OnEnter each time an object enters. `triggered` used to gate every
 * trigger, which also meant OnExit never ran (it was gated on `!triggered`):
 * 102PER's HotSteam vents set a local on enter, damage the PC on every
 * heartbeat while it is set, and clear it on exit - so every vent the Exile
 * had ever crossed kept hurting them from anywhere in the module, in bursts
 * of 20-30 HP.
 */
export function canTriggerFireEnter(state: TriggerFiringState): boolean {
  if (state.type === ModuleTriggerType.TRAP) {
    return !(state.triggered && state.trapOneShot);
  }
  return true;
}

/**
 * Whether a trigger may fire OnExit for an object that has just left. Exits
 * are never latched: a trap that has sprung still reports the object leaving.
 */
export function canTriggerFireExit(_state: TriggerFiringState): boolean {
  return true;
}
