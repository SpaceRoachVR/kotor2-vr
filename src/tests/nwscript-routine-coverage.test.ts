import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Routine coverage, pinned to the routines TSL's own scripts actually call.
 *
 * Decoding every compiled script in the retail install (5,120 of them) with
 * PyKotor's NCS reader and counting ACTION instructions gave a usage-weighted
 * list: 83 unimplemented routines were being called. This batch covers the most
 * used of them (556 script-uses).
 *
 * Parsed from source: importing the tables pulls in the whole engine.
 */
const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function parseTable(source: string): Map<number, { name: string; implemented: boolean }> {
  const out = new Map<number, { name: string; implemented: boolean }>();
  const starts = [...source.matchAll(/\n {2}(\d+)\s*:\s*\{/g)];
  starts.forEach((match, i) => {
    const from = match.index as number;
    const to = i + 1 < starts.length ? (starts[i + 1].index as number) : source.length;
    const body = source.slice(from, to);
    const name = body.match(/name:\s*['"]([^'"]+)['"]/);
    out.set(Number(match[1]), { name: name ? name[1] : '?', implemented: /action:\s*(async\s+)?function/.test(body) });
  });
  return out;
}

const k1 = parseTable(read('nwscript/NWScriptDefK1.ts'));
const k2 = parseTable(read('nwscript/NWScriptDefK2.ts'));
const isImplemented = (id: number): boolean => {
  const tsl = k2.get(id);
  if (!tsl) return false;
  if (tsl.implemented) return true;
  const base = k1.get(id);
  return !!base && base.implemented && base.name === tsl.name;
};

// id -> name, so a table renumbering fails here rather than silently passing.
const COVERED: [number, string][] = [
  [139, 'GetAbilityScore'], [700, 'ActionBarkString'], [784, 'GetSpellAcquired'],
  [786, 'GrantFeat'], [787, 'GrantSpell'], [791, 'SetFakeCombatState'],
  [794, 'SetOrientOnClick'], [802, 'AddBonusForcePoints'], [810, 'IsStealthed'],
  [819, 'SetKeepStealthInDialog'], [833, 'AdjustCreatureAttributes'],
  [834, 'SetCreatureAILevel'], [835, 'ResetCreatureAILevel'], [841, 'GetPUPOwner'],
  [842, 'GetIsPuppet'], [850, 'ChangeObjectAppearance'], [853, 'ActionSwitchWeapons'],
  [856, 'DisableMap'], [858, 'DisableHealthRegen'], [862, 'SetForceAlwaysUpdate'],
  [869, 'AdjustCreatureSkills'], [870, 'GetSkillRankBase'], [872, 'GetCombatActionsPending'],
  // 2026-09-22 batch, read off the DeNCS-decompiled retail callers.
  [144, 'AngleToVector'], [386, 'SetMapPinEnabled'], [389, 'AddMultiClass'],
  [553, 'FaceObjectAwayFromObject'], [822, 'ForceHeartbeat'], [868, 'RemoveEffectByExactMatch'],
];

describe('routine coverage', () => {
  test.each(COVERED)('%i %s is implemented', (id, name) => {
    expect(k2.get(id)?.name).toBe(name);
    expect(isImplemented(id)).toBe(true);
  });

  test('overall TSL coverage does not regress', () => {
    const implemented = [...k2.keys()].filter(isImplemented).length;
    expect(implemented).toBeGreaterThanOrEqual(628);
  });
});

describe('what the implementations reach for', () => {
  const creature = read('module/ModuleCreature.ts');

  test('ability and skill helpers exist on the creature', () => {
    for (const method of ['getAbilityScoreByIndex', 'adjustAbilityScore', 'getSkillRankBase',
      'adjustSkillRank', 'grantSpell', 'swapWeaponSets']) {
      expect(creature).toContain(`${method}(`);
    }
  });

  test('DisableHealthRegen actually gates vitality regeneration', () => {
    expect(creature).toContain('!isNaN(regen_health) && !GameState.healthRegenDisabled');
    // Force regeneration is a separate branch and must not be gated.
    expect(creature).toContain('if(!isNaN(regen_force)){');
  });

  test('the module-wide flags live on GameState', () => {
    const state = read('GameState.ts');
    for (const flag of ['healthRegenDisabled', 'mapDisabled', 'keepStealthInDialog']) {
      expect(state).toContain(`static ${flag}: boolean = false;`);
    }
  });
});
