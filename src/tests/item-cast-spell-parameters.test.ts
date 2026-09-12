import { describe, expect, it } from "@jest/globals";
import {
  ItemCastSpellParameter,
  writeItemCastSpellParameters,
} from "@/actions/ItemCastSpellParameters";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";

describe("ItemCastSpellParameter", () => {
  it("matches the item-cast action serialization contract", () => {
    expect(ItemCastSpellParameter).toEqual({
      Target: 0,
      Area: 1,
      TargetX: 2,
      TargetY: 3,
      TargetZ: 4,
      SpellId: 5,
      CasterLevel: 6,
      Delay: 7,
      ProjectilePath: 8,
      ProjectileSpellId: 9,
      Item: 10,
      ImpactScript: 11,
    });
  });

  it("writes every item-cast field at its canonical index", () => {
    const calls: Array<readonly [number, number, unknown]> = [];
    const action = {
      setParameter(index: number, type: number, value: unknown): void {
        calls.push([index, type, value]);
      },
    };
    const target = { id: 12 };
    const area = { id: 7 };
    const item = { id: 33 };

    writeItemCastSpellParameters(action, {
      target,
      area,
      targetPosition: { x: 1, y: 2, z: 3 },
      spellId: 99,
      casterLevel: 4,
      delay: 1.5,
      projectilePath: 5,
      projectileSpellId: 6,
      item,
      impactScript: "impact_script",
    });

    expect(calls).toEqual([
      [ItemCastSpellParameter.Target, ActionParameterType.DWORD, target],
      [ItemCastSpellParameter.Area, ActionParameterType.DWORD, area],
      [ItemCastSpellParameter.TargetX, ActionParameterType.FLOAT, 1],
      [ItemCastSpellParameter.TargetY, ActionParameterType.FLOAT, 2],
      [ItemCastSpellParameter.TargetZ, ActionParameterType.FLOAT, 3],
      [ItemCastSpellParameter.SpellId, ActionParameterType.INT, 99],
      [ItemCastSpellParameter.CasterLevel, ActionParameterType.INT, 4],
      [ItemCastSpellParameter.Delay, ActionParameterType.FLOAT, 1.5],
      [ItemCastSpellParameter.ProjectilePath, ActionParameterType.INT, 5],
      [ItemCastSpellParameter.ProjectileSpellId, ActionParameterType.INT, 6],
      [ItemCastSpellParameter.Item, ActionParameterType.DWORD, item],
      [ItemCastSpellParameter.ImpactScript, ActionParameterType.STRING, "impact_script"],
    ]);
  });
});
