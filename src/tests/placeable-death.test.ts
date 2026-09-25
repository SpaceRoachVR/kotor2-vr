import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * A placeable reaching zero HP never ran its OnDeath script: 105PER's
 * invisible turbolift console sat at 15 HP under the PC's scripted attack
 * and a_turbo105per never unlocked the turbolift. ModulePlaceable pulls in
 * GameState, so this pins the source.
 */
describe('placeable death', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'module', 'ModulePlaceable.ts'), 'utf8');
  const subtract = source.slice(source.indexOf('  subtractHP(value = 0){'), source.indexOf('  onDeath(){'));
  const death = source.slice(source.indexOf('  onDeath(){'), source.indexOf('  destroy(): void {'));

  test('a plot placeable is immune and Min1HP stops at one hit point', () => {
    expect(subtract).toContain('if(this.plot){ return; }');
    expect(subtract).toContain('Math.max(0, this.getHP() - 1)');
  });

  test('crossing to dead runs the OnDeath script exactly once', () => {
    expect(subtract).toContain('if(!wasDead && this.isDead())');
    expect(death).toContain('if(this.deathHandled){ return; }');
    expect(death).toContain('ModuleObjectScript.PlaceableOnDeath');
    expect(death).toContain('instance.run(this)');
  });

  test('a hit runs the placeable\'s OnMeleeAttacked script, a spell its OnSpellCastAt', () => {
    const attacked = source.slice(source.indexOf('  onAttacked(attackType: CombatActionType){'), source.indexOf('  subtractHP(value = 0){'));
    expect(attacked).toContain('ModuleObjectScript.PlaceableOnMeleeAttacked');
    expect(attacked).toContain('ModuleObjectScript.PlaceableOnSpellCastAt');
    expect(attacked).toContain('instance.run(this)');
  });

  test('a scripted ActionAttack is remembered on the caller until the target dies', () => {
    const routines = fs.readFileSync(path.join(__dirname, '..', 'nwscript', 'NWScriptDefK1.ts'), 'utf8');
    const start = routines.indexOf('name: "ActionAttack"');
    const body = routines.slice(start, routines.indexOf('name: "GetNearestCreature"', start));
    expect(body).toContain('caller.combatData.scriptedAttackTarget = target');
    const creature = fs.readFileSync(path.join(__dirname, '..', 'module', 'ModuleCreature.ts'), 'utf8');
    expect(creature).toContain('scriptedAttackPending: !!scripted');
  });
});
