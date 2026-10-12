import { EngineMode } from '@/enums/engine/EngineMode';

interface DisposablePlayer { destroy(): void }
interface SavedGameSession<T extends DisposablePlayer> {
  loadingModule: boolean;
  module?: { dispose(): void };
  SetEngineMode(mode: EngineMode): void;
  MenuManager: { ClearMenus(): void };
  PartyManager: { Player?: T; party: T[]; PlayerTemplate?: unknown; ActualPlayerTemplate?: unknown };
}

/** A save replaces the session; unlike an area transition it cannot retain live player state. */
export function prepareSavedGameLoad<T extends DisposablePlayer>(session: SavedGameSession<T>): void {
  if (session.loadingModule) throw new Error('Cannot load a save while a module transition is running');
  session.MenuManager.ClearMenus();
  session.SetEngineMode(EngineMode.LOADING);
  const outgoingModule = session.module;
  const outgoingPlayer = session.PartyManager.Player;
  try {
    outgoingModule?.dispose();
  } finally {
    // Detach before LoadModule: saving the outgoing module would overwrite incoming working files.
    try {
      outgoingPlayer?.destroy();
    } finally {
      session.module = undefined;
      session.PartyManager.Player = undefined;
      session.PartyManager.party = [];
      session.PartyManager.PlayerTemplate = undefined;
      session.PartyManager.ActualPlayerTemplate = undefined;
    }
  }
}

/** pc.utc backs the Exile; a PIFO controlled-companion template retains precedence. */
export function restoreSavedPlayerTemplates<T>(
  party: { PlayerTemplate?: T; ActualPlayerTemplate?: T },
  savedPlayer?: T,
): void {
  if (!savedPlayer) return;
  party.ActualPlayerTemplate = savedPlayer;
  if (!party.PlayerTemplate) party.PlayerTemplate = savedPlayer;
}
