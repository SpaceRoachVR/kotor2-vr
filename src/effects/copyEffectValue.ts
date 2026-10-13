/**
 * NWScript effects are values. A script builds one effect and applies it to
 * every creature in an area power's shape (k_sp1_generic's Force Wave applies
 * the same EffectForcePushed and EffectVisualEffect to each target), and each
 * target must get its own copy. The engine applied the one instance to every
 * target: an effect that has applied once skips onApply, and it is attached to
 * whichever object took it last, so Force Wave pushed only one of four
 * troopers and Stasis Field skipped one of four failed saves.
 *
 * Copies an effect's own state: arrays are copied, nested effects (an
 * EffectLink's children) are copied in turn, everything else is shared. The
 * copy is unapplied and unattached. Deliberately free of engine imports so it
 * can be tested without the world.
 */
export interface EffectStateLike {
  applied?: boolean;
  durationEnded?: boolean;
  object?: unknown;
}

export function copyEffectValue<T extends object>(effect: T, isEffect: (value: unknown) => boolean): T {
  const copy = Object.create(Object.getPrototypeOf(effect));
  for(const key of Object.keys(effect)){
    const value = (effect as any)[key];
    if(Array.isArray(value)){
      copy[key] = value.slice();
    }else if(value && typeof value === 'object' && isEffect(value)){
      copy[key] = copyEffectValue(value, isEffect);
    }else{
      copy[key] = value;
    }
  }
  const state = copy as EffectStateLike;
  state.applied = false;
  state.durationEnded = false;
  state.object = undefined;
  return copy;
}
