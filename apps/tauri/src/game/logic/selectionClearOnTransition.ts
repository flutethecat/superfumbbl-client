/** Owner 09-29 (S33, g999): a received frame must never leave a reach overlay up. The renderer draws the
 *  "inspection" reach for any selected player while no activation is live, so a selection that outlives the
 *  activation (the server ended it: turnover, knock-down) or the turn resurfaced as pale reach + rush dice around
 *  a fallen player (in g999 the opposing block TARGET, left selected by the quick-blitz confirm click). The clear is
 *  tied to the received TRANSITION, never to the state, so a coach's own inspection click made afterwards survives
 *  until the turn passes again. */
export interface ReceivedSelectionState {
  /** store.state.activePlayerId (server-derived active player) */
  activePlayerId: string | null;
  /** game.actingPlayer.playerId (the model's acting player) */
  actingPlayerId: string | null;
  playingIsHome: boolean | null;
  /** store.state.moveTrailClearSeq: pulses on every received turnEnd report */
  turnEndSeq: number;
}

/** A received turnEnd report, or the playing side flipping. */
export function receivedTurnPassed(previous: ReceivedSelectionState, next: ReceivedSelectionState): boolean {
  if (next.turnEndSeq !== previous.turnEndSeq) return true;
  return previous.playingIsHome !== null && next.playingIsHome !== null && previous.playingIsHome !== next.playingIsHome;
}

/** The pitch selection to retire on this received transition. `selectedBefore` is the selection as it stood BEFORE
 *  the transition. Spectators and replays keep exactly the game_818 rule (the just-ended active player's selection
 *  goes when the server-derived active id clears) and nothing else. */
export function receivedTransitionClearsSelection(
  previous: ReceivedSelectionState,
  next: ReceivedSelectionState,
  selectedBefore: string | null,
  /** true for the seated coach (not a spectator / replay reader) */
  playing: boolean,
): boolean {
  if (!selectedBefore) return false;
  if (previous.activePlayerId && !next.activePlayerId && selectedBefore === previous.activePlayerId) return true;
  if (!playing) return false;
  // The server cleared the acting player and he was the pitch selection.
  if (previous.actingPlayerId && !next.actingPlayerId && selectedBefore === previous.actingPlayerId) return true;
  // The turn passed, either direction: nothing stays selected (the ending seat's overlays go, the beginning seat starts clean).
  return receivedTurnPassed(previous, next);
}

/** Local arms (route, pending block/pass/...) are dropped only by the seat whose turn ENDED: my side was playing
 *  before and is not now. It runs whether or not anything is selected; the seat whose turn BEGINS keeps its arms. */
export function receivedTurnEndedForMySeat(
  previous: ReceivedSelectionState,
  next: ReceivedSelectionState,
  myIsHome: boolean | null,
  playing: boolean,
): boolean {
  if (!playing || myIsHome === null) return false;
  return previous.playingIsHome === myIsHome && next.playingIsHome !== null && next.playingIsHome !== myIsHome;
}

/** What the pitch selection becomes after a click confirmed a block / blitz target: the renderer selected the clicked
 *  opposing player first, so hand the selection back to the attacker (or clear it). 'keep' = nothing to change. */
export function selectionAfterTargetConfirm(
  selectedId: string | null,
  targetId: string,
  actingId: string | null,
): 'keep' | 'clear' | string {
  if (selectedId !== targetId) return 'keep';
  return actingId && actingId !== targetId ? actingId : 'clear';
}
