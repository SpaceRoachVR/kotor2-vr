import { GameState } from "@/GameState";
import { SkillType } from "@/enums/nwscript/SkillType";
import type { GUILabel, GUIListBox } from "@/gui";
import { InGameComputer as K1_InGameComputer } from "@/game/kotor/KOTOR";

/**
 * InGameComputer class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file InGameComputer.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class InGameComputer extends K1_InGameComputer {

  declare LBL_REP_UNITS: GUILabel;
  declare LBL_REP_SKILL: GUILabel;
  declare LBL_COMP_SPIKES: GUILabel;
  declare LBL_COMP_SKILL: GUILabel;
  declare LBL_COMP_SKILL_VAL: GUILabel;
  declare LBL_REP_SKILL_VAL: GUILabel;
  declare LBL_REP_UNITS_VAL: GUILabel;
  declare LBL_BAR1: GUILabel;
  declare LB_MESSAGE: GUIListBox;
  declare LBL_BAR2: GUILabel;
  declare LBL_COMP_SPIKES_VAL: GUILabel;
  declare LB_REPLIES: GUIListBox;
  declare LBL_BAR3: GUILabel;
  declare LBL_BAR4: GUILabel;
  declare LBL_BAR5: GUILabel;
  declare LBL_BAR6: GUILabel;

  constructor(){
    super();
    this.gui_resref = 'computer_p';
    this.background = 'black';
    this.voidFill = true;
  }

  async menuControlInitializer(skipInit: boolean = false) {
    await super.menuControlInitializer(true);
    if(skipInit) return;
    return new Promise<void>((resolve, reject) => {
      // The lists have no padding, so each line's first letter sat under the
      // frame ("ERAGUS CENTRAL", critic runs 11-12). Rows are inset by it.
      this.LB_MESSAGE.padding = Math.max(this.LB_MESSAGE.padding || 0, 8);
      this.LB_REPLIES.padding = Math.max(this.LB_REPLIES.padding || 0, 8);
      this.LB_MESSAGE.setItem(null);
      this.LB_MESSAGE.setTextColor(this.LB_MESSAGE.defaultColor.r, this.LB_MESSAGE.defaultColor.g, this.LB_MESSAGE.defaultColor.b);
      this.LB_REPLIES.onSelected = (entry: any, control: any, index: number) => {
        GameState.CutsceneManager.selectReplyAtIndex(index);
      }
      resolve();
    });
  }

  show(){
    super.show();
    this.fillCounters();
    // B logs out (critic run 17: B did nothing in a terminal). It picks the
    // terminal's own reply that ends the session, never cuts the script short.
    this._button_b = { click: () => this.logOutWithB() } as any;
  }

  /**
   * B is Back: a sub-page's own "Return to ..." reply when it has one (critic
   * run 18: B on the logs page logged out), else the reply that leads
   * nowhere ("Log out", "[End]").
   */
  logOutWithB(): boolean {
    const shown = (GameState.CutsceneManager.currentReplies || []).filter((reply: any) => !reply?.isContinueDialog?.());
    for(let i = shown.length - 1; i >= 0; i--){
      let text = '';
      try { text = String(shown[i]?.getCompiledString?.() ?? ''); } catch { /* no text */ }
      if(/^\s*\[?\s*(return|back|previous)/i.test(text)){
        GameState.CutsceneManager.selectReplyAtIndex(i);
        return true;
      }
    }
    for(let i = shown.length - 1; i >= 0; i--){
      const reply: any = shown[i];
      if(Array.isArray(reply?.entries) && reply.entries.length === 0){
        GameState.CutsceneManager.selectReplyAtIndex(i);
        return true;
      }
    }
    return false;
  }

  /**
   * The four counters retail shows beside the terminal text: Computer Use and
   * Repair skill, spikes and repair parts carried. Nothing filled them, so
   * they read 0 with 12 spikes in the bag (critic run 11).
   */
  private countersKey = '';

  fillCounters(){
    try{
      const player: any = GameState.getCurrentPlayer?.();
      const carried = (tag: string) => (GameState.InventoryManager?.inventory ?? [])
        .filter((item: any) => String(item?.getTag?.() ?? '').toUpperCase() === tag)
        .reduce((sum: number, item: any) => sum + (Number(item.getStackSize?.()) || 0), 0);
      const values = [
        player?.getSkillTotal?.(SkillType.COMPUTER_USE) ?? 0,
        player?.getSkillTotal?.(SkillType.REPAIR) ?? 0,
        carried('K_COMPUTER_SPIKE'),
        carried('K_REPAIR_PART'),
      ].map(String);
      // show() runs every frame while the terminal is up; set text on change only.
      const key = values.join('|');
      if(key === this.countersKey) return;
      this.countersKey = key;
      this.LBL_COMP_SKILL_VAL?.setText(values[0]);
      this.LBL_REP_SKILL_VAL?.setText(values[1]);
      this.LBL_COMP_SPIKES_VAL?.setText(values[2]);
      this.LBL_REP_UNITS_VAL?.setText(values[3]);
    }catch(e){
      console.warn('InGameComputer: counters not filled', e);
    }
  }
  
}
