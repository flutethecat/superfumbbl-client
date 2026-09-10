import { FUMBBL_SITE } from './settings';

export interface FumbblRaceLogo {
  size: number;
  logo: number;
}

export interface FumbblCoachTeam {
  id: number;
  name: string;
  race: string;
  teamValue?: number;
  raceLogos: FumbblRaceLogo[];
}

export type FumbblCoachTeamsResult =
  | { kind: 'found'; coachName: string; teams: FumbblCoachTeam[] }
  | { kind: 'not-found'; teams: [] };

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type IngestCaller<T = Record<string, unknown>> =
  (path: string, body: Record<string, unknown>) => Promise<T>;

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseFumbblCoachTeams(payload: unknown): FumbblCoachTeamsResult {
  // The API returns a bare error string for an unknown coach, and old/malformed responses can omit teams too.
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { kind: 'not-found', teams: [] };

  const data = payload as Record<string, unknown>;
  if (!Array.isArray(data.teams)) return { kind: 'not-found', teams: [] };

  const teams = data.teams.flatMap((entry): FumbblCoachTeam[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const team = entry as Record<string, unknown>;
    const id = finiteNumber(team.id);
    if (id === undefined || typeof team.name !== 'string' || typeof team.race !== 'string') return [];

    const currentTeamValue = finiteNumber(team.currentTeamValue);
    const teamValue = currentTeamValue ?? finiteNumber(team.teamValue);
    const raceLogos = Array.isArray(team.raceLogos)
      ? team.raceLogos.flatMap((entry): FumbblRaceLogo[] => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
          const logo = entry as Record<string, unknown>;
          const size = finiteNumber(logo.size);
          const logoId = finiteNumber(logo.logo);
          return size === undefined || logoId === undefined ? [] : [{ size, logo: logoId }];
        })
      : [];

    return [{ id, name: team.name, race: team.race, teamValue, raceLogos }];
  });

  return {
    kind: 'found',
    coachName: typeof data.name === 'string' ? data.name : '',
    teams,
  };
}

export async function fetchFumbblCoachTeams(
  coachName: string,
  fetcher: FetchLike = fetch,
): Promise<FumbblCoachTeamsResult> {
  const response = await fetcher(`${FUMBBL_SITE}/api/coach/teams/${encodeURIComponent(coachName)}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseFumbblCoachTeams(await response.json());
}

export function fumbblCoachTeamIconPath(team: Pick<FumbblCoachTeam, 'raceLogos'>): string | null {
  const logos = team.raceLogos.filter(({ size, logo }) => Number.isFinite(size) && Number.isFinite(logo));
  if (!logos.length) return null;

  // Prefer the largest crest no bigger than 64px; oversized-only sets use their smallest option.
  const preferred = logos.filter(({ size }) => size <= 64).sort((a, b) => b.size - a.size)[0]
    ?? [...logos].sort((a, b) => a.size - b.size)[0];
  return preferred ? `i/${preferred.logo}.png` : null;
}

export function ingestFumbblCoachTeam<T>(
  caller: IngestCaller<T>,
  superFumbblCoach: string,
  fumbblTeamId: number,
): Promise<T> {
  // Browsed official-FUMBBL ownership and the destination Super FUMBBL account are separate identities.
  return caller('library/ingest', { coach: superFumbblCoach, team: String(fumbblTeamId) });
}
