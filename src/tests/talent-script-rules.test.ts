import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { pickBestTalent, pickRandomTalent, talentScriptType, TALENT_TYPE_FEAT, TALENT_TYPE_FORCE, TALENT_TYPE_SKILL } from '@/talents/talentScriptRules';
import { TalentObjectType } from '@/enums/engine/TalentObjectType';

/**
 * The retail party AI (k_inc_generic) picks a talent with
 * GetCreatureTalentBest, then checks GetCreatureHasTalent and
 * GetTypeFromTalent before ActionUseTalentOnObject. GetCreatureHasTalent
 * compared engine flag values against TALENT_TYPE_* and was never true, so
 * Kreia and Visas only ever swung (Korriban: 0 talents used in 30 s).
 */
describe('NWScript talent rules', () => {
  const spell = TalentObjectType.TalentObject | TalentObjectType.TalentSpell;
  const feat = TalentObjectType.TalentObject | TalentObjectType.TalentFeat;
  const skill = TalentObjectType.TalentObject | TalentObjectType.TalentSkill;

  test('a talent reports its TALENT_TYPE_*', () => {
    expect(talentScriptType({ objectType: spell })).toBe(TALENT_TYPE_FORCE);
    expect(talentScriptType({ objectType: feat })).toBe(TALENT_TYPE_FEAT);
    expect(talentScriptType({ objectType: skill })).toBe(TALENT_TYPE_SKILL);
    expect(talentScriptType(undefined)).toBe(-1);
  });

  const talents = [
    { id: 28, objectType: feat, category: 0x1104, maxCR: 4 },
    { id: 11, objectType: feat, category: 0x1104, maxCR: 12 },
    { id: 29, objectType: feat, category: 0x1104, maxCR: 25 },
    { id: 23, objectType: spell, category: 0x1101, maxCR: 8 },
  ];

  test('the best talent is the highest CR not over the limit', () => {
    expect(pickBestTalent(talents, 0x1104, 20)?.id).toBe(11);
    expect(pickBestTalent(talents, 0x1104, 3)).toBeUndefined();
    expect(pickBestTalent(talents, 0x1101, 20)?.id).toBe(23);
  });

  test('excluded talents are skipped', () => {
    expect(pickBestTalent(talents, 0x1104, 20, TALENT_TYPE_FEAT, 11)?.id).toBe(28);
    expect(pickBestTalent(talents, 0x1104, 20, TALENT_TYPE_FEAT, -1)).toBeUndefined();
    expect(pickBestTalent(talents, 0x1104, 20, TALENT_TYPE_FORCE, -1)?.id).toBe(11);
  });

  test('a random talent comes from the category only, never category-0 skills', () => {
    const withSkills = [...talents, { id: 2, objectType: skill, category: 0, maxCR: 0 }, { id: 5, objectType: skill, category: 0, maxCR: 0 }];
    for(const r of [0, 0.34, 0.67, 0.99]){
      const t = pickRandomTalent(withSkills, 0x1104, () => r);
      expect(t && t.category).toBe(0x1104);
    }
    expect(pickRandomTalent(withSkills, 0x2222)).toBeUndefined();
  });

  test('the engine routes use them', () => {
    const creature = fs.readFileSync(path.join(process.cwd(), 'src/module/ModuleCreature.ts'), 'utf8');
    const has = creature.slice(creature.indexOf('  hasTalent(talent: TalentObject){'), creature.indexOf('  getTalents(){'));
    expect(has).toContain('talentScriptType(talent)');
    const use = creature.slice(creature.indexOf('  useTalent(talent: TalentObject, oTarget: ModuleObject): Action {'), creature.indexOf('  setAnimationState('));
    expect(use).toContain('switch(talentScriptType(talent))');
    expect(use).toContain('(talent as TalentSpell).useTalentOnObject(oTarget, this)');
    expect(use).toContain('(talent as TalentFeat).useTalentOnObject(oTarget, this)');
    expect(creature).toContain('pickRandomTalent(this.getTalents(), category)');
    expect(creature).toContain('pickBestTalent(this.getTalents(), nCategory, nCRMax, nExcludeType, nExcludeId)');
    const k1 = fs.readFileSync(path.join(process.cwd(), 'src/nwscript/NWScriptDefK1.ts'), 'utf8');
    const at = k1.indexOf('name: "GetTypeFromTalent"');
    expect(k1.slice(at, at + 600)).toContain('talentScriptType(args[0])');
  });
});
