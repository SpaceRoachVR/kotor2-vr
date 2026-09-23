import { expect, test, describe } from '@jest/globals';
import {
  parseFeatPrerequisites,
  isFeatPrerequisiteMet,
  type FeatPrerequisiteContext,
} from '@/talents/featPrerequisiteRules';
import { TalentFeat } from '@/talents/TalentFeat';

describe('featPrerequisiteRules', () => {
  describe('parseFeatPrerequisites', () => {
    test('parses camelCase and snake_case properties from 2DA row', () => {
      const row = {
        mincharlevel: '4',
        minattackbonus: '3',
        minstr: '13',
        mindex: '****',
        prereqfeat1: '11',
        prereqfeat2: '-1',
        orreqfeat0: '28',
        orreqfeat1: '31',
      };
      const parsed = parseFeatPrerequisites(row);
      expect(parsed.minCharLevel).toBe(4);
      expect(parsed.minAttackBonus).toBe(3);
      expect(parsed.minStr).toBe(13);
      expect(parsed.minDex).toBe(-1);
      expect(parsed.prereqFeat1).toBe(11);
      expect(parsed.prereqFeat2).toBe(-1);
      expect(parsed.orReqFeats).toEqual([28, 31]);
    });

    test('handles empty or malformed input with safe defaults', () => {
      const parsed = parseFeatPrerequisites(null);
      expect(parsed.minCharLevel).toBe(0);
      expect(parsed.prereqFeat1).toBe(-1);
      expect(parsed.prereqFeat2).toBe(-1);
      expect(parsed.orReqFeats).toEqual([]);
    });
  });

  describe('isFeatPrerequisiteMet', () => {
    const baseContext: FeatPrerequisiteContext = {
      characterLevel: 1,
      baseAttackBonus: 1,
      hasFeat: (id: number) => id === 11, // owns feat 11 (Flurry)
      attributes: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
      classListStatus: 0,
    };

    test('passes when all prerequisites are satisfied', () => {
      const feat = {
        minCharLevel: 1,
        prereqFeat1: 11,
        prereqFeat2: -1,
      };
      expect(isFeatPrerequisiteMet(feat, baseContext)).toBe(true);
    });

    test('fails when character level is below minCharLevel', () => {
      const improvedFlurry = {
        minCharLevel: 4,
        prereqFeat1: 11,
      };
      expect(isFeatPrerequisiteMet(improvedFlurry, { ...baseContext, characterLevel: 1 })).toBe(false);
      expect(isFeatPrerequisiteMet(improvedFlurry, { ...baseContext, characterLevel: 4 })).toBe(true);
    });

    test('fails when missing direct prerequisite feats', () => {
      const masterFlurry = {
        minCharLevel: 8,
        prereqFeat1: 91, // Improved Flurry
      };
      // Level 8 but lacks feat 91
      expect(isFeatPrerequisiteMet(masterFlurry, { ...baseContext, characterLevel: 8 })).toBe(false);

      // Level 8 and has feat 91
      const contextWithImpFlurry: FeatPrerequisiteContext = {
        ...baseContext,
        characterLevel: 8,
        hasFeat: (id: number) => id === 11 || id === 91,
      };
      expect(isFeatPrerequisiteMet(masterFlurry, contextWithImpFlurry)).toBe(true);
    });

    test('validates dual prerequisites (prereqFeat1 AND prereqFeat2)', () => {
      const dualFeat = {
        prereqFeat1: 10,
        prereqFeat2: 20,
      };
      expect(isFeatPrerequisiteMet(dualFeat, { ...baseContext, hasFeat: (id) => id === 10 })).toBe(false);
      expect(isFeatPrerequisiteMet(dualFeat, { ...baseContext, hasFeat: (id) => id === 20 })).toBe(false);
      expect(isFeatPrerequisiteMet(dualFeat, { ...baseContext, hasFeat: (id) => id === 10 || id === 20 })).toBe(true);
    });

    test('validates alternative prerequisites (orReqFeat)', () => {
      const orFeat = {
        orReqFeat0: 100,
        orReqFeat1: 101,
      };
      expect(isFeatPrerequisiteMet(orFeat, { ...baseContext, hasFeat: () => false })).toBe(false);
      expect(isFeatPrerequisiteMet(orFeat, { ...baseContext, hasFeat: (id) => id === 100 })).toBe(true);
      expect(isFeatPrerequisiteMet(orFeat, { ...baseContext, hasFeat: (id) => id === 101 })).toBe(true);
    });

    test('validates attribute requirements', () => {
      const strFeat = { minStr: 15 };
      expect(isFeatPrerequisiteMet(strFeat, baseContext)).toBe(false); // str 14 < 15
      expect(isFeatPrerequisiteMet(strFeat, { ...baseContext, attributes: { str: 16 } })).toBe(true);
    });

    test('validates classListStatus', () => {
      const feat = { minCharLevel: 1 };
      expect(isFeatPrerequisiteMet(feat, { ...baseContext, classListStatus: 0 })).toBe(true);
      expect(isFeatPrerequisiteMet(feat, { ...baseContext, classListStatus: 1 })).toBe(true);
      expect(isFeatPrerequisiteMet(feat, { ...baseContext, classListStatus: 3 })).toBe(false); // granted/non-selectable
      expect(isFeatPrerequisiteMet(feat, { ...baseContext, classListStatus: 4 })).toBe(false); // unavailable
    });
  });

  describe('TalentFeat stance penalties', () => {
    test('correctly calculates AC penalties for combat stances including Sniper Shot', () => {
      const flurry = new TalentFeat();
      flurry.id = 11;
      expect(flurry.getArmorClassPenalty()).toBe(4);

      const impFlurry = new TalentFeat();
      impFlurry.id = 91;
      expect(impFlurry.getArmorClassPenalty()).toBe(2);

      const masterFlurry = new TalentFeat();
      masterFlurry.id = 51;
      expect(masterFlurry.getArmorClassPenalty()).toBe(1);

      const critStrike = new TalentFeat();
      critStrike.id = 28;
      expect(critStrike.getArmorClassPenalty()).toBe(5);

      const sniperShot = new TalentFeat();
      sniperShot.id = 31;
      expect(sniperShot.getArmorClassPenalty()).toBe(5);

      const impSniperShot = new TalentFeat();
      impSniperShot.id = 20;
      expect(impSniperShot.getArmorClassPenalty()).toBe(5);

      const masterSniperShot = new TalentFeat();
      masterSniperShot.id = 77;
      expect(masterSniperShot.getArmorClassPenalty()).toBe(5);
    });

    test('correctly calculates attack penalties for combat stances', () => {
      const powerAttack = new TalentFeat();
      powerAttack.id = 8;
      expect(powerAttack.getAttackPenalty()).toBe(3);

      const impPowerAttack = new TalentFeat();
      impPowerAttack.id = 17;
      expect(impPowerAttack.getAttackPenalty()).toBe(3);

      const masterPowerAttack = new TalentFeat();
      masterPowerAttack.id = 83;
      expect(masterPowerAttack.getAttackPenalty()).toBe(3);

      const rapidShot = new TalentFeat();
      rapidShot.id = 30;
      expect(rapidShot.getAttackPenalty()).toBe(4);

      const impRapidShot = new TalentFeat();
      impRapidShot.id = 92;
      expect(impRapidShot.getAttackPenalty()).toBe(2);

      const masterRapidShot = new TalentFeat();
      masterRapidShot.id = 21;
      expect(masterRapidShot.getAttackPenalty()).toBe(1);
    });
  });
});
