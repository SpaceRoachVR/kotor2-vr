/**
 * When a defeated party is sent to the Load Game screen.
 *
 * The screen used to open exactly once. Closing it — Back, or a stray button
 * press — dropped the player into the game with every party member down, every
 * swing refused and no way out: reported from the headset in round 8 as a full
 * freeze on Peragus, logged as `SetEngineMode: 1` four seconds after the
 * defeat with nothing afterwards but refused input. A party with nobody
 * standing has nowhere to go but a load, so the screen comes back.
 *
 * Creatures only update while the game is in play, so time spent on the screen
 * itself never counts toward reopening it.
 */
export class PartyDefeatScreenTimer {
  /** Long enough that closing the screen does not flicker it straight back. */
  static readonly REOPEN_SECONDS = 1.5;

  private shown = false;
  private inGameSeconds = 0;

  /**
   * Call once per game update while the whole party is down. Says whether the
   * screen should open now: `'open'` the first time, `'reopen'` once the
   * player has been back in the game for REOPEN_SECONDS, otherwise null.
   */
  defeated(deltaSeconds: number): 'open' | 'reopen' | null {
    if (!this.shown) {
      this.shown = true;
      this.inGameSeconds = 0;
      return 'open';
    }
    if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) this.inGameSeconds += deltaSeconds;
    if (this.inGameSeconds < PartyDefeatScreenTimer.REOPEN_SECONDS) return null;
    this.inGameSeconds = 0;
    return 'reopen';
  }

  /** Someone is standing: the next defeat opens the screen at once. */
  reset(): void {
    this.shown = false;
    this.inGameSeconds = 0;
  }
}
