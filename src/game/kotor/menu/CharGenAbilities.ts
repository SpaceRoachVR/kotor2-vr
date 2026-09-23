import type { GUIListBox, GUILabel, GUIButton } from "@/gui";
import type { ModuleCreature } from "@/module";
import { CharGenAttribute } from "@/enums/chargen/CharGenAttribute";
import { GameMenu } from "@/gui";
import { GameState } from "@/GameState";

/**
 * CharGenAbilities class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file CharGenAbilities.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class CharGenAbilities extends GameMenu {

  MAIN_TITLE_LBL: GUILabel;
  SUB_TITLE_LBL: GUILabel;
  REMAINING_SELECTIONS_LBL: GUILabel;
  SELECTIONS_REMAINING_LBL: GUILabel;
  DEX_POINTS_BTN: GUIButton;
  DEX_LBL: GUILabel;
  DEX_MINUS_BTN: GUIButton;
  DEX_PLUS_BTN: GUIButton;
  CON_POINTS_BTN: GUIButton;
  CON_PLUS_BTN: GUIButton;
  CON_MINUS_BTN: GUIButton;
  CON_LBL: GUILabel;
  WIS_POINTS_BTN: GUIButton;
  WIS_LBL: GUILabel;
  WIS_MINUS_BTN: GUIButton;
  WIS_PLUS_BTN: GUIButton;
  INT_POINTS_BTN: GUIButton;
  INT_PLUS_BTN: GUIButton;
  INT_MINUS_BTN: GUIButton;
  INT_LBL: GUILabel;
  CHA_POINTS_BTN: GUIButton;
  CHA_PLUS_BTN: GUIButton;
  CHA_MINUS_BTN: GUIButton;
  CHA_LBL: GUILabel;
  DESC_LBL: GUILabel;
  COST_LBL: GUILabel;
  COST_POINTS_LBL: GUILabel;
  LBL_MODIFIER: GUILabel;
  LBL_ABILITY_MOD: GUILabel;
  LB_DESC: GUIListBox;
  STR_POINTS_BTN: GUIButton;
  STR_LBL: GUILabel;
  STR_MINUS_BTN: GUIButton;
  STR_PLUS_BTN: GUIButton;
  BTN_RECOMMENDED: GUIButton;
  BTN_ACCEPT: GUIButton;
  BTN_BACK: GUIButton;

  creature: ModuleCreature;

  constructor(){
    super();
    this.gui_resref = 'abchrgen';
    this.background = '';
    this.voidFill = true;
  }

  async menuControlInitializer(skipInit: boolean = false) {
    await super.menuControlInitializer();
    if(skipInit) return;
    return new Promise<void>((resolve, reject) => {
      this.wireAbilityControls();
      resolve();
    });
  }

  /** The six rows: attribute id, `CharGenManager` field, control prefix. */
  private static readonly ATTRIBUTE_ROWS: ReadonlyArray<[number, 'str'|'dex'|'con'|'wis'|'int'|'cha', string]> = [
    [CharGenAttribute.STR, 'str', 'STR'], [CharGenAttribute.DEX, 'dex', 'DEX'],
    [CharGenAttribute.CON, 'con', 'CON'], [CharGenAttribute.WIS, 'wis', 'WIS'],
    [CharGenAttribute.INT, 'int', 'INT'], [CharGenAttribute.CHA, 'cha', 'CHA'],
  ];

  private static fieldFor(attribute: number): 'str'|'dex'|'con'|'wis'|'int'|'cha' {
    return CharGenAbilities.ATTRIBUTE_ROWS.find(([id]) => id === attribute)?.[1] ?? 'str';
  }

  /**
   * Back, Accept, Recommended and the twelve adjust buttons.
   *
   * One method for both games: TSL's subclass calls
   * `super.menuControlInitializer(true)` and so never runs this class's body,
   * and it had grown a line-for-line copy of these handlers instead. Level-up
   * needed the same screen with different rules — one point per attribute, a
   * floor at the pre-level score, and no character-creation main screen to
   * update — and changing two copies is how they drift.
   */
  protected wireAbilityControls(){
    const manager = GameState.CharGenManager;

    this.BTN_BACK.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });

    this.BTN_ACCEPT.addEventListener('click', (e) => {
      e.stopPropagation();

      this.commitAttributes();

      const levelUp = manager.levelUp;
      if(levelUp){
        levelUp.completeStep('attributes');
      }else{
        this.manager.CharGenMain?.updateAttributes();
      }

      this.close();
    });

    this.BTN_RECOMMENDED.addEventListener('click', (e) => {
      e?.stopPropagation?.();
      const levelUp = manager.levelUp;
      if(levelUp){
        this.applyRecommendedLevelUpAttributes();
      }else{
        manager.availPoints = 0;
        if(this.creature){
          for(const [, field] of CharGenAbilities.ATTRIBUTE_ROWS){
            manager[field] = parseInt(this.creature.classes[0][field] as any);
          }
        }
      }
      this.updateButtonStates();
    });

    for(const [attribute, field, prefix] of CharGenAbilities.ATTRIBUTE_ROWS){
      (this as any)[`${prefix}_MINUS_BTN`].addEventListener('click', (e: any) => {
        e.stopPropagation();
        if(this.creature && manager[field] > this.getAttributeFloor(attribute)){
          const cost = this.getAttributeCost(attribute);
          manager[field] -= 1;
          manager.availPoints += cost;
        }
        this.updateButtonStates();
      });

      (this as any)[`${prefix}_PLUS_BTN`].addEventListener('click', (e: any) => {
        e.stopPropagation();
        if(this.creature && this.getAttributeCost(attribute) <= manager.availPoints){
          manager[field] += 1;
          const cost = this.getAttributeCost(attribute);
          manager.availPoints -= cost;
        }
        this.updateButtonStates();
      });
    }
  }

  /**
   * The lowest a score may be lowered to on this visit. In character creation
   * that is 8, or what an earlier Accept already committed; in a level-up it is
   * the score before this level, so points already owned cannot be refunded.
   */
  getAttributeFloor(attribute: number): number {
    const field = CharGenAbilities.fieldFor(attribute);
    const levelUp = GameState.CharGenManager.levelUp;
    if(levelUp) return levelUp.baseline.abilities[field];
    return Math.max(8, Number(this.creature?.[field] ?? 8));
  }

  /** Writes the scores being edited onto the creature. */
  commitAttributes(){
    if(!this.creature) return;
    for(const [, field] of CharGenAbilities.ATTRIBUTE_ROWS){
      this.creature[field] = GameState.CharGenManager[field];
    }
  }

  /** Level-up Recommended: this level's points go to the class's primary ability. */
  applyRecommendedLevelUpAttributes(){
    const manager = GameState.CharGenManager;
    const levelUp = manager.levelUp;
    if(!levelUp) return;
    for(const [, field] of CharGenAbilities.ATTRIBUTE_ROWS){
      manager[field] = levelUp.baseline.abilities[field];
    }
    const primary = String(levelUp.characterClass.primaryabil || '').toLowerCase();
    const target = CharGenAbilities.ATTRIBUTE_ROWS.find(([, field]) => field === primary)?.[1] ?? 'str';
    manager[target] += levelUp.allowances.attributePoints;
    manager.availPoints = 0;
  }

  show(){
    super.show();
    this.updateButtonStates();
    // Wired on show rather than in the initializer: TSL's subclass calls
    // `super.menuControlInitializer(true)` and so skips this class's body,
    // which is the same trap `CharGenFeats.wireStepNavigation` documents.
    if(!this.attributeDescriptionsWired){
      this.attributeDescriptionsWired = true;
      this.wireAttributeDescriptions();
    }
    this.clearAttributeDescription();
  }

  private attributeDescriptionsWired = false;

  setCreature(creature: ModuleCreature){
    this.creature = creature;
  }

  /**
   * The ability modifier for a score, matching `CombatRound.GetMod`, formatted
   * the way the screen's own authored placeholder implies: a signed two-digit
   * field. The retail column between the attribute name and its score is the
   * modifier, and it was never written — every row read the placeholder `00`
   * regardless of the score beside it.
   */
  private static formatAbilityModifier(score: number): string {
    const modifier = Math.floor((Number(score) - 10) / 2);
    const magnitude = Math.abs(modifier).toString().padStart(2, '0');
    return `${modifier < 0 ? '-' : '+'}${magnitude}`;
  }

  updateButtonStates(){
    this.STR_POINTS_BTN.setText(GameState.CharGenManager.str);
    this.DEX_POINTS_BTN.setText(GameState.CharGenManager.dex);
    this.CON_POINTS_BTN.setText(GameState.CharGenManager.con);
    this.WIS_POINTS_BTN.setText(GameState.CharGenManager.wis);
    this.INT_POINTS_BTN.setText(GameState.CharGenManager.int);
    this.CHA_POINTS_BTN.setText(GameState.CharGenManager.cha);

    const mod = CharGenAbilities.formatAbilityModifier;
    (this as any).LBL_BONUS_STR?.setText(mod(GameState.CharGenManager.str));
    (this as any).LBL_BONUS_DEX?.setText(mod(GameState.CharGenManager.dex));
    (this as any).LBL_BONUS_CON?.setText(mod(GameState.CharGenManager.con));
    (this as any).LBL_BONUS_WIS?.setText(mod(GameState.CharGenManager.wis));
    (this as any).LBL_BONUS_INT?.setText(mod(GameState.CharGenManager.int));
    (this as any).LBL_BONUS_CHA?.setText(mod(GameState.CharGenManager.cha));

    //Selected Attribute Cost
    //this.COST_POINTS_LBL

    this.STR_MINUS_BTN.show();
    this.DEX_MINUS_BTN.show();
    this.CON_MINUS_BTN.show();
    this.WIS_MINUS_BTN.show();
    this.INT_MINUS_BTN.show();
    this.CHA_MINUS_BTN.show();

    this.STR_PLUS_BTN.show();
    this.DEX_PLUS_BTN.show();
    this.CON_PLUS_BTN.show();
    this.WIS_PLUS_BTN.show();
    this.INT_PLUS_BTN.show();
    this.CHA_PLUS_BTN.show();

    // The minus-button rules below all read this.creature. Without a creature
    // this threw partway through the refresh on every click, so nothing redrew.
    // The show() calls above deliberately stay outside the guard.
    if(!this.creature) return;

    if(GameState.CharGenManager.str <= this.getAttributeFloor(CharGenAttribute.STR))
      this.STR_MINUS_BTN.hide();

    if(GameState.CharGenManager.dex <= this.getAttributeFloor(CharGenAttribute.DEX))
      this.DEX_MINUS_BTN.hide();

    if(GameState.CharGenManager.con <= this.getAttributeFloor(CharGenAttribute.CON))
      this.CON_MINUS_BTN.hide();

    if(GameState.CharGenManager.wis <= this.getAttributeFloor(CharGenAttribute.WIS))
      this.WIS_MINUS_BTN.hide();

    if(GameState.CharGenManager.int <= this.getAttributeFloor(CharGenAttribute.INT))
      this.INT_MINUS_BTN.hide();

    if(GameState.CharGenManager.cha <= this.getAttributeFloor(CharGenAttribute.CHA))
      this.CHA_MINUS_BTN.hide();

    if(this.getAttributeCost(CharGenAttribute.STR) > GameState.CharGenManager.availPoints)
      this.STR_PLUS_BTN.hide();

    if(this.getAttributeCost(CharGenAttribute.DEX) > GameState.CharGenManager.availPoints)
      this.DEX_PLUS_BTN.hide();

    if(this.getAttributeCost(CharGenAttribute.CON) > GameState.CharGenManager.availPoints)
      this.CON_PLUS_BTN.hide();

    if(this.getAttributeCost(CharGenAttribute.WIS) > GameState.CharGenManager.availPoints)
      this.WIS_PLUS_BTN.hide();

    if(this.getAttributeCost(CharGenAttribute.INT) > GameState.CharGenManager.availPoints)
      this.INT_PLUS_BTN.hide();

    if(this.getAttributeCost(CharGenAttribute.CHA) > GameState.CharGenManager.availPoints)
      this.CHA_PLUS_BTN.hide();

    this.REMAINING_SELECTIONS_LBL.setText(GameState.CharGenManager.availPoints);
  }

  /**
   * TLK string references for the attribute descriptions.
   *
   * There is no 2DA for these — unlike skills and feats, which carry a
   * `description` strref column — so the engine has to know them. They were
   * found by dumping the chargen block of the loaded `dialog.tlk` rather than
   * guessed: 208 "CHARACTER GENERATION", 209 "Attributes", 211-216 the six
   * attribute names in this order, 217 "Description", 218 "Point Cost", and
   * 222-227 the descriptions in the same order.
   *
   * Verified against TSL's `dialog.tlk`. K1 ships a different table and has NOT
   * been verified, which is why {@link describeAttribute} checks the resolved
   * text names the attribute it is about and shows nothing rather than
   * something wrong when it does not.
   */
  static readonly ATTRIBUTE_DESCRIPTION_STRREFS: Record<number, number> = {
    [CharGenAttribute.STR]: 222,
    [CharGenAttribute.DEX]: 223,
    [CharGenAttribute.CON]: 224,
    [CharGenAttribute.WIS]: 225,
    [CharGenAttribute.INT]: 226,
    [CharGenAttribute.CHA]: 227,
  };

  /** TLK references for the attribute names, used to validate the above. */
  static readonly ATTRIBUTE_NAME_STRREFS: Record<number, number> = {
    [CharGenAttribute.STR]: 211,
    [CharGenAttribute.DEX]: 212,
    [CharGenAttribute.CON]: 213,
    [CharGenAttribute.WIS]: 214,
    [CharGenAttribute.INT]: 215,
    [CharGenAttribute.CHA]: 216,
  };

  /**
   * Fills the Description and Point Cost panels for the attribute under the
   * pointer. Both were declared on this menu and never written to.
   *
   * The description is only shown when the resolved string actually names the
   * attribute. The strrefs are hard-coded because no data table carries them,
   * and a hard-coded strref that is right for TSL may address unrelated text in
   * K1 — better to show a cost and no prose than confident nonsense.
   */
  describeAttribute(attribute: number){
    // Hover fires every frame; only rebuild when the attribute actually
    // changes. See the same guard in CharGenSkills.describeSkill.
    if(this.describedAttribute === attribute) return;
    this.describedAttribute = attribute;
    const cost = this.getAttributeCost(attribute);
    this.COST_POINTS_LBL?.setText(String(cost));

    const nameRef = CharGenAbilities.ATTRIBUTE_NAME_STRREFS[attribute];
    const descRef = CharGenAbilities.ATTRIBUTE_DESCRIPTION_STRREFS[attribute];
    const name = GameState.TLKManager.GetStringById(nameRef)?.Value ?? '';
    const description = GameState.TLKManager.GetStringById(descRef)?.Value ?? '';
    const describesThisAttribute = !!name && !!description
      && description.toLowerCase().indexOf(name.toLowerCase()) >= 0;

    this.LB_DESC?.setItem(describesThisAttribute ? description : '');
  }

  private describedAttribute: number = -1;

  clearAttributeDescription(){
    this.describedAttribute = -1;
    this.LB_DESC?.setItem('');
    this.COST_POINTS_LBL?.setText('');
  }

  /**
   * Every control in an attribute row reports the same attribute on hover, so
   * the description appears wherever the player's pointer naturally rests —
   * the name, the value, or either adjust button.
   */
  protected wireAttributeDescriptions(){
    const rows: [number, string][] = [
      [CharGenAttribute.STR, 'STR'], [CharGenAttribute.DEX, 'DEX'],
      [CharGenAttribute.CON, 'CON'], [CharGenAttribute.WIS, 'WIS'],
      [CharGenAttribute.INT, 'INT'], [CharGenAttribute.CHA, 'CHA'],
    ];
    for(const [attribute, prefix] of rows){
      for(const suffix of ['_LBL', '_POINTS_BTN', '_MINUS_BTN', '_PLUS_BTN']){
        const control = (this as any)[`${prefix}${suffix}`];
        control?.addEventListener?.('hover', () => this.describeAttribute(attribute));
      }
    }
  }

  getAttributeCost(index = 0){
    // A level-up point buys exactly one score, whatever the score already is.
    if(GameState.CharGenManager.levelUp) return 1;
    let mod = 0;
    switch(index){
      case CharGenAttribute.STR:
        mod = Math.floor((GameState.CharGenManager.str - 10)/2);
      break;
      case CharGenAttribute.DEX:
        mod = Math.floor((GameState.CharGenManager.dex - 10)/2);
      break;
      case CharGenAttribute.CON:
        mod = Math.floor((GameState.CharGenManager.con - 10)/2);
      break;
      case CharGenAttribute.WIS:
        mod = Math.floor((GameState.CharGenManager.wis - 10)/2);
      break;
      case CharGenAttribute.INT:
        mod = Math.floor((GameState.CharGenManager.int - 10)/2);
      break;
      case CharGenAttribute.CHA:
        mod = Math.floor((GameState.CharGenManager.cha - 10)/2);
      break;
    }
    return Math.max(1, mod);
  }

  reset(){
    GameState.CharGenManager.availPoints = 30;
    if(this.creature){
      this.creature.str = 8;
      this.creature.dex = 8;
      this.creature.con = 8;
      this.creature.wis = 8;
      this.creature.int = 8;
      this.creature.cha = 8;
    }
  }
  
}
