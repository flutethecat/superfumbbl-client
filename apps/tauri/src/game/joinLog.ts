/** Owner 09-07: the log line for a serverJoin broadcast — "<Coach> joined as <Seat>" for a player seat (Home /
 *  Away by the game's coach names, "a coach" when the seat is not yet known) and "<Coach> is now spectating the
 *  game." for a spectator. Null when the broadcast carries no coach (nothing worth a line). */
export function joinLogLine(
  cmd: { coach?: unknown; clientMode?: unknown },
  game: { teamHome?: { coach?: unknown }; teamAway?: { coach?: unknown } } | null | undefined,
): string | null {
  const coach = typeof cmd.coach === 'string' ? cmd.coach.trim() : '';
  if (!coach) return null;
  const mode = String(cmd.clientMode ?? '').toLowerCase();
  if (mode === 'spectator') return `${coach} is now spectating the game.`;
  const same = (c: unknown) => typeof c === 'string' && c.trim().toLowerCase() === coach.toLowerCase();
  const seat = same(game?.teamHome?.coach) ? 'Home' : same(game?.teamAway?.coach) ? 'Away' : null;
  return `${coach} joined as ${seat ?? 'a coach'}`;
}
