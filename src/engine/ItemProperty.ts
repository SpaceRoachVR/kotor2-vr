import { GameState } from "@/GameState";
import { ModuleItemCostTable } from "@/enums/module/ModuleItemCostTable";
import { GFFDataType } from "@/enums/resource/GFFDataType";
import { GFFField } from "@/resource/GFFField";
import { GFFStruct } from "@/resource/GFFStruct";
import { Dice } from "@/utility/Dice";
import { SWItemPropsDef } from "@/engine/rules/SWItemPropsDef";
import { SWCostTable } from "@/engine/rules/SWCostTable";
import { TwoDAObject } from "@/resource/TwoDAObject";

class SWSubTypeBase {
  id: number;
  name: number;
  label: string;

  getName(){
    return this.name != -1 ? GameState.TLKManager.GetStringById(this.name).Value : this.label;
  }

  static From2DA(row: any = {}){
    const subType = new SWSubTypeBase();
    subType.id = TwoDAObject.normalizeValue(row.__index, 'number', -1);
    subType.name = TwoDAObject.normalizeValue(row.name, 'number', -1);
    subType.label = TwoDAObject.normalizeValue(row.label, 'string', '');
    return subType;
  }
}

export class ItemProperty {
  template: any;
  item: any;
  propertyName: number;
  subType: number;
  costTable: number;
  costValue: number;
  /**
   * -1 means "no upgrade is required to use this property", and that is the
   * correct default: `UpgradeType` is an optional K2 upgrade-system field that
   * most retail templates simply omit. Both security tunnelers
   * (`g_i_secspike01/02`) omit it, as do the great majority of the install's
   * 994 item templates.
   *
   * Left undefined, `isUseable()` computed `1 << undefined` === 1, compared it
   * against `upgrades` (0), and answered false — so EVERY property on such a
   * template read as unusable. That silently disabled armour, attack, damage,
   * Disguise and all six ability bonuses in `ModuleItem`, and the security
   * tunneler's ThievesTools bonus in `ActionUnlockObject`.
   */
  upgradeType: number = -1;
  param1: number;
  param1Value: number;
  chanceAppear: number;
  usesPerDay: number;
  useable: number;

  propertyDefinition: SWItemPropsDef;
  subTypeDefinition: SWSubTypeBase;
  costTableLookupDefinition: SWCostTable;
  costTableDefinition: any;

  constructor(template: any, item: any){
    this.template = template;
    this.item = item;
    this.initProperties();

    //Load the property definition
    this.propertyDefinition = GameState.SWRuleSet.itemPropsDef[this.propertyName];
    if(!this.propertyDefinition){
      console.error(`Invalid Item Property: ${this.propertyName}`);
    }

    //Load the sub type definition
    if(this.propertyDefinition?.hasSubType()){
      const subTypeDef = GameState.TwoDAManager.datatables.get(this.propertyDefinition.subtyperesref.toLowerCase());
      if(subTypeDef){
        const row = subTypeDef.rows[this.subType];
        if(!row){
          //Bail rather than build from the miss. From2DA's default parameter
          //turns an absent row into a subtype with id -1 and an empty label,
          //which reads downstream as a real definition and hides the gap.
          console.error(`Invalid Item Property Sub Type: ${this.subType}`);
        }else{
          this.subTypeDefinition = SWSubTypeBase.From2DA(row);
        }
      }else{
        console.error(`Invalid Item Property Sub Type: ${this.propertyDefinition.subtyperesref}`);
      }
    }

    //Load the cost table definition
    this.costTableLookupDefinition = GameState.SWRuleSet.costTables[this.costTable];
    if(!this.costTableLookupDefinition){
      //The old shape only reported the miss when costTable > -1, and fell into
      //the else for everything else -- so an absent lookup with costTable <= -1
      //dereferenced .name on undefined and threw, turning a data gap into a
      //crash on the item-loading path.
      if(this.costTable > -1){
        console.error(`Invalid Item Property Cost Table: ${this.costTable}`);
      }
    }else{
      const costTable = GameState.TwoDAManager.datatables.get(this.costTableLookupDefinition.name.toLowerCase());
      this.costTableDefinition = costTable;
    }
  }

  getProperty():SWItemPropsDef{
    return this.propertyDefinition;
  }

  getPropertyName(){
    const property = this.getProperty();
    if(!property){
      return new Error(`Invalid Item Property`);
    }
    return property.getName();
  }

