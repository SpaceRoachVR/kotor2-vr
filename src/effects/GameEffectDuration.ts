import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";
import type { GameEffect } from "@/effects/GameEffect";

/**
 * The part of the module calendar an effect's expiry is read from —
 * `ModuleTimeManager` in the running game.
 */
export interface EffectExpiryClock {
  getFutureTimeFromSeconds(seconds: number): { pauseDay: number; pauseTime: number };
}

type DurationCarrier = Pick<GameEffect,
  'getDurationType' | 'setDurationType' | 'duration' | 'setDuration' |
  'expireDay' | 'expireTime' | 'setExpireDay' | 'setExpireTime'
>;

/**
 * Gives an effect the duration it is being applied with, and an expiry when it
 * is TEMPORARY and has none yet.
 *
 * `GameEffect.update` only counts a TEMPORARY effect down once it carries an
 * expiry, and until now only `ApplyEffectToObject` stamped one. Every other
 * route — `addEffect(effect, TEMPORARY, seconds)`, a TEMPORARY effect built in
 * engine code, and every child of an EffectLink — produced an effect that
 * never ended. A security tunneler's "3 second" +6 Security stacked for good
 * in a headset run: 6 → 12 → 18 → 24 → 42 → 78.
 *
 * `type` and `duration` are only applied when passed, so `addEffect(effect)`
 * keeps whatever the effect was built with. An expiry that is already set is
 * never recomputed: `ApplyEffectToObject`, a loaded save and a parent effect
 * copying its own expiry onto a child have all fixed it already. A TEMPORARY
 * effect with no positive duration is left alone, as it was before.
 */
export function applyEffectDuration(
  effect: DurationCarrier,
  type?: GameEffectDurationType,
  duration?: number,
  clock?: EffectExpiryClock,
): void {
  if(type !== undefined){ effect.setDurationType(type); }
  if(duration !== undefined){ effect.setDuration(duration); }

  if(effect.getDurationType() != GameEffectDurationType.TEMPORARY){ return; }
  if(effect.expireDay || effect.expireTime){ return; }
  if(!(effect.duration > 0)){ return; }

  const expiry = clock?.getFutureTimeFromSeconds(effect.duration);
  if(!expiry){ return; }
  effect.setExpireDay(expiry.pauseDay);
  effect.setExpireTime(expiry.pauseTime);
}

/**
 * Copies a link's duration type, remaining duration and expiry onto one of its
 * children. A link is never attached itself — `addEffect` attaches its children
 * — so this is the only way the lifetime a script gave the link reaches the
 * effects that actually do something.
 */
export function inheritLinkDuration(link: DurationCarrier, child: DurationCarrier): void {
  child.setDurationType(link.getDurationType());
  child.setDuration(link.duration);
  child.setExpireDay(link.expireDay);
  child.setExpireTime(link.expireTime);
}
