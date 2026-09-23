import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

// ModuleObject reaches three's ESM examples and the NWScript VM at import
// time. None of that is on the addEffect path, so stub just enough to load it.
jest.mock('@/GameState', () => ({ GameState: {} }));
jest.mock('@/three/odyssey', () => ({ OdysseyModel3D: class {}, OdysseyObject3D: class {} }));
jest.mock('@/nwscript/NWScriptInstance', () => ({ NWScriptInstance: class {} }));
jest.mock('@/nwscript/NWScript', () => ({ NWScript: class {} }));
jest.mock('@/loaders', () => ({ MDLLoader: class {} }));
jest.mock('@/odyssey', () => ({ OdysseyModel: class {}, OdysseyModelAnimation: class {}, OdysseyWalkMesh: class {} }));

import { GameState } from '@/GameState';
import { ModuleObject } from '@/module/ModuleObject';
import { GameEffect } from '@/effects/GameEffect';
import { EffectLink } from '@/effects/EffectLink';
import { EffectACIncrease } from '@/effects/EffectACIncrease';
import { EffectAttackIncrease } from '@/effects/EffectAttackIncrease';
import { applyEffectDuration, inheritLinkDuration } from '@/effects/GameEffectDuration';
import { GameEffectDurationType } from '@/enums/effects/GameEffectDurationType';
import { ModuleObjectType } from '@/enums/module/ModuleObjectType';
import { TalentFeat } from '@/talents/TalentFeat';
import { CombatRound } from '@/combat/CombatRound';

const { INSTANT, TEMPORARY, PERMANENT } = GameEffectDurationType;

/** A calendar that starts at day 1, 1000 ms and hands out real future times. */
function clock() {
  return {
    getFutureTimeFromSeconds: jest.fn((seconds: number) => ({ pauseDay: 1, pauseTime: 1000 + seconds * 1000 })),
  };
}

function host(): ModuleObject {
  const object = Object.create(ModuleObject.prototype) as ModuleObject;
  object.effects = [];
  return object;
}

/** Runs the per-frame effect update the way ModuleCreature does. */
function advance(object: ModuleObject, seconds: number, step = 0.25): void {
  for(let t = 0; t < seconds; t += step){
    for(let i = 0; i < object.effects.length; i++){
      object.effects[i]?.update(step);
    }
  }
}

function acIncrease(amount = 1): EffectACIncrease {
  const effect = new EffectACIncrease();
  effect.setInt(1, amount);
  return effect;
}

let time: ReturnType<typeof clock>;

beforeEach(() => {
  time = clock();
  (GameState as any).module = { timeManager: time };
});

afterEach(() => {
  delete (GameState as any).module;
});

