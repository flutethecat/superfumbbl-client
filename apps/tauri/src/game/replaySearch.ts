/**
 * Owner 10-06 (spec-replay-pane-revamp.md): the Replay pane's unified search - one field, "Coach, league or game ID".
 * Pure + tested (test/replaySearch.test.ts); public FUMBBL API only, no auth, read-only.
 *   - all digits -> a FUMBBL match id first (`/api/match/get/<id>`); when that fails (HTTP error, unparsable, or the
 *     API's `null` body for an unknown id) a FUMBBL group (league) id with tournaments; else the number is taken as an
 *     FFB replay (game) id: one "Game <id>" row with unknown teams whose Replay connects straight to that id.
 *   - anything else -> a coach name, verbatim (fetchRecentFumbblMatches; the searched coach is the LEFT side); when
 *     FUMBBL knows no such coach, a league / group name (owner 10-06: "Group search is the same as League search"):
 *     the public API has no group search, so the names come from the BUNDLED league index (assets/data/league-index.json;
 *     /p/groups is bot-walled, its live fetch is only an optional refresh that merges new leagues), matched
 *     case-insensitively as a substring - one match lists its recent tournament games, several give a pick list.
 *   - empty -> the user's own recent games (settings.coach).
 * Never connects anything itself: the user clicks Replay.
 */
import { fetchRecentFumbblMatches, type FumbblRecentMatch, type RecentTeamCap } from './fumbblRecentMatches';
import { resultLetter } from './fumbblPlayBlade';
import { FUMBBL_SITE } from './settings';
import leagueIndexData from '../assets/data/league-index.json';

export interface ReplayRowTeam {
  name: string;
  coach: string;
  race?: string;
  tv?: number;
  teamId?: number;
}

export interface ReplayRow {
  /** list key, unique within one result set */
  key: string;
  /** FUMBBL match id (absent for a bare replay-id row) */
  matchId?: number;
  /** the FFB game id the replay socket takes; 0 = FUMBBL has no replay for this match */
  replayId: number;
  /** "YYYY-MM-DD HH:MM:SS" (site time); '' when unknown */
  when: string;
  /** the match's division, or (league rows) its tournament's name */
  division?: string;
  /** league rows whose schedule carried no replay id: Replay looks it up via /api/match/get when clicked */
  replayLookup?: boolean;
  left: ReplayRowTeam;
  /** null = teams unknown (bare replay id) */
  right: ReplayRowTeam | null;
  /** null = no score known */
  score: { left: number; right: number } | null;
}

export type ReplaySearchKind = 'own' | 'coach' | 'match' | 'replay' | 'league' | 'league-pick' | 'none';

export interface FumbblGroup {
  id: number;
  /** '' = not known yet (a logo-only league with no advert line) */
  name: string;
  /** /p/groups shows this league as a logo only: `name` is its advert line (or ''), not its name - the real name
   *  comes from /api/group/get (resolveLogoGroupNames / searchGroup) */
  fromAd?: boolean;
}

export interface ReplaySearchResult {
  kind: ReplaySearchKind;
  /** the trimmed query ('' for the own-games list) */
  query: string;
  /** the coach whose games are listed (own / coach searches) */
  coach?: string;
  /** the league whose games are listed (kind 'league') */
  group?: FumbblGroup;
  /** several leagues matched the name (kind 'league-pick'): the user picks one (searchGroup) */
  groups?: FumbblGroup[];
  /** a BARE number that resolved as a match or a league: the pane offers the other readings (replay:<n>, league:<n>) */
  bareId?: number;
  /** own / coach lists: only some of the coach's teams were read (RECENT_TEAM_CAP) */
  teamCap?: RecentTeamCap;
  /** a league whose tournament schedules did not all load: the rows that did load, plus this notice */
  notice?: string;
  rows: ReplayRow[];
}

type FetchLike = (input: string) => Promise<Response>;

export type IdReading = 'match' | 'replay' | 'league';
export type ClassifiedQuery =
  | { kind: 'own' }
  | { kind: 'id'; id: number; /** set by an explicit prefix (match: / replay: / league: / group:); absent = bare number */ force?: IdReading }
  | { kind: 'coach'; coach: string };

/** Trim and collapse inner whitespace (a pasted name with doubled spaces still matches). */
export function normalizeQuery(raw: string): string { return raw.trim().replace(/\s+/g, ' '); }

