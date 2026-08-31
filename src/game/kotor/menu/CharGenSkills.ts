import { GameState } from "@/GameState";
import { GameMenu } from "@/gui";
import type { GUIListBox, GUILabel, GUIButton } from "@/gui";
import {
  allocateRecommendedCharGenSkills,
  applyCharGenSkillIncrease,
  resolveCharGenSkillAllocation,
} from "@/game/kotor/menu/CharGenSkillRules";

/**
 * CharGenSkills class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file CharGenSkills.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class CharGenSkills extends GameMenu {

  MAIN_TITLE_LBL: GUILabel;
  SUB_TITLE_LBL: GUILabel;
  REMAINING_SELECTIONS_LBL: GUILabel;
  SELECTIONS_REMAINING_LBL: GUILabel;
  COMPUTER_USE_POINTS_BTN: GUIButton;
  COMPUTER_USE_LBL: GUILabel;
  COM_MINUS_BTN: GUIButton;
  COM_PLUS_BTN: GUIButton;
  DEMOLITIONS_POINTS_BTN: GUIButton;
  DEM_MINUS_BTN: GUIButton;
  DEMOLITIONS_LBL: GUILabel;
  DEM_PLUS_BTN: GUIButton;
  STEALTH_POINTS_BTN: GUIButton;
  STEALTH_LBL: GUILabel;
  STE_MINUS_BTN: GUIButton;
  STE_PLUS_BTN: GUIButton;
  AWARENESS_POINTS_BTN: GUIButton;
  AWARENESS_LBL: GUILabel;
  AWA_MINUS_BTN: GUIButton;
  AWA_PLUS_BTN: GUIButton;
  PERSUADE_POINTS_BTN: GUIButton;
  PER_PLUS_BTN: GUIButton;
  PERSUADE_LBL: GUILabel;
  PER_MINUS_BTN: GUIButton;
  REPAIR_POINTS_BTN: GUIButton;
  REPAIR_LBL: GUILabel;
  REP_MINUS_BTN: GUIButton;
  REP_PLUS_BTN: GUIButton;
  DESC_LBL: GUILabel;
  COST_LBL: GUILabel;
  COST_POINTS_LBL: GUILabel;
  SECURITY_POINTS_BTN: GUIButton;
  SEC_PLUS_BTN: GUIButton;
  SEC_MINUS_BTN: GUIButton;
  SECURITY_LBL: GUILabel;
  TREAT_INJURY_POINTS_BTN: GUIButton;
  TRE_MINUS_BTN: GUIButton;
  TREAT_INJURY_LBL: GUILabel;
  LB_DESC: GUIListBox;
  CLASSSKL_LBL: GUILabel;
  BTN_RECOMMENDED: GUIButton;
  BTN_ACCEPT: GUIButton;
  BTN_BACK: GUIButton;
  TRE_PLUS_BTN: GUIButton;

  private activeSkillRow = 0;
  private readonly warnedUnavailableSkillRows = new Set<string>();

  constructor(){
    super();
    this.gui_resref = 'skchrgen';
    this.background = '1600x1200back';
    this.voidFill = true;
  }

  /**
   * Wires Back, Accept and Recommended.
   *
   * Separated because TSL's subclass calls `super.menuControlInitializer(true)`
   * and so never runs this class's initializer body — leaving every button on
   * the TSL skills step dead. That step is reachable now that custom character
   * creation is offered.
   */
  protected wireSkillControls(){

      
      this.BTN_BACK.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
      });

      this.BTN_ACCEPT.addEventListener('click', (e) => {
        e.stopPropagation();
        console.log('CharGenSkills', 'Assigning skillpoints')
        GameState.CharGenManager.selectedCreature.skills[0].rank = GameState.CharGenManager.computerUse;
        GameState.CharGenManager.selectedCreature.skills[1].rank = GameState.CharGenManager.demolitions;
        GameState.CharGenManager.selectedCreature.skills[2].rank = GameState.CharGenManager.stealth;
        GameState.CharGenManager.selectedCreature.skills[3].rank = GameState.CharGenManager.awareness;
        GameState.CharGenManager.selectedCreature.skills[4].rank = GameState.CharGenManager.persuade;
        GameState.CharGenManager.selectedCreature.skills[5].rank = GameState.CharGenManager.repair;
        GameState.CharGenManager.selectedCreature.skills[6].rank = GameState.CharGenManager.security;
        GameState.CharGenManager.selectedCreature.skills[7].rank = GameState.CharGenManager.treatInjury;
        this.close();
      });

      this.BTN_RECOMMENDED.addEventListener('click', (e) => {
        e.stopPropagation();
        GameState.CharGenManager.resetSkillPoints();
        GameState.CharGenManager.availSkillPoints = GameState.CharGenManager.getMaxSkillPoints();
        this.applyRecommendedSkillAllocation();
        this.updateButtonStates();
      });
  }


  /**
   * The eight skills, in `skills.2da` row order, paired with the controls that
   * drive them and the `CharGenManager` field that stores the rank.
   */
  private static readonly SKILL_ROWS: ReadonlyArray<{
    readonly row: number; readonly field: string;
    readonly plus: string; readonly minus: string;
  }> = [
    { row: 0, field: 'computerUse',  plus: 'COM_PLUS_BTN', minus: 'COM_MINUS_BTN' },
    { row: 1, field: 'demolitions',  plus: 'DEM_PLUS_BTN', minus: 'DEM_MINUS_BTN' },
    { row: 2, field: 'stealth',      plus: 'STE_PLUS_BTN', minus: 'STE_MINUS_BTN' },
    { row: 3, field: 'awareness',    plus: 'AWA_PLUS_BTN', minus: 'AWA_MINUS_BTN' },
    { row: 4, field: 'persuade',     plus: 'PER_PLUS_BTN', minus: 'PER_MINUS_BTN' },
    { row: 5, field: 'repair',       plus: 'REP_PLUS_BTN', minus: 'REP_MINUS_BTN' },
    { row: 6, field: 'security',     plus: 'SEC_PLUS_BTN', minus: 'SEC_MINUS_BTN' },
    { row: 7, field: 'treatInjury',  plus: 'TRE_PLUS_BTN', minus: 'TRE_MINUS_BTN' },
  ];

  private getSkillRows(): Array<Record<string, unknown> | undefined> {
    const table = GameState.TwoDAManager.datatables.get('skills');
    return CharGenSkills.SKILL_ROWS.map((skill) => table?.rows?.[skill.row]);
  }

  private getCharacterLevel(): number {
    const level = GameState.CharGenManager.selectedCreature?.getTotalClassLevel?.();
    return typeof level === 'number' && Number.isInteger(level) && level >= 1 ? level : 1;
  }

  private getSkillAllocation(row: number, currentRank: number, availablePoints: number) {
    return resolveCharGenSkillAllocation({
      skillRow: this.getSkillRows()[row],
      classSkillColumn: GameState.CharGenManager.getSkillTableColumn(),
      level: this.getCharacterLevel(),
      currentRank,
      availablePoints,
    });
  }

  private warnUnavailableSkillRow(row: number): void {
    const classColumn = GameState.CharGenManager.getSkillTableColumn();
    const diagnosticKey = `${classColumn}:${row}`;
    if (this.warnedUnavailableSkillRows.has(diagnosticKey)) return;
    this.warnedUnavailableSkillRows.add(diagnosticKey);
    console.warn(`CharGenSkills: unavailable skill row ${row} for class column ${classColumn}`);
  }

  private updateActiveSkillStatus(): void {
    const manager: any = GameState.CharGenManager;
    const skill = CharGenSkills.SKILL_ROWS[this.activeSkillRow] || CharGenSkills.SKILL_ROWS[0];
    const allocation = this.getSkillAllocation(
      skill.row,
      Number(manager[skill.field]),
      Number(manager.availSkillPoints),
    );

    if (allocation.kind === 'unavailable') {
      this.warnUnavailableSkillRow(skill.row);
    }

    const classLabel = allocation.kind === 'class'
      ? 'Class Skill'
      : allocation.kind === 'cross-class'
        ? 'Cross-Class Skill'
        : 'Unavailable';
    this.CLASSSKL_LBL?.setText(classLabel);
    this.COST_LBL?.setText(allocation.kind === 'unavailable' ? '' : 'Cost');
    this.COST_POINTS_LBL?.setText(allocation.kind === 'unavailable' ? '' : allocation.rankCost);
  }

  private applyRecommendedSkillAllocation(): void {
    const manager: any = GameState.CharGenManager;
    const fields = CharGenSkills.SKILL_ROWS.map((skill) => skill.field);
    const recommendation = GameState.CharGenManager.getRecommendedOrder();
    const result = allocateRecommendedCharGenSkills({
      skillRows: this.getSkillRows(),
      classSkillColumn: GameState.CharGenManager.getSkillTableColumn(),
      level: this.getCharacterLevel(),
      ranks: fields.map((field) => Number(manager[field])),
      availablePoints: Number(manager.availSkillPoints),
      recommendedOrder: fields.map((_, priority) => Number(recommendation[priority])),
    });

    for (let index = 0; index < fields.length; index += 1) {
      manager[fields[index]] = result.ranks[index];
    }
    manager.availSkillPoints = result.remainingPoints;
    const firstRecommendedRow = fields.map((_, priority) => Number(recommendation[priority]))
      .find((skillRow) => Number.isInteger(skillRow) && skillRow >= 0 && skillRow < fields.length);
    if (firstRecommendedRow !== undefined) this.activeSkillRow = firstRecommendedRow;
  }

  /**
   * The per-skill +/- buttons had no handlers in either game -- only Back,
   * Accept and Recommended were ever wired -- so skill points could not be
   * spent by hand at all. Reported from the headset.
   */
  /**
   * Fills the Description panel for the skill under the pointer.
   *
   * `skills.2da` carries a `description` column of TLK references — resolving
   * row 0 gives "Related Attribute: Intelligence ... Computer Use allows a
   * character to slice computer programs" — so unlike the attributes this needs
   * no hard-coded string ids.
   *
   * Setting `activeSkillRow` as well means the authored Cost labels, which
   * `updateButtonStates` already drives from that row, follow the pointer too.
   */
  describeSkill(row: number){
    // Hover fires every frame while the pointer rests on a control. Rebuilding
    // the list box that often keeps it in the mutate/commit window where its
    // render-to-texture publish is suppressed, so the panel never appears —
    // it is only ever mid-rebuild. Rebuild on an actual change of row.
    if(this.activeSkillRow === row && this.describedSkillRow === row) return;
    this.describedSkillRow = row;
    this.activeSkillRow = row;
    const skillRow: any = this.getSkillRows()[row];
    const descriptionRef = skillRow ? Number(skillRow.description) : Number.NaN;
    const description = Number.isFinite(descriptionRef)
      ? GameState.TLKManager.GetStringById(descriptionRef)?.Value ?? ''
      : '';
    // Cost labels first, description second. `updateButtonStates` refreshes the
    // authored cost/class labels from `activeSkillRow`, and running it after
    // the description had already been placed left the panel blank.
    this.updateButtonStates();
    this.LB_DESC?.setItem(description);
  }

  /**
   * Both adjust buttons of a row report that row on hover, so the description
   * and cost appear wherever the pointer rests within it.
   */
  private describedSkillRow: number = -1;

  protected wireSkillDescriptions(){
    for(const skill of CharGenSkills.SKILL_ROWS){
      for(const control of [(this as any)[skill.plus], (this as any)[skill.minus]]){
        control?.addEventListener?.('hover', () => this.describeSkill(skill.row));
      }
    }
  }

  protected wireSkillAdjustControls(){
    const manager: any = GameState.CharGenManager;
    for(const skill of CharGenSkills.SKILL_ROWS){
        (this as any)[skill.plus]?.addEventListener('click', (e: any) => {
          e.stopPropagation();
          this.activeSkillRow = skill.row;
          const result = applyCharGenSkillIncrease({
            skillRow: this.getSkillRows()[skill.row],
            classSkillColumn: GameState.CharGenManager.getSkillTableColumn(),
            level: this.getCharacterLevel(),
            currentRank: Number(manager[skill.field]),
            availablePoints: Number(manager.availSkillPoints),
          });
          if (result.canIncrease) {
            manager[skill.field] = result.nextRank;
            manager.availSkillPoints = result.remainingPoints;
          } else if (result.kind === 'unavailable') {
            this.warnUnavailableSkillRow(skill.row);
          }
          this.updateButtonStates();
          });

          (this as any)[skill.minus]?.addEventListener('click', (e: any) => {
            e.stopPropagation();
            this.activeSkillRow = skill.row;
            const floor = GameState.CharGenManager.selectedCreature?.skills?.[skill.row]?.rank ?? 0;
            const allocation = this.getSkillAllocation(
              skill.row,
              Number(manager[skill.field]),
              Number(manager.availSkillPoints),
            );
            if (allocation.kind === 'unavailable') {
              this.warnUnavailableSkillRow(skill.row);
            } else if (manager[skill.field] > floor) {
              manager[skill.field] -= 1;
              manager.availSkillPoints += allocation.rankCost;
            }
            this.updateButtonStates();
          });
    }
  }

  async menuControlInitializer(skipInit: boolean = false) {
    await super.menuControlInitializer();
    if(skipInit) return;
    return new Promise<void>((resolve, reject) => {
      this.wireSkillControls();
      this.wireSkillAdjustControls();
      resolve();
    });
  }

  show() {
    super.show();
    this.updateButtonStates();
    // Wired here, not in `menuControlInitializer`: TSL's subclass calls
    // `super.menuControlInitializer(true)` and so never runs this class's
    // initializer body. Wiring there left the buttons with zero 'hover'
    // listeners in TSL while K1 was fine — measured as `hoverListeners: 0`
    // against 1 on the abilities screen, which wires from `show()`.
    if(!this.skillDescriptionsWired){
      this.skillDescriptionsWired = true;
      this.wireSkillDescriptions();
    }
    this.describedSkillRow = -1;
  }

  private skillDescriptionsWired = false;

  updateButtonStates() {
    this.COMPUTER_USE_POINTS_BTN.setText(GameState.CharGenManager.computerUse);
    this.DEMOLITIONS_POINTS_BTN.setText(GameState.CharGenManager.demolitions);
    this.STEALTH_POINTS_BTN.setText(GameState.CharGenManager.stealth);
    this.AWARENESS_POINTS_BTN.setText(GameState.CharGenManager.awareness);
    this.PERSUADE_POINTS_BTN.setText(GameState.CharGenManager.persuade);
    this.REPAIR_POINTS_BTN.setText(GameState.CharGenManager.repair);
    this.SECURITY_POINTS_BTN.setText(GameState.CharGenManager.security);
    this.TREAT_INJURY_POINTS_BTN.setText(GameState.CharGenManager.treatInjury);
    this.REMAINING_SELECTIONS_LBL.setText(GameState.CharGenManager.availSkillPoints);
    this.updateActiveSkillStatus();
  }

  reset() {
    GameState.CharGenManager.availSkillPoints = GameState.CharGenManager.getMaxSkillPoints();
    GameState.CharGenManager.resetSkillPoints();
  }
  
}