describe('addEffect with an EffectLink', () => {
  test('TEMPORARY children carry the link expiry and leave when it runs out', () => {
    const object = host();
    const a = acIncrease();
    const b = new EffectAttackIncrease();

    object.addEffect(new EffectLink(a, b), TEMPORARY, 3);

    expect(object.effects).toEqual([a, b]);
    for(const child of [a, b]){
      expect(child.getDurationType()).toBe(TEMPORARY);
      expect(child.duration).toBe(3);
      expect(child.expireDay).toBe(1);
      expect(child.expireTime).toBe(4000);
    }

    advance(object, 2.5);
    expect(object.effects).toEqual([a, b]);

    advance(object, 1.5);
    expect(object.effects).toEqual([]);
    expect(a.durationEnded && b.durationEnded).toBe(true);
  });

  test('the ApplyEffectToObject route is not stamped twice', () => {
    // What opcode 220 does before it calls addEffect: set the lifetime on the
    // effect it was given and stamp the expiry from the calendar itself.
    const object = host();
    const link = new EffectLink(acIncrease(), new EffectAttackIncrease());
    link.setDurationType(TEMPORARY);
    link.setDuration(3);
    link.setExpireDay(7);
    link.setExpireTime(123);

    object.addEffect(link, TEMPORARY, 3);

    expect(time.getFutureTimeFromSeconds).not.toHaveBeenCalled();
    for(const child of object.effects){
      expect(child.expireDay).toBe(7);
      expect(child.expireTime).toBe(123);
      expect(child.duration).toBe(3);
    }
    advance(object, 3.5);
    expect(object.effects).toEqual([]);
  });

  test('a PERMANENT link stays attached and never gains an expiry', () => {
    const object = host();
    const a = acIncrease();
    const b = new EffectAttackIncrease();

    object.addEffect(new EffectLink(a, b), PERMANENT, 0);
    advance(object, 600, 1);

    expect(object.effects).toEqual([a, b]);
    for(const child of [a, b]){
      expect(child.getDurationType()).toBe(PERMANENT);
      expect(child.expireDay).toBe(0);
      expect(child.expireTime).toBe(0);
    }
    expect(time.getFutureTimeFromSeconds).not.toHaveBeenCalled();
  });

  test('nested links hand the lifetime all the way down', () => {
    const object = host();
    const leaves = [acIncrease(1), acIncrease(2), new EffectAttackIncrease()];

    object.addEffect(new EffectLink(new EffectLink(leaves[0], leaves[1]), leaves[2]), TEMPORARY, 2);

    expect(object.effects).toEqual(leaves);
    expect(leaves.every((e) => e.expireTime === 3000)).toBe(true);
    advance(object, 2.5);
    expect(object.effects).toEqual([]);
  });

  test('a link applied without arguments passes on its own lifetime, not INSTANT', () => {
    const object = host();
    const a = acIncrease();
    const link = new EffectLink(a, undefined);
    link.setDurationType(PERMANENT);

    object.addEffect(link);

    expect(object.effects).toEqual([a]);
    expect(a.getDurationType()).toBe(PERMANENT);
  });
});

describe('addEffect with a plain effect', () => {
  test('applies the type and duration it is handed, and expires', () => {
    // The security tunneler shape: +6 Security "for 3 seconds" stacked for good.
    const object = host();
    const effect = acIncrease();

    object.addEffect(effect, TEMPORARY, 3);

    expect(effect.getDurationType()).toBe(TEMPORARY);
    expect(effect.expireTime).toBe(4000);
    advance(object, 3.5);
    expect(object.effects).toEqual([]);
  });

  test('an effect built TEMPORARY in engine code expires with no arguments', () => {
    // The TalentFeat penalty shape: lifetime set on the effect, addEffect(effect).
    const object = host();
    const effect = acIncrease();
    effect.setDurationType(TEMPORARY);
    effect.setDuration(3);

    object.addEffect(effect);

    expect(time.getFutureTimeFromSeconds).toHaveBeenCalledWith(3);
    advance(object, 3.5);
    expect(object.effects).toEqual([]);
  });

  test('omitted arguments keep the lifetime the effect was built with', () => {
    const object = host();
    const permanent = acIncrease();
    permanent.setDurationType(PERMANENT);

    object.addEffect(permanent);
    advance(object, 600, 1);

    expect(permanent.getDurationType()).toBe(PERMANENT);
    expect(object.effects).toEqual([permanent]);
  });

  test('INSTANT effects are not given an expiry', () => {
    const object = host();
    const effect = acIncrease();

    object.addEffect(effect, INSTANT);
    advance(object, 10, 1);

    expect(effect.getDurationType()).toBe(INSTANT);
    expect(effect.expireDay).toBe(0);
    expect(effect.expireTime).toBe(0);
    expect(object.effects).toEqual([effect]);
    expect(time.getFutureTimeFromSeconds).not.toHaveBeenCalled();
  });

  test('an effect loaded with an expiry keeps it', () => {
    const object = host();
    const effect = acIncrease();
    effect.setDurationType(TEMPORARY);
    effect.setDuration(1.5);
    effect.setExpireDay(3);
    effect.setExpireTime(99);

    object.addEffect(effect);

    expect(time.getFutureTimeFromSeconds).not.toHaveBeenCalled();
    expect(effect.expireDay).toBe(3);
    expect(effect.expireTime).toBe(99);
  });

  test('the expiry is in place before onApply, so spawned children inherit it', () => {
    // EffectPoison and EffectForceShield copy their own expiry onto the visual
    // and resistance effects they add from onApply.
    const object = host();
    const spawned = acIncrease();
    class Spawner extends GameEffect {
      onApply(){
        if(this.applied) return;
        super.onApply();
        spawned.setSubTypeUnMasked(this.getSubTypeUnMasked());
        spawned.setDuration(this.duration);
        spawned.setExpireDay(this.expireDay);
        spawned.setExpireTime(this.expireTime);
        this.object.addEffect(spawned);
      }
    }

    object.addEffect(new Spawner(), TEMPORARY, 3);

    expect(spawned.expireTime).toBe(4000);
    expect(time.getFutureTimeFromSeconds).toHaveBeenCalledTimes(1);
    advance(object, 3.5);
    expect(object.effects).toEqual([]);
  });

  test('a TEMPORARY effect with no duration is left as it was', () => {
    const object = host();
    const effect = acIncrease();

    object.addEffect(effect, TEMPORARY, 0);
    advance(object, 5, 1);

    expect(effect.expireTime).toBe(0);
    expect(object.effects).toEqual([effect]);
  });

  test('with no module loaded nothing throws and no expiry is invented', () => {
    delete (GameState as any).module;
    const object = host();
    const effect = acIncrease();

    expect(() => object.addEffect(effect, TEMPORARY, 3)).not.toThrow();
    expect(effect.expireTime).toBe(0);
  });
});

