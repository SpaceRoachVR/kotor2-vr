import {
  LEVEL_UP_ABILITIES,
  resolveLevelUpAllowances,
  resolveLevelUpSkillPoints,
  resolveLevelUpVitalityGain,
} from "@/game/kotor/menu/LevelUpRules";
import type {
  LevelUpAbility,
  LevelUpAllowances,
  LevelUpClassRules,
  LevelUpVitalityGain,
} from "@/game/kotor/menu/LevelUpRules";

export type LevelUpStep = 'attributes' | 'skills' | 'feats' | 'powers';

/** Retail order: each step can depend on the one before it. */
export const LEVEL_UP_STEPS: ReadonlyArray<LevelUpStep> = ['attributes', 'skills', 'feats', 'powers'];

export interface LevelUpCreatureClass extends LevelUpClassRules {
  level: number;
  spells: Array<{ id: number }>;
}

/** The subset of `ModuleCreature` a level-up touches. */
export interface LevelUpCreature {
  str: number;
  dex: number;
  con: number;
  wis: number;
  int: number;
  cha: number;
  skills: Array<{ rank: number }>;
  feats: Array<{ id: number }>;
  classes: LevelUpCreatureClass[];
  hitPoints: number;
  maxHitPoints: number;
  currentHitPoints: number;
  forcePoints: number;
  maxForcePoints: number;
  currentForce: number;
  canLevelUp(): boolean;
  getTotalClassLevel(): number;
  getMainClass(): LevelUpCreatureClass | false | undefined;
  removeFeat(id: number): boolean;
}

export interface LevelUpBaseline {
  readonly abilities: Readonly<Record<LevelUpAbility, number>>;
  readonly skillRanks: ReadonlyArray<number>;
  readonly featIds: ReadonlyArray<number>;
  readonly spells: ReadonlyArray<{ id: number }>;
  readonly classLevel: number;
}

/**
 * One level being spent, from the moment the player presses Level Up until
 * Accept or Back.
 *
 * The class level is raised up front, so every screen the steps reuse — the
 * character-creation Attributes, Skills and Feats screens — already sees the
 * new level: skill rank caps, feat availability and power minimum levels all
 * read it. Everything a step can change is recorded first, so Back puts the
 * character exactly as it was, and reopening a step starts that step and every
 * later one over. That second rule is what lets Intelligence spent on
 * Attributes change the Skills allowance without a stale spend surviving.
 */
export class LevelUpSession {

  readonly baseline: LevelUpBaseline;
  readonly allowances: LevelUpAllowances;
  readonly newCharacterLevel: number;

  private readonly completed = new Set<LevelUpStep>();
  private ended = false;

  private constructor(
    readonly creature: LevelUpCreature,
    readonly characterClass: LevelUpCreatureClass,
  ){
    this.baseline = {
      abilities: {
        str: creature.str, dex: creature.dex, con: creature.con,
        wis: creature.wis, int: creature.int, cha: creature.cha,
      },
      skillRanks: creature.skills.map((skill) => skill.rank),
      featIds: creature.feats.map((feat) => feat.id),
      spells: characterClass.spells.slice(),
      classLevel: characterClass.level,
    };
    characterClass.level += 1;
    this.newCharacterLevel = creature.getTotalClassLevel();
    this.allowances = resolveLevelUpAllowances({
      characterClass,
      newClassLevel: characterClass.level,
      newCharacterLevel: this.newCharacterLevel,
    });
  }

  /** Starts a level-up, or returns undefined when the character cannot level. */
  static begin(creature: LevelUpCreature | undefined): LevelUpSession | undefined {
    if(!creature || typeof creature.canLevelUp !== 'function' || !creature.canLevelUp()) return undefined;
    const characterClass = creature.getMainClass();
    if(!characterClass) return undefined;
    return new LevelUpSession(creature, characterClass);
  }

  get isActive(): boolean {
    return !this.ended;
  }

