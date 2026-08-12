import { GameEngineType } from "@/enums/engine";

export interface CursorTexturePair {
  released: string;
  pressed: string;
}

/**
 * Resolve engine-specific cursor textures from the active game engine.
 *
 * KOTOR II renamed the hostile action cursor from `attack` to `kill`. Keeping
 * this mapping independent of launcher profile state prevents initialization
 * order from selecting KOTOR I resources in a TSL game.
 */
export function getAttackCursorTextures(gameKey: GameEngineType): CursorTexturePair {
  if (gameKey === GameEngineType.TSL) {
    return { released: "gui_mp_killU", pressed: "gui_mp_killD" };
  }

  if (gameKey === GameEngineType.KOTOR) {
    return { released: "gui_mp_attackU", pressed: "gui_mp_attackD" };
  }

  throw new Error(`Unsupported game engine for cursor textures: ${String(gameKey)}`);
}
