import { ModuleObject } from "@/module/ModuleObject";
import { describeModuleObject } from "@/utility/ModuleObjectDiagnostics";
import type { ModuleCreature } from "@/module/ModuleCreature";
import { BaseItem } from "@/engine/BaseItem";
import { EffectDisguise } from "@/effects/EffectDisguise";
import { WeaponWield } from "@/enums/combat/WeaponWield";
import { WeaponType } from "@/enums/combat/WeaponType";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { ModuleItemProperty } from "@/enums/module/ModuleItemProperty";
import { GFFDataType } from "@/enums/resource/GFFDataType";
import { GFFField } from "@/resource/GFFField";
import { GFFObject } from "@/resource/GFFObject";
import { GFFStruct } from "@/resource/GFFStruct";
import { MDLLoader, ResourceLoader } from "@/loaders";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { TalentSpell } from "@/talents";
import { OdysseyModel3D } from "@/three/odyssey";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { CombatFeatType } from "@/enums/combat/CombatFeatType";
import { BitWise } from "@/utility/BitWise";
import { Dice } from "@/utility/Dice";
import { ItemProperty } from "@/engine/ItemProperty";
import { GameState } from "@/GameState";
import { ActionParameterType, GameEffectDurationType, ModuleCreatureAnimState, SkillType } from "@/enums";
import { writeItemCastSpellParameters } from "@/actions/ItemCastSpellParameters";
import type { SWWeaponSound } from "@/engine/rules/SWWeaponSound";
import { parseUpgradeTable } from "@/game/tsl/crafting/UpgradeRules";
import { itemDeflectionBonus } from "@/combat/itemDeflectionBonus";

/**
* ModuleItem class.
* 
* Class representing an item found in module areas, placeable, creatures, etc...
* 
* KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
* 
* @file ModuleItem.ts
* @author KobaltBlu <https://github.com/KobaltBlu>
* @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
* @memberof KotOR
*/
/** Fields a split-off copy must not inherit: identity and placement. */
const VR_CLONE_SKIP_FIELDS: ReadonlySet<string> = new Set([
  'ObjectId', 'ID', 'XPosition', 'YPosition', 'ZPosition', 'XOrientation', 'YOrientation', 'ZOrientation',
]);

/** Shared empty answer for getDamageBonuses, so items with none allocate nothing. */
const NO_DAMAGE_BONUSES: readonly { type: number, value: number }[] = Object.freeze([]);

/** TSL items carry UpgradeSlot0..UpgradeSlot5. */
const UPGRADE_SLOT_COUNT = 6;

/** upgrade.2da rows already reported as contributing nothing, so each logs once. */
const loggedUpgradeRows = new Set<number>();

function logUpgradeRowOnce(row: number, message: string, error?: unknown){
  if(loggedUpgradeRows.has(row)) return;
  loggedUpgradeRows.add(row);
  if(error === undefined) console.warn(`ModuleItem: ${message}`);
  else console.warn(`ModuleItem: ${message}`, error);
}

export class ModuleItem extends ModuleObject {
  equippedRes: any;
  baseItemId: number;
  baseItem: BaseItem;
  addCost: number;
  cost: number;
  modelVariation: number;
  textureVariation: number;
  palleteID: number;
  loaded: boolean;
  properties: ItemProperty[];
  possessor: any;
  descIdentified: any;
  stolen: any;
  infinite: any;
  inventoryRes: any;
  stackSize: any;
  charges: any;
  deleting: any;
  dropable: any;
  identified: any;
  maxCharges: any;
  newItem: any;
  nonEquippable: any;
  pickpocketable: any;

  upgradeItems: any = {};
  upgrades: number = 0;
  upgradeLevel: number = 0;
  upgradeSlot0: number = -1;
  upgradeSlot1: number = -1;
  upgradeSlot2: number = -1;
  upgradeSlot3: number = -1;
  upgradeSlot4: number = -1;
  upgradeSlot5: number = -1;
  /** Installed upgrade parts' properties, keyed by the six slots' rows. */
  private upgradePropertyCache?: { slots: number[], properties: ItemProperty[] };
  /** Own + upgrade properties, rebuilt only when either list changes. */
  private effectivePropertyCache?: { own: ItemProperty[], ownLength: number, upgrades: ItemProperty[], merged: ItemProperty[] };
  weaponSound: SWWeaponSound;

  constructor ( gff = new GFFObject() ) {
    super();
    this.objectType |= ModuleObjectType.ModuleItem;

    if(typeof gff === 'string'){
      this.equippedRes = gff;
      this.template = new GFFObject();
      this.template.RootNode.addField(new GFFField(GFFDataType.RESREF, 'EquippedRes')).setValue(gff);
    }else{
      this.template = gff;
    }

    // if(gff instanceof GFFObject && gff.RootNode.hasField('ObjectId')){
    //   this.id = gff.getFieldByLabel('ObjectId').getValue();
    // }else if(gff instanceof GFFObject && gff.RootNode.hasField('ID')){
    //   this.id = gff.getFieldByLabel('ID').getValue();
    // }else{
    //   this.id = -1;
    // }

    //this.id = -1;

    this.baseItemId = 0;
    this.addCost = 0;
    this.cost = 0;
    this.modelVariation = 0;
    this.textureVariation = 1;
    this.palleteID = 0;
    this.loaded = false;
    this.properties = [];
    this.upgradeItems = {};
    this.placedInWorld = false;
    this.possessor = undefined;

    this.initProperties();

  }

