/** itempropdef.2da rows for the two blaster-bolt deflection properties. */
const DEFLECT_INCREASE = 55; // Blaster_Bolt_Deflect_Increase, cost table IPRP_BONUSCOST ("1".."10")
const DEFLECT_DECREASE = 56; // Blaster_Bolt_Defect_Decrease, cost table IPRP_NEG10COST ("-1".."-10")

export interface DeflectionPropertyInput {
  readonly propertyName: number;
  /** ItemProperty.isUseable(): false for K1 UpgradeType-gated leftovers. */
  readonly useable: boolean;
  /** The cost-table row's `value` column, parsed; undefined when the row is missing. */
  readonly rowValue: number | undefined;
  readonly costValue: number;
}

/**
 * An item's blaster-bolt deflection modifier from its properties (lightsaber
 * lenses, emitters and crystals: Kunda lens +1/+2, Byrothsis lens -2..-4,
 * Jenruax +5, ...). Increases add and decreases subtract, whatever sign the
 * cost table stores; several properties add up, as retail turns each one into
 * its own deflection effect and those effects stack. Pure, so it can be
 * tested without the engine; ModuleItem gathers the inputs.
 */
export function itemDeflectionBonus(properties: readonly DeflectionPropertyInput[]): number {
  let bonus = 0;
  for (const property of properties) {
    if (!property.useable) continue;
    if (property.propertyName !== DEFLECT_INCREASE && property.propertyName !== DEFLECT_DECREASE) continue;
    const magnitude = Number.isFinite(property.rowValue)
      ? Math.abs(property.rowValue as number)
      : Math.max(0, property.costValue || 0);
    bonus += property.propertyName === DEFLECT_INCREASE ? magnitude : -magnitude;
  }
  return bonus;
}
