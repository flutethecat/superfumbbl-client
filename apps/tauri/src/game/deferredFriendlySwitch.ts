/** Owner 10-05: "Currently we send the end activation for a player the moment a user selects a new player. Could we
 *  delay the end activation for the previously used player until a command has been sent on the new one?"
 *  (Settings > Mouse, default off.)
 *
 *  With the setting on, the first left-click on another of my players while the acting player has already used part
 *  of its activation sends NOTHING: the clicked player is only held as the pending switch. The previous player's end
 *  goes on the wire when the coach actually activates the new one (a second click on it, or an action picked from
 *  its menu), immediately ahead of that player's declaration. Anything else drops the pending switch and the acting
 *  player carries on. */
export interface DeferredFriendlySwitch {
  /** The player the coach clicked (not yet activated). */
  playerId: string;
  /** The server's acting player when the switch was armed; the pending switch only ever ends THIS activation. */
  fromId: string;
  /** The store's sent-command count when the switch was armed. ANY command sent since then (a step, a Ball &
   *  Chain direction, a target...) means the coach carried on with the previous player: the next click on the
   *  new player arms afresh instead of committing (Astra pass 3). */
  sentAtArm: number;
}

/** A left-click on a friendly switch target: the first one arms, the second one on the same player commits. */
export function deferredSwitchClick(
  pending: DeferredFriendlySwitch | null,
  clickedPlayerId: string,
  actingPlayerId: string,
  sentNow: number,
): 'arm' | 'commit' {
  return pending && pending.playerId === clickedPlayerId && pending.fromId === actingPlayerId
    && pending.sentAtArm === sentNow ? 'commit' : 'arm';
}

/** A pending switch is dropped as soon as the server's acting player is no longer the one it was armed against. */
export function deferredSwitchStillValid(pending: DeferredFriendlySwitch | null, actingPlayerId: string): boolean {
  return !!pending && !!actingPlayerId && pending.fromId === actingPlayerId;
}

/** How long a committed switch waits for the server to clear the previous activation before the follow-up
 *  declaration is abandoned (the end itself has been sent; the coach simply clicks the player again). */
export const DEFERRED_SWITCH_FOLLOW_UP_MS = 3000;
export function deferredSwitchFollowUpFresh(committedAt: number, now: number): boolean {
  return now - committedAt <= DEFERRED_SWITCH_FOLLOW_UP_MS;
}