describe('ModuleObject.update with expiring effects', () => {
  test('a door or placeable survives the frame an effect expires on', () => {
    // Non-creature objects update effects inside ModuleObject.update, which
    // cached the array length; the expiring effect removed itself and the loop
    // then read past the end.
    const object = host() as any;
    object.deferEventUpdate = false;
    object.updateDestroy = (): void => undefined;
    object._heartbeatTimeout = 1e9;
    object.spawned = false;
    object.position = new THREE.Vector3();
    object.sphere = new THREE.Sphere();
    const a = acIncrease(1);
    const b = acIncrease(2);
    object.addEffect(a, TEMPORARY, 1);
    object.addEffect(b, PERMANENT);

    expect(() => {
      for(let frame = 0; frame < 12; frame++){ ModuleObject.prototype.update.call(object, 0.25); }
    }).not.toThrow();
    expect(object.effects).toEqual([b]);
  });
});

describe('feat penalties applied through addEffect', () => {
  test('a Flurry round penalty lasts one 3 second round, then leaves', () => {
    // CombatRound calls impactCaster every round a feat attack is used. The
    // penalty used to stay forever, and its duration was ROUND_LENGTH in ms.
    const object = host();
    object.objectType = ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature;
    const flurry = Object.create(TalentFeat.prototype) as TalentFeat;
    flurry.id = 11;

    flurry.impactCaster(object);
    flurry.impactCaster(object);

    expect(object.effects).toHaveLength(4);
    expect(object.effects.every((e) => e.duration === CombatRound.ROUND_LENGTH / 1000)).toBe(true);
    // An effect that removes itself shifts the next one into its slot, which
    // then misses that frame — as in ModuleCreature's loop — so allow a lap.
    advance(object, CombatRound.ROUND_LENGTH / 1000 + 1);
    expect(object.effects).toEqual([]);
  });
});

describe('GameEffectDuration helpers', () => {
  test('applyEffectDuration only overrides what it is given', () => {
    const effect = acIncrease();
    effect.setDurationType(PERMANENT);
    effect.setDuration(9);

    applyEffectDuration(effect, undefined, undefined, time);

    expect(effect.getDurationType()).toBe(PERMANENT);
    expect(effect.duration).toBe(9);
  });

  test('inheritLinkDuration copies type, duration and expiry', () => {
    const link = new EffectLink();
    link.setDurationType(TEMPORARY);
    link.setDuration(4);
    link.setExpireDay(2);
    link.setExpireTime(5000);
    const child = acIncrease();

    inheritLinkDuration(link, child);

    expect([child.getDurationType(), child.duration, child.expireDay, child.expireTime]).toEqual([TEMPORARY, 4, 2, 5000]);
  });
});