  getSubType(){
    return this.subTypeDefinition;
  }

  getSubtypeName(){
    return this.subTypeDefinition?.getName() || '';
  }

  getCostTable() {
    if(this.costTableDefinition){
      return this.costTableDefinition;
    }
    throw new Error('Unable to locate costTable');
  }

  getCostTableRow(){
    return this.costTableDefinition?.rows[this.costValue];
  }

  //Determine if the property requires an upgrade to use, or if it is always useable
  isUseable(){
    //Defensive as well as defaulted: a template that carries UpgradeType as a
    //non-numeric value would otherwise shift by NaN and land back on the same
    //silent "unusable" answer the default above exists to prevent.
    if(!Number.isInteger(this.upgradeType) || this.upgradeType < 0){
      return true;
    }
    const upgrade_flag = (1 << this.upgradeType);
    //If no upgrade is required or the upgrade is present on the item
    if(((this.item?.upgrades ?? 0) & upgrade_flag) == upgrade_flag){
      return true;
    }
    return false;
  }

  is(property: any, subType: any = undefined){
    if(typeof property != 'undefined' && typeof subType != 'undefined'){
      return this.propertyName == property && this.subType == subType;
    }else{
      return this.propertyName == property;
    }
  }

  costTableRandomCheck(){
    let costTable = this.getCostTable();
    //Random Cost Check
    if(this.costValue == 0){
      let rowCount = costTable.rows.length - 1;
      let randomCostValue = (Math.floor(Math.random() * rowCount) + 1); 
      return costTable.rows[randomCostValue];
    }
    return this.getCostTableRow();
  }

  getValue(){
    let costTable = this.getCostTable();
    let costTableRow = this.getCostTableRow();
    if(costTableRow){
      switch(this.costTable){
        case ModuleItemCostTable.Base1:

        break;
        case ModuleItemCostTable.Bonus:
          //Random Cost Check
          costTableRow = this.costTableRandomCheck();

          return parseInt(costTableRow.value);
        break;
        case ModuleItemCostTable.Melee:
          //Random Cost Check
          costTableRow = this.costTableRandomCheck();

          return parseInt(costTableRow.value);
        break;
        case ModuleItemCostTable.SpellUse:
          //Random Cost Check
          costTableRow = this.costTableRandomCheck();

        break;
        case ModuleItemCostTable.Damage:
          //Random Cost Check
          costTableRow = this.costTableRandomCheck();

          if(costTableRow.numdice != '****'){

            return Dice.roll(parseInt(costTableRow.numdice), Dice.intToDiceType(costTableRow.die) );
          }else{
            return parseInt(costTableRow.label);
          }
        break;
        case ModuleItemCostTable.Immune:
          //Random Cost Check
          costTableRow = this.costTableRandomCheck();
          return parseInt(costTableRow.value);
        break;
        case ModuleItemCostTable.DamageSoak:
          //Random Cost Check
          costTableRow = this.costTableRandomCheck();
          return parseInt(costTableRow.amount);
        break;
        case ModuleItemCostTable.DamageResist:
          //Random Cost Check
          costTableRow = this.costTableRandomCheck();
          return parseInt(costTableRow.amount);
        break;
        case ModuleItemCostTable.DancingScimitar:
          //Random Cost Check
          costTableRow = this.costTableRandomCheck();

        break;
        case ModuleItemCostTable.Slots:
          
        break;
        case ModuleItemCostTable.Monster_Cost:
          //Random Cost Check
          costTableRow = this.costTableRandomCheck();

          if(costTableRow.numdice != '****'){
            return Dice.roll(parseInt(costTableRow.numdice), Dice.intToDiceType(costTableRow.die) );
          }
        break;

      }
    }

    return 0;
  }

