import { GameMenu } from "@/gui";
import type { GUILabel, GUIButton, GUIControl } from "@/gui";
import type { ModuleCreature } from "@/module";
import { GameState } from "@/GameState";
import { GUIFeatItem } from "@/game/kotor/gui/GUIFeatItem";
import { LEVEL_UP_STEPS, LevelUpSession } from "@/game/kotor/menu/LevelUpSession";
import type { LevelUpCreature, LevelUpStep } from "@/game/kotor/menu/LevelUpSession";
import { LEVEL_UP_ABILITIES } from "@/game/kotor/menu/LevelUpRules";

/**
 * MenuLevelUp class.
 *
 * The level-up step panel: Attributes, Skills, Feats, Force Powers, then
 * Accept. It was an empty shell in both games, and the Level Up button fell
 * back to auto level-up, which spends no skill points and picks no feats or
 * powers — reported from the headset as "level up does not work correctly,
 * instead automatically leveling the character like quick level".
 *
 * The Attributes, Skills and Feats steps are the character-creation screens,
 * switched into level-up rules by `CharGenManager.levelUp`; Force Powers is
 * `MenuPowerLevelUp`. What a level is worth, which steps are open, and undoing
 * it all on Back are `LevelUpSession`.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file MenuLevelUp.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class MenuLevelUp extends GameMenu {

  LBL_BG: GUILabel;
  BTN_BACK: GUIButton;
  LBL_5: GUIControl;
  LBL_4: GUIControl;
  LBL_3: GUIControl;
  LBL_2: GUIControl;
  LBL_1: GUIControl;
  LBL_NUM1: GUILabel;
  LBL_NUM2: GUILabel;
  LBL_NUM3: GUILabel;
  LBL_NUM4: GUILabel;
  LBL_NUM5: GUILabel;
  BTN_STEPNAME4: GUIButton;
  BTN_STEPNAME1: GUIButton;
  BTN_STEPNAME2: GUIButton;
  BTN_STEPNAME3: GUIButton;
  BTN_STEPNAME5: GUIButton;

  session: LevelUpSession | undefined = undefined;
  private previousChargenCreature: any = undefined;
  private starting = false;

  /** The authored step buttons, in order. BTN_STEPNAME5 is Accept. */
  static readonly STEP_BUTTONS: ReadonlyArray<[LevelUpStep, string]> = [
    ['attributes', 'BTN_STEPNAME1'],
    ['skills', 'BTN_STEPNAME2'],
    ['feats', 'BTN_STEPNAME3'],
    ['powers', 'BTN_STEPNAME4'],
  ];

  constructor(){
    super();
    this.gui_resref = 'leveluppnl';
    this.background = '1600x1200back';
    this.voidFill = true;
  }

  async menuControlInitializer(skipInit: boolean = false) {
    await super.menuControlInitializer();
    if(skipInit) return;
    return new Promise<void>((resolve, reject) => {
      this.wireLevelUpPanel();
      resolve();
    });
  }

  /** Separate for TSL, whose subclass skips this class's initializer body. */
  protected wireLevelUpPanel(){
    for(const [step, name] of MenuLevelUp.STEP_BUTTONS){
      (this as any)[name]?.addEventListener('click', (e: any) => {
        e?.stopPropagation?.();
        this.openStep(step);
      });
    }

    this.BTN_STEPNAME5?.addEventListener('click', (e: any) => {
      e?.stopPropagation?.();
      this.finishLevelUp();
    });

    this.BTN_BACK?.addEventListener('click', (e: any) => {
      e?.stopPropagation?.();
      this.close();
    });
    this._button_b = this.BTN_BACK;
  }

  /**
   * Starts spending a level on this creature and shows the panel.
   * @returns false when the creature cannot level or a level-up is already open
   */
  async beginLevelUp(creature: ModuleCreature): Promise<boolean> {
    if(!await this.startSession(creature)) return false;
    this.open();
    return true;
  }

  /**
   * Auto: the same level, spent without opening a screen, on each step's own
   * Recommended choice — the class's primary ability, the class skill order,
   * the first eligible feats, and the table's recommended powers. The old auto
   * route raised the level, one attribute and vitality and spent nothing
   * else — no skill points, feats, powers or Force points.
   */
  async autoLevelUp(creature: ModuleCreature): Promise<boolean> {
    if(!await this.startSession(creature)) return false;
    const session = this.session!;
    try{
      for(const step of LEVEL_UP_STEPS){
        if(!this.prepareStep(step)) continue;
        switch(step){
          case 'attributes':
            this.manager.CharGenAbilities.applyRecommendedLevelUpAttributes();
            this.manager.CharGenAbilities.commitAttributes();
          break;
          case 'skills':
            this.manager.CharGenSkills.applyRecommendedSkillAllocation();
            this.manager.CharGenSkills.commitSkillRanks();
          break;
          case 'feats':
            // Picking rebuilds the feat grid; a never-shown screen has no row builder yet.
            this.manager.CharGenFeats.LB_FEATS?.setProtoBuilder(GUIFeatItem);
            this.manager.CharGenFeats.addGrantedFeats();
            this.manager.CharGenFeats.selectRecommendedFeats();
          break;
          case 'powers':
            this.manager.MenuPowerLevelUp.selectRecommendedPowers();
          break;
        }
        session.completeStep(step);
      }
      return this.completeSession();
    }finally{
      this.endSession();
    }
  }

  private async startSession(creature: ModuleCreature): Promise<boolean> {
    if(this.starting || this.session?.isActive) return false;
    this.starting = true;
    try{
      await this.manager.LoadLevelUpMenus();
      const session = LevelUpSession.begin(creature as unknown as LevelUpCreature);
      if(!session) return false;

      const chargen = GameState.CharGenManager;
      this.session = session;
      this.previousChargenCreature = chargen.selectedCreature;
      chargen.levelUp = session;
      // The Skills screen reads and writes the creature through this field.
      chargen.selectedCreature = creature as any;
      this.manager.CharGenFeats?.resetFeatSelections();
      this.manager.MenuPowerLevelUp?.resetSelections();
      return true;
    }finally{
      this.starting = false;
    }
  }

  show(){
    super.show();
    this.updateStepStates();
  }

  /**
   * Steps with nothing to spend, or not yet reached, are dimmed and ignore the
   * pointer; the step to do next pulses, and so does Accept once it is ready.
   * Refreshed every time the panel is shown, which includes returning from a
   * step's screen.
   */
  updateStepStates(){
    const session = this.session;
    const next = session?.getNextStep();
    for(const [step, name] of MenuLevelUp.STEP_BUTTONS){
      const button: GUIButton | undefined = (this as any)[name];
      if(!button) continue;
      const open = !!session && session.isStepUnlocked(step);
      button.disableSelection = !open;
      button.pulsing = open && step === next;
    }
    if(this.BTN_STEPNAME5){
      const ready = !!session && session.canFinish();
      this.BTN_STEPNAME5.disableSelection = !ready;
      this.BTN_STEPNAME5.pulsing = ready;
    }
  }

  openStep(step: LevelUpStep){
    if(!this.prepareStep(step)) return;
    switch(step){
      case 'attributes': this.manager.CharGenAbilities.open(); break;
      case 'skills': this.manager.CharGenSkills.open(); break;
      case 'feats': this.manager.CharGenFeats.open(); break;
      case 'powers': this.manager.MenuPowerLevelUp.open(); break;
    }
  }

  /** Starts a step over and loads its screen with the level's starting point. */
  private prepareStep(step: LevelUpStep): boolean {
    const session = this.session;
    if(!session?.isActive) return false;
    if(!session.beginStep(step)) return false;

    const creature = session.creature as unknown as ModuleCreature;
    const chargen = GameState.CharGenManager;
    switch(step){
      case 'attributes':
        for(const ability of LEVEL_UP_ABILITIES){
          chargen[ability] = creature[ability];
        }
        chargen.availPoints = session.allowances.attributePoints;
        this.manager.CharGenAbilities.setCreature(creature);
      break;
      case 'skills':
        this.manager.CharGenSkills.primeLevelUpSkills();
      break;
      case 'feats':
        this.manager.CharGenFeats.setCreature(creature);
        this.manager.CharGenFeats.resetFeatSelections();
      break;
      case 'powers':
        this.manager.MenuPowerLevelUp.setCreature(creature);
        this.manager.MenuPowerLevelUp.resetSelections();
      break;
    }
    return true;
  }

  finishLevelUp(){
    if(this.completeSession()) this.close();
  }

  /** Accept: class-granted feats, then the session's vitality and Force gain. */
  private completeSession(): boolean {
    const session = this.session;
    if(!session?.canFinish()) return false;
    const creature = session.creature as unknown as ModuleCreature;

    // Feats the class simply grants at this level, whether or not the level
    // also had a Feats step to open. The Feats screen grants them on show.
    const feats = this.manager.CharGenFeats;
    if(feats){
      feats.setCreature(creature);
      feats.addGrantedFeats();
    }

    const gain = session.finish();
    if(!gain) return false;
    console.log(`[LevelUp] ${creature.getName?.() ?? 'creature'} reached level ${session.newCharacterLevel}: +${gain.hitPoints} vitality, +${gain.forcePoints} Force points`);
    return true;
  }

  /** Undoes an unfinished level and hands the shared chargen state back. */
  private endSession(){
    const session = this.session;
    if(!session) return;
    if(session.isActive) session.cancel();
    const chargen = GameState.CharGenManager;
    if(chargen.levelUp === session) chargen.levelUp = undefined;
    chargen.selectedCreature = this.previousChargenCreature;
    this.previousChargenCreature = undefined;
    this.session = undefined;
  }

  /**
   * Closing the panel any way other than Accept — Back, the controller's B
   * button, or every menu being cleared — abandons the level, so the class
   * level is never left raised with nothing spent.
   */
  close(){
    this.endSession();
    super.close();
  }

}
