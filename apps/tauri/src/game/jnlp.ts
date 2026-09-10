/**
 * FUMBBL join-request (ffblive.jnlp) parsing — B3-9.
 *
 * FUMBBL's "join game" flow hands the user a Java Web Start file whose
 * <application-desc> arguments carry everything the official client needs:
 *   -replay|-spectate|-player (mode flag), -gameId N, -port 22223,
 *   -coach <name>, -auth <one-time token>
 * Intercepting that file and reading those arguments lets THIS client take
 * over the join. See docs/fumbbl-interfacing.md for the interception design.
 */

export interface JnlpJoinRequest {
  mode: 'replay' | 'spectate' | 'player' | 'unknown';
  gameId: number | null;
  port: number | null;
  coach: string | null;
  auth: string | null;
  /** Owner 2026-07-07: FORK (standalone) join — the fork joins by gameName + teamId with a
   *  cleartext password (not FUMBBL's gameId + one-time -auth token). Marked by a `-fork` arg. */
  fork: boolean;
  gameName: string | null;
  teamId: string | null;
  /** FUMBBL live PLAYER joins carry -teamId + -teamName (and NO -gameId): the player joins
   *  with their team and the server matches/assigns the game. */
  teamName: string | null;
  password: string | null;
  /** hex md5(pw) from a `-passwordMd5` fork JNLP — the pre-hashed credential (owner ruling
   *  08-17). Preferred over `password` when present. */
  passwordMd5: string | null;
}

export function parseJnlp(xml: string): JnlpJoinRequest {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const args = Array.from(doc.querySelectorAll('application-desc argument')).map(
    (a) => a.textContent?.trim() ?? '',
  );
  const result: JnlpJoinRequest = {
    mode: 'unknown', gameId: null, port: null, coach: null, auth: null,
    fork: false, gameName: null, teamId: null, teamName: null, password: null, passwordMd5: null,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '-replay') result.mode = 'replay';
    else if (arg === '-spectate') result.mode = 'spectate';
    else if (arg === '-player') result.mode = 'player';
    else if (arg === '-fork') result.fork = true;
    else if (arg === '-gameId') result.gameId = Number(args[++i]) || null;
    else if (arg === '-port') result.port = Number(args[++i]) || null;
    else if (arg === '-coach') result.coach = args[++i] ?? null;
    else if (arg === '-auth') result.auth = args[++i] ?? null;
    else if (arg === '-gameName') result.gameName = args[++i] ?? null;
    else if (arg === '-teamId') result.teamId = args[++i] ?? null;
    else if (arg === '-teamName') result.teamName = args[++i] ?? null;
    else if (arg === '-password') result.password = args[++i] ?? null;
    else if (arg === '-passwordMd5') result.passwordMd5 = args[++i] ?? null;
  }
  return result;
}
