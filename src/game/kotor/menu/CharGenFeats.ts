import { GameMenu } from "@/gui";
import type { GUIListBox, GUILabel, GUIButton } from "@/gui";
import { GUIFeatItem } from "@/game/kotor/gui/GUIFeatItem";
import type { ModuleCreature } from "@/module";
import { GameState } from "@/GameState";

/**
 * CharGenFeats class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file CharGenFeats.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class CharGenFeats extends GameMenu {

  MAIN_TITLE_LBL: GUILabel;
  SUB_TITLE_LBL: GUILabel;
  DESC_LBL: GUILabel;
  STD_SELECTIONS_REMAINING_LBL: GUILabel;
  STD_REMAINING_SELECTIONS_LBL: GUILabel;
  LB_FEATS: GUIListBox;
  LB_DESC: GUIListBox;
  LBL_NAME: GUILabel;
  BTN_RECOMMENDED: GUIButton;
  BTN_SELECT: GUIButton;
  BTN_ACCEPT: GUIButton;
  BTN_BACK: GUIButton;

  creature: ModuleCreature;

  constructor(){
    super();
    this.gui_resref = 'ftchrgen';
    this.background = '1600x1200back';
    this.voidFill = true;
  }

  /**
   * Back and Accept are step navigation, and without them this screen is a
   * dead end.
   *
   * It is reachable as step 4 of `CharGenCustomPanel` and had no handler on any
   * of its four buttons, so entering it stranded the player inside character
   * creation with no way back — which is why custom chargen was hidden rather
   * than fixed.
   *
   * Manual feat *selection* (`BTN_SELECT`, `BTN_RECOMMENDED`) is still
   * unimplemented. It is not needed for a valid character: `addGrantedFeats()`
   * runs on `show()` and grants every feat the character's class entitles it
   * to, so a custom character leaves this screen properly equipped.
   *
   * Lives here rather than in the initializer because TSL's subclass calls
   * `super.menuControlInitializer(true)` and therefore skips this class's body.
   */
  protected wireStepNavigation(){
    this.BTN_BACK?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });

    this.BTN_ACCEPT?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
  }

  async menuControlInitializer(skipInit: boolean = false) {
    await super.menuControlInitializer();
    if(skipInit) return;
    return new Promise<void>((resolve, reject) => {
      this.wireStepNavigation();
      resolve();
    });
  }

  show() {
    super.show();
    this.addGrantedFeats();
    this.LB_FEATS.setProtoBuilder(GUIFeatItem);
    this.buildFeatList();
  }

  setCreature(creature: ModuleCreature){
    this.creature = creature;
  }

  addGrantedFeats() {
    const featCount = GameState.SWRuleSet.featCount;
    let granted = [];
    for (let i = 0; i < featCount; i++) {
      const feat = GameState.SWRuleSet.feats[i];
      if (!feat) continue;
      if(this.creature){
        const mainClass = this.creature.getMainClass();
        if (mainClass && feat.constant != '****') {
          if (mainClass.isFeatAvailable(feat)) {
            const status = mainClass.getFeatStatus(feat);
            if (status == 3 && this.creature.getTotalClassLevel() >= mainClass.getFeatGrantedLevel(feat)) {
              if (!this.creature.getHasFeat(feat.id)) {
                console.log('Feat Granted', feat);
                this.creature.addFeat(feat.id);
                granted.push(feat);
              }
            }
          }
        }
      }
    }
  }

  buildFeatList() {
    const feats = GameState.SWRuleSet.feats;
    const featCount = GameState.SWRuleSet.featCount;
    let list = [];
    if(this.creature){
      const mainClass = this.creature.getMainClass();
      if(mainClass){
        for (let i = 0; i < featCount; i++) {
          const feat = feats[i];
          if (feat && feat.constant != '****') {
            if (mainClass.isFeatAvailable(feat)) {
              const status = mainClass.getFeatStatus(feat);
              if (this.creature.getHasFeat(feat.id) || status == 0 || status == 1) {
                list.push(feat);
              }
            }
          }
        }
      }
    }
    let groups = [];
    for (let i = 0; i < list.length; i++) {
      const feat = list[i];
      const group = [];
      const prereqfeat1 = GameState.SWRuleSet.feats[feat.prereqFeat1];
      const prereqfeat2 = GameState.SWRuleSet.feats[feat.prereqFeat2];
      if (!prereqfeat1 && !prereqfeat2) {
        group.push(feat);
        for (let j = 0; j < featCount; j++) {
          const chainFeat = GameState.SWRuleSet.feats[j];
          if (!chainFeat) continue;
          if (chainFeat.prereqFeat1 == feat.id || chainFeat.prereqFeat2 == feat.id) {
            if (chainFeat.prereqFeat1 != -1 && chainFeat.prereqFeat2 != -1) {
              group[2] = chainFeat;
            } else {
              group[1] = chainFeat;
            }
          }
        }
        // Only a prerequisite-free feat roots a chain, and only then does the
        // group contain anything. Pushing regardless left empty groups in the
        // list, and the sort below then read `groupa[0].toolsCategories` off
        // undefined and threw -- aborting the whole method before setItems ran,
        // so the feats screen rendered an empty box.
        groups.push(group);
      }
    }
    groups.sort((groupa, groupb) => {
      const a = groupa[0]?.toolsCategories;
      const b = groupb[0]?.toolsCategories;
      if(a === b) return 0;
      return a > b ? 1 : -1;
    });
    this.LB_FEATS.setItems(groups);
  }
  
}