  /**
   * One item split off this one. The copy used to share this item's
   * template, so setting the copy's StackSize to 1 rewrote the original's
   * too, and the next load() collapsed the source stack (critic run 4).
   * The template is now copied, without its ObjectId, so the two stay
   * separate objects.
   */
  clone(): ModuleItem {
    let template: GFFObject;
    try{
      template = new GFFObject(this.template.getExportBuffer());
    }catch(e){
      template = new GFFObject();
      for(const field of this.template.RootNode.fields) template.RootNode.addField(field);
    }
    // The item as it is now, not as its template was: charges spent, the
    // identified flag, upgrades and properties live on the object until a
    // save writes them (critic run 5: the copy lost them).
    try{
      const runtime = this.save();
      for(const field of runtime.fields){
        if(!field || VR_CLONE_SKIP_FIELDS.has(field.label)) continue;
        // save() hands back the template's own UpgradeSlot field objects; the
        // exported copy already has its own, and taking these would alias the
        // two items' slots (critic run 6).
        if(/^UpgradeSlot\d$/.test(field.label)) continue;
        template.RootNode.removeFieldByLabel(field.label);
        template.RootNode.addField(field);
      }
    }catch(e){
      console.warn('ModuleItem.clone: runtime state not copied', e);
    }
    template.RootNode.removeFieldByLabel('ObjectId');
    template.RootNode.removeFieldByLabel('ID');
    const nItem = new ModuleItem(template);
    nItem.initProperties();
    nItem.template.getFieldByLabel('StackSize')?.setValue(1);
    nItem.stackSize = 1;
    return nItem;
  }

  update(delta = 0){
    if(this.model instanceof OdysseyModel3D)
      this.model.update(delta);
  }

  getDescription(){
    return this.descIdentified;
  }

  getBaseItemId(): number {
    return this.baseItemId;
  }

  getBaseItem(): BaseItem {
    return this.baseItem;
  }

  getBodyVariation(){
    return this.baseItem.bodyVar;
  }

  getModelVariation(){
    return this.modelVariation || 1;
  }

  /**
   * Sets the model variation (a lightsaber's blade colour). The value also
   * goes into the template's BYTE field `ModelVariation`: inventory moves
   * re-read the template (InventoryManager.addItem calls load(), which runs
   * initProperties) and would otherwise put the old variation back, as
   * setUpgradeSlot does for the slots. save() writes modelVariation.
   */
  setModelVariation(n: number): void {
    const value = Math.max(0, Math.min(255, Math.trunc(Number(n)) || 0));
    this.modelVariation = value;
    if(this.template?.RootNode){
      const existing = this.template.RootNode.hasField('ModelVariation') ? this.template.getFieldByLabel('ModelVariation') : undefined;
      if(existing && existing.getType() === GFFDataType.BYTE){
        existing.setValue(value);
      }else{
        if(existing) this.template.RootNode.removeFieldByLabel('ModelVariation');
        this.template.RootNode.addField(new GFFField(GFFDataType.BYTE, 'ModelVariation')).setValue(value);
      }
    }
  }

  getTextureVariation(){
    return this.textureVariation || 1;
  }

  getIcon(){
    return 'i'+this.baseItem.itemClass+'_'+("000" + this.getModelVariation()).slice(-3);
  }

  getWeaponWield(): WeaponWield{
    return this.baseItem.weaponWield;
  }

  getWeaponType(): WeaponType {
    return this.baseItem.weaponType;
  }

  isRangedWeapon(){
    return this.baseItem.rangedWeapon;
  }

  /** Base items 8/9/10 are the lightsaber variants — the same discriminator `getAttackBonus()` already uses for Weapon Focus: Lightsaber. */
  isLightsaber(){
    return this.baseItemId == 8 || this.baseItemId == 9 || this.baseItemId == 10;
  }

  isStolen(){
    return this.stolen;
  }

  isInfinite(){
    return this.infinite;
  }

  getPropertiesList(){
    if(this.template.RootNode.hasField('PropertiesList')){
      return this.template.RootNode.getFieldByLabel('PropertiesList').getChildStructs();
    }
    return null;
  }

  /** How many upgrade slots this item opens (`UpgradeLevel`), 0 when unset. */
  getUpgradeLevel(): number {
    const level = Number(this.upgradeLevel);
    return Number.isFinite(level) && level > 0 ? level : 0;
  }

  /** The upgrade.2da row installed in slot `index` (0-5), or -1 when empty. */
  getUpgradeSlot(index: number): number {
    if(!Number.isInteger(index) || index < 0 || index >= UPGRADE_SLOT_COUNT) return -1;
    const row = Number((this as any)['upgradeSlot' + index]);
    return Number.isInteger(row) && row >= 0 ? row : -1;
  }

  /**
   * Install upgrade.2da `row` in slot `index` (-1 empties it). The value also
   * goes into the template's INT field `UpgradeSlotN`, which is what save()
   * writes, and the upgrade-property cache is dropped.
   */
  setUpgradeSlot(index: number, row: number): void {
    if(!Number.isInteger(index) || index < 0 || index >= UPGRADE_SLOT_COUNT){
      throw new RangeError(`Invalid upgrade slot ${index}`);
    }
    const value = Number.isInteger(row) && row >= 0 ? row : -1;
    (this as any)['upgradeSlot' + index] = value;
    const label = 'UpgradeSlot' + index;
    if(this.template?.RootNode){
      const existing = this.template.RootNode.hasField(label) ? this.template.getFieldByLabel(label) : undefined;
      if(existing && existing.getType() === GFFDataType.INT){
        existing.setValue(value);
      }else{
        // Missing, or a non-INT field (a BYTE/WORD would wrap -1): replace it
        // with the INT retail uses.
        if(existing) this.template.RootNode.removeFieldByLabel(label);
        this.template.RootNode.addField(new GFFField(GFFDataType.INT, label)).setValue(value);
      }
    }
    this.upgradePropertyCache = undefined;
    this.effectivePropertyCache = undefined;
  }

  /** The upgrade.2da rows installed in this item, slot order, empty slots skipped. */
  getInstalledUpgradeRows(): number[] {
    const rows: number[] = [];
    for(let i = 0; i < UPGRADE_SLOT_COUNT; i++){
      const row = this.getUpgradeSlot(i);
      if(row >= 0) rows.push(row);
    }
    return rows;
  }

