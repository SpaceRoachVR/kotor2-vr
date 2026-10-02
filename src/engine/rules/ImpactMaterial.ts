import { BitWise } from "@/utility/BitWise";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { GameEffectType } from "@/enums/effects/GameEffectType";

/**
 * Which weaponsounds.2da column a blow on a target uses.
 *
 * weaponsounds.2da has an impact sound per struck material: cloth, leather,
 * armor, force field, metal, wood, stone. The engine played "leather" for
 * every hit, so a vibroblade on a mining droid sounded like it cut skin
 * (critic run 6). baseitems.2da rows (retail TSL): 35-37 Jedi robes, 38-43
 * armour classes 4-9.
 */
export type ImpactMaterial = 'cloth' | 'leather' | 'armor' | 'forceField' | 'metal' | 'wood' | 'stone';

export interface ImpactTarget {
  /** racialtypes row; 5 is droid. */
  readonly race?: number;
  /** Worn body armour's baseitems row, if any. */
  readonly armorBaseItemId?: number;
  /** A placeable (container, door, terminal): metal on Peragus. */
  readonly isPlaceable?: boolean;
  /** An energy shield is up. */
  readonly shielded?: boolean;
}

const DROID_RACE = 5;

export function resolveImpactMaterial(target: ImpactTarget): ImpactMaterial {
  if (target.shielded) return 'forceField';
  if (target.isPlaceable) return 'metal';
  if (target.race === DROID_RACE) return 'metal';
  const armor = Number(target.armorBaseItemId);
  if (armor >= 38 && armor <= 43) return 'armor';
  if (armor >= 35 && armor <= 37) return 'cloth';
  return 'leather';
}

/** The weaponsounds row's sound for a material, falling back to leather. */
export function impactResRef(
  sounds: { readonly [key: string]: unknown } | null | undefined,
  material: ImpactMaterial,
  variant = 0,
): string {
  if (!sounds) return '';
  const pick = (base: string) => String(sounds[`${base}${variant}`] || sounds[`${base}0`] || '');
  return pick(material) || pick('leather');
}

/** The weaponsounds material of whatever was struck (ImpactMaterial). */
export function resolveVRImpactMaterialFor(target: any): ImpactMaterial {
  if (!target) return 'leather';
  try {
    return resolveImpactMaterial({
      race: typeof target.getRace === 'function' ? target.getRace() : undefined,
      armorBaseItemId: target.equipment?.ARMOR?.getBaseItemId?.(),
      isPlaceable: BitWise.InstanceOfObject(target, ModuleObjectType.ModulePlaceable) || BitWise.InstanceOfObject(target, ModuleObjectType.ModuleDoor),
      shielded: typeof target.hasEffect === 'function' && target.hasEffect(GameEffectType.EffectForceShield),
    });
  } catch {
    return 'leather';
  }
}
