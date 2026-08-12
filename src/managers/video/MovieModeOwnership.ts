/**
 * Tracks ownership of EngineMode.MOVIE across a multi-movie queue.
 *
 * Individual movies briefly transition through cleanup before the next movie
 * starts. Queue ownership prevents those transitions (and unrelated module
 * initialization callbacks) from restoring gameplay audio between movies.
 */
export class MovieModeOwnership {
  private queueActive = false;

  beginQueue(): boolean {
    if (this.queueActive) {
      return false;
    }
    this.queueActive = true;
    return true;
  }

  endQueue(): void {
    this.queueActive = false;
  }

  isQueueActive(): boolean {
    return this.queueActive;
  }

  shouldDeferRestore(moviePlaying: boolean): boolean {
    return moviePlaying || this.queueActive;
  }

  shouldDeferModeChange(moviePlaying: boolean, requestedModeIsMovie: boolean): boolean {
    return !requestedModeIsMovie && this.shouldDeferRestore(moviePlaying);
  }
}
