import type { GUIButton, GUILabel } from "@/gui";
import { MenuSaveName as K1_MenuSaveName } from "@/game/kotor/KOTOR";

/**
 * MenuSaveName class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file MenuSaveName.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class MenuSaveName extends K1_MenuSaveName {

  declare BTN_OK: GUIButton;
  declare BTN_CANCEL: GUIButton;
  declare EDITBOX: GUILabel;
  declare LBL_TITLE: GUILabel;

  constructor(){
    super();
    this.gui_resref = 'savename_p';
    this.background = '';
    this.voidFill = false;
  }

  async menuControlInitializer(skipInit: boolean = false) {
    await super.menuControlInitializer(true);
    if(skipInit) return;
    return new Promise<void>((resolve, reject) => {
      //savename_p.gui uses the same control names as K1's savename.gui, but passing
      //skipInit=true above means K1's own wiring (setEditable + button listeners) never
      //ran - without this, the edit box can't be typed into and OK/Cancel don't respond.
      this.EDITBOX.setEditable(true);

      this.BTN_OK.addEventListener('click', () => {
        if(typeof this.onSave == 'function')
          this.onSave(this.EDITBOX.getValue())

        this.close();
      });
      this._button_a = this.BTN_OK;

      this.BTN_CANCEL.addEventListener('click', () => {
        this.close();
      });
      this._button_b = this.BTN_CANCEL;
      resolve();
    });
  }
  
}
