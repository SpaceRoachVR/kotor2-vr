import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `ItemProperty.isUseable()` gates every property an item grants — armour,
 * attack, damage, Disguise, all six ability bonuses, and the security
 * tunneler's ThievesTools bonus.
 *
 * `UpgradeType` is an optional K2 upgrade-system field that most retail
 * templates omit; both security tunnelers (`g_i_secspike01`, `g_i_secspike02`)
 * omit it. Left undefined it computed `1 << undefined` === 1, compared that
 * against `upgrades` (0), and answered false — so every property on such a
 * template read as unusable and silently granted nothing. The tell was
 * `ActionSetMine`, which had the same check commented out with no explanation.
 *
 * The class default is the fix; the guard in isUseable is belt-and-braces for a
 * template carrying a non-numeric value.
 *
 * Source-level because ItemProperty's constructor reaches GameState.SWRuleSet,
 * TwoDAManager and TLKManager — the whole engine graph — while the defect is a
 * missing default and a shift.
 */
const SOURCE = 'src/engine/ItemProperty.ts';
const contents = fs.readFileSync(path.join(process.cwd(), SOURCE), 'utf8');

describe('an absent UpgradeType does not disable an item property', () => {
  test('upgradeType defaults to "no upgrade required"', () => {
    expect(contents).toMatch(/upgradeType\s*:\s*number\s*=\s*-1\s*;/);
  });

  test('isUseable answers true before shifting by a non-upgrade value', () => {
    const body = contents.slice(contents.search(/isUseable\(\)\s*\{/));
    const method = body.slice(0, body.indexOf('\n  }'));
    // The guard must come before the shift, or the shift decides the answer.
    const guard = method.search(/Number\.isInteger\(this\.upgradeType\)/);
    const shift = method.search(/1\s*<<\s*this\.upgradeType/);
    expect(guard).toBeGreaterThan(-1);
    expect(shift).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(shift);
  });
});

/**
 * The arithmetic the fix exists to prevent, pinned so nobody reintroduces it by
 * "simplifying" the guard away.
 */
describe('the original arithmetic', () => {
  test('an undefined upgradeType made every property unusable', () => {
    const upgradeType = undefined as unknown as number;
    const upgrades = 0;
    const flag = 1 << (upgradeType as number);
    expect(flag).toBe(1);
    expect(upgradeType == -1).toBe(false);
    expect((upgrades & flag) === flag).toBe(false);
  });

  test('-1 is the value that makes it usable', () => {
    const upgradeType = -1;
    expect(Number.isInteger(upgradeType) && upgradeType < 0).toBe(true);
  });
});
