import { describe, expect, test } from '@jest/globals';
import { resolveBlasterDeflection } from '@/combat/resolveBlasterDeflection';

describe('resolveBlasterDeflection', () => {
  test('does not deflect when the defender cannot attempt deflection', () => {
    const result = resolveBlasterDeflection({
      attackRoll: 15,
      assuredDeflection: false,
      assuredDeflectionReflects: false,
      deflectionBonus: null,
      rollD20: () => 20,
    });
    expect(result).toEqual({ deflected: false, reflect: false });
  });

  test('deflects when the opposed roll beats the attack roll', () => {
    const result = resolveBlasterDeflection({
      attackRoll: 15,
      assuredDeflection: false,
      assuredDeflectionReflects: false,
      deflectionBonus: 3,
      rollD20: () => 13, // 13 + 3 = 16 > 15
    });
    expect(result).toEqual({ deflected: true, reflect: false });
  });

  test('does not deflect on a tie or a losing roll', () => {
    expect(resolveBlasterDeflection({
      attackRoll: 15,
      assuredDeflection: false,
      assuredDeflectionReflects: false,
      deflectionBonus: 3,
      rollD20: () => 12, // 12 + 3 = 15, tie
    })).toEqual({ deflected: false, reflect: false });

    expect(resolveBlasterDeflection({
      attackRoll: 15,
      assuredDeflection: false,
      assuredDeflectionReflects: false,
      deflectionBonus: 0,
      rollD20: () => 10,
    })).toEqual({ deflected: false, reflect: false });
  });

  test('reflects the bolt back when the deflection roll beats the attack roll by 10 or more', () => {
    const justUnder = resolveBlasterDeflection({
      attackRoll: 5,
      assuredDeflection: false,
      assuredDeflectionReflects: false,
      deflectionBonus: 0,
      rollD20: () => 14, // margin 9
    });
    expect(justUnder).toEqual({ deflected: true, reflect: false });

    const exactlyTen = resolveBlasterDeflection({
      attackRoll: 5,
      assuredDeflection: false,
      assuredDeflectionReflects: false,
      deflectionBonus: 0,
      rollD20: () => 15, // margin 10
    });
    expect(exactlyTen).toEqual({ deflected: true, reflect: true });
  });

  test('assured deflection always deflects with no roll, honoring its own reflect flag', () => {
    let rolled = false;
    const noReflect = resolveBlasterDeflection({
      attackRoll: 30,
      assuredDeflection: true,
      assuredDeflectionReflects: false,
      deflectionBonus: null,
      rollD20: () => { rolled = true; return 1; },
    });
    expect(noReflect).toEqual({ deflected: true, reflect: false });
    expect(rolled).toBe(false);

    const withReflect = resolveBlasterDeflection({
      attackRoll: 30,
      assuredDeflection: true,
      assuredDeflectionReflects: true,
      deflectionBonus: null,
      rollD20: () => 1,
    });
    expect(withReflect).toEqual({ deflected: true, reflect: true });
  });

  test('rejects a non-finite attack roll or a missing roll function', () => {
    expect(() => resolveBlasterDeflection({
      attackRoll: Number.NaN,
      assuredDeflection: false,
      assuredDeflectionReflects: false,
      deflectionBonus: 0,
      rollD20: () => 10,
    })).toThrow(TypeError);

    expect(() => resolveBlasterDeflection({
      attackRoll: 10,
      assuredDeflection: false,
      assuredDeflectionReflects: false,
      deflectionBonus: 0,
      rollD20: undefined as unknown as () => number,
    })).toThrow(TypeError);
  });
});
