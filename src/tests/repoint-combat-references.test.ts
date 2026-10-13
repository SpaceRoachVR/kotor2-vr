import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { repointCombatReferences } from '@/combat/repointCombatReferences';
import { ActionParameterType } from '@/enums/actions/ActionParameterType';

const oldKreia = { id: 2147483640, name: 'old Kreia' };
const newKreia = { id: 2147483630, name: 'new Kreia' };
const exile = { id: 2147483646, name: 'Exile' };

function sith(target: unknown) {
  return {
    combatData: { lastAttackTarget: target, lastAttacker: target, lastDamager: exile } as Record<string, unknown>,
    combatRound: {
      action: { target },
      scheduledActionList: [{ target }, { target: exile }],
      newAttackTarget: undefined as unknown,
    },
    actionQueue: [
      { target: undefined as unknown, parameters: [
        { type: ActionParameterType.INT, value: 0 },
        { type: ActionParameterType.DWORD, value: (target as any).id },
      ] },
    ],
    openSpot: { owner: target },
  };
}

describe('combat references follow a rebuilt party member', () => {
  test('targets, attackers, round actions and queued attacks move to the new instance', () => {
    const a = sith(oldKreia);
    const b = sith(exile);
    const moved = repointCombatReferences([a, b, null], oldKreia, newKreia, oldKreia.id);
    expect(a.combatData.lastAttackTarget).toBe(newKreia);
    expect(a.combatData.lastAttacker).toBe(newKreia);
    expect(a.combatData.lastDamager).toBe(exile);
    expect(a.combatRound.action.target).toBe(newKreia);
    expect(a.combatRound.scheduledActionList[0].target).toBe(newKreia);
    expect(a.combatRound.scheduledActionList[1].target).toBe(exile);
    expect(a.actionQueue[0].parameters[1].value).toBe(newKreia.id);
    expect(a.actionQueue[0].parameters[0].value).toBe(0);
    expect(a.openSpot).toBeUndefined();
    // Someone fighting another member is untouched.
    expect(b.combatRound.action.target).toBe(exile);
    expect(b.actionQueue[0].parameters[1].value).toBe(exile.id);
    expect(moved).toBe(6);
  });

  test('nothing moves when the instance is the same', () => {
    const a = sith(oldKreia);
    expect(repointCombatReferences([a], oldKreia, oldKreia as any, oldKreia.id)).toBe(0);
    expect(a.combatRound.action.target).toBe(oldKreia);
  });
});

describe('PartyManager wiring', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/managers/PartyManager.ts'), 'utf8');

  test('a companion rebuilt by a leader switch takes over its old instance\'s references', () => {
    expect(source).toContain('PartyManager.RepointToReplacement(replacedCompanion, partyMember);');
    expect(source).toContain('PartyManager.RetiredInstances.set(outgoingNpcId, oldPC);');
    const restore = source.slice(source.indexOf('static async RestoreCompanion('), source.indexOf('static Save(){'));
    expect(restore).toContain('PartyManager.RepointToReplacement(PartyManager.RetiredInstances.get(npcId), companion);');
  });
});