  /**
   * The properties of the installed upgrade parts: each slot's upgrade.2da
   * row names a part template (UTI) whose PropertiesList applies while the
   * part is installed. The item's own PropertiesList is never changed.
   * Retail part templates all live in templates.bif, which
   * ResourceLoader.InitGlobalCache caches at startup, so the synchronous
   * cached loader finds them. Cached per slot state; a row with no template
   * or no loadable UTI contributes nothing and is logged once.
   */
  getUpgradeProperties(): ItemProperty[] {
    // Checked slot by slot against the snapshot, with no allocation: the stat
    // getters call this on every read, and most items have no parts.
    const cache = this.upgradePropertyCache;
    if(cache && this.upgradeSlotsMatch(cache.slots)) return cache.properties;
    const slots = this.rawUpgradeSlots();
    this.effectivePropertyCache = undefined;
    const rows = this.getInstalledUpgradeRows();
    if(!rows.length){
      this.upgradePropertyCache = { slots, properties: [] };
      return this.upgradePropertyCache.properties;
    }
    const table = GameState.TwoDAManager?.datatables?.get('upgrade');
    // Not loaded yet: answer without caching, so a later call can resolve.
    if(!table) return [];
    const properties: ItemProperty[] = [];
    for(const row of rows){
      const tableRow = table.rows?.[row];
      const part = tableRow ? parseUpgradeTable({ [row]: tableRow })[0] : undefined;
      if(!part){
        logUpgradeRowOnce(row, `upgrade.2da row ${row} names no part template`);
        continue;
      }
      const buffer = ResourceLoader.loadCachedResource(ResourceTypes['uti'], part.template);
      if(!buffer){
        logUpgradeRowOnce(row, `upgrade.2da row ${row}: part template ${part.template} did not load`);
        continue;
      }
      try{
        const gff = new GFFObject(buffer);
        const list = gff.RootNode.hasField('PropertiesList')
          ? gff.getFieldByLabel('PropertiesList').getChildStructs()
          : [];
        for(const struct of list){
          const property = new ItemProperty(GFFObject.FromStruct(struct), this);
          // TSL parts apply whenever installed; the K1 `Upgrades` bitmask
          // gate in isUseable does not apply to them.
          property.installedUpgrade = true;
          properties.push(property);
        }
      }catch(e){
        logUpgradeRowOnce(row, `upgrade.2da row ${row}: part template ${part.template} could not be read`, e);
      }
    }
    this.upgradePropertyCache = { slots, properties };
    return properties;
  }

  /** The raw slot fields, read directly (no key strings): the stat hot path. */
  private rawUpgradeSlots(): number[] {
    return [this.upgradeSlot0, this.upgradeSlot1, this.upgradeSlot2, this.upgradeSlot3, this.upgradeSlot4, this.upgradeSlot5];
  }

  /**
   * Whether the slot fields still hold the snapshot, compared field by field
   * with no allocation: every stat read passes here.
   */
  private upgradeSlotsMatch(slots: number[]): boolean {
    return slots[0] === this.upgradeSlot0 && slots[1] === this.upgradeSlot1 && slots[2] === this.upgradeSlot2
      && slots[3] === this.upgradeSlot3 && slots[4] === this.upgradeSlot4 && slots[5] === this.upgradeSlot5;
  }

  /**
   * The item's own properties plus its installed upgrade parts'. With no parts
   * this is `this.properties` itself; with parts the merged list is cached
   * until the slots or the own list change.
   */
  getEffectiveProperties(): ItemProperty[] {
    const upgrades = this.getUpgradeProperties();
    if(!upgrades.length) return this.properties;
    const cache = this.effectivePropertyCache;
    if(cache && cache.own === this.properties && cache.upgrades === upgrades && cache.ownLength === this.properties.length){
      return cache.merged;
    }
    const merged = [...this.properties, ...upgrades];
    this.effectivePropertyCache = { own: this.properties, ownLength: this.properties.length, upgrades, merged };
    return merged;
  }

  /**
   * The highest usable value among properties matching `name` (and `subType`
   * when given), own and installed parts alike, or 0 when there is none.
   * Controller ruling R5: same-kind bonuses do not stack; the best applies.
   */
  private getHighestPropertyValue(name: number, subType?: number): number {
    const properties = this.getEffectiveProperties();
    let best: number | undefined;
    for(let i = 0, len = properties.length; i < len; i++){
      const property = properties[i];
      if(!property.isUseable() || !property.is(name, subType)) continue;
      const value = Number(property.getValue()) || 0;
      if(best === undefined || value > best) best = value;
    }
    return best ?? 0;
  }

  /**
   * Every damage bonus this item applies: one entry per damage type, in the
   * order first met (ruling R5: every damage type applies; within one type
   * the best). Within a type the property with the highest expected value
   * (ItemProperty.getExpectedValue: a flat value, or the dice average) is
   * chosen first and only it is rolled (ruling R7), so two 2d8 properties
   * roll 2d8 once instead of keeping the better of two rolls.
   */
  getDamageBonuses(): readonly { type: number, value: number }[] {
    const properties = this.getEffectiveProperties();
    let picks: { type: number, expected: number, property: ItemProperty }[] | undefined;
    for(let i = 0, len = properties.length; i < len; i++){
      const property = properties[i];
      if(!property.isUseable() || !property.is(ModuleItemProperty.Damage)) continue;
      const type = property.getSubType()?.id || 0;
      const expected = property.getExpectedValue();
      if(!picks) picks = [];
      const entry = picks.find((p) => p.type === type);
      if(!entry) picks.push({ type, expected, property });
      else if(expected > entry.expected){
        entry.expected = expected;
        entry.property = property;
      }
    }
    if(!picks) return NO_DAMAGE_BONUSES;
    return picks.map((p) => ({ type: p.type, value: Number(p.property.getValue()) || 0 }));
  }

  isDisguise(){
    const properties = this.getEffectiveProperties();
    for(let i = 0, len = properties.length; i < len; i++){
      let property = properties[i];
      if(property.isUseable() && property.is(ModuleItemProperty.Disguise)){
        return true;
      }
    }
    return false;
  }

  getDisguiseAppearance(){
    const properties = this.getEffectiveProperties();
    for(let i = 0, len = properties.length; i < len; i++){
      let property = properties[i];
      if(property.isUseable() && property.is(ModuleItemProperty.Disguise)){
        return property.getValue();
      }
    }
    return 0;
  }

  getDisguiseAppearanceId(){
    const properties = this.getEffectiveProperties();
    for(let i = 0, len = properties.length; i < len; i++){
      let property = properties[i];
      if(property.isUseable() && property.is(ModuleItemProperty.Disguise)){
        return property.subType;
      }
    }
    return -1;
  }

