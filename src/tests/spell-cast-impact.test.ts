import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Round 8: "thrown grenades still appear to do nothing. they do not cause damage
 * to mining droids or show animated explosion". Traced in the emulator with the
 * Frag Grenade (spells.2da row 87, impact script k_sup_grenade, conjure 170 ms,
 * cast 1330 ms, range L) thrown at a Damaged Mining Droid 6 m away:
 *
 * 1. The item's CastSpell subtype is the spell row; the headset threw spell 0.
 *    (ItemProperty.getCastSpellId, covered in item-cast-spell-validation.)
 * 2. SpellCastInstance copied nothing from the spell, so `impactscript` was
 *    undefined and no impact script — grenade or Force power — ever ran.
 * 3. Run by hand, k_sup_grenade called GetSpellTargetLocation() three times and
 *    got the world origin each time, so its explosion and its 4 m damage sphere
 *    (GetFirstObjectInShape) were centred where nobody stands.
 *
 * SpellCastInstance and the NWScript table reach the whole engine graph, so the
 * repairs are pinned by source.
 */
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('SpellCastInstance', () => {
  const source = read('src/combat/SpellCastInstance.ts');
  const constructorBody = (() => {
    const at = source.indexOf('constructor(caster: ModuleObject');
    const body = source.slice(at);
    return body.slice(0, body.indexOf('\n  }'));
  })();
  const impactBody = (() => {
    const at = source.indexOf('  impact(){');
    const body = source.slice(at);
    return body.slice(0, body.indexOf('\n  }\n'));
  })();

  test('takes its impact script and cast-hand visual from the spell', () => {
    expect(constructorBody).toContain('spell.impactscript');
    expect(constructorBody).toContain('spell.casthandvisual');
  });

  test('takes the authored conjure and cast times, so a grenade flies its arc', () => {
    expect(constructorBody).toContain('spell?.conjtime');
    expect(constructorBody).toContain('spell?.casttime');
    expect(constructorBody).toMatch(/this\.castTime = cast/);
  });

  test('records the spell target before the impact script runs', () => {
    const recordAt = impactBody.indexOf('this.spell.oTarget = this.target');
    const lastTargetAt = impactBody.indexOf('combatData.lastSpellTarget = this.target');
    const scriptAt = impactBody.indexOf('NWScript.Load(this.impactscript)');
    expect(recordAt).toBeGreaterThan(-1);
    expect(lastTargetAt).toBeGreaterThan(-1);
    expect(scriptAt).toBeGreaterThan(recordAt);
    expect(scriptAt).toBeGreaterThan(lastTargetAt);
  });

  test('no longer compares an unset field against the empty string', () => {
    expect(source).not.toContain("this.impactscript != ''");
    expect(source).not.toContain("this.casthandvisual != ''");
  });
});

describe('GetSpellTargetLocation', () => {
  test('returns the target location it computes', () => {
    const source = read('src/nwscript/NWScriptDefK1.ts');
    const at = source.indexOf('name: "GetSpellTargetLocation"');
    const body = source.slice(at, source.indexOf('\n  },', at));
    expect(body).toContain('return this.talent.oTarget.getLocation();');
  });
});

describe('creature perception in a room without a model', () => {
  test('does not read visibility off a missing model', () => {
    const source = read('src/module/ModuleCreature.ts');
    const at = source.indexOf('updatePerceptionList(delta = 0){');
    const body = source.slice(at, source.indexOf('\n  }\n', at));
    expect(body).toContain('this.room?.model && !this.room.model.visible');
    expect(body).not.toMatch(/if\(!this\.room\.model\.visible\)/);
  });
});