export function classifyQuery(raw: string): ClassifiedQuery {
  const query = normalizeQuery(raw);
  if (!query) return { kind: 'own' };
  const prefixed = /^(match|replay|league|group)\s*:\s*(\d+)$/i.exec(query);
  if (prefixed) {
    const id = Number(prefixed[2]);
    const word = prefixed[1]!.toLowerCase();
    if (Number.isSafeInteger(id) && id > 0) return { kind: 'id', id, force: word === 'group' ? 'league' : word as IdReading };
  }
  if (/^\d+$/.test(query)) {
    const id = Number(query);
    if (Number.isSafeInteger(id) && id > 0) return { kind: 'id', id };
  }
  return { kind: 'coach', coach: query };
}
/** Does an id query allow this reading? A bare number allows all three (match -> league -> replay). */
function idAllows(q: ClassifiedQuery, reading: IdReading): q is Extract<ClassifiedQuery, { kind: 'id' }> {
  return q.kind === 'id' && (!q.force || q.force === reading);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function positive(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function matchTeam(raw: Record<string, unknown>): ReplayRowTeam {
  const roster = raw.roster;
  // /api/match/get carries roster as { id, name }; /api/team/matches as a bare string - accept both.
  const race = typeof roster === 'string' ? roster : typeof record(roster)?.name === 'string' ? String(record(roster)!.name) : undefined;
  const coach = record(raw.coach)?.name;
  return {
    name: String(raw.name ?? ''),
    coach: typeof coach === 'string' ? coach : '',
    race: race || undefined,
    tv: positive(raw.teamValue),
    teamId: positive(raw.id),
  };
}

/** One `/api/match/get/<id>` payload -> a row (team1 left, team2 right); null for anything that is not a match. */
export function parseMatchGet(payload: unknown): ReplayRow | null {
  const m = record(payload);
  if (!m) return null;
  const t1 = record(m.team1);
  const t2 = record(m.team2);
  const matchId = Number(m.id);
  if (!t1 || !t2 || !Number.isSafeInteger(matchId) || matchId <= 0) return null;
  const replayId = Number(m.replayId);
  return {
    key: `match-${matchId}`,
    matchId,
    replayId: Number.isSafeInteger(replayId) && replayId > 0 ? replayId : 0,
    when: `${String(m.date ?? '')} ${String(m.time ?? '')}`.trim(),
    division: typeof m.division === 'string' && m.division ? m.division : undefined,
    left: matchTeam(t1),
    right: matchTeam(t2),
    score: { left: Number(t1.score ?? 0) || 0, right: Number(t2.score ?? 0) || 0 },
  };
}

/** A coach's recent match (fumbblRecentMatches) as a row: the coach's team on the LEFT. */
export function rowFromRecent(match: FumbblRecentMatch, coach: string): ReplayRow {
  return {
    key: `match-${match.matchId}`,
    matchId: match.matchId,
    replayId: match.replayId,
    when: match.when,
    division: match.division,
    left: { name: match.myTeam, coach: match.myCoach || coach, race: match.myRace, tv: match.myTv, teamId: match.myTeamId },
    right: { name: match.opponentTeam, coach: match.opponentCoach, race: match.opponentRace, tv: match.opponentTv },
    score: { left: match.myScore, right: match.opponentScore },
  };
}

/** The fallback for a number that is not a FUMBBL match id: a bare FFB replay id, teams unknown. */
export function replayIdRow(id: number): ReplayRow {
  return { key: `replay-${id}`, replayId: id, when: '', left: { name: `Game ${id}`, coach: '' }, right: null, score: null };
}

export async function fetchMatchRow(id: number, fetcher: FetchLike): Promise<ReplayRow | null> {
  try {
    const res = await fetcher(`${FUMBBL_SITE}/api/match/get/${id}`);
    if (!res.ok) return null;
    return parseMatchGet(await res.json());
  } catch { return null; }
}


/** Replay for a row: its replay id, or (a league row without one) the match's replay id from /api/match/get. */
export async function resolveReplayId(row: Pick<ReplayRow, 'replayId' | 'matchId' | 'replayLookup'>, fetcher: FetchLike): Promise<number> {
  if (row.replayId > 0) return row.replayId;
  if (!row.replayLookup || !row.matchId) return 0;
  return (await fetchMatchRow(row.matchId, fetcher))?.replayId ?? 0;
}

// ---- leagues (FUMBBL groups) ----

/** Caps for one league search: the newest tournaments' schedules only, and the newest played games of those. */
export const LEAGUE_TOURNAMENT_CAP = 3;
export const LEAGUE_MATCH_CAP = 40;
export const LEAGUE_PICK_CAP = 12;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', middot: '·', copy: '©', reg: '®', trade: '™',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', yacute: 'ý', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  agrave: 'à', egrave: 'è', igrave: 'ì', ograve: 'ò', ugrave: 'ù', Agrave: 'À', Egrave: 'È',
  acirc: 'â', ecirc: 'ê', icirc: 'î', ocirc: 'ô', ucirc: 'û', atilde: 'ã', otilde: 'õ', ntilde: 'ñ', Ntilde: 'Ñ',
  auml: 'ä', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  ccedil: 'ç', Ccedil: 'Ç', aring: 'å', Aring: 'Å', aelig: 'æ', AElig: 'Æ', oslash: 'ø', Oslash: 'Ø',
};
function codePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}
/** Pure decode: numeric (decimal / hex) entities and a table of the common named ones; unknown names stay as written. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const out = body[1] === 'x' || body[1] === 'X' ? codePoint(parseInt(body.slice(2), 16)) : codePoint(Number(body.slice(1)));
      return out || whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}
/** In a browser the platform decoder handles every named entity; the pure table is the fallback (tests / no DOM). */
function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  if (typeof document !== 'undefined') {
    try {
      const area = document.createElement('textarea');
      area.innerHTML = text;
      return area.value;
    } catch { /* fall through */ }
  }
  return decodeHtmlEntities(text);
}

