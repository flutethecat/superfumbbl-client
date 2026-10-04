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
  if (!game || !input.playing || input.localPushChoiceArmed) return false;
  if ((game as { waitingForOpponent?: unknown }).waitingForOpponent !== true) return false;
  const actingId = String((game.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  if (!actingId || !input.iControl(actingId)) return false; // my block: the pushed player is theirs
  // `homeChoice` is perspective-local on the wire (true = MY pick - upstream PushbackLogicModule); the squares the
  // server routed to the Side Step defender arrive here as not-mine.
  const squares = (game.fieldModel?.pushbackSquareArray ?? []) as { coordinate?: [number, number] | null; locked?: boolean; selected?: boolean; homeChoice?: boolean }[];
  // Owner 10-04: an occupied square is not a Side Step destination (the renderer skips those arrows too).
  const occupied = new Set((game.fieldModel?.playerDataArray ?? []).map((d) => (d.playerCoordinate ? `${d.playerCoordinate[0]},${d.playerCoordinate[1]}` : '')));
  const open = squares.filter((sq) => !sq.locked && !sq.selected && sq.homeChoice !== true && Array.isArray(sq.coordinate)
    && sq.coordinate[0] >= 0 && sq.coordinate[0] < 26 && sq.coordinate[1] >= 0 && sq.coordinate[1] < 15
    && !occupied.has(`${sq.coordinate[0]},${sq.coordinate[1]}`));
  if (open.length < 2) return false;
  const defenderId = String((game as { defenderId?: string | null }).defenderId ?? '');
  if (!defenderId || input.iControl(defenderId)) return false;
  const defender = [game.teamHome, game.teamAway].map((team) => team?.playerArray?.find((p) => p.playerId === defenderId)).find(Boolean);
  return !!defender && playerHasSkill(defender, 'Side Step');
}
