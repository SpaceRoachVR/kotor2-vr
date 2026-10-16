import { describe, expect, test } from '@jest/globals';
import {
  parseColourTable, isColourCrystal, modelVariationFor, colourCrystalFor,
} from '@/game/tsl/crafting/ColourCrystals';

const ROWS: [string, string, string, string, string][] = [
  ['BLUE', 'u_l_colo_01', 'g_w_shortsbr01', 'g_w_lghtsbr01', 'G_W_DBLSBR001'],
  ['GOLD', 'u_l_colo_03', 'g_w_shortsbr04', 'g_w_lghtsbr04', 'G_W_DBLSBR004'],
  ['GREEN', 'u_l_colo_02', 'g_w_shortsbr03', 'g_w_lghtsbr03', 'G_W_DBLSBR003'],
  ['VIOLET', 'u_l_colo_05', 'g_w_shortsbr05', 'g_w_lghtsbr05', 'G_W_DBLSBR005'],
  ['RED', 'u_l_colo_04', 'g_w_shortsbr02', 'g_w_lghtsbr02', 'G_W_DBLSBR002'],
  ['Heart', 'G1_W_SBRCRSTL20', 'g1_w_shortsbr01', 'g1_w_lghtsbr01', 'G1_W_DBLSBR001'],
  ['Mantle', 'G1_W_SBRCRSTL21', 'g1_w_shortsbr02', 'g1_w_lghtsbr02', 'G1_W_DBLSBR002'],
  ['Bronze', 'u_l_colo_10', 'g_w_shortsbr07', 'g_w_lghtsbr07', 'g_w_dblsbr007'],
  ['Orange', 'u_l_colo_08', 'g_w_shortsbr08', 'g_w_lghtsbr08', 'g_w_dblsbr008'],
  ['Silver', 'u_l_colo_07', 'g_w_shortsbr09', 'g_w_lghtsbr09', 'g_w_dblsbr009'],
  ['White', 'u_l_colo_06', 'g_w_shortsbr10', 'g_w_lghtsbr10', 'g_w_dblsbr010'],
  ['Viridian', 'u_l_colo_09', 'g_w_shortsbr11', 'g_w_lghtsbr11', 'g_w_dblsbr011'],
  ['Visas', 'u_l_colo_x01', 'w_sls_x01', 'w_ls_x01', 'w_dls_x01'],
  ['Freedon', 'u_l_colo_x02', 'w_sls_x02', 'w_ls_x02', 'w_dls_x02'],
];

function fixture(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  ROWS.forEach(([label, template, shortmdlvar, longmdlvar, doublemdlvar], i) => {
    out[String(i)] = { label, template, shortmdlvar, longmdlvar, doublemdlvar };
  });
  return out;
}

// Variations per the spec: long Blue 1, Red 2, Green 3, Yellow 4, Violet 5, Orange 7,
// Cyan 8, Viridian 9, Silver 10, Bronze 11; short Orange 6.
const VARIATIONS: Record<string, number> = {
  g_w_lghtsbr01: 1, g_w_lghtsbr02: 2, g_w_lghtsbr03: 3, g_w_lghtsbr04: 4, g_w_lghtsbr05: 5,
  g_w_lghtsbr07: 11, g_w_lghtsbr08: 7, g_w_lghtsbr09: 10, g_w_lghtsbr10: 8, g_w_lghtsbr11: 9,
  g_w_shortsbr08: 6,
};
const variationOf = (template: string) => VARIATIONS[template];

describe('ColourCrystals', () => {
  const table = parseColourTable(fixture());
  test('keeps only u_l_colo_ rows, lower-cased, in row order', () => {
    expect(table).toHaveLength(12);
    expect(table.map(r => r.crystal)).toEqual([
      'u_l_colo_01', 'u_l_colo_03', 'u_l_colo_02', 'u_l_colo_05', 'u_l_colo_04',
      'u_l_colo_10', 'u_l_colo_08', 'u_l_colo_07', 'u_l_colo_06', 'u_l_colo_09',
      'u_l_colo_x01', 'u_l_colo_x02',
    ]);
    expect(table[0].templates).toEqual({ long: 'g_w_lghtsbr01', short: 'g_w_shortsbr01', double: 'g_w_dblsbr001' });
  });
  test('row order is numeric, not lexical', () => {
    const rows = fixture();
    const shuffled: Record<string, Record<string, string>> = { 10: rows['10'], 2: rows['2'], 9: rows['9'] };
    expect(parseColourTable(shuffled).map(r => r.crystal)).toEqual(['u_l_colo_02', 'u_l_colo_07', 'u_l_colo_06']);
  });
  test('empty template cells map to an empty string', () => {
    const t = parseColourTable({ 0: { label: 'X', template: 'u_l_colo_01', shortmdlvar: '****', longmdlvar: 'g_w_lghtsbr01', doublemdlvar: '' } });
    expect(t[0].templates).toEqual({ long: 'g_w_lghtsbr01', short: '', double: '' });
    expect(modelVariationFor(t, 'u_l_colo_01', 'short', variationOf)).toBeUndefined();
  });
  test('isColourCrystal', () => {
    expect(isColourCrystal(table, 'U_L_COLO_04')).toBe(true);
    expect(isColourCrystal(table, 'u_l_crys_02')).toBe(false);
  });
  test('modelVariationFor', () => {
    expect(modelVariationFor(table, 'u_l_colo_08', 'long', variationOf)).toBe(7);
    expect(modelVariationFor(table, 'u_l_colo_08', 'short', variationOf)).toBe(6);
    expect(modelVariationFor(table, 'u_l_colo_x01', 'long', variationOf)).toBeUndefined();
    expect(modelVariationFor(table, 'u_l_crys_02', 'long', variationOf)).toBeUndefined();
  });
  test('colourCrystalFor', () => {
    expect(colourCrystalFor(table, 'long', 2, variationOf)).toBe('u_l_colo_04');
    expect(colourCrystalFor(table, 'long', 6, variationOf)).toBeUndefined();
    expect(colourCrystalFor(table, 'short', 6, variationOf)).toBe('u_l_colo_08');
  });
});