/**
 * The public https://fumbbl.com/p/groups page -> [{ id, name }]. Each league is a `<div class="group">` block whose
 * name anchor is `/p/group?group=<id>&op=view">Name`. A league shown as a LOGO has an empty anchor and the page shows
 * no name for it at all - only its advert line (`<div class="ad">`), which is then what the search matches on
 * (`fromAd`; '' when even that is empty). When a name search misses, resolveLogoGroupNames fetches those leagues'
 * real names (/api/group/get, capped, cached per session) so they can be found by name too.
 */
export function parseGroupsPage(html: string): FumbblGroup[] {
  const groups: FumbblGroup[] = [];
  const seen = new Set<number>();
  const blocks = html.split(/<div class="group">/).slice(1);
  for (const block of blocks) {
    const anchor = /href="\/p\/group\?group=(\d+)&(?:amp;)?op=view"[^>]*>([^<]*)<\/a>/.exec(block);
    if (!anchor) continue;
    const id = Number(anchor[1]);
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
    const ad = /<div class="ad">([^<]*)<\/div>/.exec(block);
    const anchorName = decodeEntities(anchor[2]!).replace(/\s+/g, ' ').trim();
    const name = anchorName || decodeEntities(ad?.[1] ?? '').replace(/\s+/g, ' ').trim();
    seen.add(id);
    // a logo-only league keeps its advert text ('' when it has none) until resolveLogoGroupNames fetches its name
    groups.push(anchorName ? { id, name } : { id, name, fromAd: true });
  }
  return groups;
}

/** Matching key: whitespace-collapsed, lower case, diacritics folded (NFD minus combining marks: "Nieżywiec" ->
 *  "niezywiec", "ÖBBB" -> "obbb"), so a search typed without accents finds the league (Astra P3). */
