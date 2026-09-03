import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `ItemProperty.save()` encodes "no upgrade required" as `UpgradeType = 255`
 * (`this.upgradeType == -1 ? 255 : this.upgradeType`), but the load path read
 * the value raw. The round trip was therefore asymmetric: a property saved as
 * -1 came back as 255.
 *
 * `isUseable()` then computed `1 << 255`. JavaScript masks shift counts to five
 * bits, so that is `1 << 31` — a value that never matches `upgrades` — and the
 * property answered **unusable**. Every item property goes inert once it has
 * been through a savegame: armour, attack, damage, the ability bonuses, and the
 * security tunneler's ThievesTools bonus in `ActionUnlockObject`.
 *
 * It hides in a fresh game because the retail templates omit `UpgradeType`
 * entirely and the class default of -1 applies. Reported from a headset
 * session: after a save/load the tunneler read `upgradeType=255, useable=false`
 * and the combat-training Metal Box (DC 33) failed at the unaided total of 29.
 *
 * Source-level because ItemProperty's constructor reaches GameState.SWRuleSet,
 * TwoDAManager and TLKManager — the whole engine graph.
 */
const SOURCE = 'src/engine/ItemProperty.ts';
const contents = fs.readFileSync(path.join(process.cwd(), SOURCE), 'utf8');

/** Mirrors ItemProperty.decodeSentinelByte. */
function decodeSentinelByte(value: unknown): number {
  if (!Number.isInteger(value as number)) return -1;
  return (value as number) === 255 ? -1 : (value as number);
}

/** Mirrors ItemProperty.isUseable's arithmetic for a given upgradeType. */
function isUseable(upgradeType: number, upgrades = 0): boolean {
  if (!Number.isInteger(upgradeType) || upgradeType < 0) return true;
  const flag = 1 << upgradeType;
  return (upgrades & flag) === flag;
}

describe('the UpgradeType sentinel round trip', () => {
  test('255 decodes back to -1, matching what save() wrote', () => {
    expect(decodeSentinelByte(255)).toBe(-1);
  });

  test('a real upgrade type is untouched', () => {
    expect(decodeSentinelByte(0)).toBe(0);
    expect(decodeSentinelByte(3)).toBe(3);
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['a non-integer', 1.5],
    ['a string', '255'],
  ])('%s falls back to "no upgrade required"', (_name, value) => {
    expect(decodeSentinelByte(value)).toBe(-1);
  });

  test('save() still encodes -1 as 255, so the decode is its exact inverse', () => {
    expect(contents).toMatch(/'UpgradeType'\s*\)\s*\)?\s*\??\.setValue\(\s*this\.upgradeType == -1 \? 255 :/);
  });

  test('the load path decodes rather than taking the raw value', () => {
    const at = contents.indexOf("hasField('UpgradeType')");
    const assignment = contents.slice(at, at + 220);
    expect(assignment).toContain('decodeSentinelByte');
  });
});

/**
 * The arithmetic the fix exists to prevent, pinned so the shift is not
 * "simplified" back into place.
 */
describe('the original arithmetic', () => {
  test('an undecoded 255 made the property unusable', () => {
    expect(isUseable(255)).toBe(false);
  });

  test('JavaScript masks the shift to five bits, so 255 behaves as 31', () => {
    expect(1 << 255).toBe(1 << 31);
  });

  test('the decoded value is usable', () => {
    expect(isUseable(decodeSentinelByte(255))).toBe(true);
  });

  // The fresh-game case that masked the defect for so long.
  test('an absent UpgradeType was already usable via the class default', () => {
    expect(isUseable(-1)).toBe(true);
  });
});

/**
 * The security tunneler is the reported casualty: ActionUnlockObject skips any
 * property that is not useable, so the ThievesTools bonus never reached the
 * roll.
 */
describe('the tunneler against the authored Peragus locks', () => {
  // T3-M4: Security 6, Intelligence 16 (+3), take 20 outside combat.
  const unaided = 20 + 3 + 6;

  test('the unaided total is 29 and loses to the Metal Box DC 33', () => {
    expect(unaided).toBe(29);
    expect(unaided > 33).toBe(false);
  });

  test('a skipped property contributes nothing, which is what was observed', () => {
    const bonus = isUseable(255) ? 6 : 0;
    expect(bonus).toBe(0);
    expect(unaided + bonus > 33).toBe(false);
  });

  // The live tunneler read costValue/value 6.
  test('the decoded property contributes its value and clears the lock', () => {
    const bonus = isUseable(decodeSentinelByte(255)) ? 6 : 0;
    expect(bonus).toBe(6);
    expect(unaided + bonus > 33).toBe(true);
  });
});
