import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Retail revives a downed party member at the end of the battle (dialog.tlk
 * 41883). The engine read "the battle is over" as "nobody standing in the
 * party is in combat", so a companion not yet engaged let the Exile get up at
 * 1 HP 3 s after going down while the Sith was still swinging at the party.
 */
describe('a downed party member stays down while the party is still being fought', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/module/ModuleCreature.ts'), 'utf8');
  const body = source.slice(source.indexOf('  updateDownedPartyMember(delta = 0){'), source.indexOf('  /** Fractional Force points carried between frames'));

  test('a hostile attacking a party member keeps the battle on', () => {
    expect(body).toContain('(this.area?.creatures ?? []).some((creature) => isFightingParty(creature, party))');
    const rule = source.slice(source.indexOf('function isFightingParty('), source.indexOf('function isKnockoutEligible('));
    expect(rule).toContain("if(creature.combatData?.combatState !== true) return false;");
    expect(rule).toContain('party.includes(creature.combatRound?.action?.target)');
    expect(rule).toContain('party.includes(creature.combatData?.lastAttackTarget)');
    // Between two targets: hostile to a party member nearby still counts.
    expect(rule).toContain("typeof creature.isHostile === 'function' && creature.isHostile(member) &&");
    expect(source).toContain('const PARTY_BATTLE_RANGE_METRES = 20;');
  });
});
