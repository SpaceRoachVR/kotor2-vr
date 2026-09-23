import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { isPersistedEffect } from '@/effects/GameEffectDuration';
import { GameEffectDurationType } from '@/enums/effects/GameEffectDurationType';

/**
 * Round 11: "I saved after leveling up and received another level when loading
 * that save." Measured on that save in the emulator, loading it gave +1,000 XP
 * and -10 HP every time, and a save/reload round trip +1,100 XP and -10 HP:
 * - each saved corpse ran its death again (kill XP, OnDeath, loot, sound);
 * - each instant hit taken was saved and dealt again on load.
 */
const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const effect = (durationType: number) => ({ getDurationType: () => durationType });

describe('instant effects are never persisted', () => {
  test('INSTANT is dropped; every lasting duration is kept', () => {
    expect(isPersistedEffect(effect(GameEffectDurationType.INSTANT))).toBe(false);
    for (const kept of [GameEffectDurationType.TEMPORARY, GameEffectDurationType.PERMANENT,
      GameEffectDurationType.EQUIPPED, GameEffectDurationType.INNATE]) {
      expect(isPersistedEffect(effect(kept))).toBe(true);
    }
  });

  test('a missing or malformed effect is not persisted', () => {
    expect(isPersistedEffect(undefined)).toBe(false);
    expect(isPersistedEffect(null)).toBe(false);
    expect(isPersistedEffect({} as any)).toBe(false);
  });

  test('the creature applies the rule on save and on load', () => {
    const creature = read('module/ModuleCreature.ts');
    expect(creature).toContain('if(!isPersistedEffect(this.effects[i])) continue;');
    expect(creature).toContain('if(effect && isPersistedEffect(effect)){');
  });
});

describe('a creature saved dead is not killed again on load', () => {
  const creature = read('module/ModuleCreature.ts');
  const loadAt = creature.indexOf('\n  load(){');
  const load = creature.slice(loadAt, creature.indexOf('\n  loadScripts (){', loadAt));

  test('load latches the death as already handled', () => {
    expect(load).toMatch(/if\(this\.isDead\(\) && !this\.isPartyMember\(\)\)\{\s*this\.deathStarted = true;\s*this\.deathAnimationPlayed = true;/);
  });

  test('the death handling it skips is the one-shot branch gated on that latch', () => {
    expect(creature).toMatch(/if\(!this\.deathStarted\)\{[\s\S]{0,200}this\.onDeath\(\);[\s\S]{0,60}this\.leaveCorpseLoot\(\);/);
  });
});
