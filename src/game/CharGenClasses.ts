import { GameEngineType } from "@/enums/engine/GameEngineType";

export interface CharGenClassInterface {
  id: number;
  strings: {
    name: number,
    gender: number,
    description: number,
  },
  appearances: number[]
}

/**
 * KotOR I's six class-selection slots: male Scoundrel, Scout, Soldier, then
 * female Soldier, Scout, Scoundrel. Each class wears the matching body size —
 * small, medium, large — which is the `appearance.2da` row pattern below.
 */
export const CharGenClasses: {[key: number]: CharGenClassInterface} = {
  0: {
    id: 2,
    strings: {
      name: 135,
      gender: 358,
      description: 32109
    },
    appearances: [136, 139, 142, 145, 148, 151, 154, 157, 160, 163, 166, 169, 172, 175, 178]
  },
  1: {
    id: 1,
    strings: {
      name: 133,
      gender: 358,
      description: 32110
    },
    // 176, not 175: every other entry steps by three from 137, and 175 is the
    // small body already listed in slot 0.
    appearances: [137, 140, 143, 146, 149, 152, 155, 158, 161, 164, 167, 170, 173, 176, 179]
  },
  2: {
    id: 0,
    strings: {
      name: 134,
      gender: 358,
      description: 32111
    },
    appearances: [138, 141, 144, 147, 150, 153, 156, 159, 162, 165, 168, 171, 174, 177, 180]
  },
  3: {
    id: 0,
    strings: {
      name: 134,
      gender: 359,
      description: 32111
    },
    appearances: [93, 96, 99, 102, 105, 108, 111, 114, 117, 120, 123, 126, 129, 132, 135]
  },
  4: {
    id: 1,
    strings: {
      name: 133,
      gender: 359,
      description: 32110
    },
    appearances: [92, 95, 98, 101, 104, 107, 110, 113, 116, 119, 122, 125, 128, 131, 134]
  },
  5: {
    id: 2,
    strings: {
      name: 135,
      gender: 359,
      description: 32109
    },
    appearances: [91, 94, 97, 100, 103, 106, 109, 112, 115, 118, 121, 124, 127, 130, 133]
  }
};

/**
 * TSL's slots. The Exile is a Jedi, but character creation used the table above
 * in both games, so every TSL character started as a Scoundrel, Scout or
 * Soldier: no Force die, no Force powers by level, and a Powers level-up step
 * that could never open. Found on a Peragus save whose Exile was `classes.2da`
 * row 2.
 *
 * Same slots and bodies (TSL's `appearance.2da` rows 91-180 are the same
 * P_FEM/P_MAL small, medium and large sets). The classes follow the hit die the
 * body size already stood for in KotOR I: small (d6) Consular, medium (d8)
 * Sentinel, large (d10) Guardian. Names are `classes.2da`'s own (353 Guardian,
 * 354 Consular, 355 Sentinel); descriptions are TSL's character-creation
 * blurbs, dialog.tlk 48031-48033.
 */
export const TSLCharGenClasses: {[key: number]: CharGenClassInterface} = {
  0: { id: 4, strings: { name: 354, gender: 358, description: 48031 }, appearances: CharGenClasses[0].appearances },
  1: { id: 5, strings: { name: 355, gender: 358, description: 48032 }, appearances: CharGenClasses[1].appearances },
  2: { id: 3, strings: { name: 353, gender: 358, description: 48033 }, appearances: CharGenClasses[2].appearances },
  3: { id: 3, strings: { name: 353, gender: 359, description: 48033 }, appearances: CharGenClasses[3].appearances },
  4: { id: 5, strings: { name: 355, gender: 359, description: 48032 }, appearances: CharGenClasses[4].appearances },
  5: { id: 4, strings: { name: 354, gender: 359, description: 48031 }, appearances: CharGenClasses[5].appearances },
};

/** The class-selection slots for a game. */
export function getCharGenClasses(gameKey: GameEngineType): {[key: number]: CharGenClassInterface} {
  return gameKey === GameEngineType.TSL ? TSLCharGenClasses : CharGenClasses;
}
