import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  capStructureCurrentHP,
  reduceDamageList,
  resolveStructureDamage,
} from '@/engine/interaction/StructureDamageRules';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const method = (source: string, signature: string) => {
  const at = source.indexOf(signature);
  expect(at).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf('\n  }\n', at));
};

/**
 * Round 9, "Plasma torch still does nothing". Measured in the emulator on the
 * Peragus Damaged Door (sw_door_taris008): HP 15, CurrentHP 45, Hardness 100.
 * Its a_plasmachk script, traced call by call with a torch-wielding attacker,
 * made exactly three calls — GetLastAttacker, GetLastWeaponUsed,
 * GetItemHasItemProperty(torch, 64) → 1 — and nothing else: it lets the torch's
 * damage through rather than opening the door itself.
 */
describe('StructureDamageRules', () => {
  test('hardness absorbs an ordinary weapon entirely', () => {
    expect(resolveStructureDamage({ damage: 9, hardness: 100, cutsThrough: false })).toBe(0);
  });

  test('a door-cutting weapon ignores hardness', () => {
    expect(resolveStructureDamage({ damage: 9, hardness: 100, cutsThrough: true })).toBe(9);
  });

  test('low hardness only takes its share', () => {
    expect(resolveStructureDamage({ damage: 9, hardness: 5, cutsThrough: false })).toBe(4);
  });

  test('current hit points are capped at the authored maximum', () => {
    expect(capStructureCurrentHP(45, 15)).toBe(15);
    expect(capStructureCurrentHP(10, 15)).toBe(10);
    expect(capStructureCurrentHP(45, 0)).toBe(45);
  });

  test('a damage list is reduced entry by entry and never below zero', () => {
    expect(reduceDamageList([-1, 3, 5, -1], 4)).toEqual([-1, 0, 4, -1]);
    expect(reduceDamageList([2, 2], 10)).toEqual([0, 0]);
  });
});

describe('engine wiring', () => {
  test('combat damage to doors and placeables goes through hardness first', () => {
    const body = method(read('src/combat/CombatAttackData.ts'), 'applyDamageEffectToCreature(owner: ModuleCreature, target: ModuleCreature){');
    expect(body.indexOf('this.applyStructureHardness(target)')).toBeLessThan(body.indexOf('new EffectDamage()'));
    expect(read('src/combat/CombatAttackData.ts')).toMatch(/ModuleItemProperty\.DoorCutting[\s\S]*ModuleItemProperty\.DoorSabering/);
  });

  test.each(['src/module/ModuleDoor.ts', 'src/module/ModulePlaceable.ts'])('%s caps current HP once HP is read', (file) => {
    const source = read(file);
    const hpAt = source.indexOf("this.hp = this.template.RootNode.getFieldByLabel('HP').getValue();");
    const capAt = source.indexOf('this.currentHP = capStructureCurrentHP(this.currentHP, this.hp);');
    expect(hpAt).toBeGreaterThan(-1);
    expect(capAt).toBeGreaterThan(hpAt);
  });

  test('TSL item properties include door cutting and sabering', () => {
    const source = read('src/enums/module/ModuleItemProperty.ts');
    expect(source).toContain('DoorCutting = 64');
    expect(source).toContain('DoorSabering = 65');
  });

  // Round 9: every class reads cls_atk_1, whose row 0 is level 1. Indexing by
  // level gave a level 1 droid +2 base attack and the Exile +2 as a Consular.
  test('class attack and defense tables are read with level 1 at row 0', () => {
    const source = read('src/combat/CreatureClass.ts');
    expect(source).toContain('this.attackBonuses[CreatureClass.levelRow(this.level, this.attackBonuses.length)]');
    expect(source).toContain('this.acbonuses[CreatureClass.levelRow(this.level, this.acbonuses.length)]');
    expect(source).toContain('const row = Math.floor(Number.isFinite(level) ? level : 1) - 1;');
  });

  test('attacks roll through the TSL attack rule', () => {
    const body = method(read('src/combat/CombatRound.ts'), 'calculateWeaponAttack(creature: ModuleCreature');
    expect(body).toContain('resolveAttackRoll({');
    expect(body).toContain('creature.getAttackBonusFor(weapon)');
    expect(body).not.toContain('attackRoll > combatAction.target.getAC()');
  });

  test('creatures add autobalance to defense, attack and saves, and spawn balanced', () => {
    const source = read('src/module/ModuleCreature.ts');
    expect(method(source, '  getAC(){')).toContain('this.getAutoBalanceBonuses().defenseBonus');
    expect(method(source, '  getAttackBonusFor(weapon?: ModuleItem): number {')).toContain('this.getAutoBalanceBonuses().attackBonus');
    expect(method(source, '  onSpawn(runScript = true){')).toContain('this.getAutoBalanceBonuses()');
    expect(source).toContain("hasField('MultiplierSet')");
    expect(source).toContain("'AutoBalanceLevel'");
  });

  test('damage applies the Mining Laser penalty and the autobalance damage multiplier', () => {
    const body = method(read('src/combat/CombatAttackData.ts'), 'calculateDamage(creature: ModuleCreature');
    expect(body).toContain('autoBalance.damageMultiplier');
    expect(body).toContain('this.attackWeapon.getDamagePenalty()');
    expect(body).toContain('strengthAddsToDamage(');
    expect(body).not.toContain('WeaponType.PIERCING');
  });

  test('saving throws meet the DC and add the autobalance bonus', () => {
    const source = read('src/module/ModuleObject.ts');
    for (const signature of ['fortitudeSave(nDC = 0', 'reflexSave(nDC = 0', 'willSave(nDC = 0']) {
      const body = method(source, signature);
      expect(body).toContain('this.getAutoBalanceSaveBonus()');
      expect(body).toContain('>= nDC');
    }
  });
});
