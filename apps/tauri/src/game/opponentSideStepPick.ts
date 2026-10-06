import { playerHasSkill, type GameJson } from '@fumbbl40k/ffb-protocol';

/** Owner 10-04: "When a player is choosing what square to sidestep into after deciding to use sidestep, we need an
 *  indicator. Let's surface the same push arrows that we do when a user is choosing to use sidestep locally for the
 *  opposition player."
 *
 *  True while the OTHER coach is picking the Side Step square for a block MY player threw: the server has published
 *  more than one open pushback square, it is waiting on my opponent, and the pushed player carries Side Step. The
 *  view then shows the candidate arrows display-only (no crosshairs, nothing clickable, nothing sent) - every square
 *  comes from the server's own pushbackSquareArray. */
export function opponentChoosingSideStepSquare(
  game: GameJson | null | undefined,
  input: { playing: boolean; iControl: (playerId: string) => boolean; localPushChoiceArmed: boolean },
): boolean {
  return opponentChoosingPushSquare(game, input) === 'sideStep';
}

/** Owner 10-05: "A normal push should also surface the possible push directions as sidestep". Which push choice the
 *  OTHER coach is making right now, for the watching coach's display-only arrows:
 *  - 'sideStep': my block, their Side Step defender picks the square (occupied squares are not destinations);
 *  - 'push': their block (or a chain link of it) and they pick the direction - occupied squares stay (a chain push
 *    goes through them);
 *  - null: nothing pending, the choice is mine (local pushChoice armed / my squares), or I am not a coach here.
 *  Every square comes from the server's own pushbackSquareArray; nothing is clickable or sent. */
export function opponentChoosingPushSquare(
  game: GameJson | null | undefined,
  input: { playing: boolean; iControl: (playerId: string) => boolean; localPushChoiceArmed: boolean },
): 'sideStep' | 'push' | null {
  if (!game || !input.playing || input.localPushChoiceArmed) return null;
  if ((game as { waitingForOpponent?: unknown }).waitingForOpponent !== true) return null;
  const actingId = String((game.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  if (!actingId) return null;
  const attackerMine = input.iControl(actingId);
  // `homeChoice` is perspective-local on the wire (true = MY pick - upstream PushbackLogicModule); the squares the
  // server routed to the other coach arrive here as not-mine.
  const squares = (game.fieldModel?.pushbackSquareArray ?? []) as { coordinate?: [number, number] | null; locked?: boolean; selected?: boolean; homeChoice?: boolean }[];
  const occupied = new Set((game.fieldModel?.playerDataArray ?? []).map((d) => (d.playerCoordinate ? `${d.playerCoordinate[0]},${d.playerCoordinate[1]}` : '')));
  const open = squares.filter((sq) => !sq.locked && !sq.selected && sq.homeChoice !== true && Array.isArray(sq.coordinate)
    && sq.coordinate[0] >= 0 && sq.coordinate[0] < 26 && sq.coordinate[1] >= 0 && sq.coordinate[1] < 15);
  const defenderId = String((game as { defenderId?: string | null }).defenderId ?? '');
  const defender = defenderId ? [game.teamHome, game.teamAway].map((team) => team?.playerArray?.find((p) => p.playerId === defenderId)).find(Boolean) : undefined;
  if (attackerMine) {
    // my block: only a Side Step defender of theirs gets to choose
    if (!defenderId || input.iControl(defenderId) || !defender || !playerHasSkill(defender, 'Side Step')) return null;
    // Owner 10-04: an occupied square is not a Side Step destination (the renderer skips those arrows too).
    return open.filter((sq) => !occupied.has(`${sq.coordinate![0]},${sq.coordinate![1]}`)).length >= 2 ? 'sideStep' : null;
  }
  // their block: they choose the push direction (first link or a chain link) unless the server routed it to me
  return open.length >= 2 ? 'push' : null;
}
