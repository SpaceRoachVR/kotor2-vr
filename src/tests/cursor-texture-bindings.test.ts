import { describe, expect, test } from "@jest/globals";
import { GameEngineType } from "@/enums/engine";
import { getAttackCursorTextures } from "@/managers/cursor/CursorTextureBindings";

describe("getAttackCursorTextures", () => {
  test("uses the TSL kill cursor resources for KOTOR II", () => {
    expect(getAttackCursorTextures(GameEngineType.TSL)).toEqual({
      released: "gui_mp_killU",
      pressed: "gui_mp_killD",
    });
  });

  test("uses the KOTOR attack cursor resources for KOTOR I", () => {
    expect(getAttackCursorTextures(GameEngineType.KOTOR)).toEqual({
      released: "gui_mp_attackU",
      pressed: "gui_mp_attackD",
    });
  });

  test("rejects an unknown engine instead of silently selecting the wrong assets", () => {
    expect(() => getAttackCursorTextures("UNKNOWN" as GameEngineType)).toThrow(
      "Unsupported game engine for cursor textures: UNKNOWN",
    );
  });
});