export function leagueMatchKey(text: string): string {
  return normalizeQuery(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
/** Case-insensitive, accent-insensitive substring match; an exact name wins outright. */
export function matchGroups(groups: readonly FumbblGroup[], query: string): FumbblGroup[] {
  const q = leagueMatchKey(query);
  if (!q) return [];
  const named = groups.filter((g) => g.name);
  const key = (g: FumbblGroup): string => leagueMatchKey(g.name);
  const exact = named.filter((g) => key(g) === q);
  if (exact.length === 1) return exact;
  return named.filter((g) => key(g).includes(q));
}

export class LeagueIndexUnavailable extends Error {
  constructor() { super('League names could not be loaded from FUMBBL'); this.name = 'LeagueIndexUnavailable'; }
}

/**
 * Owner 10-06: the BUNDLED league index (src/assets/data/league-index.json, refreshed by scripts/snapshot-league-index.mjs
 * from a browser-saved copy of /p/groups). fumbbl.com/p/groups sits behind an Anubis proof-of-work bot check, so the app
 * cannot read it with a plain fetch - league names resolve against this snapshot FIRST; the live page is only an
 * opportunistic refresh that merges leagues the snapshot does not know.
 */
export const LEAGUE_INDEX_SNAPSHOT: string = typeof leagueIndexData.snapshot === 'string' ? leagueIndexData.snapshot : '';
export const BUNDLED_LEAGUE_INDEX: readonly FumbblGroup[] = (Array.isArray(leagueIndexData.groups) ? leagueIndexData.groups : [])
  .filter((g) => Number.isSafeInteger(g?.id) && g.id > 0 && typeof g.name === 'string')
  .map((g) => ({ id: g.id, name: g.name.replace(/\s+/g, ' ').trim() }));
/** Shown when the bundled index has no match AND the live /p/groups refresh failed (bot check, HTTP error). */
export const LEAGUE_INDEX_NOTICE = `No league named like that in the bundled list (FUMBBL league list from ${LEAGUE_INDEX_SNAPSHOT || 'an unknown date'}). Search by id instead, e.g. league:13713.`;

/** Bundled leagues + the leagues a successful live refresh added (new ids only; a bundled name always wins). */
let mergedIndex: FumbblGroup[] = [...BUNDLED_LEAGUE_INDEX];
/** the live /p/groups refresh this session: 'failed' = bot check / HTTP error seen (not retried until reset) */
let liveState: 'idle' | 'merged' | 'failed' = 'idle';
/** `base` plus the leagues of `live` whose ids `base` lacks (live order kept; known ids keep their base name). */
export function mergeLiveGroups(base: readonly FumbblGroup[], live: readonly FumbblGroup[]): FumbblGroup[] {
  const known = new Set(base.map((g) => g.id));
  const added: FumbblGroup[] = [];
  for (const g of live) {
    if (known.has(g.id)) continue;
    known.add(g.id);
    added.push(g);
  }
  return [...base, ...added];
}
/** The league index a name search matches against right now (bundled + merged live). */
export function currentLeagueIndex(): readonly FumbblGroup[] { return mergedIndex; }

/** /p/groups answered with an HTTP error status: FUMBBL said no - not retried this session (unlike a transport error). */
export class LeagueIndexHttpError extends Error {
  constructor(readonly status: number) { super(`HTTP ${status}`); this.name = 'LeagueIndexHttpError'; }
}
/** One /p/groups read -> its leagues. A bot-check page (no `div.group` blocks) throws LeagueIndexUnavailable. */
export async function fetchGroupsPage(fetcher: FetchLike): Promise<FumbblGroup[]> {
  const res = await fetcher(`${FUMBBL_SITE}/p/groups`);
  if (!res.ok) throw new LeagueIndexHttpError(res.status);
  const groups = parseGroupsPage(await res.text());
  // FUMBBL answers this HTML page with an Anubis bot-check page for anything that is not a real browser session;
  // the JSON API is not affected. Never worked around - reported as unavailable.
  if (!groups.length) throw new LeagueIndexUnavailable();
  return groups;
}
/** Bot check or HTTP 4xx/5xx: FUMBBL's answer, remembered for the session. Anything else (TypeError: fetch failed,
 *  a timeout, an abort) is transport trouble and stays retryable on the next search (Astra P2-1). */
function isPermanentLiveFailure(error: unknown): boolean {
  return error instanceof LeagueIndexUnavailable || error instanceof LeagueIndexHttpError;
}

/** The live refresh's own bound - independent of the search that started it (Astra P2-2). */
export const LIVE_REFRESH_TIMEOUT_MS = 15_000;
class LiveRefreshTimeout extends Error {
  constructor() { super('League list refresh timed out'); this.name = 'TimeoutError'; }
}
interface LiveRefresh { promise: Promise<boolean>; stop(): void }
let liveRefresh: LiveRefresh | null = null;
/**
 * One live /p/groups read with its OWN AbortController and timer. With `liveFetch` (the pane's raw fetch) the request
 * is not tied to the search's signal at all, so superseding the search does not kill a shared refresh; without it
 * (tests, callers that only have a search fetcher) the timer still bounds how long anyone waits on it.
 */
function startLiveRefresh(ctx: ReplaySearchContext): LiveRefresh {
  const controller = new AbortController();
  const liveFetch = ctx.liveFetch;
  const fetcher: FetchLike = liveFetch ? (input) => liveFetch(input, { signal: controller.signal }) : ctx.fetcher;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStop: (error: Error) => void = () => undefined;
  const bound = new Promise<never>((_resolve, reject) => {
    rejectStop = reject;
    timer = setTimeout(() => { controller.abort(); reject(new LiveRefreshTimeout()); }, LIVE_REFRESH_TIMEOUT_MS);
  });
  const entry: LiveRefresh = {
    promise: Promise.resolve(false),
    stop() { clearTimeout(timer); controller.abort(); rejectStop(Object.assign(new Error('aborted'), { name: 'AbortError' })); },
  };
  entry.promise = (async () => {
    try {
      const live = await Promise.race([fetchGroupsPage(fetcher), bound]);
      mergedIndex = mergeLiveGroups(mergedIndex, live);
      liveState = 'merged';
      return true;
    } catch (error) {
      if (isPermanentLiveFailure(error)) liveState = 'failed';
      return false;
    } finally {
      clearTimeout(timer);
      if (liveRefresh === entry) liveRefresh = null;
    }
  })();
  liveRefresh = entry;
  return entry;
}
/**
 * The optional live refresh: merges NEW leagues from /p/groups into the index when the page loads. Resolves to whether
 * the live list is merged. `background` (a bundled hit) joins a refresh already in flight; an awaited refresh (a
 * bundled miss) never waits on an older pending one - it stops it and issues its own request, so one hung refresh
 * cannot stall later searches (Astra P2-2).
 */
export async function refreshLeagueIndex(ctx: ReplaySearchContext, background = false): Promise<boolean> {
  if (liveState === 'merged') return true;
  if (liveState === 'failed') return false;
  if (liveRefresh && background) return liveRefresh.promise;
  liveRefresh?.stop();
  return startLiveRefresh(ctx).promise;
}
export function resetReplaySearchCache(): void {
  liveRefresh?.stop(); liveRefresh = null;
  logoNames.clear(); enrichedMatches.clear();
  mergedIndex = [...BUNDLED_LEAGUE_INDEX]; liveState = 'idle';
}

/** The most logo-only leagues whose names one search fetches (the 10-06 page lists 50) - a few at a time. */
export const LOGO_NAME_CAP = 60;
export const LOGO_NAME_CONCURRENCY = 4;
const logoNames = new Map<number, string>();
/**
 * The logo-only leagues (fromAd) with their REAL names from /api/group/get, cached per session (a failed lookup is
 * not cached). Leagues beyond the cap, or whose lookup failed, keep their advert text.
 */
export async function resolveLogoGroupNames(groups: readonly FumbblGroup[], fetcher: FetchLike): Promise<FumbblGroup[]> {
  const todo = groups.filter((g) => g.fromAd && !logoNames.has(g.id)).slice(0, LOGO_NAME_CAP);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const g = todo[next++]!;
      const name = await fetchGroupName(g.id, fetcher);
      if (name) logoNames.set(g.id, name);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOGO_NAME_CONCURRENCY, todo.length) }, worker));
  return groups.map((g) => (g.fromAd && logoNames.has(g.id) ? { id: g.id, name: logoNames.get(g.id)! } : g));
}

