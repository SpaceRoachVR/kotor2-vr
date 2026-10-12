import { describe, expect, test } from "@jest/globals";
import { globalBooleanByteLength, packGlobalBoolean, unpackGlobalBoolean } from "@/engine/GlobalBooleanPacking";

describe('GLOBALVARS boolean packing', () => {
  test('boolean 0 is the most significant bit, as in retail saves', () => {
    const bytes = new Uint8Array(1);
    packGlobalBoolean(bytes, 0, true);
    expect(bytes[0]).toBe(0x80);
    expect(unpackGlobalBoolean(new Uint8Array([0x80]), 0)).toBe(true);
    expect(unpackGlobalBoolean(new Uint8Array([0x01]), 7)).toBe(true);
  });

  test('every boolean survives a write and read back', () => {
    const values = Array.from({ length: 163 }, (_, i) => (i * 7) % 3 === 0);
    const bytes = new Uint8Array(globalBooleanByteLength(values.length));
    values.forEach((value, i) => packGlobalBoolean(bytes, i, value));
    expect(values.map((_, i) => unpackGlobalBoolean(bytes, i))).toEqual(values);
  });

  test('a partial last byte is kept', () => {
    expect(globalBooleanByteLength(160)).toBe(20);
    expect(globalBooleanByteLength(161)).toBe(21);
  });
});
