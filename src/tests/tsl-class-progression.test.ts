import { describe, expect, test } from '@jest/globals';
import { CreatureClass } from '@/combat/CreatureClass';
import { readGrantedFeatLevel, readFeatClassColumn } from '@/talents/featClassColumns';

/**
 * Authoritative retail TSL class data extracted from classes.2da.
 */
interface RetailClassSpec {
  id: number;
  code: string;
  label: string;
  hitdie: number;
  forcedie: number;
  skillpointbase: number;
  spellcaster: boolean;
  featgain: string;
  spellgaintable: string;
  savingthrowtable: string;
  armorclasscolumn: string;
}

const RETAIL_CLASSES: Record<number, RetailClassSpec> = {
  0: { id: 0, code: 'sol', label: 'Soldier', hitdie: 10, forcedie: 0, skillpointbase: 1, spellcaster: false, featgain: 'SOL', spellgaintable: '', savingthrowtable: 'CLS_ST_SOLDIER', armorclasscolumn: 'SOL' },
  1: { id: 1, code: 'sct', label: 'Scout', hitdie: 8, forcedie: 0, skillpointbase: 3, spellcaster: false, featgain: 'SCT', spellgaintable: '', savingthrowtable: 'CLS_ST_SCOUT', armorclasscolumn: 'SCT' },
  2: { id: 2, code: 'scd', label: 'Scoundrel', hitdie: 6, forcedie: 0, skillpointbase: 4, spellcaster: false, featgain: 'SCD', spellgaintable: '', savingthrowtable: 'CLS_ST_SCNDRL', armorclasscolumn: 'SCD' },
  3: { id: 3, code: 'jgd', label: 'JediGuardian', hitdie: 10, forcedie: 4, skillpointbase: 1, spellcaster: true, featgain: 'JGD', spellgaintable: 'JGD', savingthrowtable: 'CLS_ST_JEDI_G', armorclasscolumn: 'JDG' },
  4: { id: 4, code: 'jcn', label: 'JediConsular', hitdie: 6, forcedie: 8, skillpointbase: 2, spellcaster: true, featgain: 'JCN', spellgaintable: 'JCN', savingthrowtable: 'CLS_ST_JEDI_C', armorclasscolumn: 'JDC' },
  5: { id: 5, code: 'jsn', label: 'JediSentinel', hitdie: 8, forcedie: 6, skillpointbase: 3, spellcaster: true, featgain: 'JSN', spellgaintable: 'JSN', savingthrowtable: 'CLS_ST_JEDI_S', armorclasscolumn: 'JDS' },
  6: { id: 6, code: 'drc', label: 'CombatDroid', hitdie: 12, forcedie: 0, skillpointbase: 1, spellcaster: false, featgain: 'DRC', spellgaintable: '', savingthrowtable: 'CLS_ST_CM_DRD', armorclasscolumn: 'SCD' },
  7: { id: 7, code: 'drx', label: 'ExpertDroid', hitdie: 8, forcedie: 0, skillpointbase: 1, spellcaster: false, featgain: 'DRX', spellgaintable: '', savingthrowtable: 'CLS_ST_EX_DRD', armorclasscolumn: 'SCD' },
  9: { id: 9, code: 'tec', label: 'TechSpecialist', hitdie: 6, forcedie: 0, skillpointbase: 4, spellcaster: false, featgain: 'TEC', spellgaintable: '', savingthrowtable: 'CLS_ST_TECHSPEC', armorclasscolumn: 'TEC' },
  11: { id: 11, code: 'jwm', label: 'JediWeaponmaster', hitdie: 10, forcedie: 6, skillpointbase: 1, spellcaster: true, featgain: 'JWM', spellgaintable: 'JWM', savingthrowtable: 'CLS_ST_JWEAPMAS', armorclasscolumn: 'JWM' },
  12: { id: 12, code: 'jma', label: 'JediMaster', hitdie: 6, forcedie: 10, skillpointbase: 2, spellcaster: true, featgain: 'JMA', spellgaintable: 'JMA', savingthrowtable: 'CLS_ST_JMASTER', armorclasscolumn: 'JMA' },
  13: { id: 13, code: 'jwa', label: 'JediWatchman', hitdie: 8, forcedie: 8, skillpointbase: 3, spellcaster: true, featgain: 'JWA', spellgaintable: 'JWA', savingthrowtable: 'CLS_ST_JWATCH', armorclasscolumn: 'JWA' },
  14: { id: 14, code: 'sma', label: 'SithMarauder', hitdie: 10, forcedie: 6, skillpointbase: 1, spellcaster: true, featgain: 'SMA', spellgaintable: 'SMA', savingthrowtable: 'CLS_ST_SITHMAR', armorclasscolumn: 'SMA' },
  15: { id: 15, code: 'sld', label: 'SithLord', hitdie: 6, forcedie: 10, skillpointbase: 2, spellcaster: true, featgain: 'SLD', spellgaintable: 'SLD', savingthrowtable: 'CLS_ST_SITHLORD', armorclasscolumn: 'SLD' },
  16: { id: 16, code: 'sas', label: 'SithAssassin', hitdie: 8, forcedie: 8, skillpointbase: 3, spellcaster: true, featgain: 'SAS', spellgaintable: 'SAS', savingthrowtable: 'CLS_ST_SITHASS', armorclasscolumn: 'SAS' },
};