interface GroupTournament { id: number; name: string; status: string; latest: string }

/** `/api/group/tournaments/<groupId>` -> tournaments, newest first (by the later of start / end, then id). */
export function parseGroupTournaments(payload: unknown): GroupTournament[] {
  if (!Array.isArray(payload)) return [];
  const list: GroupTournament[] = [];
  for (const raw of payload) {
    const t = record(raw);
    const id = Number(t?.id);
    if (!t || !Number.isSafeInteger(id) || id <= 0) continue;
    const start = typeof t.start === 'string' ? t.start : '';
    const end = typeof t.end === 'string' ? t.end : '';
    list.push({ id, name: typeof t.name === 'string' ? t.name : '', status: typeof t.status === 'string' ? t.status : '', latest: start > end ? start : end });
  }
  return list.sort((a, b) => b.latest.localeCompare(a.latest) || b.id - a.id);
}

/**
 * `/api/tournament/schedule/<tournamentId>` -> the PLAYED games as rows (teams[0] left, teams[1] right). Shape verified
 * read-only 10-06 on tournament 67279: [{ round, created, modified, result?: { id, status: 'played' | 'forfeit',
 * replayId, winner, teams: [{ id, score }] }, teams: [{ id, name }] }]. The schedule carries team names only (no coach,
 * race or TV) and no played date - `modified` (when the result was recorded) stands in for it.
 */
export function parseTournamentSchedule(payload: unknown, tournamentName = ''): ReplayRow[] {
  if (!Array.isArray(payload)) return [];
  const rows: ReplayRow[] = [];
  for (const raw of payload) {
    const entry = record(raw);
    const result = record(entry?.result);
    const teams = Array.isArray(entry?.teams) ? (entry!.teams as unknown[]).map(record) : [];
    const matchId = Number(result?.id);
    if (!entry || !result || result.status !== 'played' || !Number.isSafeInteger(matchId) || matchId <= 0) continue;
    const [a, b] = teams;
    if (!a || !b) continue;
    const scores = Array.isArray(result.teams) ? (result.teams as unknown[]).map(record) : [];
    const scoreOf = (teamId: unknown): number => Number(scores.find((s) => s && Number(s.id) === Number(teamId))?.score ?? 0) || 0;
    const replayId = Number(result.replayId);
    const hasReplay = Number.isSafeInteger(replayId) && replayId > 0;
    rows.push({
      key: `match-${matchId}`,
      matchId,
      replayId: hasReplay ? replayId : 0,
      replayLookup: hasReplay ? undefined : true,
      when: typeof entry.modified === 'string' ? entry.modified : '',
      division: tournamentName || undefined,
      left: { name: String(a.name ?? ''), coach: '', teamId: positive(a.id) },
      right: { name: String(b.name ?? ''), coach: '', teamId: positive(b.id) },
      score: { left: scoreOf(a.id), right: scoreOf(b.id) },
    });
  }
  return rows;
}