  initProperties(){
    if(this.template.RootNode.hasField('PropertyName'))
      this.propertyName = this.template.RootNode.getFieldByLabel('PropertyName').getValue();
    
    //'SubType' is not a retail spelling. It is what this engine's own save()
    //used to write, so every item round-tripped through a save before the
    //writer was corrected carries it. Read both so those saves still load.
    if(this.template.RootNode.hasField('Subtype'))
      this.subType = this.template.RootNode.getFieldByLabel('Subtype').getValue();
    else if(this.template.RootNode.hasField('SubType'))
      this.subType = this.template.RootNode.getFieldByLabel('SubType').getValue();

    if(this.template.RootNode.hasField('CostTable'))
      this.costTable = this.template.RootNode.getFieldByLabel('CostTable').getValue();

    if(this.template.RootNode.hasField('CostValue'))
      this.costValue = this.template.RootNode.getFieldByLabel('CostValue').getValue();

    if(this.template.RootNode.hasField('Param1'))
      this.param1 = this.template.RootNode.getFieldByLabel('Param1').getValue();

    if(this.template.RootNode.hasField('Param1Value'))
      this.param1Value = this.template.RootNode.getFieldByLabel('Param1Value').getValue();

    if(this.template.RootNode.hasField('ChanceAppear'))
      this.chanceAppear = this.template.RootNode.getFieldByLabel('ChanceAppear').getValue();

    if(this.template.RootNode.hasField('UsesPerDay'))
      this.usesPerDay = this.template.RootNode.getFieldByLabel('UsesPerDay').getValue();

    //Same story as Subtype above: 'Usable' is this engine's own former
    //misspelling, not a retail one.
    if(this.template.RootNode.hasField('Useable'))
      this.useable = this.template.RootNode.getFieldByLabel('Useable').getValue();
    else if(this.template.RootNode.hasField('Usable'))
      this.useable = this.template.RootNode.getFieldByLabel('Usable').getValue();

    if(this.template.RootNode.hasField('UpgradeType'))
      this.upgradeType = ItemProperty.decodeSentinelByte(
        this.template.RootNode.getFieldByLabel('UpgradeType').getValue()
      );
  }

  /**
   * Undoes the `-1 -> 255` encoding that `save()` applies to these BYTE fields.
   *
   * `save()` writes `this.upgradeType == -1 ? 255 : this.upgradeType`, but the
   * load path took the value raw, so the round trip was asymmetric: a property
   * saved as "no upgrade required" came back as upgrade type 255. `isUseable()`
   * then computed `1 << 255`, which JavaScript masks to `1 << 31`, and that
   * never matches `upgrades` — so the property answered **unusable**.
   *
   * The effect is that every item property becomes inert once it has been
   * through a savegame: armour, attack, damage, the ability bonuses, and the
   * security tunneler's ThievesTools bonus. It hides in a fresh game, where the
   * retail templates simply omit `UpgradeType` and the class default of -1
   * applies — which is why the tunneler worked on a new game and stopped
   * working after a save/load. Reported from a headset session: the tunneler
   * read `upgradeType=255, useable=false` and the combat-training Metal Box
   * (DC 33) failed at the unaided 29.
   */
  static decodeSentinelByte(value: unknown): number {
    if(!Number.isInteger(value as number)) return -1;
    return (value as number) === 255 ? -1 : (value as number);
  }

  save(){
    let propStruct = new GFFStruct(0);

    propStruct.addField( new GFFField(GFFDataType.WORD, 'PropertyName') )?.setValue( this.propertyName == -1 ? 255 : this.propertyName);
    propStruct.addField( new GFFField(GFFDataType.WORD, 'Subtype') )?.setValue( this.subType == -1 ? 255 : this.subType);
    propStruct.addField( new GFFField(GFFDataType.BYTE, 'CostTable') )?.setValue( this.costTable == -1 ? 255 : this.costTable);
    propStruct.addField( new GFFField(GFFDataType.WORD, 'CostValue') )?.setValue( this.costValue == -1 ? 255 : this.costValue);
    propStruct.addField( new GFFField(GFFDataType.BYTE, 'Param1') )?.setValue( this.param1 == -1 ? 255 : this.param1);
    propStruct.addField( new GFFField(GFFDataType.BYTE, 'Param1Value') )?.setValue( this.param1Value == -1 ? 255 : this.param1Value);
    propStruct.addField( new GFFField(GFFDataType.BYTE, 'ChanceAppear') )?.setValue( this.chanceAppear == -1 ? 255 : this.chanceAppear);
    propStruct.addField( new GFFField(GFFDataType.BYTE, 'UsesPerDay') )?.setValue( this.usesPerDay == -1 ? 255 : this.usesPerDay);
    propStruct.addField( new GFFField(GFFDataType.BYTE, 'Useable') )?.setValue( this.useable == -1 ? 255 : this.useable);
    propStruct.addField( new GFFField(GFFDataType.BYTE, 'UpgradeType') )?.setValue( this.upgradeType == -1 ? 255 : this.upgradeType);

    return propStruct;
  }

}