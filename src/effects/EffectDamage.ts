import { GameEffect } from "@/effects/GameEffect";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { BitWise } from "@/utility/BitWise";
import { calculateDamageAmount } from "@/effects/calculateDamageAmount";

/**
 * EffectDamage class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file EffectDamage.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class EffectDamage extends GameEffect {
  constructor(){
    super();
    this.type = GameEffectType.EffectDamage;
    
    this.setNumIntegers(21);
    this.intList.fill(-1, 0, 16);

    //intList[0-14] : -1 or a per-DamageType damage amount, indexed by the DamageType enum
    //(BLUDGEONING=0 .. ENERGY=12, BASE=13, PHYSICAL=14 - see enums/combat/DamageType.ts).
    //A single hit can populate several of these at once (e.g. weapon base damage plus a
    //BASE-indexed power-attack/spec bonus), so the total damage is their sum, not one slot.
    //intList[16] : 1000
    //intList[17] : Damage Type
    //intList[18] : Damage Power

  }

  onApply(){
    if(this.applied)
      return;
      
    super.onApply();
    
    if(BitWise.InstanceOf(this.object?.objectType, ModuleObjectType.ModuleObject)){
      this.object.subtractHP(this.getDamageAmount());
      this.object.combatData.lastDamager = this.creator;
      this.object.combatData.lastAttacker = this.creator;
    }
  }

  getDamageAmount(){
    return calculateDamageAmount(this.intList);
  }

  getDamageType(){
    return this.getInt(17);
  }

  getDamagePower(){
    return this.getInt(18);
  }

}