async function fetchJson(url: string, fetcher: FetchLike): Promise<unknown> {
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** One league's recent games: its newest tournaments' schedules (capped), played games newest first (capped). */
async function fetchGroupName(id: number, fetcher: FetchLike): Promise<string> {
  try {
    const g = record(await fetchJson(`${FUMBBL_SITE}/api/group/get/${id}`, fetcher));
    // Astra P3: the API can return entity-encoded names ("A &amp; B") - decode like the page's names
    return typeof g?.name === 'string' ? decodeEntities(g.name).replace(/\s+/g, ' ').trim() : '';
  } catch { return ''; }
}

export async function searchGroup(input: FumbblGroup, fetcher: FetchLike, query = input.name): Promise<ReplaySearchResult> {
  const group: FumbblGroup = input.fromAd ? { id: input.id, name: (await fetchGroupName(input.id, fetcher)) || input.name || `League ${input.id}` } : input;
  const tournaments = parseGroupTournaments(await fetchJson(`${FUMBBL_SITE}/api/group/tournaments/${group.id}`, fetcher));
  const recent = tournaments.slice(0, LEAGUE_TOURNAMENT_CAP);
  let failed = 0;
  const lists = await Promise.all(recent.map(async (t) => {
    try { return parseTournamentSchedule(await fetchJson(`${FUMBBL_SITE}/api/tournament/schedule/${t.id}`, fetcher), t.name); } catch { failed += 1; return []; }
  }));
  const seen = new Set<string>();
  const rows = lists.flat()
    .sort((x, y) => y.when.localeCompare(x.when) || (y.matchId ?? 0) - (x.matchId ?? 0))
    .filter((row) => (seen.has(row.key) ? false : (seen.add(row.key), true)))
    .slice(0, LEAGUE_MATCH_CAP);
  const result: ReplaySearchResult = { kind: 'league', query, group, rows };
  if (failed) result.notice = 'Some tournaments could not be loaded';
  return result;
}

export interface ReplaySearchContext {
  /** settings.coach - the empty-query list */
  ownCoach: string;
  fetcher: FetchLike;
  /** the raw fetch for the live /p/groups refresh, so it gets its own signal instead of the search's (Astra P2-2) */
  liveFetch?: AbortableFetch;
}

/**
 * One way of reading the search text. `accepts` is the cheap syntactic test; `resolve` returns the result, or null to
 * fall through to the next resolver (e.g. a number that is not a FUMBBL match id falls through to the group-id, then
 * the replay-id resolver). Resolvers run in REPLAY_SEARCH_RESOLVERS order and the first non-null result wins.
 */
export interface ReplaySearchResolver {
  kind: ReplaySearchKind;
  accepts(query: string): boolean;
  resolve(query: string, ctx: ReplaySearchContext): Promise<ReplaySearchResult | null>;
}

export const ownGamesResolver: ReplaySearchResolver = {
  kind: 'own',
  accepts: (query) => classifyQuery(query).kind === 'own',
  async resolve(_query, ctx) {
    const coach = ctx.ownCoach.trim();
    if (!coach) return { kind: 'own', query: '', coach, rows: [] };
    const { matches, teamCap } = await fetchRecentFumbblMatches(coach, ctx.fetcher);
    return { kind: 'own', query: '', coach, rows: matches.map((m) => rowFromRecent(m, coach)), ...(teamCap ? { teamCap } : {}) };
  },
};
export const matchIdResolver: ReplaySearchResolver = {
  kind: 'match',
  accepts: (query) => idAllows(classifyQuery(query), 'match'),
  async resolve(query, ctx) {
    const q = classifyQuery(query);
    if (!idAllows(q, 'match')) return null;
    const row = await fetchMatchRow(q.id, ctx.fetcher);
    if (row) return q.force ? { kind: 'match', query: normalizeQuery(query), rows: [row] } : { kind: 'match', query: String(q.id), bareId: q.id, rows: [row] };
    return q.force ? { kind: 'match', query: normalizeQuery(query), rows: [] } : null; // match:<n> never falls through
  },
};
/** A number that is not a match id but a group with tournaments -> that league (its name from /api/group/get). */
export const groupIdResolver: ReplaySearchResolver = {
  kind: 'league',
  accepts: (query) => idAllows(classifyQuery(query), 'league'),
  async resolve(query, ctx) {
    const q = classifyQuery(query);
    if (!idAllows(q, 'league')) return null;
    const empty: ReplaySearchResult = { kind: 'league', query: normalizeQuery(query), group: { id: q.id, name: `League ${q.id}` }, rows: [] };
    try {
      const tournaments = parseGroupTournaments(await fetchJson(`${FUMBBL_SITE}/api/group/tournaments/${q.id}`, ctx.fetcher));
      if (!tournaments.length) return q.force ? empty : null; // league:<n> never falls through
      const name = await fetchGroupName(q.id, ctx.fetcher);
      const result = await searchGroup({ id: q.id, name: name || `League ${q.id}` }, ctx.fetcher, q.force ? normalizeQuery(query) : String(q.id));
      if (!q.force) result.bareId = q.id;
      return result;
    } catch (error) {
      if (q.force) throw error;
      return null;
    }
  },
};
export const replayIdResolver: ReplaySearchResolver = {
  kind: 'replay',
  accepts: (query) => idAllows(classifyQuery(query), 'replay'),
  async resolve(query) {
    const q = classifyQuery(query);
    return idAllows(q, 'replay') ? { kind: 'replay', query: String(q.id), rows: [replayIdRow(q.id)] } : null;
  },
};
/** A coach FUMBBL knows -> their recent games (even none); an unknown coach falls through to the league search. */
export const coachResolver: ReplaySearchResolver = {
  kind: 'coach',
  accepts: (query) => classifyQuery(query).kind === 'coach',
  async resolve(query, ctx) {
    const q = classifyQuery(query);
    if (q.kind !== 'coach') return null;
    const { matches, found, teamCap } = await fetchRecentFumbblMatches(q.coach, ctx.fetcher);
    if (!found) return null;
    if (!matches.length) {
      // rig 10-06: "NAF" is also a FUMBBL coach (34 teams, no games) - a coach with NO games yields to leagues of the
      // same name (bundled + any merged live index; no live fetch awaited here). A coach WITH games keeps precedence.
      const leagues = matchGroups(currentLeagueIndex(), q.coach);
      if (leagues.length) return leagueResultFor(leagues, q.coach, ctx, coachNoGamesNote(q.coach));
    }
    return { kind: 'coach', query: q.coach, coach: q.coach, rows: matches.map((m) => rowFromRecent(m, q.coach)), ...(teamCap ? { teamCap } : {}) };
  },
};
/**
 * A league / group name: one match -> its games; several -> a pick list; none -> fall through ("no coach or league").
 * Owner 10-06: the bundled index answers first, with no fetch. When it matched, the live /p/groups refresh runs in the
 * background only (merging new leagues for later searches); when it did not, the refresh is awaited (a league newer
 * than the snapshot), and if that refresh failed too the result carries LEAGUE_INDEX_NOTICE.
 */
export const leagueNameResolver: ReplaySearchResolver = {
  kind: 'league',
  accepts: (query) => classifyQuery(query).kind === 'coach',
  async resolve(query, ctx) {
    const q = normalizeQuery(query);
    let matched = matchGroups(currentLeagueIndex(), query);
    if (matched.length) {
      void refreshLeagueIndex(ctx, true); // fire-and-forget; never rejects, bounded by its own timer
    } else if (await refreshLeagueIndex(ctx)) {
      const index = currentLeagueIndex();
      matched = matchGroups(index, query);
      // the live page shows some leagues as a logo only (advert text, or nothing): try those leagues' real names
      if (!matched.length) matched = matchGroups(await resolveLogoGroupNames(index, ctx.fetcher), query);
    } else {
      // the text was not a coach either: say why no league could be matched instead of a bare "not found"
      return { kind: 'none', query: q, notice: LEAGUE_INDEX_NOTICE, rows: [] };
    }
    if (!matched.length) return null;
    return leagueResultFor(matched, q, ctx);
  },
};

/** The one-line note when a known coach with no games gives way to leagues of the same name. */
export function coachNoGamesNote(coach: string): string { return `Coach ${coach} has no games — showing leagues named like ${coach}`; }
/** One matched league -> its games; several -> the pick list. An optional note leads any notice of its own. */
async function leagueResultFor(matched: readonly FumbblGroup[], query: string, ctx: ReplaySearchContext, note?: string): Promise<ReplaySearchResult> {
  const q = normalizeQuery(query);
  const result: ReplaySearchResult = matched.length === 1
    ? await searchGroup(matched[0]!, ctx.fetcher, q)
    : { kind: 'league-pick', query: q, groups: matched.slice(0, LEAGUE_PICK_CAP), rows: [] };
  if (note) result.notice = result.notice ? `${note}. ${result.notice}` : note;
  return result;
}

/** Resolution order: own games (empty); match id -> group id -> replay id (digits, or one of them by its prefix
 *  match: / league: (group:) / replay:); coach -> league name (text). */
export const REPLAY_SEARCH_RESOLVERS: readonly ReplaySearchResolver[] = [
  ownGamesResolver, matchIdResolver, groupIdResolver, replayIdResolver, coachResolver, leagueNameResolver,
];

/**
 * Resolve one search. A coach lookup that fails at the HTTP level throws (the pane shows the error); text that is
 * neither a known coach nor a league resolves to kind 'none'.
 */
export async function runReplaySearch(
  raw: string,
  ownCoach: string,
  fetcher: FetchLike,
  resolvers: readonly ReplaySearchResolver[] = REPLAY_SEARCH_RESOLVERS,
  options: { liveFetch?: AbortableFetch } = {},
): Promise<ReplaySearchResult> {
  const query = normalizeQuery(raw);
  const ctx: ReplaySearchContext = { ownCoach, fetcher, ...(options.liveFetch ? { liveFetch: options.liveFetch } : {}) };
  for (const resolver of resolvers) {
    if (!resolver.accepts(query)) continue;
    const result = await resolver.resolve(query, ctx);
    if (result) return result;
  }
  return { kind: 'none', query, rows: [] };
}

/**
 * What a row's centre shows. Hide-scores (or an unknown score) -> no score ("vs") and no result art; otherwise the
 * score and the W/L/D from the LEFT side, exactly like My Recent Games.
 */
export function maskRow(row: Pick<ReplayRow, 'score'>, hide: boolean): { score: { left: number; right: number } | null; result: 'W' | 'L' | 'D' | null } {
  if (hide || !row.score) return { score: null, result: null };
  return { score: row.score, result: resultLetter(row.score.left, row.score.right) };
}

// ---- one search's lifetime: a hard timeout, and abort on supersede ----

export const REPLAY_SEARCH_TIMEOUT_MS = 15_000;
export type AbortableFetch = (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;
export class ReplaySearchTimeout extends Error {
  constructor() { super('Search timed out'); this.name = 'ReplaySearchTimeout'; }
}

/**
 * Run one search with every request bound to `controller` (abort it to cancel the search, e.g. when a newer search
 * starts). After `ms` the controller is aborted and the promise rejects with ReplaySearchTimeout - even if some
 * request ignores the abort, the search itself always settles.
 */
export function withSearchTimeout<T>(
  run: (fetcher: FetchLike) => Promise<T>,
  baseFetch: AbortableFetch,
  ms: number = REPLAY_SEARCH_TIMEOUT_MS,
  controller: AbortController = new AbortController(),
): Promise<T> {
  const fetcher: FetchLike = (input) => baseFetch(input, { signal: controller.signal });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new ReplaySearchTimeout()); }, ms);
  });
  return Promise.race([run(fetcher), timeout]).finally(() => clearTimeout(timer));
}

