import { GameMenu } from "@/gui";
import type { GUIListBox, GUILabel, GUIButton } from "@/gui";
import { GUIFeatItem } from "@/game/kotor/gui/GUIFeatItem";
import type { ModuleCreature } from "@/module";
import type { CreatureClass } from "@/combat/CreatureClass";
import { GameState } from "@/GameState";
import {
  LEVEL_UP_POWER_CLASS_COLUMNS,
  groupLevelUpPowerChains,
  listLevelUpPowers,
  recommendLevelUpPowers,
} from "@/game/kotor/menu/LevelUpRules";
import type { LevelUpPowerEntry } from "@/game/kotor/menu/LevelUpRules";

/**
 * A Force power dressed as the feat shape `GUIFeatItem` draws: an id, an icon
 * and no feat prerequisites. The grid then gives powers the same click-to-pick
 * behaviour and gold / green / steel-blue frames as the Feats step.
 */
interface PowerListItem {
  readonly id: number;
  readonly icon: string;
  readonly name: string;
  readonly description: string;
  readonly prereqFeat1: number;
  readonly prereqFeat2: number;
  readonly entry: LevelUpPowerEntry;
}

/**
 * MenuPowerLevelUp class.
 *
 * The Force Powers step of a level-up. It was an empty shell in both games and
 * nothing opened it, so no character ever learned a power by levelling.
 * Eligibility, grouping and recommendations are `LevelUpRules`; this screen
 * only presents them and records the picks on the class being levelled.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file MenuPowerLevelUp.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class MenuPowerLevelUp extends GameMenu {

  MAIN_TITLE_LBL: GUILabel;
  SUB_TITLE_LBL: GUILabel;
  REMAINING_SELECTIONS_LBL: GUILabel;
  SELECTIONS_REMAINING_LBL: GUILabel;
  DESC_LBL: GUILabel;
  LB_POWERS: GUIListBox;
  LB_DESC: GUIListBox;
  LBL_POWER: GUILabel;
  RECOMMENDED_BTN: GUIButton;
  SELECT_BTN: GUIButton;
  ACCEPT_BTN: GUIButton;
  BACK_BTN: GUIButton;

  /** Read by `resolveGUIFeatActor`, as on the Feats step. */
  creature: ModuleCreature;

  /** Powers picked on this visit, in the order they were taken. */
  protected pickedPowerIds: Set<number> = new Set();
  protected highlightedPowerId: number | undefined = undefined;
  private entries: LevelUpPowerEntry[] = [];

  constructor(){
    super();
    this.gui_resref = 'pwrlvlup';
    this.background = '';
    this.voidFill = false;
  }

  async menuControlInitializer(skipInit: boolean = false) {
    await super.menuControlInitializer();
    if(skipInit) return;
    return new Promise<void>((resolve, reject) => {
      this.wirePowerControls();
      resolve();
    });
  }

  /** Separate for TSL, whose subclass skips this class's initializer body. */
  protected wirePowerControls(){
    this.BACK_BTN?.addEventListener('click', (e: any) => {
      e?.stopPropagation?.();
      this.undoPicks();
      this.close();
    });

    this.ACCEPT_BTN?.addEventListener('click', (e: any) => {
      e?.stopPropagation?.();
      GameState.CharGenManager.levelUp?.completeStep('powers');
      this.close();
    });

    this.SELECT_BTN?.addEventListener('click', (e: any) => {
      e?.stopPropagation?.();
      if(this.highlightedPowerId === undefined) return;
      this.togglePower(this.highlightedPowerId);
      this.refresh();
    });

    this.RECOMMENDED_BTN?.addEventListener('click', (e: any) => {
      e?.stopPropagation?.();
      this.selectRecommendedPowers();
    });
  }

  setCreature(creature: ModuleCreature){
    this.creature = creature;
  }

  /** Forgets the previous visit's picks; the session has already restored the class. */
  resetSelections(){
    this.pickedPowerIds.clear();
    this.highlightedPowerId = undefined;
  }

  show(){
    super.show();
    this.LB_POWERS?.setProtoBuilder(GUIFeatItem);
    this.refresh();
    this.clearDescription();
  }

  /** The class whose known-powers list a pick is added to. */
  protected getPowerClass(): CreatureClass | undefined {
    const levelUp = GameState.CharGenManager.levelUp;
    if(levelUp) return levelUp.characterClass as unknown as CreatureClass;
    const mainClass = this.creature?.getMainClass?.();
    return mainClass || undefined;
  }

  /** Known through any class. Armband powers are borrowed, not learned. */
  protected knowsPower(id: number): boolean {
    const classes = this.creature?.classes ?? [];
    return classes.some((characterClass) => characterClass.spells.some((spell) => spell.id == id));
  }

  getRemainingPowerSelections(): number {
    const levelUp = GameState.CharGenManager.levelUp;
    if(!levelUp) return 0;
    return Math.max(0, levelUp.allowances.powerPicks - this.pickedPowerIds.size);
  }

  protected buildEntries(): LevelUpPowerEntry[] {
    const characterClass = this.getPowerClass();
    const table = GameState.TwoDAManager.datatables.get('spells');
    if(!this.creature || !characterClass || !table) return [];
    const rows: Record<string, unknown>[] = [];
    for(let i = 0; i < table.RowCount; i++) rows.push(table.rows[i]);
    return listLevelUpPowers({
      rows,
      classColumn: LEVEL_UP_POWER_CLASS_COLUMNS[characterClass.id],
      characterLevel: this.creature.getTotalClassLevel(),
      isKnown: (id) => this.knowsPower(id),
    });
  }

  private toItem(entry: LevelUpPowerEntry): PowerListItem {
    const text = (strref: unknown) => {
      const id = Number(strref);
      return Number.isInteger(id) && id >= 0 ? GameState.TLKManager.GetStringById(id)?.Value ?? '' : '';
    };
    return {
      id: entry.id,
      icon: String(entry.row.iconresref ?? ''),
      name: text(entry.row.name),
      description: text(entry.row.spelldesc),
      prereqFeat1: -1,
      prereqFeat2: -1,
      entry,
    };
  }

  refresh(){
    this.entries = this.buildEntries();
    const groups = groupLevelUpPowerChains(this.entries)
      .map((group) => group.map((entry) => entry ? this.toItem(entry) : entry));
    // Auto level-up picks through this screen without ever showing it.
    if(this.bVisible){
      this.LB_POWERS?.setItems(groups);
      this.LB_POWERS?.markListRttDirty?.();
    }
    this.REMAINING_SELECTIONS_LBL?.setText(String(this.getRemainingPowerSelections()));
  }

  /** The `GUIFeatItem` selection-screen contract; see `CharGenFeats.getFeatPresentation`. */
  getFeatPresentation(item: PowerListItem): { state: 'owned'|'selectable'|'unavailable'; picked: boolean; highlighted: boolean } {
    const picked = !!item && this.pickedPowerIds.has(item.id);
    const highlighted = !!item && this.highlightedPowerId === item.id;
    if(!item) return { state: 'unavailable', picked, highlighted };
    if(picked) return { state: 'selectable', picked, highlighted };
    const state = item.entry.state === 'known' ? 'owned' : item.entry.state;
    return { state, picked, highlighted };
  }

  /** A click on a power: pick it, or take back a pick made on this visit. */
  selectFeatFromList(item: PowerListItem){
    if(!item) return;
    this.highlightFeat(item);
    this.togglePower(item.id);
    this.refresh();
  }

  highlightFeat(item: PowerListItem){
    if(!item) return;
    this.highlightedPowerId = item.id;
    this.describeFeat(item);
  }

  describeFeat(item: PowerListItem){
    if(!item) return;
    this.LBL_POWER?.setText(item.name || '');
    this.LB_DESC?.setItem(item.description || '');
  }

  clearDescription(){
    this.LBL_POWER?.setText('');
    this.LB_DESC?.setItem('');
  }

  /** @returns whether anything changed */
  togglePower(id: number): boolean {
    if(this.pickedPowerIds.has(id)){
      this.unpickPower(id);
      return true;
    }
    if(this.getRemainingPowerSelections() <= 0) return false;
    const entry = this.buildEntries().find((candidate) => candidate.id === id);
    if(!entry || entry.state !== 'selectable') return false;
    const characterClass = this.getPowerClass();
    if(!characterClass) return false;
    characterClass.addSpell(new GameState.TalentSpell(id));
    this.pickedPowerIds.add(id);
    return true;
  }

  /**
   * Removes a pick, and any later pick that needed it: taking back Heal also
   * takes back an Improved Heal chosen on the strength of it.
   */
  private unpickPower(id: number){
    const characterClass = this.getPowerClass();
    if(characterClass){
      const index = characterClass.spells.findIndex((spell) => spell.id == id);
      if(index >= 0) characterClass.spells.splice(index, 1);
    }
    this.pickedPowerIds.delete(id);
    for(const entry of this.buildEntries()){
      if(this.pickedPowerIds.has(entry.id) && entry.prerequisites.includes(id)){
        this.unpickPower(entry.id);
      }
    }
  }

  undoPicks(){
    for(const id of Array.from(this.pickedPowerIds)) this.unpickPower(id);
    this.highlightedPowerId = undefined;
  }

  selectRecommendedPowers(){
    this.undoPicks();
    const lightSide = Number((this.creature as any)?.goodEvil ?? 50) >= 50;
    const ids = recommendLevelUpPowers(this.buildEntries(), this.getRemainingPowerSelections(), lightSide);
    for(const id of ids) this.togglePower(id);
    this.refresh();
  }

}
