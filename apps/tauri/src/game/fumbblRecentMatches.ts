/**
 * Owner 09-24: the Replay tab's "Your FUMBBL games" — the coach's most recent official matches, from the public
 * API only (no auth): `/api/coach/teams/{coach}` → one `/api/team/matches/{teamId}/0` page per team → merged,
 * newest first. A row's `replayId` is the FFB game id the replay socket takes (`connectReplay({ gameId })`);
 * `id` is FUMBBL's match id and is kept only for the link.
 */
import { fetchFumbblCoachTeams, type FumbblCoachTeam } from './fumbblCoachTeams';
import { FUMBBL_SITE } from './settings';

export interface FumbblRecentMatch {
  matchId: number;
  replayId: number;
  /** ISO-ish "YYYY-MM-DD HH:MM:SS" as FUMBBL reports it (site time). */
  when: string;
  myTeamId: number;
  myTeam: string;
  /** Owner 10-06: the coach of `myTeam` as FUMBBL spells it (the Replay pane's coach search shows it on the left). */
  myCoach?: string;
  myScore: number;
  opponentTeam: string;
  opponentCoach: string;
  opponentScore: number;
  division?: string;
  /** Owner 09-25: races (FUMBBL `roster`) + team values for the Play blade's crests and coach·TV lines. */
  myRace?: string;
  opponentRace?: string;
  myTv?: number;
  opponentTv?: number;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function parseTeamMatches(payload: unknown, teamId: number): FumbblRecentMatch[] {
  if (!Array.isArray(payload)) return [];
  const rows: FumbblRecentMatch[] = [];
  for (const raw of payload) {
    const m = raw as Record<string, unknown>;
    const t1 = m.team1 as Record<string, unknown> | undefined;
    const t2 = m.team2 as Record<string, unknown> | undefined;
    const replayId = Number(m.replayId);
    const matchId = Number(m.id);
    if (!t1 || !t2 || !Number.isInteger(replayId) || replayId <= 0 || !Number.isInteger(matchId)) continue;
    const mine = Number(t1.id) === teamId ? t1 : Number(t2.id) === teamId ? t2 : null;
    if (!mine) continue;
    const theirs = mine === t1 ? t2 : t1;
    const coach = theirs.coach as Record<string, unknown> | undefined;
    const myCoach = (mine.coach as Record<string, unknown> | undefined)?.name;
    rows.push({
      matchId,
      replayId,
      when: `${String(m.date ?? '')} ${String(m.time ?? '')}`.trim(),
      myTeamId: teamId,
      myTeam: String(mine.name ?? ''),
      myCoach: typeof myCoach === 'string' && myCoach ? myCoach : undefined,
      myScore: Number(mine.score ?? 0) || 0,
      opponentTeam: String(theirs.name ?? ''),
      opponentCoach: String(coach?.name ?? ''),
      opponentScore: Number(theirs.score ?? 0) || 0,
      division: typeof m.division === 'string' ? m.division : undefined,
      myRace: typeof mine.roster === 'string' ? mine.roster : undefined,
      opponentRace: typeof theirs.roster === 'string' ? theirs.roster : undefined,
      myTv: Number(mine.teamValue) > 0 ? Number(mine.teamValue) : undefined,
      opponentTv: Number(theirs.teamValue) > 0 ? Number(theirs.teamValue) : undefined,
    });
  }
  return rows;
}

/** Newest first; a match played by two of the coach's own teams appears once. */
export function mergeRecent(lists: FumbblRecentMatch[][], limit = 30): FumbblRecentMatch[] {
  const seen = new Set<number>();
  return lists.flat()
    .sort((a, b) => b.when.localeCompare(a.when) || b.matchId - a.matchId)
    .filter((row) => (seen.has(row.matchId) ? false : (seen.add(row.matchId), true)))
    .slice(0, limit);
}

/**
 * Owner 10-06 (Replay pane rig): a veteran coach can own hundreds of teams (RickWreckless: 340, 261 retired) and one
 * matches page per team meant hundreds of requests - over HTTP/1.1 that queued for minutes and starved every other
 * FUMBBL request. Only the most likely teams are read, capped, a few requests at a time. /api/coach/teams carries NO
 * last-played date (checked 10-06: no lastMatch field), so the order is by status - an in-between state (just
 * played) first, then Active, then the rest, Retired last - and then the newest team (highest id). When the cap
 * applies the result says so (`teamCap`) and the lists show it.
 *
 * Owner 10-11 ("Let's use local logs as the first indication of which games to pull"): for the LOCAL coach the client's
 * own record of the teams played on this machine (recentPlayedTeams.ts), most recent first, leads that order; the
 * status order fills the remaining slots. Same endpoints, same cap, same concurrency.
 */
/** Statuses that do not mean "just played": a team that has not started, or is waiting on the site staff. */
const SETTLED_TEAM_STATUSES: ReadonlySet<string> = new Set(['new', 'pending approval', 'waiting for approval', 'rejected', 'blocked', 'deleted', 'disbanded']);
export const RECENT_TEAM_CAP = 16;
export const RECENT_FETCH_CONCURRENCY = 4;
/** At most this many of the RECENT_TEAM_CAP slots come from the local record; the rest always follow the status order. */
export const RECENT_LOCAL_TEAM_MAX = 10;
/** A locally recorded team leads only when it was played within this long of now (30 days). */
export const RECENT_LOCAL_TEAM_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export function pickRecentTeams<T extends Pick<FumbblCoachTeam, 'id' | 'status'>>(
  teams: readonly T[], cap = RECENT_TEAM_CAP, localTeamIds: readonly number[] = [],
): T[] {
  // Owner 10-11: a game went missing from the list because its team had moved to an end-of-season prompt - not
  // "Post Match Sequence", so it ranked below every Active team and fell outside the cap. A team is in such an
  // in-between state BECAUSE it just played (post-match sequence, season end / redraft), so every status that is not
  // a settled one leads the order; the exact wording FUMBBL uses for those states is not relied on.
  const rank = (t: T): number => {
    const status = (t.status ?? '').trim().toLowerCase();
    if (!status) return 2;
    if (status === 'active') return 1;
    if (status === 'retired') return 3;
    return SETTLED_TEAM_STATUSES.has(status) ? 2 : 0;
  };
  // Owner 10-11: the teams this machine saw played lead, most recent first, whatever their status (a Retired team that
  // was just played still has the game). A team the coach no longer has is skipped; a repeated id counts once.
  // At most RECENT_LOCAL_TEAM_MAX lead: a game played elsewhere (another machine, the Java client) is only known by
  // its team's status, so the status order always keeps the remaining slots. The caller drops rows older than
  // RECENT_LOCAL_TEAM_MAX_AGE_MS (recentPlayedTeams.playedTeamIds).
  const byId = new Map<number, T>();
  for (const team of teams) if (!byId.has(team.id)) byId.set(team.id, team);
  const leading: T[] = [];
  const led = new Set<number>();
  for (const id of localTeamIds) {
    if (leading.length >= RECENT_LOCAL_TEAM_MAX) break;
    const team = byId.get(id);
    if (!team || led.has(id)) continue;
    led.add(id);
    leading.push(team);
  }
  const rest = teams.filter((team) => !led.has(team.id)).sort((a, b) => rank(a) - rank(b) || b.id - a.id);
  return [...leading, ...rest].slice(0, cap);
}
export interface RecentTeamCap { shown: number; total: number }
/** The one-line note for a capped list (both the Replay pane and the Play blade). */
export function recentTeamCapNote(cap: RecentTeamCap | undefined): string {
  return cap ? `Showing games from ${cap.shown} of ${cap.total} teams (most recently active first)` : '';
}
/** `signal` (owner 11-12): an aborted signal stops the workers taking further items. */
async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length && !signal?.aborted) { const i = next++; out[i] = await fn(items[i]!); }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Owner 11-12 (coach stats sync): optional cancel and a bounded wait per request. Callers that pass nothing get the
 *  calls exactly as before (no request init). */