  /** Skill points for this level, from the character's Intelligence right now. */
  getSkillPoints(): number {
    return resolveLevelUpSkillPoints(this.characterClass.skillpointbase, this.creature.int);
  }

  /** Whether a step has anything to spend. Skills always do: at least one point. */
  isStepRequired(step: LevelUpStep): boolean {
    switch(step){
      case 'attributes': return this.allowances.attributePoints > 0;
      case 'skills': return true;
      case 'feats': return this.allowances.featPicks > 0;
      case 'powers': return this.allowances.powerPicks > 0;
    }
    return false;
  }

  isStepComplete(step: LevelUpStep): boolean {
    return this.completed.has(step);
  }

  /** A required step opens once every required step before it is done. */
  isStepUnlocked(step: LevelUpStep): boolean {
    if(this.ended || !this.isStepRequired(step)) return false;
    for(const earlier of LEVEL_UP_STEPS){
      if(earlier === step) return true;
      if(this.isStepRequired(earlier) && !this.completed.has(earlier)) return false;
    }
    return false;
  }

  /** The step the player should do next, or undefined when all are done. */
  getNextStep(): LevelUpStep | undefined {
    return LEVEL_UP_STEPS.find((step) => this.isStepRequired(step) && !this.completed.has(step));
  }

  canFinish(): boolean {
    return !this.ended && this.getNextStep() === undefined;
  }

  /**
   * Opens a step: it and every later step go back to the baseline and are no
   * longer complete. Returns false when the step is not open yet.
   */
  beginStep(step: LevelUpStep): boolean {
    if(!this.isStepUnlocked(step)) return false;
    const from = LEVEL_UP_STEPS.indexOf(step);
    for(const later of LEVEL_UP_STEPS.slice(from)){
      this.completed.delete(later);
      this.restoreStep(later);
    }
    return true;
  }

  completeStep(step: LevelUpStep): void {
    if(this.ended || !this.isStepRequired(step)) return;
    this.completed.add(step);
  }

  /** Back: every change undone and the class level returned. */
  cancel(): void {
    if(this.ended) return;
    for(const step of LEVEL_UP_STEPS) this.restoreStep(step);
    this.characterClass.level = this.baseline.classLevel;
    this.completed.clear();
    this.ended = true;
  }

  /**
   * Accept: the choices stay, and vitality and Force points grow by the class
   * dice plus the final modifiers. Each pool's maximum, base and current value
   * all rise together, so damage already taken is kept rather than healed.
   */
  finish(): LevelUpVitalityGain | undefined {
    if(!this.canFinish()) return undefined;
    const gain = resolveLevelUpVitalityGain(this.characterClass, this.creature.con, this.creature.wis);
    this.creature.hitPoints += gain.hitPoints;
    this.creature.maxHitPoints += gain.hitPoints;
    this.creature.currentHitPoints += gain.hitPoints;
    if(gain.forcePoints > 0){
      this.creature.forcePoints += gain.forcePoints;
      this.creature.maxForcePoints += gain.forcePoints;
      this.creature.currentForce += gain.forcePoints;
    }
    this.ended = true;
    return gain;
  }

  private restoreStep(step: LevelUpStep): void {
    const { creature, baseline } = this;
    switch(step){
      case 'attributes':
        for(const ability of LEVEL_UP_ABILITIES){
          creature[ability] = baseline.abilities[ability];
        }
      break;
      case 'skills':
        for(let i = 0; i < creature.skills.length && i < baseline.skillRanks.length; i++){
          creature.skills[i].rank = baseline.skillRanks[i];
        }
      break;
      case 'feats': {
        const kept = new Set(baseline.featIds);
        for(const feat of creature.feats.slice()){
          if(!kept.has(feat.id)) creature.removeFeat(feat.id);
        }
      }
      break;
      case 'powers':
        this.characterClass.spells.length = 0;
        this.characterClass.spells.push(...baseline.spells);
      break;
    }
  }

}
