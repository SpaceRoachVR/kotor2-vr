import { EngineMode } from "@/enums/engine/EngineMode";
import { GameMenu } from "@/gui";
import type { GUIButton, GUILabel } from "@/gui";
import { GameState } from "@/GameState";
import { EngineState } from "@/enums/engine/EngineState";
import { MenuSaveLoadMode } from "@/enums/gui/MenuSaveLoadMode";
import { NWScript } from "@/nwscript/NWScript";
import { SaveGame } from "@/engine/SaveGame";

/**
 * MenuGameOver class.
 *
 * The retail defeat screen (gameover_p), shown when the whole party is down.
 * It was never wired up, so a party wipe dropped the player straight onto the
 * Load Game list with no word of what had happened (critic runs 3-5; Allen,
 * 2026-10-02). Its three buttons are retail's: load the last save, open Load
 * Game, or quit to the main menu.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file MenuGameOver.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class MenuGameOver extends GameMenu {

  declare BTN_LASTSAVE: GUIButton;
  declare BTN_LOADGAME: GUIButton;
  declare BTN_QUIT: GUIButton;
  declare LBL_MESSAGE: GUILabel;

  constructor(){
    super();
    this.gui_resref = 'gameover_p';
    this.background = 'blackfill';
    this.voidFill = true;
  }

  async menuControlInitializer(skipInit: boolean = false) {
    await super.menuControlInitializer(true);
    if(skipInit) return;
    return new Promise<void>((resolve, reject) => {
      this.BTN_LASTSAVE?.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.loadLastSave();
      });

      this.BTN_LOADGAME?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.manager.MenuSaveLoad.mode = MenuSaveLoadMode.LOADGAME;
        this.manager.MenuSaveLoad.open();
      });

      this.BTN_QUIT?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
        GameState.UnloadModule();
        GameState.State = EngineState.RUNNING;
        if(GameState.module){
          GameState.module.dispose();
          GameState.module = undefined;
        }
        NWScript.Reload();
        GameState.controls.initKeys();
        this.manager.MainMenu.Start();
      });
      resolve();
    });
  }

  /**
   * The newest save of any kind (manual, quick or auto), like retail's "Last
   * Save". Saves carry a real TIMESTAMP since critic run 6; older ones do
   * not, and for those the highest numbered save is the newest.
   */
  static findLastSave(saves: readonly SaveGame[]): SaveGame | undefined {
    let last: SaveGame | undefined;
    for(const save of saves){
      if(!save || !(save as any).timestampKnown) continue;
      const time = save.TIMESTAMP instanceof Date ? save.TIMESTAMP.getTime() : NaN;
      // Saves written while the stamp was broken read as 1601 or as garbage;
      // only a date in this century and not in the future counts (critic run 8).
      if(!Number.isFinite(time) || time < Date.UTC(2001, 0, 1) || time > Date.now() + 86_400_000) continue;
      if(!last || time > last.TIMESTAMP.getTime()) last = save;
    }
    if(last) return last;
    let highest: SaveGame | undefined;
    for(const save of saves){
      const n = Number(save?.getSaveNumber?.());
      if(!Number.isFinite(n)) continue;
      if(!highest || n > Number(highest.getSaveNumber())) highest = save;
    }
    return highest;
  }

  private async loadLastSave(){
    if(!this.bVisible || GameState.loadingModule) return;
    try{
      if(!SaveGame.saves.length) await SaveGame.GetSaveGames();
    }catch(e){
      console.error('MenuGameOver: listing saves failed', e);
    }
    const session = SaveGame.sessionLastSave;
    const last = (session && SaveGame.saves.find((s) => s.directory === session.directory)) ?? MenuGameOver.findLastSave(SaveGame.saves);
    if(!last){
      // Nothing to load: the Load Game list says so better than silence.
      this.manager.MenuSaveLoad.mode = MenuSaveLoadMode.LOADGAME;
      this.manager.MenuSaveLoad.open();
      return;
    }
    this.manager.ClearMenus();
    // Loading from here on: ClearMenus restores the in-game mode, and one
    // UpdateIngame against the disposed module threw (round 15).
    GameState.SetEngineMode(EngineMode.LOADING);
    if(GameState.module){
      GameState.module.dispose();
      GameState.module = undefined;
    }
    try{
      await last.load();
    }catch(e){
      // A corrupt or partial save must not leave the player with no module
      // and no menu (critic run 6): the Load Game list is the way on.
      console.error('MenuGameOver: loading the last save failed', e);
      this.manager.MenuSaveLoad.mode = MenuSaveLoadMode.LOADGAME;
      this.manager.MenuSaveLoad.open();
    }
  }

}
