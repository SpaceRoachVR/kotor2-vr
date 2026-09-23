import { GameMenu } from "@/gui";
import type { GUIListBox, GUILabel, GUIButton } from "@/gui";
import { GameState } from "@/GameState";

enum AbilityFilter {
  SKILLS = 1,
  POWERS = 2,
  FEATS = 3
}

/**
 * MenuAbilities class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file MenuAbilities.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class MenuAbilities extends GameMenu {

  LBL_INFOBG: GUILabel;
  LB_DESC: GUIListBox;
  LBL_PORTRAIT: GUILabel;
  LB_ABILITY: GUIListBox;
  LBL_NAME: GUILabel;
  LBL_SKILLRANK: GUILabel;
  LBL_RANKVAL: GUILabel;
  LBL_BONUS: GUILabel;
  LBL_BONUSVAL: GUILabel;
  LBL_TOTAL: GUILabel;
  LBL_TOTALVAL: GUILabel;
  BTN_POWERS: GUIButton;
  BTN_SKILLS: GUIButton;
  BTN_FEATS: GUIButton;
  BTN_EXIT: GUIButton;
  BTN_CHANGE1: GUIButton;
  BTN_CHANGE2: GUIButton;

  /**
   * The Abilities screen never described anything. Its feat and power items
   * report the icon under the pointer to their menu by name — `highlightFeat`,
   * `describeFeat`, `describeSpell`, the contract `CharGenFeats` already keeps
   * — and this menu had none of those methods, so the calls fell through a
   * `typeof ... === 'function'` guard and did nothing. Reported from a headset
   * session as "static icons are un-interactable".
   *
   * The text is the game's own: feats.2da `name`/`description` and spells.2da
   * `name`/`spelldesc` are TLK string references.
   */
  highlightFeat(feat: any){
    this.describeFeat(feat);
  }

  describeFeat(feat: any){
    if(!feat) return;
    this.showAbilityDescription(feat.name, feat.description);
  }

  describeSpell(spell: any){
    if(!spell) return;
    this.showAbilityDescription(spell.name, spell.spelldesc);
  }

  /** The list the current tab shows descriptions in. TSL overrides this for its Feats tab. */
  getDescriptionList(): GUIListBox {
    return this.LB_DESC;
  }

  protected showAbilityDescription(nameRef: unknown, descriptionRef: unknown){
    const nameText = GameState.TLKManager.GetStringById(Number(nameRef))?.Value;
    const descriptionText = GameState.TLKManager.GetStringById(Number(descriptionRef))?.Value;
    this.LBL_NAME?.setText(nameText || '');
    this.getDescriptionList()?.setItem(descriptionText || '');
  }

  filter: AbilityFilter = AbilityFilter.SKILLS;

  constructor(){
    super();
    this.gui_resref = 'abilities';
    this.background = '1600x1200back';
    this.voidFill = true;
  }

  async menuControlInitializer(skipInit: boolean = false) {
    await super.menuControlInitializer();
    if(skipInit) return;
    return new Promise<void>((resolve, reject) => {
      this.BTN_EXIT.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
      });
      this._button_b = this.BTN_EXIT;

      this.BTN_SKILLS.addEventListener('click', (e) => {
        e.stopPropagation();
        this.filter = AbilityFilter.SKILLS;
      });

      this.BTN_POWERS.addEventListener('click', (e) => {
        e.stopPropagation();
        this.filter = AbilityFilter.POWERS;
      });

      this.BTN_FEATS.addEventListener('click', (e) => {
        e.stopPropagation();
        this.filter = AbilityFilter.FEATS;
      });

      resolve();
    });
  }

  show() {
    super.show();
    this.manager.MenuTop.LBLH_ABI.onHoverIn();
  }

  triggerControllerBumperLPress() {
    this.manager.MenuTop.BTN_CHAR.click();
  }

  triggerControllerBumperRPress() {
    this.manager.MenuTop.BTN_MSG.click();
  }
  
}
