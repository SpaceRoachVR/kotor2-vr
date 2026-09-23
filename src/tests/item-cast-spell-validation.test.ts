import { describe, expect, it } from "@jest/globals";
import { isItemCastSpellSourceUsable } from "@/actions/ItemCastSpellValidation";

describe("isItemCastSpellSourceUsable", () => {
  it("accepts a source item that is currently owned and has the requested usable cast", () => {
    const item = {
      properties: [{
        isUseable: () => true,
        is: (propertyType: number) => propertyType === 12,
        getCastSpellId: () => 99,
      }],
    };

    expect(isItemCastSpellSourceUsable({
      sourceItem: item,
      requestedSpellId: 99,
      isOwnedByCaster: (candidate: unknown) => candidate === item,
      castSpellPropertyType: 12,
    })).toBe(true);
  });

  it("rejects an item that was removed before the queued action resolves", () => {
    const item = {
      properties: [{
        isUseable: () => true,
        is: () => true,
        getCastSpellId: () => 99,
      }],
    };

    expect(isItemCastSpellSourceUsable({
      sourceItem: item,
      requestedSpellId: 99,
      isOwnedByCaster: () => false,
      castSpellPropertyType: 12,
    })).toBe(false);
  });

  it("rejects an exhausted or mismatched cast property", () => {
    const item = {
      properties: [
        {
          isUseable: () => false,
          is: () => true,
          getCastSpellId: () => 99,
        },
        {
          isUseable: () => true,
          is: () => true,
          getCastSpellId: () => 101,
        },
      ],
    };

    expect(isItemCastSpellSourceUsable({
      sourceItem: item,
      requestedSpellId: 99,
      isOwnedByCaster: (candidate: unknown) => candidate === item,
      castSpellPropertyType: 12,
    })).toBe(false);
  });

  it("rejects malformed spell ids and unsafe property implementations", () => {
    const item = {
      properties: [{
        isUseable: () => {
          throw new Error("corrupt item property");
        },
        is: () => true,
        getCastSpellId: () => 99,
      }],
    };

    expect(isItemCastSpellSourceUsable({
      sourceItem: item,
      requestedSpellId: Number.NaN,
      isOwnedByCaster: () => true,
      castSpellPropertyType: 12,
    })).toBe(false);
    expect(isItemCastSpellSourceUsable({
      sourceItem: item,
      requestedSpellId: 99,
      isOwnedByCaster: () => true,
      castSpellPropertyType: 12,
    })).toBe(false);
  });

  it("fails closed when a queued validation request is structurally malformed", () => {
    expect(isItemCastSpellSourceUsable(undefined as unknown as Parameters<typeof isItemCastSpellSourceUsable>[0]))
      .toBe(false);
    expect(isItemCastSpellSourceUsable({
      sourceItem: { properties: [] },
      requestedSpellId: 99,
      isOwnedByCaster: undefined as unknown as (sourceItem: unknown) => boolean,
      castSpellPropertyType: 12,
    })).toBe(false);
  });
});
