import { beforeEach, describe, expect, jest, test } from '@jest/globals';

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
import { EffectLink } from '@/effects/EffectLink';
import { EffectACIncrease } from '@/effects/EffectACIncrease';
import { EffectAttackIncrease } from '@/effects/EffectAttackIncrease';
import { GameEffectDurationType } from '@/enums/effects/GameEffectDurationType';
import { forcePushDirection } from '@/effects/forcePushDirection';

/**
 * Parity with retail k_sp1_generic's area powers on a group of four: the
 * script builds each effect once and applies it to every enemy that failed
 * its save. Four failed saves must leave four applied effects, one on each
 * target, each attached to its own target, and each thrown straight away
 * from the caster (Force Wave on Korriban: 4 failed Reflex saves, 1 pushed).
 */
describe('an area power on four targets', () => {
  beforeEach(() => {
    (GameState as any).module = { timeManager: { getFutureTimeFromSeconds: (s: number) => ({ pauseDay: 1, pauseTime: 1000 + s * 1000 }) } };
  });

  const host = (): ModuleObject => {
    const object = Object.create(ModuleObject.prototype) as ModuleObject;
    object.effects = [];
    return object;
  };

  test('one script effect applied to four failed saves gives four applied effects', () => {
    const targets = [host(), host(), host(), host()];
    // What the script holds: one effect (here a link, like Stasis Field's).
    const scriptEffect = new EffectLink(new EffectACIncrease(), new EffectAttackIncrease());
    for(const target of targets){
      // ApplyEffectToObject: a copy per target.
      const applied = scriptEffect.clone();
      applied.setDurationType(GameEffectDurationType.TEMPORARY);
      applied.setDuration(6);
      target.addEffect(applied, GameEffectDurationType.TEMPORARY, 6);
    }
    for(const target of targets){
      expect(target.effects).toHaveLength(2);
      for(const effect of target.effects){
        expect(effect.applied).toBe(true);
        expect(effect.object).toBe(target);
      }
    }
    const all = targets.flatMap((t) => t.effects);
    expect(new Set(all).size).toBe(8);
    expect(scriptEffect.applied).toBe(false);
  });

  test('each of four targets around the caster is thrown about 5 m straight away from it', () => {
    const caster = { x: 0, y: 0 };
    const ring = [{ x: 3, y: 0 }, { x: 0, y: 3 }, { x: -2.1, y: 2.1 }, { x: 1, y: -2.8 }];
    for(const t of ring){
      // A target facing the caster's companion behind it (facing 0, +y).
      const [dx, dy] = forcePushDirection(t, caster, 0);
      const landed = { x: t.x + dx * 5, y: t.y + dy * 5 };
      const before = Math.hypot(t.x, t.y);
      expect(Math.hypot(landed.x, landed.y) - before).toBeCloseTo(5, 5);
    }
  });
});
