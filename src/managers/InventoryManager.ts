import { GFFDataType } from "@/enums/resource/GFFDataType";
import { GFFField } from "@/resource/GFFField";
import { GFFObject } from "@/resource/GFFObject";
import * as path from "path";
import { CurrentGame } from "@/engine/CurrentGame";
import type { ModuleCreature, ModuleItem } from "@/module";
import { GameState } from "@/GameState";
import { BaseItemType } from "@/enums/combat/BaseItemType";
import { UIIconTimerType } from "@/enums/engine/UIIconTimerType";
import { canEquipInSlot } from "@/engine/rules/EquipmentSlotRules";
import { meetsUseLimits } from "@/engine/rules/ItemUseLimits";
import { ModuleItemProperty } from "@/enums/module/ModuleItemProperty";
// import { PartyManager } from "@/managers/PartyManager";

/** Whether items of this base type stack (baseitems.2da `stacking` > 1). */
export function isStackableItem(item: { getBaseItem?: () => { stacking?: number } | undefined }): boolean {
  try { return Number(item?.getBaseItem?.()?.stacking ?? 1) > 1; } catch (e) { return false; }
}

/** Whether an item carries any upgrade (TSL workbench). */
export function hasItemUpgrades(item: any): boolean {
  if (!item) return false;
  if (Number(item.upgrades) > 0) return true;
  if (item.upgradeItems && Object.keys(item.upgradeItems).length > 0) return true;
  for (let i = 0; i < 6; i++) if (Number(item['upgradeSlot' + i]) >= 0) return true;
  return false;
}

/**
 * The held item a new one should stack onto, or undefined to keep it apart.
 * Identical items stack, as retail does (weapons too: baseitems.2da gives them
 * 99), but an upgraded item never merges with another copy: its upgrades were
 * lost into the stack (critic run 3).
 */
export function findItemStackTarget<T extends { getTag(): string }>(held: readonly T[], item: T): T | undefined {
  if (!isStackableItem(item as any) || hasItemUpgrades(item)) return undefined;
  const tag = item.getTag().toLowerCase();
  return held.find((other) => other !== item && other.getTag().toLowerCase() === tag && !hasItemUpgrades(other));
}

