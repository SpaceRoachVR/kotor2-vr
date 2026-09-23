import { describe, expect, test } from '@jest/globals';
import { SWHead } from '@/engine/rules/SWHead';
import { SWCreatureAppearance } from '@/engine/rules/SWCreatureAppearance';

describe('SWHead texture resolution', () => {
  test('returns empty string for neutral NPC head with alttexture ****', () => {
    const head = SWHead.From2DA({
      __index: '96',
      head: 'P_AttonH',
      alttexture: '****',
      headtexvvve: 'P_AttnH1D2',
      headtexvve: 'P_AttnH1D1',
      headtexve: 'P_AttnH1D1',
      headtexe: 'P_AttnH1D1',
      headtexg: '****',
      headtexvg: '****',
    });

    // Neutral alignment (50) should not return 'p_attonh' (the model geometry);
    // it should return '' so the head model retains its embedded authored texture (p_attnh1).
    expect(head.getTextureGoodEvil(50)).toBe('');
    expect(head.getTextureGoodEvil(40)).toBe('');
  });

  test('returns dark side transition texture when alignment is evil', () => {
    const head = SWHead.From2DA({
      __index: '96',
      head: 'P_AttonH',
      alttexture: '****',
      headtexvvve: 'P_AttnH1D2',
      headtexvve: 'P_AttnH1D1',
      headtexve: 'P_AttnH1D1',
      headtexe: 'P_AttnH1D1',
      headtexg: '****',
      headtexvg: '****',
    });

    expect(head.getTextureGoodEvil(0)).toBe('p_attnh1d2');
    expect(head.getTextureGoodEvil(10)).toBe('p_attnh1d1');
    expect(head.getTextureGoodEvil(20)).toBe('p_attnh1d1');
    expect(head.getTextureGoodEvil(30)).toBe('p_attnh1d1');
  });

  test('returns alttexture for player head with authored alttexture', () => {
    const head = SWHead.From2DA({
      __index: '26',
      head: 'PFHA01',
      alttexture: 'PFHA01',
      headtexvvve: 'PFHA01D2',
      headtexvve: 'PFHA01D1',
      headtexve: 'PFHA01D1',
      headtexe: 'PFHA01D1',
      headtexg: '****',
      headtexvg: '****',
    });

    expect(head.getTextureGoodEvil(50)).toBe('pfha01');
    expect(head.getTextureGoodEvil(0)).toBe('pfha01d2');
  });

  test('returns empty string for non-player head with no dark side transitions', () => {
    const head = SWHead.From2DA({
      __index: '139',
      head: 'N_MainOf',
      alttexture: '****',
      headtexvvve: '****',
      headtexvve: '****',
      headtexve: '****',
      headtexe: '****',
      headtexg: '****',
      headtexvg: '****',
    });

    expect(head.getTextureGoodEvil(50)).toBe('');
    expect(head.getTextureGoodEvil(0)).toBe('');
  });
});

describe('SWCreatureAppearance getBodyModelInfo', () => {
  const attonAppearance = SWCreatureAppearance.From2DA({
    __index: '452',
    label: 'Party_NPC_Atton',
    modeltype: 'B',
    modela: 'PMBAM',
    texa: 'PMBAMC',
    modelb: 'P_AttonBB',
    texb: '****',
    modelc: 'PMBCM',
    texc: 'PMBC',
  });

  test('unique companion clothing (variation B with texb ****) preserves model texture', () => {
    const info = attonAppearance.getBodyModelInfo('b', 1);
    expect(info.model).toBe('p_attonbb');
    // Does not fall back to texa (pmbamc); leaves texture empty so P_AttonBB uses authored p_attonba.
    expect(info.texture).toBe('');
  });

  test('armor variation C applies padded 2-digit texture variation', () => {
    const info = attonAppearance.getBodyModelInfo('c', 1);
    expect(info.model).toBe('pmbcm');
    expect(info.texture).toBe('pmbc01');

    const infoVar2 = attonAppearance.getBodyModelInfo('c', 2);
    expect(infoVar2.texture).toBe('pmbc02');
  });

  test('naked/underwear default variation applies padded 2-digit texture variation', () => {
    const info = attonAppearance.getBodyModelInfo('', 1);
    expect(info.model).toBe('pmbam');
    expect(info.texture).toBe('pmbamc01');
  });

  test('non-biped creatures return race model and racetex unchanged', () => {
    const droidAppearance = SWCreatureAppearance.From2DA({
      __index: '10',
      label: 'Droid_T3M4',
      modeltype: 'F',
      race: 'P_T3M4',
      racetex: 'P_T3M4',
    });

    const info = droidAppearance.getBodyModelInfo('b', 1);
    expect(info.model).toBe('p_t3m4');
    expect(info.texture).toBe('p_t3m4');
  });
});
