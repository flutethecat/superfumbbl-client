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
    rows.push({
      matchId,
      replayId,
      when: `${String(m.date ?? '')} ${String(m.time ?? '')}`.trim(),
      myTeamId: teamId,
      myTeam: String(mine.name ?? ''),
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

export async function fetchRecentFumbblMatches(coach: string, fetcher: FetchLike, limit = 30): Promise<{ teams: FumbblCoachTeam[]; matches: FumbblRecentMatch[] }> {
  const result = await fetchFumbblCoachTeams(coach, fetcher as unknown as typeof fetch);
  if (result.kind === 'not-found') return { teams: [], matches: [] };
  const lists = await Promise.all(result.teams.map(async (team) => {
    try {
      const res = await fetcher(`${FUMBBL_SITE}/api/team/matches/${team.id}/0`);
      return res.ok ? parseTeamMatches(await res.json(), team.id) : [];
    } catch { return []; }
  }));
  return { teams: result.teams, matches: mergeRecent(lists, limit) };
}