// ---- league rows: progressive enrichment from /api/match/get (owner 10-06) ----
// Tournament schedules carry team names only. Each played league row is filled in from its match record (coach,
// race / roster, TV - and the replay id when the schedule lacked it), a few requests at a time, cached per session.

export const ENRICH_CONCURRENCY = 4;
const enrichedMatches = new Map<number, ReplayRow>();
export function resetLeagueEnrichmentCache(): void { enrichedMatches.clear(); }

/** Merge a parsed match record into a league row (sides matched by team id; the row's own names win). */
export function enrichRowFromMatch(row: ReplayRow, match: ReplayRow | null): ReplayRow {
  if (!match || !match.right || !row.right) return row;
  const fill = (side: ReplayRowTeam): ReplayRowTeam => {
    const src = side.teamId && match.right!.teamId === side.teamId ? match.right! : side.teamId && match.left.teamId === side.teamId ? match.left : null;
    if (!src) return side;
    return { ...side, name: side.name || src.name, coach: side.coach || src.coach, race: side.race ?? src.race, tv: side.tv ?? src.tv };
  };
  const out: ReplayRow = { ...row, left: fill(row.left), right: fill(row.right) };
  if (!out.replayId && match.replayId) { out.replayId = match.replayId; delete out.replayLookup; }
  return out;
}

