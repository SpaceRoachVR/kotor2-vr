/**
 * AutoSaveManager class.
 *
 * Retail autosaves into "000001 - AUTOSAVE" when you arrive in an area and
 * when a script calls DoSinglePlayerAutoSave. The save cannot be taken the
 * moment it is asked for: an area's OnEnter often opens a conversation or a
 * fight straight away (the Peragus wake-up does both), and a save taken then
 * would capture a half-started scene. So a request waits until play has been
 * quiet for a moment - in-game, no conversation, no one in the party
 * fighting - and a new area load drops any request that has not fired.
 *
 * The world queries are passed in so the scheduling can be tested without a
 * running engine.
 *
 * @file AutoSaveManager.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export interface AutoSaveWorld {
  /** Autosave option on (INI "Game Options.AutoSave"). */
  enabled(): boolean;
  /** Free play: in-game mode, no conversation, not loading, not already saving. */
  canSave(): boolean;
  /** Anyone in the party in combat. */
  inCombat(): boolean;
  save(slot: 'autosave' | 'quicksave'): Promise<void>;
}

export type AutoSaveReason = 'area' | 'script';

export class AutoSaveManager {

  /** Seconds of uninterrupted quiet play before a pending autosave fires. */
  static QUIET_SECONDS = 1.5;

  static world: AutoSaveWorld;
  static pending: AutoSaveReason = null;
  static quietTime = 0;
  static inFlight = false;

  static request(reason: AutoSaveReason){
    AutoSaveManager.pending = reason;
    AutoSaveManager.quietTime = 0;
  }

  /** A new area is loading: the old request no longer describes where the player is. */
  static cancel(){
    AutoSaveManager.pending = null;
    AutoSaveManager.quietTime = 0;
  }

  static update(delta: number){
    const world = AutoSaveManager.world;
    if(!AutoSaveManager.pending || AutoSaveManager.inFlight || !world){ return; }
    if(!world.enabled()){
      AutoSaveManager.cancel();
      return;
    }
    if(!world.canSave() || world.inCombat()){
      AutoSaveManager.quietTime = 0;
      return;
    }
    AutoSaveManager.quietTime += delta;
    if(AutoSaveManager.quietTime < AutoSaveManager.QUIET_SECONDS){ return; }

    const reason = AutoSaveManager.pending;
    AutoSaveManager.cancel();
    AutoSaveManager.inFlight = true;
    console.log('AutoSaveManager: autosaving', reason);
    AutoSaveManager.write('autosave');
  }

  /**
   * The player asked for a save: it happens now or not at all. Retail refuses
   * to save in combat, and a conversation cannot be saved mid-line.
   */
  static quickSave(onDone?: (written: boolean) => void): boolean {
    const world = AutoSaveManager.world;
    if(!world || AutoSaveManager.inFlight || !world.canSave() || world.inCombat()){
      console.log('AutoSaveManager: quick save refused (combat, conversation or a save in progress)');
      return false;
    }
    AutoSaveManager.inFlight = true;
    AutoSaveManager.write('quicksave', onDone);
    return true;
  }

  private static write(slot: 'autosave' | 'quicksave', onDone?: (written: boolean) => void){
    AutoSaveManager.world.save(slot).then(() => {
      try { onDone?.(true); } catch (e) { /* feedback only */ }
    }, (e) => {
      console.error(`AutoSaveManager: ${slot} failed`, e);
      try { onDone?.(false); } catch (err) { /* feedback only */ }
    }).finally(() => {
      AutoSaveManager.inFlight = false;
    });
  }

  static reset(){
    AutoSaveManager.cancel();
    AutoSaveManager.inFlight = false;
  }
}
