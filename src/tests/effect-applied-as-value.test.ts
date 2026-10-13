import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { copyEffectValue } from '@/effects/copyEffectValue';

/**
 * Force Wave (k_sp1_generic) builds one EffectForcePushed and applies it to
 * every enemy in the shape. Applying the one instance to all of them pushed
 * one trooper of four; each target needs its own copy.
 */
describe('effects are applied as values', () => {
  class FakeEffect {
    type = 1; applied = false; durationEnded = false; object: any = undefined;
    intList: number[] = [0, 1]; floatList: number[] = [2.5]; creator: any = { id: 7 };
    effect1: FakeEffect | undefined; effect2: FakeEffect | undefined;
    getInt(i: number){ return this.intList[i]; }
  }
  const isEffect = (v: unknown) => v instanceof FakeEffect;

  test('a copy keeps the class and the state, but is unapplied and unattached', () => {
    const e = new FakeEffect(); e.applied = true; e.object = { id: 1 };
    const c = copyEffectValue(e, isEffect);
    expect(c).toBeInstanceOf(FakeEffect);
    expect(c).not.toBe(e);
    expect(c.getInt(1)).toBe(1);
    expect(c.creator).toBe(e.creator);
    expect(c.applied).toBe(false);
    expect(c.object).toBeUndefined();
  });

  test("a copy's lists are its own", () => {
    const e = new FakeEffect();
    const c = copyEffectValue(e, isEffect);
    c.floatList[0] = 9;
    expect(e.floatList[0]).toBe(2.5);
  });

  test("a link's children are copied too", () => {
    const link = new FakeEffect(); link.effect1 = new FakeEffect(); link.effect1.applied = true;
    const c = copyEffectValue(link, isEffect);
    expect(c.effect1).not.toBe(link.effect1);
    expect(c.effect1!.applied).toBe(false);
  });

  test('ApplyEffectToObject applies a copy of the script effect', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/nwscript/NWScriptDefK1.ts'), 'utf8');
    const at = src.indexOf('name: "ApplyEffectToObject"');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('\n  221:{', at));
    expect(body).toContain('args[1].clone()');
    const effect = fs.readFileSync(path.join(process.cwd(), 'src/effects/GameEffect.ts'), 'utf8');
    expect(effect).toContain('copyEffectValue(this,');
  });
});
