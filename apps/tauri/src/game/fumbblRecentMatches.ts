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

type FetchLike = (input: string) => Promise<Response>;

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
 * last-played date (checked 10-06: no lastMatch field), so the order is by status - "Post Match Sequence" (just
 * played) first, then Active, then the rest, Retired last - and then the newest team (highest id). When the cap
 * applies the result says so (`teamCap`) and the lists show it.
 */
export const RECENT_TEAM_CAP = 16;
export const RECENT_FETCH_CONCURRENCY = 4;
export function pickRecentTeams<T extends Pick<FumbblCoachTeam, 'id' | 'status'>>(teams: readonly T[], cap = RECENT_TEAM_CAP): T[] {
  const rank = (t: T): number => (t.status === 'Post Match Sequence' ? 0 : t.status === 'Active' ? 1 : t.status === 'Retired' ? 3 : 2);
  return [...teams].sort((a, b) => rank(a) - rank(b) || b.id - a.id).slice(0, cap);
}
export interface RecentTeamCap { shown: number; total: number }
/** The one-line note for a capped list (both the Replay pane and the Play blade). */
export function recentTeamCapNote(cap: RecentTeamCap | undefined): string {
  return cap ? `Showing games from ${cap.shown} of ${cap.total} teams (most recently active first)` : '';
}
async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!); }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function fetchRecentFumbblMatches(coach: string, fetcher: FetchLike, limit = 30): Promise<{
  teams: FumbblCoachTeam[];
  matches: FumbblRecentMatch[];
  /** false = FUMBBL knows no such coach (owner 10-06: the Replay pane then tries a league) */
  found: boolean;
  /** set when the coach has more teams than RECENT_TEAM_CAP: only `shown` of `total` teams were read */
  teamCap?: RecentTeamCap;
}> {
  const result = await fetchFumbblCoachTeams(coach, fetcher as unknown as typeof fetch);
  if (result.kind === 'not-found') return { teams: [], matches: [], found: false };
  const picked = pickRecentTeams(result.teams);
  const lists = await mapLimited(picked, RECENT_FETCH_CONCURRENCY, async (team) => {
    try {
      const res = await fetcher(`${FUMBBL_SITE}/api/team/matches/${team.id}/0`);
      return res.ok ? parseTeamMatches(await res.json(), team.id) : [];
    } catch { return []; }
  });
  const out = { teams: result.teams, matches: mergeRecent(lists, limit), found: true as boolean };
  return result.teams.length > picked.length ? { ...out, teamCap: { shown: picked.length, total: result.teams.length } } : out;
}
