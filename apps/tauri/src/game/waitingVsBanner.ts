/**
 * Owner 10-06: the waiting board's TEAM VS TEAM banner. Pure projection + a small cached loader.
 *
 * Data sources, in order of arrival (none of them blocks the waiting card):
 *  1. `gameStore.state.waitingForMatch` — coach names + my team name at once; my team id, the opponent's team id
 *     and the game id when the join knew them (a listed/scheduled game, a rejoin).
 *  2. The FFB lobby's own game list (`fumbblLobbyGames`, refreshed by the existing Play-blade/lobby flow) — the one
 *     source that describes a game still WAITING for its opponent: both team ids, names and coaches. FUMBBL's public
 *     API has no endpoint for a not-yet-started game by id (`/api/match/current` lists running games only;
 *     `/api/match/get/{id}` takes a completed match id).
 *  3. `/api/team/get/{teamId}` — name, coach, race (`roster.name`) and team value (`currentTeamValue`). It carries no
 *     logo field (top-level keys checked 10-06: id, coach, roster{id,name}, name, bio{image,htmlBio}, … players), so
 *     the crest goes through the same loader as the Spectate list and Play blade: teamLogoUrl({ race, side }) — a
 *     local pack's race logo, else the bundled race crest; runtime FUMBBL CDN requests are disabled client-wide. For a scheduled tournament game
 *     my team's `tournament.opponents` names the opponent team when it holds exactly one id.
 */
import type { GameListEntry } from '@fumbbl40k/ffb-protocol';

export type WaitingForMatch = {
  gameName?: string;
  teamName?: string;
  coach?: string;
  opponentCoach?: string;
  gameId?: number;
  teamId?: string;
  opponentTeamId?: string;
  /** an official FUMBBL join: the only case the FUMBBL API may be asked anything */
  official?: boolean;
};

export interface FumbblTeamInfo {
  id: string;
  name?: string;
  coach?: string;
  race?: string;
  tv?: number;
  /** `tournament.opponents` — the scheduled opponent team ids, when the team is in a tournament */
  tournamentOpponents: string[];
}

export interface BannerSide {
  teamName: string;
  coach?: string;
  race?: string;
  tv?: number;
  teamId?: string;
}

export interface WaitingBannerModel {
  mine: BannerSide;
  opponent: BannerSide;
}

const eqCoach = (a?: string, b?: string): boolean => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const positive = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const id = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value);
  const s = text(value);
  return s && /^\d+$/.test(s) && s !== '0' ? s : undefined;
};

/** `/api/team/get/{teamId}` → the fields the banner uses (null for anything that is not a team record). */
export function parseFumbblTeam(payload: unknown): FumbblTeamInfo | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = payload as Record<string, unknown>;
  const teamId = id(raw.id);
  if (!teamId) return null;
  const coach = raw.coach && typeof raw.coach === 'object' ? text((raw.coach as Record<string, unknown>).name) : text(raw.coach);
  const roster = raw.roster && typeof raw.roster === 'object' ? raw.roster as Record<string, unknown> : null;
  const tournament = raw.tournament && typeof raw.tournament === 'object' ? raw.tournament as Record<string, unknown> : null;
  const opponents = Array.isArray(tournament?.opponents) ? tournament!.opponents.map(id).filter((v): v is string => !!v) : [];
  return {
    id: teamId,
    name: text(raw.name),
    coach,
    race: text(roster?.name) ?? text(raw.race),
    tv: positive(raw.currentTeamValue) ?? positive(raw.teamValue),
    tournamentOpponents: opponents,
  };
}

/** The lobby list's entry for this game - by game id only. A list entry carries no game name, so a by-name join
 *  (no id) never borrows an entry: an older game of the same team could name the wrong opponent (Astra 10-06). */
export function lobbyEntryFor(wait: WaitingForMatch, entries: readonly GameListEntry[]): GameListEntry | undefined {
  return wait.gameId && wait.gameId > 0 ? entries.find((e) => Number(e.gameId) === wait.gameId) : undefined;
}

