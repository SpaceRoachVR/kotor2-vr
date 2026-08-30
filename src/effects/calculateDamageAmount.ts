const DAMAGE_COMPONENT_COUNT = 15;
const MINIMUM_DAMAGE = 1;
const MAXIMUM_DAMAGE = 10_000;

export function calculateDamageAmount(components: readonly number[]): number {
  let total = 0;
  const componentCount = Math.min(components.length, DAMAGE_COMPONENT_COUNT);
  for(let index = 0; index < componentCount; index += 1){
    const value = components[index];
    if(Number.isFinite(value) && value > 0){
      total += value;
    }
  }
  return Math.min(Math.max(total, MINIMUM_DAMAGE), MAXIMUM_DAMAGE);
}
