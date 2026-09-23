import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { calculateDamageAmount } from '@/effects/calculateDamageAmount';
import { DamageType } from '@/enums/combat/DamageType';

describe('EffectDamage damage totals', () => {
  test('sums every positive damage-type component', () => {
    const components = new Array<number>(21).fill(-1);
    components[DamageType.BLUDGEONING] = 7;
    components[DamageType.FIRE] = 4;
    components[DamageType.BASE] = 3;
    components[DamageType.PHYSICAL] = 2;

    expect(calculateDamageAmount(components)).toBe(16);
  });

  test('ignores unset and non-positive component slots', () => {
    const components = new Array<number>(21).fill(-1);
    components[DamageType.PIERCING] = 5;
    components[DamageType.COLD] = 0;
    components[DamageType.ION] = -10;

    expect(calculateDamageAmount(components)).toBe(5);
  });

  test('preserves the engine minimum and maximum damage bounds', () => {
    expect(calculateDamageAmount(new Array<number>(21).fill(-1))).toBe(1);

    const components = new Array<number>(21).fill(-1);
    components[DamageType.UNIVERSAL] = 9_000;
    components[DamageType.ENERGY] = 4_000;
    expect(calculateDamageAmount(components)).toBe(10_000);
  });

  test('ignores non-finite values and non-damage metadata slots', () => {
    const components = new Array<number>(21).fill(-1);
    components[DamageType.ACID] = Number.NaN;
    components[DamageType.SONIC] = Number.POSITIVE_INFINITY;
    components[17] = 50_000;

    expect(calculateDamageAmount(components)).toBe(1);
  });
});

/**
 * Every combat hit reaches a creature as an INSTANT EffectDamage
 * (`CombatAttackData.applyDamageEffectToCreature`), and this effect was the one
 * damage path that never notified the object it damaged — `damage()` on both
 * ModuleObject and ModuleCreature call `onDamaged()`, and combat uses neither.
 *
 * Measured in a headset session against the Ebon Hawk training droids:
 * `subtractHP` fired 54 times while `onDamaged` fired 0 times, no script
 * instance was created and no signal was delivered — which is why their
 * `k_def_damage01` never signalled the user-defined event that lifts Min1HP.
 *
 * Scanned rather than executed: `GameEffect` imports `GameState` at module
 * scope, so loading the class here would mean reproducing the twenty-mock
 * isolateModules harness the VR suite uses, for one assertion.
 */
describe('EffectDamage notifies the object it damaged', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'effects', 'EffectDamage.ts'), 'utf8',
  );
  // The comments in that method discuss `onDamaged` and `lastDamager` at
  // length, so a scan of the raw text would pass even if the call were deleted.
  // Strip comments and assert against code alone.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  test('runs the damaged object OnDamaged script', () => {
    const at = code.indexOf('onApply()');
    expect(at).toBeGreaterThan(-1);
    const body = code.slice(at);
    expect(body).toContain('this.object.subtractHP(');
    expect(body).toContain('this.object.onDamaged()');
  });

  test('records the damager before running the script, so GetLastDamager resolves', () => {
    const damagerAt = code.indexOf('combatData.lastDamager');
    const notifyAt = code.indexOf('this.object.onDamaged()');
    expect(damagerAt).toBeGreaterThan(-1);
    expect(notifyAt).toBeGreaterThan(damagerAt);
  });

  test('a faulting script cannot unwind damage that was already applied', () => {
    const at = code.indexOf('this.object.onDamaged()');
    expect(at).toBeGreaterThan(-1);
    // The call is wrapped, so a broken authored script costs the notification
    // and not the hit that caused it.
    expect(code.slice(0, at)).toMatch(/try\s*\{[^}]*$/);
  });
});
