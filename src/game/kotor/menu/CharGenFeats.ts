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
    this.updateRemainingSelections();
    this.clearFeatDescription();
    if(!this.selectionWired){
      this.selectionWired = true;
      this.wireFeatSelection();
    }
    this.highlightedFeat = null;
  }

  /**
   * How many feats this character may still choose by hand.
   *
   * `featgain.2da` states the picks a class receives at each level, already
   * resolved onto `CreatureClass.featGainPoints`. Both authored labels were
   * declared and never written to, so the screen always read a blank or stale
   * count regardless of the character.
   *
   * Note this is the *choosable* allowance. `addGrantedFeats()` separately
   * awards every feat the class is simply entitled to, and those are not picks.
   */
  getRemainingFeatSelections(): number {
    if(!this.creature) return 0;
    const mainClass = this.creature.getMainClass();
    if(!mainClass) return 0;
    const level = Math.max(1, this.creature.getTotalClassLevel());
    const granted = mainClass.featGainPoints?.[level - 1] ?? 0;
    if(!Number.isFinite(granted)) return 0;
    return Math.max(0, granted - this.selectedFeatIds.size);
  }

  updateRemainingSelections(){
    // The two authored names are near-identical but do different jobs, and
    // getting them the wrong way round silently destroys the caption:
    //
    //   STD_SELECTIONS_REMAINING_LBL  left 410, width 300, "Remaining Feats"
    //   STD_REMAINING_SELECTIONS_LBL  left 656, width  42, "0"
    //
    // Only the second is the counter. The first is the caption beside it and
    // must be left exactly as the GUI file authored it.
    this.STD_REMAINING_SELECTIONS_LBL?.setText(String(this.getRemainingFeatSelections()));
  }

  /** Feats chosen by hand this visit, as opposed to granted by class. */
  protected selectedFeatIds: Set<number> = new Set();

  /** The feat the player last clicked; what Select acts on. */
  protected highlightedFeat: any = null;

  private selectionWired = false;

  /**
   * Whether a feat may be picked by hand right now.
   *
   * Deliberately reuses the rules `buildFeatList` already applies — class
   * availability and feat status — rather than re-deriving them, so the list
   * and the Select button can never disagree about what is takeable.
   */
  canSelectFeat(feat: any): boolean {
    if(!feat || !this.creature) return false;
    if(this.creature.getHasFeat(feat.id)) return false;
    const mainClass = this.creature.getMainClass();
    if(!mainClass || !mainClass.isFeatAvailable(feat)) return false;
    const status = mainClass.getFeatStatus(feat);
    if(status !== 0 && status !== 1) return false;
    return this.hasFeatPrerequisites(feat);
  }

  /** Both prerequisite slots, treating an absent one (-1) as satisfied. */
  hasFeatPrerequisites(feat: any): boolean {
    const satisfied = (prereq: unknown) => {
      const id = Number(prereq);
      return !Number.isInteger(id) || id < 0 || this.creature.getHasFeat(id);
    };
    return satisfied(feat?.prereqFeat1) && satisfied(feat?.prereqFeat2);
  }

  /** Called by `GUIFeatItem` when a feat row is clicked. */
  highlightFeat(feat: any){
    this.highlightedFeat = feat ?? null;
    this.describeFeat(feat);
  }

  /**
   * Adds the highlighted feat, or takes it back if it was picked this visit.
   *
   * Retail has no separate Remove control, so Select toggles: picks made here
   * can be undone before Accept, while feats granted by class cannot be
   * removed because they were never picks.
   */
  toggleHighlightedFeat(): boolean {
    const feat = this.highlightedFeat;
    if(!feat || !this.creature) return false;

    if(this.selectedFeatIds.has(feat.id)){
      this.selectedFeatIds.delete(feat.id);
      this.creature.removeFeat(feat.id);
      this.afterSelectionChanged();
      return true;
    }

    if(this.getRemainingFeatSelections() <= 0) return false;
    if(!this.canSelectFeat(feat)) return false;

    this.creature.addFeat(feat.id);
    this.selectedFeatIds.add(feat.id);
    this.afterSelectionChanged();
    return true;
  }

  /**
   * Spends every remaining pick on the first eligible feats in list order.
   *
   * Mirrors the shape of `allocateRecommendedCharGenSkills` — take what the
   * rules allow until the allowance is gone — rather than inventing a second
   * notion of what a sensible choice is.
   */
  selectRecommendedFeats(): number {
    if(!this.creature) return 0;
    let taken = 0;
    for(const feat of (GameState.SWRuleSet.feats || [])){
      if(this.getRemainingFeatSelections() <= 0) break;
      if(!feat || feat.constant == '****') continue;
      if(!this.canSelectFeat(feat)) continue;
      this.creature.addFeat(feat.id);
      this.selectedFeatIds.add(feat.id);
      taken++;
    }
    if(taken) this.afterSelectionChanged();
    return taken;
  }

  /**
   * Rebuilds what a pick changes: the remaining count, and the list itself so
   * a newly-taken feat stops rendering as unavailable.
   */
  protected afterSelectionChanged(){
    this.updateRemainingSelections();
    this.buildFeatList();
    this.LB_FEATS?.markListRttDirty?.();
    if(this.highlightedFeat) this.describeFeat(this.highlightedFeat);
  }

  /**
   * Wired from `show()` rather than the initializer: TSL's subclass drives its
   * own `menuControlInitializer`, and wiring hover from the base initializer is
   * exactly what left the skills screen with zero listeners.
   */
  protected wireFeatSelection(){
    this.BTN_SELECT?.addEventListener('click', (e: any) => {
      e?.stopPropagation?.();
      this.toggleHighlightedFeat();
    });
    this.BTN_RECOMMENDED?.addEventListener('click', (e: any) => {
      e?.stopPropagation?.();
      this.selectRecommendedFeats();
    });
  }

  clearFeatDescription(){
    this.LBL_NAME?.setText('');
    // An empty node clears the list; GUIListBox has no separate clear method.
    this.LB_DESC?.setItem('');
  }

  /**
   * Fills the name and description panels for the feat under the pointer.
   *
   * Called by `GUIFeatItem` on hover. `TalentFeat.name` and `.description` are
   * TLK string references, so the text is the game's own rather than anything
   * invented here.
   */
  describeFeat(feat: any){
    if(!feat) return;
    const nameText = GameState.TLKManager.GetStringById(Number(feat.name))?.Value;
    const descriptionText = GameState.TLKManager.GetStringById(Number(feat.description))?.Value;
    this.LBL_NAME?.setText(nameText || '');
    this.LB_DESC?.setItem(descriptionText || '');
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
