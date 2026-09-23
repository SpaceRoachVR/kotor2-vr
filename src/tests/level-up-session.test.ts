import { describe, expect, test } from '@jest/globals';
import { LevelUpSession } from '@/game/kotor/menu/LevelUpSession';
import type { LevelUpCreature, LevelUpCreatureClass } from '@/game/kotor/menu/LevelUpSession';

function consularAt(level: number): LevelUpCreatureClass {
  return {
    id: 4, level, hitdie: 6, forcedie: 8, skillpointbase: 2, spellcaster: true, primaryabil: 'WIS',
    featGainPoints: [1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    spellGainPoints: [2, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 2],
    spells: [{ id: 10 }],
  };
}

function creatureWith(characterClass: LevelUpCreatureClass, canLevel = true): LevelUpCreature {
  const creature: LevelUpCreature = {
    str: 10, dex: 12, con: 12, wis: 16, int: 14, cha: 13,
    skills: [0, 1, 2, 3, 4, 5, 6, 7].map((rank) => ({ rank })),
    feats: [{ id: 1 }, { id: 2 }],
    classes: [characterClass],
    hitPoints: 30, maxHitPoints: 30, currentHitPoints: 20,
    forcePoints: 40, maxForcePoints: 40, currentForce: 35,
    canLevelUp: () => canLevel,
    getTotalClassLevel: () => creature.classes.reduce((total, cls) => total + cls.level, 0),
    getMainClass: () => creature.classes[creature.classes.length - 1],
    removeFeat: (id: number) => {
      const index = creature.feats.findIndex((feat) => feat.id === id);
      if(index < 0) return false;
      creature.feats.splice(index, 1);
      return true;
    },
  };
  return creature;
}

describe('a level-up session', () => {
  test('does not start without enough experience', () => {
    expect(LevelUpSession.begin(creatureWith(consularAt(3), false))).toBeUndefined();
    expect(LevelUpSession.begin(undefined)).toBeUndefined();
  });

  test('raises the class level up front so the reused screens see it', () => {
    const cls = consularAt(3);
    const session = LevelUpSession.begin(creatureWith(cls))!;
    expect(cls.level).toBe(4);
    expect(session.newCharacterLevel).toBe(4);
    expect(session.allowances).toEqual({ attributePoints: 1, featPicks: 0, powerPicks: 1 });
  });

  test('steps with nothing to spend are skipped, and the rest open in order', () => {
    const session = LevelUpSession.begin(creatureWith(consularAt(3)))!;
    expect(session.isStepRequired('feats')).toBe(false);
    expect(session.isStepUnlocked('attributes')).toBe(true);
    expect(session.isStepUnlocked('skills')).toBe(false);
    session.completeStep('attributes');
    expect(session.isStepUnlocked('skills')).toBe(true);
    expect(session.isStepUnlocked('powers')).toBe(false);
    session.completeStep('skills');
    expect(session.isStepUnlocked('feats')).toBe(false);
    expect(session.isStepUnlocked('powers')).toBe(true);
    expect(session.canFinish()).toBe(false);
    session.completeStep('powers');
    expect(session.canFinish()).toBe(true);
  });

  test('skill points follow Intelligence spent on the Attributes step', () => {
    const creature = creatureWith(consularAt(3));
    const session = LevelUpSession.begin(creature)!;
    expect(session.getSkillPoints()).toBe(4);
    creature.int = 16;
    expect(session.getSkillPoints()).toBe(5);
  });

  test('reopening a step starts it and every later step over', () => {
    const creature = creatureWith(consularAt(3));
    const session = LevelUpSession.begin(creature)!;
    session.beginStep('attributes');
    creature.int = 15;
    session.completeStep('attributes');
    session.beginStep('skills');
    creature.skills[0].rank = 3;
    session.completeStep('skills');

    expect(session.beginStep('attributes')).toBe(true);
    expect(creature.int).toBe(14);
    expect(creature.skills[0].rank).toBe(0);
    expect(session.isStepComplete('skills')).toBe(false);
    expect(session.isStepUnlocked('skills')).toBe(false);
  });

  test('a locked step cannot be opened', () => {
    const session = LevelUpSession.begin(creatureWith(consularAt(3)))!;
    expect(session.beginStep('powers')).toBe(false);
  });

  test('Back undoes attributes, skills, feats, powers and the level', () => {
    const cls = consularAt(2);
    const creature = creatureWith(cls);
    const session = LevelUpSession.begin(creature)!;
    creature.wis = 17;
    creature.skills[4].rank = 9;
    creature.feats.push({ id: 99 });
    cls.spells.push({ id: 28 });

    session.cancel();
    expect(cls.level).toBe(2);
    expect(creature.wis).toBe(16);
    expect(creature.skills[4].rank).toBe(4);
    expect(creature.feats.map((feat) => feat.id)).toEqual([1, 2]);
    expect(cls.spells.map((spell) => spell.id)).toEqual([10]);
    expect(session.isActive).toBe(false);
  });

  test('Accept keeps the choices and grows vitality and Force without healing', () => {
    const cls = consularAt(2);
    const creature = creatureWith(cls);
    const session = LevelUpSession.begin(creature)!;
    expect(session.finish()).toBeUndefined();
    session.completeStep('skills');
    session.completeStep('feats');
    session.completeStep('powers');
    cls.spells.push({ id: 28 });

    expect(session.finish()).toEqual({ hitPoints: 7, forcePoints: 11 });
    expect(creature.maxHitPoints).toBe(37);
    expect(creature.maxHitPoints + creature.currentHitPoints - creature.hitPoints).toBe(27);
    expect(creature.maxForcePoints).toBe(51);
    expect(creature.currentForce).toBe(46);
    expect(cls.level).toBe(3);
    expect(cls.spells.map((spell) => spell.id)).toEqual([10, 28]);
    session.cancel();
    expect(cls.level).toBe(3);
  });
});
