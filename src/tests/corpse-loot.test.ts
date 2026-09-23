import { describe, expect, test } from '@jest/globals';
import { selectCorpseLoot } from '@/module/creature/CorpseLoot';

describe('corpse loot honours the Dropable flag', () => {
  test('a Damaged Mining Droid leaves no prop sword or grenades, only its droppable items', () => {
    // g_assassindrd003: grenades and components in ItemList, only the
    // components flagged Dropable; Mining Laser equipped with Dropable=1.
    const sonic = { tag: 'G_w_SonicGren01', dropable: 0 };
    const prop = { tag: 'PropSS01', dropable: 0 };
    const components = { tag: 'Components', dropable: 1 };
    const laser = { tag: 'MiningLaser', dropable: 1 };
    const hide = { tag: 'g_i_crhide015', dropable: 1 };

    const loot = selectCorpseLoot([sonic, prop, components], { LEFTHAND: laser, HIDE: hide, RIGHTHAND: undefined });

    expect(loot.inventory).toEqual([components]);
    expect(loot.droppedEquipmentSlots).toEqual(['LEFTHAND']);
  });

  test('loot a script added after spawn has no flag and is kept', () => {
    const treasure: { tag: string; dropable?: unknown } = { tag: 'g_i_credits' };
    expect(selectCorpseLoot([treasure], {}).inventory).toEqual([treasure]);
  });

  test('equipment without the flag stays on the body', () => {
    expect(selectCorpseLoot<{ dropable?: unknown }>([], { RIGHTHAND: { dropable: 0 }, LEFTHAND: { dropable: undefined } }).droppedEquipmentSlots).toEqual([]);
  });
});