describe('TSL classes 2DA specification alignment', () => {
  test('all 15 active TSL classes have correct hit die and force die', () => {
    for (const spec of Object.values(RETAIL_CLASSES)) {
      const cls = new CreatureClass();
      cls.apply2DA({
        __index: spec.id,
        label: spec.label,
        hitdie: String(spec.hitdie),
        forcedie: String(spec.forcedie),
        skillpointbase: String(spec.skillpointbase),
        spellcaster: spec.spellcaster ? '1' : '0',
        featgain: spec.featgain,
        spellgaintable: spec.spellgaintable || '****',
        savingthrowtable: spec.savingthrowtable,
        armorclasscolumn: spec.armorclasscolumn,
      });

      expect(cls.hitdie).toBe(spec.hitdie);
      expect(cls.forcedie).toBe(spec.forcedie);
      expect(cls.skillpointbase).toBe(spec.skillpointbase);
      expect(cls.spellcaster).toBe(spec.spellcaster);
      expect(cls.savingthrowtable).toBe(spec.savingthrowtable);
      expect(cls.armorclasscolumn).toBe(spec.armorclasscolumn);
    }
  });

  test('saving throw getters return level-appropriate saves from parsed tables', () => {
    const cls = new CreatureClass();
    cls.level = 3;
    cls.savingThrows = [
      { index: 0, level: 1, fortsave: 2, refsave: 0, willsave: 0 } as any,
      { index: 1, level: 2, fortsave: 3, refsave: 0, willsave: 0 } as any,
      { index: 2, level: 3, fortsave: 3, refsave: 1, willsave: 1 } as any,
    ];

    expect(cls.getFortitudeSave()).toBe(3);
    expect(cls.getReflexSave()).toBe(1);
    expect(cls.getWillSave()).toBe(1);
  });

  test('player character Jedi classes receive PC-granted starting feats', () => {
    // Force Chain (feat 205) is only granted to player character Jedi at level 1
    const forceChainRow = {
      label: 'FORCE_CHAIN',
      jgd_pc_granted: 1,
      jcn_pc_granted: 1,
      jsn_pc_granted: 1,
      jgd_granted: -1,
      jcn_granted: -1,
      jsn_granted: -1,
    };

    // When isPlayerCharacter is false, regular granted level (-1) is returned
    expect(readGrantedFeatLevel(forceChainRow, 'JGD', false)).toBe(-1);
    expect(readGrantedFeatLevel(forceChainRow, 'JCN', false)).toBe(-1);
    expect(readGrantedFeatLevel(forceChainRow, 'JSN', false)).toBe(-1);

    // When isPlayerCharacter is true, PC granted level (1) is returned
    expect(readGrantedFeatLevel(forceChainRow, 'JGD', true)).toBe(1);
    expect(readGrantedFeatLevel(forceChainRow, 'JCN', true)).toBe(1);
    expect(readGrantedFeatLevel(forceChainRow, 'JSN', true)).toBe(1);
  });

  test('PC-granted feats fallback to regular granted when pc_granted is absent or -1', () => {
    // Unarmed Specialist I (feat 212) has regular granted=2 and pc_granted absent
    const unarmedSpecRow = {
      label: 'UNARMED_SPECIALIST_I',
      jgd_granted: 2,
      jcn_granted: 2,
      jsn_granted: 2,
    };

    expect(readGrantedFeatLevel(unarmedSpecRow, 'JGD', false)).toBe(2);
    expect(readGrantedFeatLevel(unarmedSpecRow, 'JGD', true)).toBe(2);
  });
});