/**
 * Fill league rows in place via `onRow(index, row)` as each match record lands. Rows already complete or cached are
 * filled without a request; a failed request leaves its row untouched (and is not cached, so a later search retries).
 * Stops issuing requests once `isCancelled()` turns true (a newer search / leaving the pane).
 */
export async function enrichLeagueRows(
  rows: readonly ReplayRow[],
  fetcher: FetchLike,
  onRow: (index: number, row: ReplayRow) => void,
  isCancelled: () => boolean = () => false,
): Promise<void> {
  const todo: number[] = [];
  rows.forEach((row, i) => {
    if (!row.matchId || (row.left.coach && row.right?.coach)) return;
    const cached = enrichedMatches.get(row.matchId);
    if (cached) onRow(i, enrichRowFromMatch(row, cached));
    else todo.push(i);
  });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < todo.length && !isCancelled()) {
      const i = todo[next++]!;
      const row = rows[i]!;
      const match = await fetchMatchRow(row.matchId!, fetcher);
      if (!match || isCancelled()) continue;
      enrichedMatches.set(row.matchId!, match);
      onRow(i, enrichRowFromMatch(row, match));
    }
  };
  await Promise.all(Array.from({ length: Math.min(ENRICH_CONCURRENCY, todo.length) }, worker));
}