  getName(){
    // dialog.tlk item names carry {..} sort prefixes ("{05}Vibroblade") that
    // retail never shows (critic run 11).
    const name = this.getLocalizedName();
    return typeof name === 'string' ? name.replace(/\{[^}]*\}/g, '').trim() : name;
  }

  getEquippedRes(){
    return this.equippedRes;
  }

  getInventoryRes(){
    return this.inventoryRes;
  }

  getStackSize(){
    return this.stackSize;
  }

  setStackSize(value: number){
    return this.stackSize = value;
  }

  getLocalizedName(){
    return this.localizedName.getValue().replace(/\0[\s\S]*$/g,'');
  }

  getPalleteID(){
    return this.palleteID;
  }

  getTag(){
    return this.tag;
  }

  getACBonus(){
    let bonus = 0;
    const properties = this.getEffectiveProperties();
    for(let i = 0, len = properties.length; i < len; i++){
      let property = properties[i];
      if(property.isUseable() && property.is(ModuleItemProperty.Armor)){
        bonus += property.getValue();
      }
    }
    return this.baseItem.baseAC + bonus;
  }

  getDexBonus(){
    if(this.baseItemId){
      return this.baseItem.dexBonus || 0;
    }
    return 0;
  }

  getAttackBonus(): number {
    // The best Attack Bonus among the item's own and its parts' (ruling R5).
    let bonus = this.getHighestPropertyValue(ModuleItemProperty.AttackBonus);

    if(BitWise.InstanceOfObject(this.possessor, ModuleObjectType.ModuleCreature)){
      switch(this.getWeaponWield()){
        case WeaponWield.BLASTER_PISTOL:
          if(this.possessor.getHasFeat(CombatFeatType.WEAPON_FOCUS_BLASTER)){
            bonus += 1;
          }
        break;
        case WeaponWield.BLASTER_RIFLE:
          if(this.possessor.getHasFeat(CombatFeatType.WEAPON_FOCUS_BLASTER_RIFLE)){
            bonus += 1;
          }
        break;
        case WeaponWield.BLASTER_HEAVY:
          if(this.possessor.getHasFeat(CombatFeatType.WEAPON_FOCUS_HEAVY_WEAPONS)){
            bonus += 1;
          }
        break;
        case WeaponWield.ONE_HANDED_SWORD:
        case WeaponWield.TWO_HANDED_SWORD:
        case WeaponWield.STUN_BATON:
          if(this.baseItemId == 8 || this.baseItemId == 9 || this.baseItemId == 10){
            if(this.possessor.getHasFeat(CombatFeatType.WEAPON_FOCUS_LIGHTSABER)){
              bonus += 1;
            }
          }else if(this.possessor.getHasFeat(CombatFeatType.WEAPON_FOCUS_MELEE_WEAPONS)){
            bonus += 1;
          }
        break;
      }
    }

    return bonus;
  }

  getBaseDamage(){
    if(this.baseItem.numDice){
      return Dice.roll(this.baseItem.numDice, this.baseItem.die);
    }
    return 0;
  }

  getBaseDamageType(): number {
    if(this.baseItem){
      return Math.log2(this.baseItem.damageFlags) & 0xFF;
    }
    return 0;
  }

  /** Whether this item carries a usable Monster_Damage property — true of creature weapons, not held ones. */
  hasMonsterDamage(): boolean {
    const properties = this.getEffectiveProperties();
    for(let i = 0, len = properties.length; i < len; i++){
      const property = properties[i];
      if(property.isUseable() && property.is(ModuleItemProperty.Monster_Damage)) return true;
    }
    return false;
  }

  getMonsterDamage(){
    const properties = this.getEffectiveProperties();
    for(let i = 0, len = properties.length; i < len; i++){
      let property = properties[i];
      if(property.isUseable() && property.is(ModuleItemProperty.Monster_Damage)){
        return property.getValue();
      }
    }
    return 0;
  }

  /**
   * The total of this item's usable Damage Penalty properties, as a positive
   * number. Their cost table (IPRP_NEG5COST) stores "-1".."-5" in its value
   * column, which getValue() has no case for, so it answered 0 and the Mining
   * Laser's -1 never applied.
   */
  getDamagePenalty(): number {
    let penalty = 0;
    const properties = this.getEffectiveProperties();
    for(let i = 0, len = properties.length; i < len; i++){
      const property = properties[i];
      if(!property.isUseable() || !property.is(ModuleItemProperty.DamagePenalty)) continue;
      const row = property.getCostTableRow?.();
      const value = row ? parseInt(row.value) : NaN;
      penalty += Number.isFinite(value) ? Math.abs(value) : Math.max(0, property.costValue || 0);
    }
    return penalty;
  }

  /**
   * This item's blaster-bolt deflection modifier from its own and installed
   * upgrade properties (Blaster_Bolt_Deflect_Increase / _Decrease): lightsaber
   * lenses, emitters and crystals. See itemDeflectionBonus.
   */
  getBlasterDeflectionModifier(): number {
    return itemDeflectionBonus(this.getEffectiveProperties().map((property) => {
      const row = property.getCostTableRow?.();
      const value = row ? parseInt(row.value) : NaN;
      return {
        propertyName: property.propertyName,
        useable: property.isUseable(),
        rowValue: Number.isFinite(value) ? value : undefined,
        costValue: property.costValue,
      };
    }));
  }

  hasDamageBonus(): boolean {
    const properties = this.getEffectiveProperties();
    for(let i = 0, len = properties.length; i < len; i++){
      let property = properties[i];
      if(property.isUseable() && property.is(ModuleItemProperty.Damage)){
        return true;
      }
    }
    return false;
  }

  /** The first damage type's bonus; combat applies every type via getDamageBonuses(). */
  getDamageBonus(): number {
    return this.getDamageBonuses()[0]?.value ?? 0;
  }

  /** The first damage bonus's type; combat applies every type via getDamageBonuses(). */
  getDamageBonusType(): number {
    return this.getDamageBonuses()[0]?.type ?? 0;
  }

  getDamageFlags(): number {
    return this.baseItem.damageFlags;
  }

  getCriticalThreatRangeMin(){
    return 20 - this.baseItem.criticalThreat;
  }

  getCriticalThreatRangeMax(){
    return 20;
  }

  getSTRBonus(){
    return this.getHighestPropertyValue(ModuleItemProperty.Ability, 0);
  }

  getDEXBonus(){
    return this.getHighestPropertyValue(ModuleItemProperty.Ability, 1);
  }

  getCONBonus(){
    return this.getHighestPropertyValue(ModuleItemProperty.Ability, 2);
  }

  getINTBonus(){
    return this.getHighestPropertyValue(ModuleItemProperty.Ability, 3);
  }

  getWISBonus(){
    return this.getHighestPropertyValue(ModuleItemProperty.Ability, 4);
  }

  getCHABonus(){
    return this.getHighestPropertyValue(ModuleItemProperty.Ability, 5);
  }

  isUpgradable(){
    const properties = this.getEffectiveProperties();
    for(let i = 0, len = properties.length; i < len; i++){
      let property = properties[i];
      if(property.upgradeType >= 0){
        return true;
      }
    }
    return false;
  }

  castAmmunitionAtTarget(oCaster: ModuleObject, oTarget: ModuleObject){
    if(typeof oTarget != 'undefined'){
      let ammunitiontype = this.baseItem.ammunitionType;
      if( ammunitiontype >= 1 ){
        const _2DA = GameState.TwoDAManager.datatables.get('ammunitiontypes');
        if(_2DA){
          let ammunition = _2DA.rows[ammunitiontype];
          if(typeof ammunition != 'undefined'){
            
          }
        }
      }

    }
  }

  useItemOnObject(oCaster: ModuleCreature, oTarget: ModuleObject){
    for(let i = 0, len = this.properties.length; i < len; i++){
      let property = this.properties[i];
      if(!property.isUseable()){ continue; }

      if(property.is(ModuleItemProperty.CastSpell)){
        const spellId = property.getCastSpellId();
        if(!Number.isSafeInteger(spellId) || spellId < 0){ continue; }
        // Ordinary item use remains an authored direct item-cast action. The
        // embodied grenade bridge is the sole caller that deliberately enters
        // CombatRound, because only it needs an eligible d20 tempo window.
        // Routing every item through CombatRound changes flat-game semantics
        // and can strand non-combat consumables behind combat state.
        const action = new GameState.ActionFactory.ActionItemCastSpell();
        writeItemCastSpellParameters(action, {
          target: oTarget,
          area: oTarget.area,
          targetPosition: oTarget.position,
          spellId,
          casterLevel: 1,
          delay: 1.0,
          projectilePath: 0,
          projectileSpellId: -1,
          item: this,
          impactScript: '',
        });
        oCaster.actionQueue.add(action);
      }else if(property.is(ModuleItemProperty.ThievesTools)){
        const action = new GameState.ActionFactory.ActionUnlockObject();
        action.setParameter(0, ActionParameterType.DWORD, oTarget);
        action.setParameter(1, ActionParameterType.DWORD, this);
        oCaster.actionQueue.add(action);
      }else if(property.is(ModuleItemProperty.Trap)){
        const action = new GameState.ActionFactory.ActionSetMine();
        action.setParameter(0, ActionParameterType.DWORD, this);
        action.setParameter(1, ActionParameterType.DWORD, oTarget);
        action.setParameter(2, ActionParameterType.FLOAT, oTarget.position.x);
        action.setParameter(3, ActionParameterType.FLOAT, oTarget.position.y);
        action.setParameter(4, ActionParameterType.FLOAT, oTarget.position.z);
        oCaster.actionQueue.add(action);
      }
    }
  }

  load(){
    if(!this.loaded && this.getEquippedRes()){
      //Load template and merge fields
      const buffer = ResourceLoader.loadCachedResource(ResourceTypes['uti'], this.getEquippedRes());
      if(buffer){
        const gff = new GFFObject(buffer);
        this.template.merge(gff);
        this.initProperties();
        return true;
      }else{
        console.error('Failed to load ModuleItem template');
        if(this.template instanceof GFFObject){
          this.initProperties();
        }
        return false;
      }
    }else if(!this.loaded && this.getInventoryRes()){
      //Load template and merge fields
      const buffer = ResourceLoader.loadCachedResource(ResourceTypes['uti'], this.getInventoryRes());
      if(buffer){
        const gff = new GFFObject(buffer);
        this.template.merge(gff);
        this.initProperties();
        return true;
      }else{
        console.error('Failed to load ModuleItem template');
        if(this.template instanceof GFFObject){
          this.initProperties();
        }
        return false;
      }
    }else{
      //We already have the template (From SAVEGAME)
      this.initProperties();
      // this.loadScripts();
      return true;
    }
  }

  async loadModel(): Promise<OdysseyModel3D> {
    // Droids can equip weapons without a corresponding hand attachment node.
    // Their old item model is then parentless, so body teardown cannot own it.
    if(this.model){
      this.model.removeFromParent();
      this.model.dispose();
      this.model = undefined;
    }
    if(!this.baseItem){ 
      this.model = new OdysseyModel3D;
      return this.model;
    }

    const defaultModel = this.modelResRefFor(this.getModelVariation());

    try{
      const mdl = await MDLLoader.loader.load(defaultModel);
      const model = await OdysseyModel3D.FromMDL(mdl, {
        context: this.context,
        lighting: true,
        //castShadow: false,
        //receiveShadow: false
      });
      this.model = model;
      return this.model;
    }catch(e){
      console.warn('ModuleItem.loadModel failed', describeModuleObject(this), 'model', defaultModel, e);
      this.model = new OdysseyModel3D;
      return this.model;
    }
  }

  /**
   * The item's own 3D model for holding in a VR hand, without touching
   * `this.model`. Medpacs and stims name `I_Null` as their default model,
   * which loadModel loads literally (an empty model); their real models are
   * `<itemclass>_<variation>` (i_medeqpmnt_001, i_adrnaline_002...). Round 15
   * asked to see an armed medpac, stim or grenade in the hand.
   */
  async loadHeldPresentationModel(): Promise<OdysseyModel3D | null> {
    if(!this.baseItem) return null;
    const itemclass = String(this.baseItem.itemClass ?? '').replace(/ [\s\S]*$/g,'').trim().toLowerCase();
    let resref = String(this.baseItem.defaultModel ?? '').replace(/ [\s\S]*$/g,'').trim().toLowerCase();
    const variation = ('000'+this.getModelVariation()).substr(-3);
    if(!resref || resref == 'i_null'){
      resref = itemclass+'_'+variation;
    }else{
      resref = this.nthStringConverter(resref, this.getModelVariation());
      if(!parseInt(resref.substr(-3))) resref = itemclass+'_'+variation;
    }
    try{
      const mdl = await MDLLoader.loader.load(resref);
      return await OdysseyModel3D.FromMDL(mdl, { context: this.context, lighting: true });
    }catch(e){
      return null;
    }
  }

  /**
   * The model resref loadModel loads for `variation`: baseitems.2da's
   * DefaultModel with its trailing number replaced by the variation (a
   * lightsaber's blade colour is its variation: w_lghtsbr_002), or
   * `<itemclass>_<variation>` when DefaultModel carries no number.
   */
  modelResRefFor(variation: number): string {
    const itemclass = String(this.baseItem?.itemClass ?? '').replace(/\0[\s\S]*$/g,'').trim().toLowerCase();
    let defaultModel = String(this.baseItem?.defaultModel ?? 'I_Null').replace(/\0[\s\S]*$/g,'').trim().toLowerCase();
    if(defaultModel != 'i_null'){
      defaultModel = this.nthStringConverter(defaultModel, variation);
      if(!parseInt(defaultModel.substr(-3))){
        defaultModel = itemclass+'_'+(('000'+variation).substr(-3));
      }
    }
    return defaultModel;
  }

  nthStringConverter(name = '', nth = 1){
    let value = nth.toString();
    name = name.substr(0, name.length - value.length);
    return name + value;
  }

  /**
   * Set the weapon powered state and update the powered animation
   * @param powered - Whether the weapon should be powered
   */
  setPowered(powered: boolean){
    //weaponPowered() can fire on an equipped item whose model hasn't finished loading
    //yet (or has none) - this threw uncaught every frame once triggered, which is why
    //it read as a freeze rather than a one-off error.
    if(!(this.model instanceof OdysseyModel3D)){ return; }

    const currentAnimL = this.model.animationManager.currentAnimation || this.model.odysseyAnimationMap.get('off');
    if(!currentAnimL){ return; }

    //power up
    if(powered){
      switch(currentAnimL.name){
        case 'off':
          this.model.playAnimation('powerup');
        break;
        case 'powerup':
        break;
        default:
          this.model.playAnimation('powered', true);
        break;
      }
      return;
    }
    
    //power down
    switch(currentAnimL.name){
      case 'powered':
        this.model.playAnimation('powerdown');
      break;
      case 'powerdown':
      break;
      default:
        this.model.playAnimation('off', true);
      break;
    }
  }

  static FromResRef(resRef: string): ModuleItem {
    const buffer = ResourceLoader.loadCachedResource(ResourceTypes['uti'], resRef);
    if(buffer){
      const item = new ModuleItem(new GFFObject(buffer));
      item.initProperties();
      return item;
    }
    return undefined;
  }

  getSpells(){
    let spells = [];

    //propertyName, subType, costTable, costValue, param1, param1Value, chanceAppear, usesPerDay, useable, upgradeType
    for(let i = 0, len = this.properties.length; i < len; i++){
      let property = this.properties[i];
      //Activate Item
      if(property.propertyName == ModuleItemProperty.CastSpell){
        spells.push(new TalentSpell(property.subType));
      }
    }

    return spells;
  }

  initProperties(){

    if(this.loaded){
      return;
    }
    
    if(!this.initialized){
      if(this.template.RootNode.hasField('ObjectId')){
        this.id = this.template.getFieldByLabel('ObjectId').getValue();
      }else if(this.template.RootNode.hasField('ID')){
        this.id = this.template.getFieldByLabel('ID').getValue();
      }
      
      GameState.ModuleObjectManager.AddObjectById(this);
    }

    if(this.template.RootNode.hasField('AddCost'))
      this.addCost = parseInt(this.template.getFieldByLabel('AddCost').getValue());

    if(this.template.RootNode.hasField('BaseItem')){
      this.baseItemId = this.template.getFieldByLabel('BaseItem').getValue();
      this.baseItem = BaseItem.From2DA(this.baseItemId);
    }

    if(this.template.RootNode.hasField('Charges'))
      this.charges = this.template.getFieldByLabel('Charges').getValue();

    if(this.template.RootNode.hasField('Cost'))
      this.cost = parseInt(this.template.getFieldByLabel('Cost').getValue());

    if(this.template.RootNode.hasField('DELETING'))
      this.deleting = this.template.getFieldByLabel('DELETING').getValue();

    if(this.template.RootNode.hasField('DescIdentified'))
      this.descIdentified = this.template.getFieldByLabel('DescIdentified').getValue();

    if(this.template.RootNode.hasField('Description'))
      this.description = this.template.getFieldByLabel('Description').getValue();

    if(this.template.RootNode.hasField('Dropable'))
      this.dropable = this.template.getFieldByLabel('Dropable').getValue();
      
    if(this.template.RootNode.hasField('EquippedRes'))
      this.equippedRes = this.template.getFieldByLabel('EquippedRes').getValue();

    if(this.template.RootNode.hasField('Identified'))
      this.identified = this.template.getFieldByLabel('Identified').getValue();

    if(this.template.RootNode.hasField('Infinite'))
      this.infinite = this.template.getFieldByLabel('Infinite').getValue();

    if(this.template.RootNode.hasField('InventoryRes'))
      this.inventoryRes = this.template.getFieldByLabel('InventoryRes').getValue();
  
    if(this.template.RootNode.hasField('LocalizedName'))
      this.localizedName = this.template.RootNode.getFieldByLabel('LocalizedName').getCExoLocString();
        
    if(this.template.RootNode.hasField('MaxCharges'))
      this.maxCharges = this.template.RootNode.getFieldByLabel('MaxCharges').getValue();

    if(this.template.RootNode.hasField('ModelVariation'))
      this.modelVariation = this.template.RootNode.getFieldByLabel('ModelVariation').getValue();
    
    if(this.template.RootNode.hasField('NewItem'))
      this.newItem = this.template.RootNode.getFieldByLabel('NewItem').getValue();
        
    if(this.template.RootNode.hasField('NonEquippable'))
      this.nonEquippable = this.template.RootNode.getFieldByLabel('NonEquippable').getValue();
  
    if(this.template.RootNode.hasField('Pickpocketable'))
      this.pickpocketable = this.template.RootNode.getFieldByLabel('Pickpocketable').getValue();
      
    if(this.template.RootNode.hasField('Plot'))
      this.plot = this.template.getFieldByLabel('Plot').getValue();

    if(this.template.RootNode.hasField('PropertiesList')){
      let propertiesList = this.template.getFieldByLabel('PropertiesList').getChildStructs();
      this.properties = [];
      for(let i = 0, len = propertiesList.length; i < len; i++){
        this.properties.push( 
          new ItemProperty( 
            GFFObject.FromStruct( propertiesList[i] ), this 
          ) 
        );
      }
    }

    if(this.template.RootNode.hasField('StackSize'))
      this.stackSize = this.template.getFieldByLabel('StackSize').getValue();

    if(this.template.RootNode.hasField('Stolen'))
      this.stolen = this.template.getFieldByLabel('Stolen').getValue();

    if(this.template.RootNode.hasField('Tag'))
      this.tag = this.template.getFieldByLabel('Tag').getValue().replace(/\0[\s\S]*$/g,'');

    if(this.template.RootNode.hasField('TextureVar'))
      this.textureVariation = this.template.getFieldByLabel('TextureVar').getValue();

    if(this.template.RootNode.hasField('Upgrades')){
      this.upgrades = this.template.getFieldByLabel('Upgrades').getValue();
    }

    if(this.template.RootNode.hasField('K2VR_UsesDay')){
      (this as any).wornCastUseState = {
        charges: Number(this.charges) || 0,
        usesDay: this.template.getFieldByLabel('K2VR_UsesDay').getValue(),
        usesToday: this.template.RootNode.hasField('K2VR_UsesToday') ? this.template.getFieldByLabel('K2VR_UsesToday').getValue() : 0,
      };
    }

    if(this.template.RootNode.hasField('UpgradeLevel')){
      this.upgradeLevel = this.template.getFieldByLabel('UpgradeLevel').getValue();
    }

    if(this.template.RootNode.hasField('UpgradeSlot0')){
      this.upgradeSlot0 = this.template.getFieldByLabel('UpgradeSlot0').getValue();
    }

    if(this.template.RootNode.hasField('UpgradeSlot1')){
      this.upgradeSlot1 = this.template.getFieldByLabel('UpgradeSlot1').getValue();
    }

    if(this.template.RootNode.hasField('UpgradeSlot2')){
      this.upgradeSlot2 = this.template.getFieldByLabel('UpgradeSlot2').getValue();
    }

    if(this.template.RootNode.hasField('UpgradeSlot3')){
      this.upgradeSlot3 = this.template.getFieldByLabel('UpgradeSlot3').getValue();
    }

    if(this.template.RootNode.hasField('UpgradeSlot4')){
      this.upgradeSlot4 = this.template.getFieldByLabel('UpgradeSlot4').getValue();
    }

    if(this.template.RootNode.hasField('UpgradeSlot5')){
      this.upgradeSlot5 = this.template.getFieldByLabel('UpgradeSlot5').getValue();
    }

    if(this.template.RootNode.hasField('XPosition'))
      this.position.x = this.template.RootNode.getFieldByLabel('XPosition').getValue();

    if(this.template.RootNode.hasField('YPosition'))
      this.position.y = this.template.RootNode.getFieldByLabel('YPosition').getValue();

    if(this.template.RootNode.hasField('ZPosition'))
      this.position.z = this.template.RootNode.getFieldByLabel('ZPosition').getValue();

    if(this.template.RootNode.hasField('XOrientation'))
      this.xOrientation = this.template.RootNode.getFieldByLabel('XOrientation').getValue();

    if(this.template.RootNode.hasField('YOrientation'))
      this.yOrientation = this.template.RootNode.getFieldByLabel('YOrientation').getValue();

    if(this.template.RootNode.hasField('ZOrientation'))
      this.zOrientation = this.template.RootNode.getFieldByLabel('ZOrientation').getValue();

    if(this.template.RootNode.hasField('PaletteID'))
      this.palleteID = this.template.RootNode.getFieldByLabel('PaletteID').getValue();

    // baseitems.2da `weaponmattype` names the weaponsounds.2da row (0 Unarmed,
    // 1 Lightsaber, 2 Blade, 3 Large Blade). `powereditem` (0/1) was used, so
    // every vibroblade swung and hit with the Unarmed sounds (critic run 6
    // sweep, read from the retail tables). Blasters have none.
    const materialType = Number(this.baseItem?.weaponMaterialType);
    this.weaponSound = Number.isInteger(materialType) && materialType >= 0
      ? GameState.SWRuleSet.weaponSounds[materialType]
      : undefined;

    this.initialized = true

  }

  setPossessor( oCreature: ModuleObject){
    this.possessor = oCreature;
  }

  getPossessor(){
    return this.possessor;
  }

  onEquip(oCreature: ModuleCreature){
    console.log('ModuleItem.onEquip', oCreature?.getTag?.(), this.getTag?.());
    if(this.isDisguise()){
      oCreature.removeEffectsByType( GameEffectType.EffectDisguise ); //EFFECT_DISGUISE
      let eDisguise = new EffectDisguise();
      eDisguise.setInt(0, this.getDisguiseAppearanceId());
      eDisguise.setCreator(this);
      eDisguise.setAttachedObject(oCreature);
      oCreature.addEffect( eDisguise );
    }
    if(GameState.PartyManager.party.indexOf(oCreature) >= 0){
      GameState.InventoryManager.removeItem(this);
    }else{
      //oCreature.inventory.push(this);
    }
    this.setPossessor(oCreature);
  }

  /**
   * Returns the party-pool entry the item went back to (it may have merged
   * into an identical copy already in the bag), or undefined when it was
   * not returned. unequipSlot uses this so it never adds the item twice.
   */
  onUnEquip(oCreature: ModuleCreature): ModuleItem | undefined {
    console.log('ModuleItem.onUnEquip', oCreature?.getTag?.(), this.getTag?.());
    oCreature.removeEffectsByCreator(this);
    let returned: ModuleItem | undefined;
    if(GameState.PartyManager.party.indexOf(oCreature) >= 0){
      returned = GameState.InventoryManager.addItem(this);
    }else{
      //oCreature.inventory.push(this);
    }
    this.setPossessor(undefined);
    return returned;
  }

  destroy(): void {
    super.destroy();
    if(this.placedInWorld){
      if(this.area) this.area.detachObject(this);
    }
  }

  save(){
    let itemStruct = new GFFStruct(0);

    if(this.id >= 0)
      itemStruct.addField( new GFFField(GFFDataType.DWORD, 'ObjectId') ).setValue(this.id);
    
    itemStruct.addField( new GFFField(GFFDataType.INT, 'BaseItem') ).setValue(this.getBaseItemId());
    itemStruct.addField( new GFFField(GFFDataType.CEXOSTRING, 'Tag') ).setValue(this.tag);
    itemStruct.addField( new GFFField(GFFDataType.BYTE, 'Identified') ).setValue(this.identified);
    itemStruct.addField( new GFFField(GFFDataType.CEXOLOCSTRING, 'Description') ).setValue(this.template.getFieldByLabel('Description')?.getCExoLocString());
    itemStruct.addField( new GFFField(GFFDataType.CEXOLOCSTRING, 'DescIdentified') ).setValue(this.template.getFieldByLabel('DescIdentified')?.getCExoLocString());
    itemStruct.addField( new GFFField(GFFDataType.CEXOLOCSTRING, 'LocalizedName') ).setValue(this.template.getFieldByLabel('LocalizedName')?.getCExoLocString());
    itemStruct.addField( new GFFField(GFFDataType.WORD, 'StackSize') ).setValue(this.stackSize);
    itemStruct.addField( new GFFField(GFFDataType.BYTE, 'Stolen') ).setValue(this.stolen);
    itemStruct.addField( new GFFField(GFFDataType.DWORD, 'Upgrades') ).setValue(this.upgrades);
    // TSL upgrade state. Nothing in the port edits it yet, so the template's
    // own fields are the item's state; they used to be dropped on save, and an
    // upgraded lightsaber came back plain (critic run 4).
    itemStruct.addField( new GFFField(GFFDataType.BYTE, 'UpgradeLevel') ).setValue(this.upgradeLevel || 0);
    // The port's worn-activatable use count (ItemCastUseLimit), so "1 use per
    // day" survives a save and load (critic run 6). Not a retail field;
    // retail ignores unknown fields.
    const wornUse = (this as any).wornCastUseState;
    if(wornUse && wornUse.usesDay !== undefined){
      itemStruct.addField( new GFFField(GFFDataType.INT, 'K2VR_UsesDay') ).setValue(wornUse.usesDay | 0);
      itemStruct.addField( new GFFField(GFFDataType.INT, 'K2VR_UsesToday') ).setValue((wornUse.usesToday ?? 0) | 0);
    }
    for(let i = 0; i < 6; i++){
      const label = 'UpgradeSlot' + i;
      if(this.template?.RootNode?.hasField(label)) itemStruct.addField(this.template.getFieldByLabel(label));
    }
    // An item with no flag was added by script (CreateItemOnObject) and is loot
    // by construction. Writing undefined read back as 0 and would have made it
    // vanish from a corpse after a save and load. See CorpseLoot.
    itemStruct.addField( new GFFField(GFFDataType.BYTE, 'Dropable') ).setValue(this.dropable ?? 1);
    itemStruct.addField( new GFFField(GFFDataType.BYTE, 'Pickpocketable') ).setValue(1);
    itemStruct.addField( new GFFField(GFFDataType.BYTE, 'ModelVariation') ).setValue(this.modelVariation);
    itemStruct.addField( new GFFField(GFFDataType.BYTE, 'Charges') ).setValue(this.charges);
    itemStruct.addField( new GFFField(GFFDataType.BYTE, 'MaxCharges') ).setValue(this.maxCharges);
    itemStruct.addField( new GFFField(GFFDataType.DWORD, 'Cost') ).setValue(this.cost);
    itemStruct.addField( new GFFField(GFFDataType.DWORD, 'AddCost') ).setValue(this.addCost);
    itemStruct.addField( new GFFField(GFFDataType.BYTE, 'Plot') ).setValue(this.plot);

    let propertiesList = itemStruct.addField( new GFFField(GFFDataType.LIST, 'PropertiesList') );
    for(let i = 0; i < this.properties.length; i++){
      propertiesList.addChildStruct( this.properties[i].save() );
    }

    itemStruct.addField( new GFFField(GFFDataType.FLOAT, 'XPosition') ).setValue(this.position.x);
    itemStruct.addField( new GFFField(GFFDataType.FLOAT, 'YPosition') ).setValue(this.position.y);
    itemStruct.addField( new GFFField(GFFDataType.FLOAT, 'ZPosition') ).setValue(this.position.z);
    itemStruct.addField( new GFFField(GFFDataType.FLOAT, 'XOrientation') ).setValue(this.xOrientation);
    itemStruct.addField( new GFFField(GFFDataType.FLOAT, 'YOrientation') ).setValue(this.yOrientation);
    itemStruct.addField( new GFFField(GFFDataType.FLOAT, 'ZOrientation') ).setValue(this.zOrientation);
    itemStruct.addField( new GFFField(GFFDataType.BYTE, 'NonEquippable') ).setValue(this.nonEquippable);
    itemStruct.addField( new GFFField(GFFDataType.BYTE, 'NewItem') ).setValue(this.newItem);
    itemStruct.addField( new GFFField(GFFDataType.BYTE, 'DELETING') ).setValue(0);

    return itemStruct;
  }

}
