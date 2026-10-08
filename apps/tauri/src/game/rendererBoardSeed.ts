/**
 * Owner 10-08: "Players are not being shown as activated if the user joins mid turn."
 *
 * The store derives the board marks (acting player, acted-this-turn set, recovering / Dodgy Snack latches) from the
 * join snapshot at once (forceSnapshotTick, 09-06). The pitch view, though, only mounts once a game exists - so on
 * every join and reconnect that derivation is finished BEFORE the view's watchers are created, and a plain watcher
 * never fires for a value that was already there. The renderer then painted the snapshot with empty sets until the
 * next server command replaced the arrays. This is the one seam that hands the store's current board marks to a
 * renderer: the mount calls it, and so does the snapshot-tick watcher (a view that outlived the socket).
 *
 * Nothing is derived here: every value is the store's projection of what the server sent.
 */
export interface BoardMarkRenderer {
  setActivePlayer(playerId: string | null): void;
  setActedPlayers(ids: string[]): void;
  setRecoveringPlayers(ids: string[]): void;
  setDodgySnackPlayers(ids: string[]): void;
}
export interface BoardMarkState {
  activePlayerId: string | null;
  actedPlayers: readonly string[] | null | undefined;
  recoveringPlayers: readonly string[] | null | undefined;
  dodgySnackPlayers: readonly string[] | null | undefined;
}
export function seedRendererBoardMarks(renderer: BoardMarkRenderer, state: BoardMarkState): void {
  renderer.setActivePlayer(state.activePlayerId ?? null);
  renderer.setActedPlayers([...(state.actedPlayers ?? [])]);
  renderer.setRecoveringPlayers([...(state.recoveringPlayers ?? [])]);
  renderer.setDodgySnackPlayers([...(state.dodgySnackPlayers ?? [])]);
}