/**
 * InventoryManager class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file InventoryManager.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class InventoryManager {
  static inventory: ModuleItem[] = [];

  static getInventory( slot = 0, creature?: ModuleCreature ){
    if(!slot){
      return InventoryManager.inventory;
    }else{
      let equippable = [];
      for(let i = 0; i < InventoryManager.inventory.length; i++){
        let item = InventoryManager.inventory[i];
        if( InventoryManager.isItemUsableInSlot(item, slot) && InventoryManager.isItemUsableBy(item, creature)){
          equippable.push(item);
        }
      }
      return equippable;
    }
  }

  static getNonQuestInventory( slot = 0, creature?: ModuleCreature ){
    if(!slot){
      let equippable = [];
      for(let i = 0; i < InventoryManager.inventory.length; i++){
        let item = InventoryManager.inventory[i];
        if(!item.plot){
          equippable.push(item);
        }
      }
      return equippable;
    }else{
      let equippable = [];
      for(let i = 0; i < InventoryManager.inventory.length; i++){
        let item = InventoryManager.inventory[i];
        if(InventoryManager.isItemUsableInSlot(item, slot) && InventoryManager.isItemUsableBy(item, creature)){
          equippable.push(item);
        }
      }
      return equippable;
    }
  }

  static getQuestInventory(slot = 0, creature?: ModuleCreature){
    if(!slot){
      let equippable = [];
      for(let i = 0; i < InventoryManager.inventory.length; i++){
        let item = InventoryManager.inventory[i];
        if(item.plot){
          equippable.push(item);
        }
      }
      return equippable;
    }else{
      let equippable = [];
      for(let i = 0; i < InventoryManager.inventory.length; i++){
        let item = InventoryManager.inventory[i];
        if(InventoryManager.isItemUsableInSlot(item, slot) && InventoryManager.isItemUsableBy(item, creature)){
          equippable.push(item);
        }
      }
      return equippable;
    }
  }

  static getSellableInventory(slot = 0, creature?: ModuleCreature){
    return InventoryManager.getNonQuestInventory(slot, creature);
  }

  static isItemUsableBy( item?: ModuleItem, creature?: ModuleCreature): boolean {
    // if(!(item instanceof ModuleItem) || !(creature instanceof ModuleCreature))
      // return false;

    let droidorhuman = item.baseItem.droidOrHuman;
    
    const raceOk = !droidorhuman || (
      (droidorhuman == 1 && creature.getRace() == 6) ||
      (droidorhuman == 2 && creature.getRace() == 5)
    );
    if (!raceOk) return false;

    // Use limits come from the item's own and installed parts' properties.
    if (creature && typeof item.getEffectiveProperties === 'function') {
      const limits = item.getEffectiveProperties()
        .filter(p => p.propertyName === ModuleItemProperty.UseLimitationAlignmentGroup)
        .map(p => ({ property: p.propertyName, subType: p.subType }));
      if (!meetsUseLimits(limits, { goodEvil: creature.getGoodEvil() })) return false;
    }
    return true;
  }

  static isItemUsableInSlot( item: ModuleItem, slot: any ): boolean {
    // The second weapon set shares the first set's rules; see EquipmentSlotRules.
    return canEquipInSlot(item.baseItem.equipableSlots, slot);
  }

  static addItem(template: GFFObject|ModuleItem = new GFFObject(), limitOne = false): ModuleItem {

    let item: ModuleItem;
    let transferredStackSize: number | undefined;
    if(template instanceof GFFObject){
      item = new GameState.Module.ModuleArea.ModuleItem(template);
    }else if(template instanceof GameState.Module.ModuleArea.ModuleItem){
      item = template;
      transferredStackSize = item.getStackSize();
      if (!Number.isInteger(transferredStackSize) || transferredStackSize < 1) {
        throw new RangeError('Transferred inventory item must have a positive integer stack size');
      }
    }

    if(!(item instanceof GameState.Module.ModuleArea.ModuleItem)){
      throw 'You can only add an item of type ModuleItem to an inventory';
    }

    item.initProperties();
    // Existing items carry their live quantity, including merged container
    // stacks. Template initialization must not reset that quantity on transfer.
    if (transferredStackSize !== undefined) item.setStackSize(transferredStackSize);
    // The party pool is no object's inventory: an item arriving here (looted,
    // given, unequipped) no longer belongs to the container or NPC it came
    // from (critic run 5: a stale holder broke GiveItem).
    item.setPossessor?.(undefined);
    if(item.getBaseItemId() == BaseItemType.CREDITS){
      GameState.PartyManager.AddGold(item.getStackSize());
      GameState.UINotificationManager.EnableUINotificationIconType(UIIconTimerType.CREDITS_RECEIVED);
    }else if(item.getBaseItemId() == BaseItemType.PAZAAK_CARD){
      GameState.PazaakManager.AddCard(item.getModelVariation(), item.getStackSize());
      GameState.UINotificationManager.EnableUINotificationIconType(UIIconTimerType.ITEM_RECEIVED);
    }else{
      GameState.UINotificationManager.EnableUINotificationIconType(UIIconTimerType.ITEM_RECEIVED);
      // load() re-reads the template's StackSize. An item handed in already
      // built keeps the stack its caller set: CreateItemOnObject(sTag, oPC, 3)
      // sets 3 and then adds, and used to arrive as 1.
      item.load();
      if (transferredStackSize !== undefined) item.setStackSize(transferredStackSize);
      // Already held: adding the same object again used to merge it into
      // itself and double its stack (unequip added it twice; repeated
      // GiveItem did the same). Critic run 3.
      if(InventoryManager.inventory.includes(item)) return item;
      // Identical items stack; an upgraded one stays its own entry.
      let hasItem = findItemStackTarget(InventoryManager.inventory, item);
      if(hasItem){

        if(!limitOne){
          hasItem.setStackSize(hasItem.getStackSize() + item.getStackSize());
        }else{
          hasItem.setStackSize(hasItem.getStackSize() + 1);
        }

        return hasItem;
      }else{

        if(limitOne)
          item.setStackSize(1);

        InventoryManager.inventory.push(item);
        return item;
      }
    }

  }

  static removeItemByResRef(resRef = '', nCount = 1){
    let item = InventoryManager.getItemByTag(resRef);
    if(item){
      GameState.UINotificationManager.EnableUINotificationIconType(UIIconTimerType.ITEM_LOST);
      let idx = InventoryManager.inventory.indexOf(item);
      if(nCount < item.getStackSize()){
        item.setStackSize( (item.getStackSize() - nCount) || 1 );
      }else{
        InventoryManager.inventory.splice(idx, 1);
      }
    }
  }

  static removeItem(item?: string|ModuleItem, nCount = 1){
    if(typeof item === 'string'){
      InventoryManager.removeItemByResRef(item, nCount);
    }else if(item instanceof GameState.Module.ModuleArea.ModuleItem){
      let idx = InventoryManager.inventory.indexOf(item);
      if(idx >= 0){
        GameState.UINotificationManager.EnableUINotificationIconType(UIIconTimerType.ITEM_LOST);
        if(nCount >= item.getStackSize()){
          InventoryManager.inventory.splice(idx, 1);
        }else{
          item.setStackSize( (item.getStackSize() - nCount) || 1 );
        }
      }else{
        //Item not in inventory
      }
    }else{
      console.warn('InventoryManager.removeItem() unknown item', item, nCount);
    }
  }

  static getItemByTag(sTag = ''){
    for(let i = 0; i < InventoryManager.inventory.length; i++){
      let item = InventoryManager.inventory[i];
      if(item.getTag().toLowerCase() == sTag.toLowerCase())
        return item;
    }
    return false;
  }

  static itemFromJSON(json: any = {}){
    let item: any = {};
    let props = json.fields;
    for(let fieldName in props){
      let field = props[fieldName];
      if(field.type == 15){
        item[fieldName] = [];
        for(let i = 0; i < field.structs.length; i++){
          item[fieldName].push(InventoryManager.itemFromJSON(field.structs[i]));
        }
      }else{
        item[fieldName] = field.value;
      }
    }
    return item;
  }

  static Save(){
    return new Promise( async (resolve, reject) => {
      //console.log('InventoryManager.Save()', 'Exporting...');
      let gff = new GFFObject();
      gff.FileType = 'INV ';

      let itemList = gff.RootNode.addField( new GFFField( GFFDataType.LIST, 'ItemList' ));
      for(let i = 0; i < InventoryManager.inventory.length; i++){
        itemList.addChildStruct( InventoryManager.inventory[i].save() );
      }

      await gff.export( path.join( CurrentGame.gameinprogress_dir, 'INVENTORY.res') );
      resolve(gff);
    });
  }

}
