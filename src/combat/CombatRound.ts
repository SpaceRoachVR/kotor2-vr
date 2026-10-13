import type { ModuleCreature, ModuleItem, ModuleObject } from "@/module";
import { GFFStruct } from "@/resource/GFFStruct";
import { Dice } from "@/utility/Dice";
import { OdysseyModelAnimation } from "@/odyssey";
import { CombatActionType } from "@/enums/combat/CombatActionType";
import { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";
import { ModuleCreatureArmorSlot } from "@/enums/module/ModuleCreatureArmorSlot";
import { TextSprite3DType } from "@/enums/engine/TextSprite3DType";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { CombatFeatType } from "@/enums/combat/CombatFeatType";
import { AttackResult } from "@/enums/combat/AttackResult";
import { BaseItemType } from "@/enums/combat/BaseItemType";
import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";
import { WeaponWield } from "@/enums/combat/WeaponWield";
import { ActionType } from "@/enums/actions/ActionType";
import { WeaponSize } from "@/enums/combat/WeaponSize";
import { resolveTwoWeaponPenalty } from "@/combat/TwoWeaponRules";
import { resolveFeatOnHitSave, resolveFeatSaveDC, resolveThreatRangeMin, resolveThreatRangeMultiplier } from "@/combat/CombatFeatRules";
import { DamageType } from "@/enums/combat/DamageType";
import { DiceType } from "@/enums/combat/DiceType";
import { TextSprite3D } from "@/engine/TextSprite3D";
import { BitWise } from "@/utility/BitWise";
import { CombatAttackData } from "@/combat/CombatAttackData";
import { resolveBlasterDeflection } from "@/combat/resolveBlasterDeflection";
import type { CombatRoundAction } from "@/combat/CombatRoundAction";
import { GameState } from "@/GameState";
import { FeedbackMessageEntry } from "@/engine/FeedbackMessageEntry";
import { FeebackMessageColor } from "@/enums/engine/FeedbackMessageColor";
import { resolveAttackRoll } from "@/combat/TSLCombatRules";
import { buildCombatAttackPlan, countHeldCombatAttacks, selectHeldCombatAttack, type CombatAttackHand, type CombatPlannedAttack } from "@/combat/CombatAttackPlan";

/** Ranks attack results so a round reports its best attack. */
function bestAttackResult(previous: AttackResult | undefined, next: AttackResult): AttackResult {
  const rank = (r: AttackResult | undefined) =>
    r === AttackResult.CRITICAL_HIT ? 4 :
    r === AttackResult.HIT_SUCCESSFUL || r === AttackResult.AUTOMATIC_HIT ? 3 :
    r === AttackResult.DEFLECTED || r === AttackResult.PARRIED ? 2 :
    r === AttackResult.MISS ? 1 : 0;
  return rank(previous) > rank(next) ? previous as AttackResult : next;
}

/**
 * CombatRound class.
 *
 * The CombatRound class manages a single combat round for a ModuleObject (typically a ModuleCreature)
 * It handles the timing and execution of combat actions, including attack rolls, damage calculations, and animations.
 * It also manages the dueling/engagement state between creatures, as well as the pause/resume mechanics.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file CombatRound.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class CombatRound {
  /**
   * The length of a combat round in milliseconds
   */
  static ROUND_LENGTH: number = 3000;

  /**
   * Which creatures roll only the first attack of each round when it begins.
   * Their round's other attacks (the off hand, a double-bladed weapon's second
   * blade, Flurry / Rapid Shot's extra) wait for `resolveHeldAttack`, one per
   * call, until the round ends; any not asked for by then are not rolled.
   * Every roll, bonus, penalty and damage number is the one the round would
   * have rolled at its start. Null (the default) rolls them all at once.
   * For a front end whose player makes each attack with an input of its own.
   */
  static holdsLaterAttacks: ((owner: ModuleObject) => boolean) | null = null;

  owner: ModuleObject;

  roundStarted: boolean = false;
  attackID: number = 0;
  attackGroup: number = 0;
  spellCastRound: boolean = false;
  deflectArrow: boolean = true;
  weaponSucks: boolean = false;
  dodgeTarget: ModuleObject;
  newAttackTarget: ModuleObject; //the new target to switch to after this combat round has ended
  engaged: boolean = false; //dueling(?)
  master: boolean = false; //is this combatround group owned by this creature
  masterID: ModuleObject; //the creature that owns this combat group

  roundPaused: boolean = false;
  roundPausedBy: ModuleObject;
  infinitePause: boolean = false;
  pauseTimer: number = 0;
  timer: number = 0;
  roundLength: number = 0;
  overlapAmount: number = 0;
  bleedTimer: number = 0;

  currentAttack: number = 0;
  parryIndex: number = 0;
  numAOOs: number = 1; //Attacks of Opportunity - unused (?)
  numCleaves: number = 1; //Cleave Attacks - unused (?)
  onHandAttacks: number = 0;
  additionalAttacks: number = 0;
  effectAttacks: number = 0;
  parryActions: number = 0;
  offHandTaken: boolean = false;
  extraTaken: boolean = false;

  attackList: CombatAttackData[] = [];
  /** This round's attacks in the order they roll (CombatAttackPlan). */
  plannedAttacks: CombatPlannedAttack<ModuleItem>[] = [];
  /** Which of `plannedAttacks` have been rolled. */
  plannedAttackRolled: boolean[] = [];
  /** Attacks rolled after the round's first, one at a time (resolveHeldAttack). */
  heldAttacksResolved: number = 0;
  /** The result of the attack resolveHeldAttack rolled last. */
  lastHeldAttackResult: AttackResult | undefined = undefined;
  specialAttackList: any[] = []; // (?)
  scheduledActionList: CombatRoundAction[] = [];
  action: CombatRoundAction;

  constructor(owner: ModuleObject){
    this.owner = owner;
    this.initialize();
  }

  /**
   * Initialize the combat round
   */
  initialize(){
    this.roundStarted = false;
    this.spellCastRound = false;
    this.deflectArrow = true;
    this.weaponSucks = false;
    this.dodgeTarget = undefined;
    this.newAttackTarget = undefined;
    this.engaged = false;
    this.master = false;
    this.masterID = undefined;
    this.roundPaused = false;
    this.roundPausedBy = undefined;
    this.infinitePause = false;
    this.pauseTimer = 0;
    this.timer = 0;
    this.roundLength = CombatRound.ROUND_LENGTH;
    this.overlapAmount = 0;
    this.bleedTimer = 0;
    this.currentAttack = 0;
    this.attackID = 0;
    this.attackGroup = 0;
    this.parryIndex = 0;
    this.numAOOs = 1;
    this.numCleaves = 1;
    this.onHandAttacks = 1;
    this.additionalAttacks = 0;
    this.effectAttacks = 0;
    this.parryActions = 0;
    this.offHandTaken = false;
    this.extraTaken = false;
    this.attackList = new Array(5);
    for(let i = 0; i < 5; i++){
      this.attackList[i] = new CombatAttackData();
    }
  }

  /**
   * Begin the combat round
   */
  beginCombatRound(){
    // (per-round begin/end logs removed: one line every 3 s per combatant)
    if(!BitWise.InstanceOfObject(this.owner, ModuleObjectType.ModuleCreature)) return;

    const owner: ModuleCreature = this.owner as any;

    this.roundStarted = true;

    this.onHandAttacks = owner.equipment.RIGHTHAND ? 1 : 0;
    this.additionalAttacks = 0;
    this.offHandTaken = false;
    this.extraTaken = false;

    this.spellCastRound = false;
    this.deflectArrow = true;

    const combatData = owner.combatData;

    combatData.lastAttackTarget = undefined;
    combatData.lastSpellTarget = undefined;
    this.timer = 0;

    if(this.action){
      const target = this.action.target;
      const targetCombatRound = target.combatRound;
      if(this.action.actionType == CombatActionType.ATTACK){
        combatData.lastAttackTarget = target;
        if(BitWise.InstanceOfObject(owner, ModuleObjectType.ModuleCreature) && BitWise.InstanceOfObject(target, ModuleObjectType.ModuleCreature)){
          if(owner.isDuelingObject(target)){
            this.engaged = true;
            if(!this.masterID && !targetCombatRound.masterID){
              this.masterID = targetCombatRound.masterID = owner;
              this.master = true;
              targetCombatRound.master = false;
            }else if(!this.masterID){
              this.masterID = targetCombatRound.masterID;
              this.master = false;
            }
          }
        }else if(BitWise.InstanceOfObject(owner, ModuleObjectType.ModuleCreature) && BitWise.InstanceOfObject(target, ModuleObjectType.ModuleObject)){
          this.master = true;
          targetCombatRound.master = !this.master;
        }
      }else if(
        this.action.actionType == CombatActionType.CAST_SPELL ||
        this.action.actionType == CombatActionType.ITEM_CAST_SPELL
      ){
        this.spellCastRound = true;
      }else if(this.action.actionType == CombatActionType.ATTACK_USE_FEAT){
        // Once per action: a duel partner's round begins this round again
        // mid-way, and re-applying the feat there renewed Flurry's -4 so that
        // it outlived the round into the next, plain one.
        if(!this.action.featImpacted){
          this.action.featImpacted = true;
          this.action.feat.impactCaster(owner);
          this.action.feat.impactTarget(this.action.target);
        }
        switch(this.action.featId){
          case CombatFeatType.FLURRY:
          case CombatFeatType.IMPROVED_FLURRY:
          case CombatFeatType.MASTER_FLURRY:
          case CombatFeatType.RAPID_SHOT:
          case CombatFeatType.IMPROVED_RAPID_SHOT:
          case CombatFeatType.MASTER_RAPID_SHOT:
            if(owner.equipment.RIGHTHAND){
              this.additionalAttacks += 1;
            }
          break;
        }
      }
    }
  }

  /**
   * End the combat round
   */
  endCombatRound(){

    this.roundStarted = false;
    const combatData = this.owner.combatData;
    combatData.lastCombatFeatUsed = undefined;
    combatData.lastForcePowerUsed = undefined;

    if(this.action){
      if(
        this.action.actionType == CombatActionType.ATTACK ||
        this.action.actionType == CombatActionType.ATTACK_USE_FEAT
      ){
        combatData.lastAttackAction = ActionType.ActionPhysicalAttacks;
        combatData.lastAttackResult = this.action.attackResult;
        if(this.action.feat){
          combatData.lastCombatFeatUsed = this.action.feat;
        }
      }else if(this.action.actionType == CombatActionType.CAST_SPELL){
        combatData.lastAttackAction = ActionType.ActionCastSpell;
        combatData.lastAttemptedSpellTarget = this.action.target;
        if(this.action.spell){
          combatData.lastForcePowerUsed = this.action.spell;
        }
      }else if(this.action.actionType == CombatActionType.ITEM_CAST_SPELL){
        combatData.lastAttackAction = ActionType.ActionItemCastSpell;
        combatData.lastAttemptedSpellTarget = this.action.target;
        if(this.action.spell){
          combatData.lastForcePowerUsed = this.action.spell;
        }
      }
    }

    this.roundPaused = false;
    this.roundPausedBy = undefined;
    this.pauseTimer = 0;
    this.bleedTimer = 0;
    this.infinitePause = false;
    this.extraTaken = false;
    this.attackID = 0;
    this.overlapAmount = 0;
    this.parryIndex = 0;
    this.roundLength = CombatRound.ROUND_LENGTH;
    this.weaponSucks = false;
    this.spellCastRound = false;
    this.deflectArrow = true;
    this.action = undefined;
    this.timer = 0;
    for(let i = 0; i < 5; i++){
      this.attackList[i].reset();
    }
    // Attacks the round held and nobody asked for are lost with it.
    this.plannedAttacks = [];
    this.plannedAttackRolled = [];
    this.heldAttacksResolved = 0;
    this.lastHeldAttackResult = undefined;
    this.removeRoundFeatAttackPenalty();
    this.owner.onCombatRoundEnd();
  }

  /**
   * Flurry, Rapid Shot and Power Attack lower "all attacks that round": the
   * attack penalty a feat round applied ends with the round.
   */
  removeRoundFeatAttackPenalty(){
    const owner = this.owner;
    const effects = Array.isArray(owner?.effects) ? owner.effects : [];
    for(const effect of [...effects]){
      if((effect as any)?.featPenaltyRoundOnly === true) owner.removeEffect(effect);
    }
  }

  /**
   * Reset the combat round
   */
  reset(){
    //
  }

  /**
   * Update the combat round
   * @param delta - The delta time to update the round for
   */
  update(delta: number = 0){
    if(!this.roundStarted) return;

    if(this.roundPaused){
      this.pauseTimer -= (delta * 1000);
      if(this.pauseTimer < 0) this.pauseTimer = 0;
      if(this.pauseTimer <= 0 && !this.infinitePause){
        this.roundPaused = false;
        this.pauseTimer = 0;
        this.endCombatRound();
      }
    }else{
      this.timer += (delta * 1000);
      if(this.timer >= this.roundLength){
        this.endCombatRound();
      }
    }
  }

  /**
   * Pause the round for the given pause owner and pause timer
   * @param pauseOwner - The pause owner to pause the round for
   * @param pauseTimer - The pause timer to pause the round for
   */
  pauseRound(pauseOwner: ModuleObject, pauseTimer: number = 0){
    this.roundPaused = true;
    this.roundPausedBy = pauseOwner;
    this.pauseTimer = pauseTimer;
    this.pauseLength = pauseTimer;
  }

  /** The length the current pause started at; the VR hilt ring reads it. */
  pauseLength: number = 0;

  /**
   * Unpause the round for the given pause owner
   * @param pauseOwner - The pause owner to unpause the round for
   */
  unpauseRound(pauseOwner: ModuleObject){
    if(this.roundPausedBy == pauseOwner){
      this.roundPaused = false;
      this.pauseTimer = 0;
    }
  }

  /**
   * Add an action to the scheduled action list
   * @param action - The action to add
   */
  addAction(action: CombatRoundAction){
    action.owner = this.owner;
    this.scheduledActionList.push(action);
  }

  /**
   * Clear all actions
   */
  clearActions(){
    this.action = undefined;
    this.scheduledActionList = [];
  }

  /**
   * Clear the action for the given combat action
   * @param action - The action to clear
   * @returns True if the action was cleared, false otherwise
   */
  clearAction(action: CombatRoundAction){
    let index = this.scheduledActionList.indexOf(action);
    if(index >= 0){
      this.scheduledActionList.splice( index, 1 );
      return true;
    }
    return false;
  }

  /**
   * Clear the actions by target
   * @param target - The target to clear the actions for
   */
  clearActionsByTarget(target: ModuleObject){
    let index = this.scheduledActionList.length;
    while(index--){
      const action = this.scheduledActionList[index];
      if(action && action.target == target){
        this.scheduledActionList.splice(index, 1);
      }
    }
  }

  /**
   * Set the attack target for the given combat action
   * @param target - The target to set the attack target for
   * @returns True if the attack target was set, false otherwise
   */
  setAttackTarget(target: ModuleObject): boolean {
    if(!target) return false;
    for(let i = 0, len = this.scheduledActionList.length; i < len; i++){
      this.scheduledActionList[i].target = target;
    }
  }

  /**
   * Calculate the attack damage for the given creature and combat action
   * @param creature - The creature to calculate the attack damage for
   * @param combatAction - The combat action to calculate the attack damage for
   */
  calculateAttackDamage(creature: ModuleCreature, combatAction: CombatRoundAction){
    if(!combatAction || combatAction.resultsCalculated)
      return;

      creature.weaponPowered(true);

    combatAction.resultsCalculated = true;
    const hasAssuredHit = creature.hasEffect(GameEffectType.EffectAssuredHit);
    this.currentAttack = 0;

    if(!combatAction.isCutsceneAttack){
      combatAction.attackResult = (hasAssuredHit) ? AttackResult.AUTOMATIC_HIT : AttackResult.MISS;
      combatAction.attackDamage = 0;
      if(creature){
        // Main hand, off hand (or a double-bladed weapon's second blade),
        // then Flurry / Rapid Shot's extra: CombatAttackPlan keeps the order
        // this method has always rolled them in.
        this.plannedAttacks = this.buildAttackPlan(creature);
        this.plannedAttackRolled = this.plannedAttacks.map(() => false);
        this.heldAttacksResolved = 0;
        this.lastHeldAttackResult = undefined;
        const holds = this.plannedAttacks.length > 1 && CombatRound.holdsLaterAttacks?.(creature) === true;
        const rollNow = holds ? 1 : this.plannedAttacks.length;
        for(let i = 0; i < rollNow; i++){
          const planned = this.plannedAttacks[i];
          this.plannedAttackRolled[i] = true;
          this.calculateWeaponAttack(creature, planned.weapon, planned.slot, combatAction);
        }
      }
    }

    combatAction.target.combatData.lastAttacker = creature;
    creature.combatData.lastAttackResult = combatAction.attackResult;
    combatAction.target.onAttacked(combatAction.actionType);

    this.calculateRoundAnimations(creature, combatAction);

    let attackAnimation = creature.model.odysseyAnimationMap.get(combatAction.animationName.toLowerCase().trim());
    let attackDamageDelay = attackAnimation?.getDamageDelay() || 0;

    if(combatAction.isCutsceneAttack){
      const attack = this.attackList[0];
      if(attack){
        attack.attackResult = combatAction.attackResult;
        if(
          attack.attackResult == AttackResult.HIT_SUCCESSFUL ||
          attack.attackResult == AttackResult.CRITICAL_HIT ||
          attack.attackResult == AttackResult.AUTOMATIC_HIT
        ){
          attack.attackWeapon = creature.equipment.RIGHTHAND;
          attack.attackResult = combatAction.attackResult
          attack.damageList[DamageType.BASE].damageValue = combatAction.attackDamage;
          attack.applyDamageEffectToCreature(creature, this.action.target as ModuleCreature);
        }
      }
    }else{
      //process attack results
      for(let i = 0; i < this.currentAttack; i++){
        this.applyAttackOutcome(creature, this.attackList[i]);
      }
    }

  }

  /** Applies one rolled attack: its damage on a hit, the floating number or "miss". */
  private applyAttackOutcome(creature: ModuleCreature, attack: CombatAttackData | undefined){
    if(!attack)
      return;

    if(
      attack.attackResult == AttackResult.HIT_SUCCESSFUL ||
      attack.attackResult == AttackResult.CRITICAL_HIT ||
      attack.attackResult == AttackResult.AUTOMATIC_HIT
    ){
      attack.applyDamageEffectToCreature(creature, this.action.target as ModuleCreature);
      TextSprite3D.CreateOnObject(this.action.target, attack.getTotalDamage().toString(), TextSprite3DType.HOSTILE, 1500);
    }else if(attack.attackResult == AttackResult.MISS){
      TextSprite3D.CreateOnObject(this.action.target, 'miss', TextSprite3DType.NEUTRAL, 1500);
    }
  }

  /** The round's attacks for `creature`, in the order they roll. */
  buildAttackPlan(creature: ModuleCreature): CombatPlannedAttack<ModuleItem>[] {
    const equipment = creature.equipment;
    return buildCombatAttackPlan<ModuleItem>({
      simple: creature.isSimpleCreature(),
      rightHand: equipment.RIGHTHAND,
      leftHand: equipment.LEFTHAND,
      claws: [equipment.CLAW1, equipment.CLAW2, equipment.CLAW3],
      rightHandDoubleBladed: this.isDoubleBladed(equipment.RIGHTHAND),
      additionalAttacks: this.additionalAttacks,
      // Knight Speed / Master Speed ("+1 / +2 attacks per round") are not
      // restored yet. When they are, their count goes here.
      speedAttacks: 0,
      maxAttacks: this.attackList.length,
    });
  }

  /**
   * How many of this round's attacks are still held for `hand`
   * (CombatRound.holdsLaterAttacks). Zero once the round has ended, its
   * target has died, or everything has been rolled.
   */
  heldAttackCount(hand: CombatAttackHand): number {
    if(!this.canResolveHeldAttack()) return 0;
    return countHeldCombatAttacks(this.plannedAttacks, this.plannedAttackRolled, hand);
  }

  /**
   * Rolls the next attack this round is holding for `hand`, exactly as the
   * round would have rolled it at its start, applies it and logs it. Returns
   * its result, or undefined when there is nothing to roll.
   */
  resolveHeldAttack(creature: ModuleCreature, hand: CombatAttackHand): AttackResult | undefined {
    if(!creature || creature !== (this.owner as unknown) || !this.canResolveHeldAttack()) return undefined;
    const index = selectHeldCombatAttack(this.plannedAttacks, this.plannedAttackRolled, hand);
    if(index < 0) return undefined;
    const planned = this.plannedAttacks[index];
    const combatAction = this.action;
    this.plannedAttackRolled[index] = true;
    const slot = this.currentAttack;
    this.calculateWeaponAttack(creature, planned.weapon, planned.slot, combatAction);
    if(this.currentAttack === slot) return undefined;
    const attack = this.attackList[slot];
    this.applyAttackOutcome(creature, attack);
    this.playHeldAttackReaction(creature, combatAction, attack.attackResult);
    this.heldAttacksResolved++;
    this.lastHeldAttackResult = attack.attackResult;
    return attack.attackResult;
  }

  private canResolveHeldAttack(): boolean {
    const action = this.action;
    if(!this.roundStarted || !action || !action.resultsCalculated || action.isCutsceneAttack) return false;
    if(action.actionType != CombatActionType.ATTACK && action.actionType != CombatActionType.ATTACK_USE_FEAT) return false;
    const target = action.target;
    if(!target || (typeof target.isDead === 'function' && target.isDead())) return false;
    return this.plannedAttackRolled.some((rolled) => !rolled);
  }

  /**
   * The target's flinch or dodge for an attack rolled after the round's first,
   * by the rule calculateRoundAnimations uses for the round's own.
   */
  private playHeldAttackReaction(creature: ModuleCreature, combatAction: CombatRoundAction, result: AttackResult){
    if(!combatAction?.target || !BitWise.InstanceOfObject(combatAction.target, ModuleObjectType.ModuleCreature)) return;
    const target: ModuleCreature = combatAction.target as any;
    if(target.isDead()) return;
    if(target.animationState.index != ModuleCreatureAnimState.IDLE && target.animationState.index != ModuleCreatureAnimState.READY) return;
    if(target.combatData.lastAttackTarget != creature || this.attacksIncludeKillingBlow()) return;
    const hit = result == AttackResult.HIT_SUCCESSFUL || result == AttackResult.CRITICAL_HIT || result == AttackResult.AUTOMATIC_HIT;
    if(hit){
      target.playTwoDAAnimation( target.getDamageAnimation( combatAction.animationName ) );
      target.animationState.index = ModuleCreatureAnimState.DAMAGE;
    }else{
      target.playTwoDAAnimation( target.getDodgeAnimation( combatAction.animationName ) );
      target.animationState.index = ModuleCreatureAnimState.DODGE;
    }
  }

  /**
   * Calculate the attack roll for the given creature and weapon
   * @param creature - The creature to calculate the attack roll for
   * @param weapon - The weapon to calculate the attack roll for
   * @returns The attack roll
   */
  calculateAttackRoll(creature: ModuleCreature, weapon: ModuleItem){
    return Dice.roll(1, DiceType.d20, creature.getAttackBonusFor(weapon));
  }

  /**
   * Check if the attack roll is a critical hit
   * @param attackRoll - The attack roll to check
   * @param weapon - The weapon to check the critical hit for
   * @returns True if the attack roll is a critical hit, false otherwise
   */
  isCritical(attackRoll: number, weapon: ModuleItem | undefined = undefined): boolean {
    if(!weapon) return attackRoll == 20;
    return (attackRoll > weapon.getCriticalThreatRangeMin() && attackRoll <= 20);
  }

  /**
   * Check if the creature is dual-wielding
   * @param creature - The creature to check if it is dual-wielding
   * @returns True if the creature is dual-wielding, false otherwise
   */
  isDualWielding(creature: ModuleCreature): boolean {
    const rightHand = creature.equipment.RIGHTHAND;
    const leftHand = creature.equipment.LEFTHAND;
    if(!leftHand && this.isDoubleBladed(rightHand)) return true;
    return (
      rightHand && ( rightHand.getBaseItem().weaponWield != WeaponWield.STUN_BATON ) &&
      leftHand && ( leftHand.getBaseItem().weaponWield != WeaponWield.STUN_BATON )
    );
  }

  /**
   * Double-bladed swords, vibro double-blades and double lightsabers:
   * baseitems.2da weaponwield 3 with "Double" in the label. The quarterstaff
   * shares weaponwield 3 but is not double-bladed.
   */
  isDoubleBladed(weapon: ModuleItem | undefined): boolean {
    // baseitems.2da rows 6, 7 and 9 (critic run 5: not a label match).
    const id = weapon?.getBaseItemId?.();
    return id === BaseItemType.DOUBLE_BLADED_SWORD || id === BaseItemType.VIBRO_DOUBLE_BLADE ||
      id === BaseItemType.DOUBLE_BLADED_LIGHTSABER;
  }

  /**
   * Critical Strike / Sniper Shot stun on a hit, Power Attack / Blast knock
   * down on a critical, each unless the target makes the Fortitude save the
   * feat text names (CombatFeatRules).
   */
  private applyFeatOnHit(creature: ModuleCreature, weapon: ModuleItem | undefined, combatAction: CombatRoundAction, critical: boolean){
    if(!weapon) return;
    const save = resolveFeatOnHitSave(combatAction.feat?.id, !!weapon.isRangedWeapon?.());
    if(!save || (save.on === 'critical' && !critical)) return;
    const target = combatAction.target as ModuleObject;
    if(!target || (typeof target.isDead === 'function' && target.isDead())) return;
    // Droids (race 5) do not stun: TSL's Force Stun skips them and Stun Droid
    // exists for them. The engine has no immunity system yet (critic run 6).
    if(save.effect === 'stun' && (target as any).getRace?.() === 5) return;
    try{
      const ability = save.ability === 'STR' ? creature.getSTR() : save.ability === 'DEX' ? creature.getDEX() : creature.getINT();
      const dc = resolveFeatSaveDC(save, creature.getTotalClassLevel?.() ?? 0, CombatRound.GetMod(ability));
      if(typeof target.fortitudeSave === 'function' && target.fortitudeSave(dc, 0, creature)) return;
      const effect = save.effect === 'stun'
        ? new GameState.GameEffectFactory.EffectSetState()
        : new GameState.GameEffectFactory.EffectKnockdown();
      if(save.effect === 'stun') effect.setInt(0, 4); // Stunned, as EffectStunned()
      effect.setCreator(creature);
      effect.setDurationType(GameEffectDurationType.TEMPORARY);
      effect.setDuration(save.seconds);
      effect.initialize();
      target.addEffect(effect);
      // A stunned or knocked-down VR player otherwise only found out by being
      // refused (critic run 6).
      try { GameState.onPlayerDisabled?.(target, save.effect === 'stun' ? 'Stunned' : 'Knocked down', save.seconds); } catch { /* feedback only */ }
    }catch(e){
      console.error('CombatRound: feat on-hit effect failed', e);
    }
  }

  /**
   * Calculate the two-weapon penalty for the given creature and slot
   * @param creature - The creature to calculate the penalty for
   * @param slot - The slot to calculate the penalty for
   * @returns The two-weapon penalty
   */
  calculateTwoWeaponPenalty(creature: ModuleCreature, slot: ModuleCreatureArmorSlot.RIGHTHAND|ModuleCreatureArmorSlot.LEFTHAND){
    if(!creature) return 0;
    if(creature.isSimpleCreature()) return 0;
    return resolveTwoWeaponPenalty({
      offHand: slot == ModuleCreatureArmorSlot.LEFTHAND,
      // "Balanced" is a light off-hand weapon (a short blade or a pistol). It
      // eases the MAIN hand by 2; the main hand's own weapon used to decide
      // it, and the relief went to the off hand (critic runs 3 and 4).
      balancedOffHand: Number(creature.equipment.LEFTHAND?.getBaseItem?.()?.weaponSize) == WeaponSize.SMALL,
      hasFeat: (feat: number) => !!creature.getHasFeat(feat),
    });
  }

  /**
   * Calculate the weapon attack for the given creature and weapon
   * @param creature - The creature to calculate the attack for
   * @param weapon - The weapon to calculate the attack for
   * @param weaponSlot - The slot of the weapon
   * @param combatAction - The combat action to calculate the attack for
   */
  calculateWeaponAttack(creature: ModuleCreature, weapon: ModuleItem | undefined = undefined, weaponSlot: ModuleCreatureArmorSlot, combatAction: CombatRoundAction) {
    // For GetLastWeaponUsed: the weapon of the attack being rolled now.
    creature.combatData.lastWeaponUsed = weapon;
    let attackBonus = creature.getAttackBonusFor(weapon);
    const isDualWielding = this.isDualWielding(creature);
    const isMainHand = weapon && weaponSlot == ModuleCreatureArmorSlot.RIGHTHAND;
    const isOffHand = weapon && weaponSlot == ModuleCreatureArmorSlot.LEFTHAND;
    if(isDualWielding && (isMainHand || isOffHand)){
      attackBonus -= this.calculateTwoWeaponPenalty(creature, weaponSlot);
    }
    // TSL's attack roll (see TSLCombatRules): meet defense to hit, natural 1
    // misses, natural 20 hits, and a threat needs a second roll to become a
    // critical. This used to add bonuses before testing the threat range, hit
    // only on beating defense, and make every threat an automatic critical hit.
    const natural = Dice.roll(1, DiceType.d20);
    const roll = resolveAttackRoll({
      natural,
      attackBonus,
      defense: combatAction.target.getAC(),
      // Critical Strike / Sniper Shot widen the threat range 2x/3x/4x.
      threatRangeMin: weapon
        ? resolveThreatRangeMin(weapon.getCriticalThreatRangeMin() + 1,
          resolveThreatRangeMultiplier(combatAction.feat?.id, !!weapon.isRangedWeapon?.()))
        : 20,
      threatNatural: Dice.roll(1, DiceType.d20),
    });
    const attackRoll = roll.total;
    const isCritical = roll.critical;
    const hasAssuredHit = creature.hasEffect(GameEffectType.EffectAssuredHit);
    const attack = this.attackList[this.currentAttack];
    if(!attack) return;
    attack.attackSlot = weaponSlot;
    const previousResult = this.currentAttack > 0 ? combatAction.attackResult : undefined;
    if(hasAssuredHit || roll.hit){
      if(this.tryBlasterDeflection(creature, weapon, attackRoll, combatAction, attack)){
        // Through the same ranking as hits and misses: a main-blade hit then a
        // deflected off-hand shot is a round that hit (critic run 6).
        combatAction.attackResult = bestAttackResult(previousResult, AttackResult.DEFLECTED);
      }else{
        const result = (!hasAssuredHit && isCritical) ? AttackResult.CRITICAL_HIT : AttackResult.HIT_SUCCESSFUL;
        combatAction.attackResult = bestAttackResult(previousResult, result);
        attack.reactObject = combatAction.target;
        attack.attackWeapon = weapon;
        attack.attackResult = result;
        attack.calculateDamage(creature, !hasAssuredHit && isCritical, combatAction.feat);
        this.applyFeatOnHit(creature, weapon, combatAction, result === AttackResult.CRITICAL_HIT);
      }
    }else{
      // The round's result is its best attack: a double-blade's off-hand
      // miss after a main-blade hit used to report the round as a miss
      // (critic run 5), and the VR feedback played the miss cue.
      combatAction.attackResult = bestAttackResult(previousResult, AttackResult.MISS);
      attack.reactObject = combatAction.target;
      attack.attackWeapon = weapon;
      attack.attackResult = AttackResult.MISS;
    }

    // Log to combat menu - create feedback message for the attack result
    this.logAttackResult(creature, weapon, combatAction, isCritical, hasAssuredHit, {
      natural, bonus: attackBonus, total: attackRoll,
      result: attack.attackResult,
      damage: attack.attackResult === AttackResult.HIT_SUCCESSFUL || attack.attackResult === AttackResult.CRITICAL_HIT
        ? Number(attack.getTotalDamage?.()) || 0 : 0,
    });

    this.currentAttack++;
  }

  /**
   * Blaster bolt deflection (Jedi Defense feat line). Per the feat
   * descriptions (Jedi Defense/Advanced/Master +0/+3/+6) and the
   * NWScriptDef comments for opcodes 469/470/252: a ranged attack that
   * would otherwise hit a creature with a lightsaber and the Jedi Defense
   * feat instead triggers an opposed roll — if the defender's roll beats
   * the attack roll the bolt is deflected, and if it's beaten by 10 or
   * more the bolt reflects back at the attacker for the same weapon
   * damage. EffectAssuredDeflection skips the roll entirely.
   * @returns true if the attack was deflected (converts what would have
   * been a hit into AttackResult.DEFLECTED — the caller must not also
   * apply hit damage)
   */
  private tryBlasterDeflection(
    attacker: ModuleCreature,
    weapon: ModuleItem | undefined,
    attackRoll: number,
    combatAction: CombatRoundAction,
    attack: CombatAttackData
  ): boolean {
    if(!weapon || !weapon.isRangedWeapon()) return false;
    const target = combatAction.target;
    if(!BitWise.InstanceOfObject(target, ModuleObjectType.ModuleCreature)) return false;
    const defender = target as unknown as ModuleCreature;

    const decision = resolveBlasterDeflection({
      attackRoll,
      assuredDeflection: defender.hasAssuredDeflection(),
      assuredDeflectionReflects: defender.assuredDeflectionReflectsDamage(),
      deflectionBonus: defender.getBlasterDeflectionBonus(),
      rollD20: () => Dice.roll(1, DiceType.d20),
    });
    if(!decision.deflected) return false;

    attack.attackWeapon = weapon;
    attack.attackResult = AttackResult.DEFLECTED;
    attack.reactObject = defender;

    if(decision.reflect){
      // The deflected bolt's damage is still the attacker's own weapon
      // damage — only who it lands on changes. Swap reactObject to the
      // attacker just for this calculation so the killing-blow check
      // inside calculateDamage() compares against the right creature's HP.
      attack.reactObject = attacker;
      attack.calculateDamage(attacker, false, combatAction.feat);
      attack.applyDamageEffectToCreature(defender, attacker);
      attack.reactObject = defender;
    }

    return true;
  }

  /**
   * Calculate the round animations for the given creature and combat action
   * @param creature - The creature to calculate the animations for
   * @param combatAction - The combat action to calculate the animations for
   */
  calculateRoundAnimations(creature: ModuleCreature, combatAction: CombatRoundAction){
    if(!combatAction) return;

    let attackKey = creature.getCombatAnimationAttackType();
    let weaponWield = creature.getCombatAnimationWeaponType();
    let attackType = 1;

    //Get random basic melee attack in combat with another melee creature that is targeting you
    if(attackKey == 'm'){
      if(this.engaged && !this.attacksIncludeKillingBlow()){
        attackKey = 'c';
        attackType = Math.round(Math.random()*4)+1;
      }
    }

    this.action.animationName = attackKey+weaponWield+'a'+attackType;
    this.action.twoDAAnimation = OdysseyModelAnimation.GetAnimation2DA(this.action.animationName);

    if(combatAction.isCutsceneAttack){

      if(creature){
        creature.playTwoDAAnimation(combatAction.twoDAAnimation);
        creature.animationState.index = ModuleCreatureAnimState.ATTACK;
      }

      if(combatAction.target){
        const target: ModuleCreature = combatAction.target as any;
        switch(combatAction.attackResult){
          case AttackResult.HIT_SUCCESSFUL:
          case AttackResult.CRITICAL_HIT:
          case AttackResult.AUTOMATIC_HIT:
            target.playTwoDAAnimation( target.getDamageAnimation( combatAction.animationName ) );
            target.animationState.index = ModuleCreatureAnimState.DAMAGE;
          break;
          case AttackResult.PARRIED:
            target.playTwoDAAnimation( target.getParryAnimation( combatAction.animationName ) );
            target.animationState.index = ModuleCreatureAnimState.PARRY;
          break;
          default:
            target.playTwoDAAnimation( target.getDamageAnimation( combatAction.animationName ) );
            target.animationState.index = ModuleCreatureAnimState.DAMAGE;
          break;
        }
      }

    }else{

      if(
        combatAction.attackResult == AttackResult.HIT_SUCCESSFUL ||
        combatAction.attackResult == AttackResult.CRITICAL_HIT
      ){

        if(creature){
          creature.playTwoDAAnimation( combatAction.twoDAAnimation );
          creature.animationState.index = ModuleCreatureAnimState.ATTACK;
        }

        if(combatAction.target && BitWise.InstanceOfObject(combatAction.target, ModuleObjectType.ModuleCreature)){
          const target: ModuleCreature = combatAction.target as any;
          if(
            target.animationState.index == ModuleCreatureAnimState.IDLE ||
            target.animationState.index == ModuleCreatureAnimState.READY
          ){
            if(target.combatData.lastAttackTarget == creature){
              if(!this.attacksIncludeKillingBlow()){
                target.playTwoDAAnimation( target.getDamageAnimation( combatAction.animationName ) );
                target.animationState.index = ModuleCreatureAnimState.DAMAGE;
              }
            }
          }
        }

      }else{

        if(creature){
          creature.playTwoDAAnimation( combatAction.twoDAAnimation );
          creature.animationState.index = ModuleCreatureAnimState.ATTACK;
        }

        if(combatAction.target && BitWise.InstanceOfObject(combatAction.target, ModuleObjectType.ModuleCreature)){
          const target: ModuleCreature = combatAction.target as any;
          if(
            target.animationState.index == ModuleCreatureAnimState.IDLE ||
            target.animationState.index == ModuleCreatureAnimState.READY
          ){
            if(combatAction.target.combatData.lastAttackTarget == creature){
              if(!this.attacksIncludeKillingBlow()){
                target.playTwoDAAnimation( target.getDodgeAnimation( combatAction.animationName ) );
                target.animationState.index = ModuleCreatureAnimState.DODGE;
              }
            }
          }
        }
      }
    }

  }

  /**
   * Check if the attacks include a killing blow
   * @returns True if the attacks include a killing blow, false otherwise
   */
  attacksIncludeKillingBlow(){
    for(let i = 0; i < 5; i++){
      if(this.attackList[i].killingBlow) return true;
    }
    return false;
  }

  /**
   * Convert the combat round to a GFF struct
   * @param structIdx - The index of the struct
   * @returns The GFF struct
   */
  toStruct(structIdx: number = 0xCADA){
    const struct = new GFFStruct(structIdx);

    return struct;
  }

  /**
   * Log the attack result to the combat feedback system
   * @param creature - The creature performing the attack
   * @param weapon - The weapon used in the attack
   * @param combatAction - The combat action containing the result
   * @param isCritical - Whether the attack was a critical hit
   * @param hasAssuredHit - Whether the attack had assured hit effect
   */
  logAttackResult(creature: ModuleCreature, weapon: ModuleItem | undefined, combatAction: CombatRoundAction, isCritical: boolean, hasAssuredHit: boolean,
    rollInfo?: { natural: number; bonus: number; total: number; result: AttackResult; damage: number }) {
    const { FeedbackMessageManager } = GameState;
    // Retail's Combat tab (dialog.tlk 1404 and 1403): "<attacker> attacks
    // <target> : *<result>* : (<d20> + <bonus> = <total>)", then the damage.
    // The old line named no target, roll or damage (critic run 19).
    if(rollInfo && combatAction?.target){
      const words: Partial<Record<AttackResult, string>> = {
        [AttackResult.CRITICAL_HIT]: 'critical hit',
        [AttackResult.HIT_SUCCESSFUL]: 'hit',
        [AttackResult.AUTOMATIC_HIT]: 'automatic hit',
        [AttackResult.MISS]: 'miss',
        [AttackResult.PARRIED]: 'parried',
        [AttackResult.DEFLECTED]: 'deflected',
        [AttackResult.ATTACK_RESISTED]: 'resisted',
      };
      const attacker = creature.getName();
      const target = (combatAction.target as any)?.getName?.() || 'target';
      // dialog.tlk words it "automatic hit" (critic run 20).
      const word = hasAssuredHit && rollInfo.result !== AttackResult.MISS ? 'automatic hit' : (words[rollInfo.result] ?? 'attack');
      const sign = rollInfo.bonus < 0 ? '-' : '+';
      // The tab lists newest first: the damage line goes in first so it reads
      // below its attack (critic run 20).
      if(rollInfo.damage > 0){
        FeedbackMessageManager.AddLine(`${attacker} damages ${target} for ${rollInfo.damage} damage`, true, FeebackMessageColor.ATTACK);
      }
      FeedbackMessageManager.AddLine(
        `${attacker} attacks ${target} : *${word}* : (${rollInfo.natural} ${sign} ${Math.abs(rollInfo.bonus)} = ${rollInfo.total})`, true,
        rollInfo.result === AttackResult.MISS ? FeebackMessageColor.INFO : FeebackMessageColor.ATTACK);
      console.log(`Combat Log: ${attacker} attacks ${target} : *${word}* : (${rollInfo.natural} ${sign} ${Math.abs(rollInfo.bonus)} = ${rollInfo.total})${rollInfo.damage > 0 ? ` for ${rollInfo.damage}` : ''}`);
      return;
    }

    let message = '';
    let color = FeebackMessageColor.ATTACK;

    // Get weapon name for display
    const weaponName = weapon ? weapon.getName() : 'Unarmed';

    // Format message based on attack result
    switch (combatAction.attackResult) {
      case AttackResult.CRITICAL_HIT:
        if (hasAssuredHit) {
          message = `${creature.getName()}: *Assured Hit* Critical Hit with ${weaponName}!`;
        } else {
          message = `${creature.getName()}: Critical Hit with ${weaponName}!`;
        }
        break;

      case AttackResult.HIT_SUCCESSFUL:
        if (hasAssuredHit) {
          message = `${creature.getName()}: *Assured Hit* Hit with ${weaponName}!`;
        } else {
          message = `${creature.getName()}: Hit with ${weaponName}!`;
        }
        break;

      case AttackResult.AUTOMATIC_HIT:
        message = `${creature.getName()}: Automatic Hit with ${weaponName}!`;
        break;

      case AttackResult.MISS:
        message = `${creature.getName()}: Miss with ${weaponName}!`;
        color = FeebackMessageColor.INFO; // Use info color for misses
        break;

      case AttackResult.ATTACK_RESISTED:
        message = `${creature.getName()}: Attack Resisted with ${weaponName}!`;
        color = FeebackMessageColor.INFO;
        break;

      case AttackResult.ATTACK_FAILED:
        message = `${creature.getName()}: Attack Failed with ${weaponName}!`;
        color = FeebackMessageColor.INFO;
        break;

      case AttackResult.PARRIED:
        message = `${creature.getName()}: Attack Parried with ${weaponName}!`;
        color = FeebackMessageColor.INFO;
        break;

      case AttackResult.DEFLECTED:
        message = `${creature.getName()}: Attack Deflected with ${weaponName}!`;
        color = FeebackMessageColor.INFO;
        break;

      default:
        message = `${creature.getName()}: Unknown attack result with ${weaponName}!`;
        color = FeebackMessageColor.INFO;
        break;
    }

    // Create and add the feedback message entry
    const entry = new FeedbackMessageEntry();
    entry.message = message;
    entry.color = color;
    entry.type = 0; // Standard combat feedback type
    entry.combat = true;

    FeedbackMessageManager.AddEntry(entry);

    // Also log to console for debugging
    console.log(`Combat Log: ${message}`);
  }

  /**
   * Calculate the ability modifier for the given value
   * @param val - The value to calculate the modifier for
   * @returns The ability modifier
   */
  static GetMod(val=0){
    return Math.floor( ( val - 10 ) / 2 );
  }

}