/** Which side of a lobby entry is mine: by team id, else by coach name. */
function mySide(wait: WaitingForMatch, entry: GameListEntry): 'home' | 'away' | null {
  if (wait.teamId && String(entry.teamHomeId ?? '') === wait.teamId) return 'home';
  if (wait.teamId && String(entry.teamAwayId ?? '') === wait.teamId) return 'away';
  if (wait.teamId) return null;
  if (eqCoach(entry.teamHomeCoach ?? undefined, wait.coach)) return 'home';
  if (eqCoach(entry.teamAwayCoach ?? undefined, wait.coach)) return 'away';
  return null;
}

/** My team id: what the join named, else my seat in the game's lobby entry (a password lobby joined by id). */
export function myTeamIdFor(wait: WaitingForMatch, entry: GameListEntry | undefined): string | undefined {
  const joined = id(wait.teamId);
  if (joined || !entry) return joined;
  const side = mySide(wait, entry);
  return side === 'home' ? id(entry.teamHomeId) : side === 'away' ? id(entry.teamAwayId) : undefined;
}

/** The opponent as the lobby list describes it (empty fields when the seat is still open). A seat whose team id or
 *  coach contradicts what the join named is ignored as a whole - never mix two teams on one card (Astra 10-06). */
function listedOpponent(wait: WaitingForMatch, entry: GameListEntry | undefined): { teamId?: string; teamName?: string; coach?: string } {
  if (!entry) return {};
  const side = mySide(wait, entry);
  if (!side) return {};
  const seat = side === 'home'
    ? { teamId: id(entry.teamAwayId), teamName: text(entry.teamAwayName), coach: text(entry.teamAwayCoach) }
    : { teamId: id(entry.teamHomeId), teamName: text(entry.teamHomeName), coach: text(entry.teamHomeCoach) };
  const joinedId = id(wait.opponentTeamId);
  const joinedCoach = text(wait.opponentCoach);
  if (joinedId && seat.teamId && seat.teamId !== joinedId) return {};
  if (joinedCoach && seat.coach && !eqCoach(seat.coach, joinedCoach)) return {};
  return seat;
}

/**
 * The opponent's team id: what the join named, else the lobby list's other seat, else my scheduled tournament
 * opponent (exactly one id). Undefined when nothing names it — the opponent side then shows the coach only.
 */
export function opponentTeamIdFor(wait: WaitingForMatch, entry: GameListEntry | undefined, mine: FumbblTeamInfo | null | undefined): string | undefined {
  const joined = id(wait.opponentTeamId);
  if (joined) return joined;
  const listed = listedOpponent(wait, entry).teamId;
  if (listed) return listed;
  // a by-name join is not the scheduled game: the tournament opponent would be unrelated (Astra 10-06)
  if (text(wait.gameName) && !(wait.gameId && wait.gameId > 0)) return undefined;
  return mine && mine.tournamentOpponents.length === 1 ? mine.tournamentOpponents[0] : undefined;
}

/**
 * Names-only → full. Everything shown is something a source said; a fetched team whose coach contradicts the coach
 * the join named is ignored (never paint the wrong opponent).
 */
