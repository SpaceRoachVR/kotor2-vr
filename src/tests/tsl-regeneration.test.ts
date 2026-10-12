import { describe, expect, test } from '@jest/globals';
import { readTSLRegenerationTable, tslForcePointsPerSecond, tslHitPointsPerTick } from '@/combat/TSLRegeneration';

// Critic run 12: TSL's regeneration.2da is key/value; read as K1's columns it
// gave NaN and nothing regenerated. Values are retail TSL's.
const retailRows = [
  ['timeperhp', '6.0'], ['outofcombathpbase', '1.0'], ['incombathpbase', '0.0'], ['conmodbonus', '0.3'],
  ['skillrankbonus', '0.1'], ['fpregentime', '90.0'], ['outofcombatfpbase', '1.0'], ['incombatfpbase', '0.1'],
  ['wismodbonus', '0.00'], ['roomforcebonus', '0.075'],
].map(([label, value], i) => ({ __index: i, __rowlabel: label, value }));

describe('TSL regeneration', () => {
  const table = readTSLRegenerationTable(retailRows)!;
  const exile = { constitutionModifier: 1, wisdomModifier: 2, treatInjuryRank: 4, maxForcePoints: 15 };

  test('reads TSL\'s key/value table, and not K1\'s column layout', () => {
    expect(table).toMatchObject({ timeperhp: 6, fpregentime: 90, outofcombatfpbase: 1, incombatfpbase: 0.1 });
    expect(readTSLRegenerationTable([{ __rowlabel: '0', forceregen: '1', healthregen: '1' }])).toBeNull();
  });

  test('out of combat: 1 + 0.3 per CON modifier + 0.1 per Treat Injury rank every 6 s', () => {
    expect(tslHitPointsPerTick(table, { ...exile, inCombat: false })).toBeCloseTo(1.7);
    expect(tslHitPointsPerTick(table, { ...exile, inCombat: true })).toBeCloseTo(0.7);
  });

  test('a spent Force pool refills in 90 s out of combat, a tenth as fast in combat', () => {
    expect(tslForcePointsPerSecond(table, { ...exile, inCombat: false }) * 90).toBeCloseTo(15);
    expect(tslForcePointsPerSecond(table, { ...exile, inCombat: true }) * 90).toBeCloseTo(1.5);
  });

  test('a negative modifier never drains', () => {
    expect(tslHitPointsPerTick(table, { ...exile, constitutionModifier: -5, treatInjuryRank: 0, inCombat: true })).toBe(0);
  });
});
