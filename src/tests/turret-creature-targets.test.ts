import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The Peragus turret (107PER) has no minigame enemies at all: its ARE carries
 * zero Enemies and zero Obstacles. Its targets are ordinary creatures that the
 * area's own OnUserDefined script spawns.
 *
 * Decompiled from the retail module:
 *   a_106per_movie  SignalEvent(GetArea(GetFirstPC()), EventUserDefined(1))
 *   a_hangar_timer  case 1: CreateObject(CREATURE, "g_sithtroop008",
 *                           WP_TARGET_ENTER), 107PER_MG_LEFT - 1,
 *                           re-signal itself after 2s
 *   a_sith_death    107PER_MG_DEAD + 1
 *   005EBO a_sith_spawn spawns 107PER_MG_EBON troopers aboard the Hawk
 *
 * Two engine gaps stopped that working, both fixed here:
 *   1. triggerUserDefinedEvent handled creatures, placeables, doors and
 *      triggers but not areas, so signalling the area did nothing at all.
 *   2. Turret bullets only ever tested minigame enemies and the player, and
 *      did it with a point test. A bullet covers ~3.3 units per frame and a
 *      trooper is about one wide, so even once creatures were considered a
 *      point test tunnelled straight through them.
 *
 * Verified live on 107PER: signalling the area spawns G_SITHTROOP07 and takes
 * 107PER_MG_LEFT from 25 to 24; a turret bullet then takes it from 53 HP to
 * -247, kills it, and 107PER_MG_DEAD becomes 1.
 */
const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('areas receive user-defined events', () => {
  const source = read('module/ModuleObject.ts');
  const body = source.slice(source.indexOf('triggerUserDefinedEvent('), source.indexOf('triggerSpellCastAtEvent('));

  test.each(['ModuleCreature', 'ModulePlaceable', 'ModuleDoor', 'ModuleTrigger', 'ModuleArea'])(
    '%s can run its OnUserDefined script', (type) => {
      expect(body).toContain(`ModuleObjectType.${type}`);
    });

  test('the area branch uses the area script key', () => {
    expect(body).toContain('this.scripts[ModuleObjectScript.AreaOnUserDefined]');
  });
});

describe('turret bullets can hit creatures', () => {
  const source = read('module/ModuleMGGunBullet.ts');

  test('player bullets test area creatures as well as minigame enemies', () => {
    expect(source).toContain('GameState.module.area.creatures');
    expect(source).toContain('creature.damage(this.damage_amt');
  });

  test('a dead creature is skipped', () => {
    expect(source).toContain('creature.isDead?.()');
  });

  test('the frame travel segment is tested, not the landing point', () => {
    expect(source).toContain('hitsCreature(creature, this.directionLine.start, this.directionLine.end)');
    // Anchor on the method definition: `initProperties()` also appears earlier
    // as a call from the constructor, which would slice an empty string.
    const from = source.indexOf('static hitsCreature(');
    const hit = source.slice(from, source.indexOf('  initProperties(){', from));
    expect(hit.length).toBeGreaterThan(0);
    expect(hit).toContain('expandByPoint(start)');
    expect(hit).toContain('expandByPoint(end)');
    expect(hit).toContain('intersectsBox(box)');
    // Creatures whose model has not built a box yet still get a hit radius.
    expect(hit).toContain('closestPointToPoint(origin, true');
  });

  test('minigame enemies keep their own sphere test', () => {
    expect(source).toContain('enemy.sphere.containsPoint(this.position)');
  });
});