export function projectWaitingBanner(
  wait: WaitingForMatch,
  entries: readonly GameListEntry[] = [],
  fetched: { mine?: FumbblTeamInfo | null; opponent?: FumbblTeamInfo | null } = {},
): WaitingBannerModel {
  // a fork/standalone join: names from the join only — the FUMBBL lobby list and team records never apply to it
  if (!wait.official) { entries = []; fetched = {}; }
  const entry = lobbyEntryFor(wait, entries);
  const listed = listedOpponent(wait, entry);
  const myId = myTeamIdFor(wait, entry);
  const own = fetched.mine && (!myId || fetched.mine.id === myId) && (!wait.coach || !fetched.mine.coach || eqCoach(fetched.mine.coach, wait.coach))
    ? fetched.mine : null;
  const expectedOpponentId = opponentTeamIdFor(wait, entry, own);
  const opponentCoachKnown = text(wait.opponentCoach) ?? listed.coach;
  const opp = fetched.opponent && fetched.opponent.id === expectedOpponentId
    && (!opponentCoachKnown || !fetched.opponent.coach || eqCoach(fetched.opponent.coach, opponentCoachKnown))
    && !eqCoach(fetched.opponent.coach, wait.coach)
    ? fetched.opponent : null;
  const opponentCoach = opponentCoachKnown ?? opp?.coach;
  return {
    mine: {
      teamName: text(wait.teamName) ?? own?.name ?? 'Your team',
      coach: text(wait.coach) ?? own?.coach,
      race: own?.race,
      tv: own?.tv,
      teamId: own?.id ?? myId,
    },
    opponent: {
      teamName: opp?.name ?? listed.teamName ?? (opponentCoach ? `${opponentCoach}'s team` : 'Opponent'),
      coach: opponentCoach,
      race: opp?.race,
      tv: opp?.tv,
      teamId: opp?.id ?? expectedOpponentId,
    },
  };
}

/** "TV 1,220k" like the Play blade. */
export function formatBannerTv(value: number | undefined): string | undefined {
  if (!value) return undefined;
  const thousands = value >= 10_000 ? Math.round(value / 1_000) : Math.round(value);
  return `TV ${thousands.toLocaleString('en-US')}k`;
}

type FetchLike = (input: string) => Promise<Response>;

/** One request per team id per waiting episode (a team does not change while its coach waits); the view clears it
 *  when the wait ends so a later match never shows an old TV or tournament opponent (Astra 10-06). */
const teamCache = new Map<string, Promise<FumbblTeamInfo | null>>();

export function loadFumbblTeam(site: string, teamId: string, fetcher: FetchLike): Promise<FumbblTeamInfo | null> {
  const key = id(teamId);
  if (!key) return Promise.resolve(null);
  const cached = teamCache.get(key);
  if (cached) return cached;
  const request = fetcher(`${site}/api/team/get/${encodeURIComponent(key)}`)
    .then(async (response) => (response.ok ? parseFumbblTeam(await response.json()) : null))
    .catch(() => null)
    .then((team) => {
      // a failed lookup may be tried again by a later trigger (a lobby-list refresh), never by a timer
      if (!team) teamCache.delete(key);
      return team;
    });
  teamCache.set(key, request);
  return request;
}

export function clearFumbblTeamCache(): void { teamCache.clear(); }

/**
 * Both team records for the banner. `isCurrent` is asked before every follow-up request and before the result is
 * used: a wait that ended (Cancel, game started, a newer wait) never starts the tournament-opponent lookup.
 */
export async function resolveBannerTeams(
  wait: WaitingForMatch,
  entries: readonly GameListEntry[],
  site: string,
  fetcher: FetchLike,
  isCurrent: () => boolean,
): Promise<{ mine: FumbblTeamInfo | null; opponent: FumbblTeamInfo | null } | null> {
  if (!wait.official) return { mine: null, opponent: null };
  const entry = lobbyEntryFor(wait, entries);
  const myId = myTeamIdFor(wait, entry);
  const knownOpponent = opponentTeamIdFor(wait, entry, null);
  const [mine, early] = await Promise.all([
    myId ? loadFumbblTeam(site, myId, fetcher) : Promise.resolve(null),
    knownOpponent ? loadFumbblTeam(site, knownOpponent, fetcher) : Promise.resolve(null),
  ]);
  if (!isCurrent()) return null;
  if (knownOpponent) return { mine, opponent: early };
  const scheduled = opponentTeamIdFor(wait, entry, mine);
  if (!scheduled) return { mine, opponent: null };
  const opponent = await loadFumbblTeam(site, scheduled, fetcher);
  return isCurrent() ? { mine, opponent } : null;
}