export interface RecentMatchesOptions {
  signal?: AbortSignal;
  /** abort any single request (and its body) that takes longer than this */
  requestTimeoutMs?: number;
}

const abortError = (): DOMException => new DOMException('The request was aborted.', 'AbortError');

/** One request's init: the caller's signal, plus the per-request timeout. `done` clears both. */
function requestInit(options: RecentMatchesOptions): { init?: RequestInit; done(): void } {
  if (!options.signal && !options.requestTimeoutMs) return { done() {} };
  const ctl = new AbortController();
  const onAbort = () => ctl.abort(abortError());
  if (options.signal?.aborted) ctl.abort(abortError());
  else options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = options.requestTimeoutMs ? setTimeout(() => ctl.abort(new DOMException('The request timed out.', 'TimeoutError')), options.requestTimeoutMs) : null;
  return { init: { signal: ctl.signal }, done() { if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); } };
}

/** `localTeamIds`: the LOCAL coach's teams played in the last 30 days, most recent first (recentPlayedTeams.localPlayedTeamIds).
 *  Only a caller listing the local coach's own games passes it; a search for another coach passes nothing. */
export async function fetchRecentFumbblMatches(coach: string, fetcher: FetchLike, limit = 30, localTeamIds: readonly number[] = [], options: RecentMatchesOptions = {}): Promise<{
  teams: FumbblCoachTeam[];
  matches: FumbblRecentMatch[];
  /** false = FUMBBL knows no such coach (owner 10-06: the Replay pane then tries a league) */
  found: boolean;
  /** set when the coach has more teams than RECENT_TEAM_CAP: only `shown` of `total` teams were read */
  teamCap?: RecentTeamCap;
  /** owner 11-12: team match pages requested, and how many of them failed (an error or a non-OK answer). A failed
   *  page still reads as no games (as before); these say whether the list is complete. */
  pagesRequested: number;
  pagesFailed: number;
}> {
  const first = requestInit(options);
  let result: Awaited<ReturnType<typeof fetchFumbblCoachTeams>>;
  try { result = await fetchFumbblCoachTeams(coach, fetcher as unknown as typeof fetch, first.init); } finally { first.done(); }
  if (options.signal?.aborted) throw abortError();
  if (result.kind === 'not-found') return { teams: [], matches: [], found: false, pagesRequested: 0, pagesFailed: 0 };
  const picked = pickRecentTeams(result.teams, RECENT_TEAM_CAP, localTeamIds);
  let pagesRequested = 0, pagesFailed = 0;
  const lists = await mapLimited(picked, RECENT_FETCH_CONCURRENCY, async (team) => {
    const req = requestInit(options);
    pagesRequested++;
    try {
      const url = `${FUMBBL_SITE}/api/team/matches/${team.id}/0`;
      const res = await (req.init ? fetcher(url, req.init) : fetcher(url));
      if (!res.ok) { pagesFailed++; return []; }
      const payload: unknown = await res.json();
      // review 2 (#3): FUMBBL answers some errors with HTTP 200 and a JSON string ("Error:3 No such command."): a page
      // that is not an array is a failed page (still read as no games, as before)
      if (!Array.isArray(payload)) { pagesFailed++; return []; }
      return parseTeamMatches(payload, team.id);
    } catch { pagesFailed++; return []; } finally { req.done(); }
  }, options.signal);
  if (options.signal?.aborted) throw abortError();
  const out = { teams: result.teams, matches: mergeRecent(lists.map((l) => l ?? []), limit), found: true as boolean, pagesRequested, pagesFailed };
  return result.teams.length > picked.length ? { ...out, teamCap: { shown: picked.length, total: result.teams.length } } : out;
}
