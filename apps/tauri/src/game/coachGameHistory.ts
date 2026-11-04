/**
 * Owner 11-03 (spec-coach-card-stats-2026-11-03.md): the LOCAL game history behind the Play screen's coach card stats.
 *
 * One summary record per game the local user PLAYED (a coach seat - never a spectated or replayed game), written once
 * per game when it reaches its final result (store.ts, the end-game settle: the moment the end screen's numbers are
 * final). Every field is server-derived, through the end screen's own code:
 *   - result and score: the server's game result (teamResult score + conceded, the server's own concession record);
 *   - TDs and casualties: teamStatTotals, the end screen's Statistics rows (gameStatRows.ts);
 *   - luck: pgLikelihoodRows, the end screen's Dice pane rows (postGameProjection.ts over diceStats / diceLuck): the
 *     All dice, Block, Armour and Action rows' Likelihood, as the pane computes them;
 *   - armour breaks: the Armour row's own counters (broken / rolls / expected), the numbers the pane prints.
 *
 * Storage: `coach-history.json` in the app data directory (src-tauri/src/coach_history.rs). Every append is ONE locked
 * read -> dedupe -> merge -> cap -> atomic write in the shell, so two windows never lose each other's games. In the web
 * preview / dev, or with a shell that predates these commands, localStorage stands in with one key per game (a write
 * never replaces another window's games). Capped to the latest 200 games; a version field. A corrupt store is quarantined before anything
 * replaces it; storage that cannot be read keeps the session's games in memory only. Never a throw, never a wait on the
 * end screen.
 *
 * Privacy: LOCAL ONLY. Nothing here makes a network request, and the history is never attached to a bug report.
 */
import { reactive } from 'vue';
import type { GameJson } from '@fumbbl40k/ffb-protocol';
import type { DiceTally } from './diceStats';
import type { Likelihood } from './diceLuck';
import { teamStatTotals } from './gameStatRows';
import { pgLikelihoodRows } from './postGameProjection';

export const COACH_HISTORY_VERSION = 1;
export const COACH_HISTORY_CAP = 200;
/** The localStorage fallback (web / dev, or an older shell without the history commands): one key per game, this
 *  prefix + `<serverId>|<gameId>`. */
export const COACH_HISTORY_KEY_PREFIX = 'superFumbbl.coachHistory.v1.';

export type CoachResult = 'W' | 'D' | 'L';
export type CoachServerKind = 'fumbbl' | 'super';
export type CoachLuckKey = 'all' | 'block' | 'armour' | 'action';
export const COACH_LUCK_KEYS: readonly CoachLuckKey[] = ['all', 'block', 'armour', 'action'];

/** One Dice pane row's Likelihood, as stored (the fields the stats read; `zShown` > 0 = lucky, the pane's sign). */
export type CoachLuckFigure = Pick<Likelihood, 'measured' | 'n' | 'score' | 'expected' | 'z' | 'zShown' | 'average'>;

export interface CoachGameRecord {
  gameId: string;
  /** The server's finished stamp as it sent it (null when the final frame carried none). */
  finished: string | null;
  /** ms epoch when this client saw the final result (orders the history; the footer's "since" date). */
  savedAt: number;
  /** The server target ('fumbbl', 'fork', a local one ...) and the FUMBBL / Super FUMBBL kind the filter reads. */
  server: string;
  /** The server's identity for the dedupe (target id + host): two Super FUMBBL servers never share game ids. */
  serverId: string;
  serverKind: CoachServerKind;
  ruleset: string;
  /** The local coach's name as the server sent it on that seat (the card shows only the records of its own coach). */
  coach: string;
  myTeam: { name: string; race: string };
  opponent: { coach: string; name: string; race: string };
  result: CoachResult;
  score: { for: number; against: number };
  /** Who conceded, as the server recorded it (null = nobody). */
  conceded: 'me' | 'opponent' | null;
  tds: { for: number; against: number };
  cas: { for: number; against: number };
  luck: Record<CoachLuckKey, CoachLuckFigure>;
  /** The Armour row's counters: the team's armour rolls against the opponent, broken, and the fair expectation. */
  armourBreaks: { actual: number; rolls: number; expected: number } | null;
}

export interface CoachHistoryFile { version: typeof COACH_HISTORY_VERSION; games: CoachGameRecord[] }

type Side = 'home' | 'away';

export function serverKindOf(server: string): CoachServerKind {
  return server === 'fumbbl' ? 'fumbbl' : 'super';
}

function rulesetOf(game: GameJson): string {
  const value = game.gameOptions?.gameOptionArray?.find((option) => option?.gameOptionId === 'rulesVersion')?.gameOptionValue;
  return typeof value === 'string' ? value : '';
}
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const count = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0);

function luckFigure(like: Likelihood): CoachLuckFigure {
  return { measured: like.measured, n: like.n, score: like.score, expected: like.expected, z: like.z, zShown: like.zShown, average: like.average };
}

/**
 * The record for one finished game, from the end screen's own inputs (the settled game JSON and the side's dice tally)
 * through the end screen's own projections. `mySide` = the local coach's seat. Null without a game result.
 */
export function coachGameRecord(input: {
  game: GameJson; tallies: { home: DiceTally; away: DiceTally }; mySide: Side; server: string; serverId: string; savedAt: number;
}): CoachGameRecord | null {
  const { game, mySide } = input;
  const result = game?.gameResult;
  if (!result?.teamResultHome || !result.teamResultAway) return null;
  const oppSide: Side = mySide === 'home' ? 'away' : 'home';
  const team = (side: Side) => (side === 'home' ? game.teamHome : game.teamAway) as unknown as Record<string, unknown> | undefined;
  const teamResult = (side: Side) => (side === 'home' ? result.teamResultHome : result.teamResultAway);
  const mine = teamResult(mySide), theirs = teamResult(oppSide);
  const scoreFor = count(mine.score), scoreAgainst = count(theirs.score);
  const conceded = mine.conceded === true && theirs.conceded !== true ? 'me' : theirs.conceded === true && mine.conceded !== true ? 'opponent' : null;
  // The server's concession record decides; otherwise its final score (BB2020+ already scores a concession as a win).
  const outcome: CoachResult = conceded === 'me' ? 'L' : conceded === 'opponent' ? 'W' : scoreFor > scoreAgainst ? 'W' : scoreFor < scoreAgainst ? 'L' : 'D';
  const myTotals = teamStatTotals(game, mySide), theirTotals = teamStatTotals(game, oppSide);
  const tally = input.tallies[mySide];
  const rows = pgLikelihoodRows(tally);
  const row = (key: CoachLuckKey) => luckFigure(rows.find((r) => r.key === key)!.like);
  const armour = tally.luck?.armour.c;
  return {
    gameId: String(game.gameId),
    finished: typeof game.finished === 'string' ? game.finished : null,
    savedAt: input.savedAt,
    server: input.server,
    serverId: input.serverId,
    serverKind: serverKindOf(input.server),
    ruleset: rulesetOf(game),
    coach: text(team(mySide)?.coach),
    myTeam: { name: text(team(mySide)?.teamName), race: text(team(mySide)?.race) },
    opponent: { coach: text(team(oppSide)?.coach), name: text(team(oppSide)?.teamName), race: text(team(oppSide)?.race) },
    result: outcome,
    score: { for: scoreFor, against: scoreAgainst },
    conceded,
    tds: { for: myTotals.touchdowns ?? 0, against: theirTotals.touchdowns ?? 0 },
    cas: { for: myTotals.casualties ?? 0, against: theirTotals.casualties ?? 0 },
    luck: { all: row('all'), block: row('block'), armour: row('armour'), action: row('action') },
    armourBreaks: armour ? { actual: count(armour.theirBroken), rolls: count(armour.theirRolls), expected: count(armour.theirExpected) } : null,
  };
}

// ---- record format ----

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isPair = (v: unknown) => isObj(v) && isNum(v.for) && isNum(v.against);
function isLuck(v: unknown): boolean {
  return isObj(v) && typeof v.measured === 'boolean' && typeof v.average === 'boolean'
    && isNum(v.n) && isNum(v.score) && isNum(v.expected) && isNum(v.z) && isNum(v.zShown);
}

/** Every field the card, the panel and the dedupe read, checked per record (Sol r1 P4): strings are strings, numbers
 *  finite, enums one of theirs, serverId present. A record failing any check is never shown, merged or capped away. The
 *  shell checks the same fields (src-tauri/src/coach_history.rs valid_record). */
export function isCoachGameRecord(value: unknown): value is CoachGameRecord {
  if (!isObj(value)) return false;
  const r = value;
  const team = r.myTeam, opp = r.opponent, luck = r.luck, breaks = r.armourBreaks;
  return isStr(r.gameId) && r.gameId !== '' && isStr(r.serverId) && r.serverId !== '' && isNum(r.savedAt)
    && (r.finished === null || isStr(r.finished))
    && isStr(r.server) && (r.serverKind === 'fumbbl' || r.serverKind === 'super')
    && isStr(r.ruleset) && isStr(r.coach)
    && isObj(team) && isStr(team.name) && isStr(team.race)
    && isObj(opp) && isStr(opp.coach) && isStr(opp.name) && isStr(opp.race)
    && (r.result === 'W' || r.result === 'D' || r.result === 'L')
    && (r.conceded === null || r.conceded === 'me' || r.conceded === 'opponent')
    && isPair(r.score) && isPair(r.tds) && isPair(r.cas)
    && isObj(luck) && COACH_LUCK_KEYS.every((k) => isLuck(luck[k]))
    && (breaks === null || (isObj(breaks) && isNum(breaks.actual) && isNum(breaks.rolls) && isNum(breaks.expected)));
}

/** The text as a history: its valid records and how many it holds that are not; null = not a history at all. */
export function readCoachHistory(raw: string): { games: CoachGameRecord[]; invalid: number } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!isObj(parsed) || parsed.version !== COACH_HISTORY_VERSION || !Array.isArray(parsed.games)) return null;
  const games = parsed.games.filter(isCoachGameRecord);
  return { games, invalid: parsed.games.length - games.length };
}

/** The text's valid records as a history; null = corrupt (unparseable, not a history, or an unknown version). */
export function parseCoachHistory(raw: string): CoachHistoryFile | null {
  const read = readCoachHistory(raw);
  return read ? { version: COACH_HISTORY_VERSION, games: read.games } : null;
}

/** One game on one server: the server's identity (target + host, Sol r1 P5) and the game id. `serverKind` only filters. */
export const historyKey = (r: Pick<CoachGameRecord, 'serverId' | 'gameId'>): string => `${r.serverId}|${r.gameId}`;

/** `games` + `record`, oldest first, one record per game, the latest COACH_HISTORY_CAP kept. Null = already held. */
export function withCoachGame(games: readonly CoachGameRecord[], record: CoachGameRecord): CoachGameRecord[] | null {
  const key = historyKey(record);
  if (games.some((g) => historyKey(g) === key)) return null;
  return [...games, record].sort((a, b) => a.savedAt - b.savedAt).slice(-COACH_HISTORY_CAP);
}

/** Both histories as one: one record per game (the file's copy wins), the newest COACH_HISTORY_CAP kept. */
export function mergeCoachHistories(file: readonly CoachGameRecord[], local: readonly CoachGameRecord[]): CoachGameRecord[] {
  const byKey = new Map<string, CoachGameRecord>();
  for (const g of [...local, ...file]) byKey.set(historyKey(g), g);
  return [...byKey.values()].sort((a, b) => a.savedAt - b.savedAt).slice(-COACH_HISTORY_CAP);
}

const historyText = (games: readonly CoachGameRecord[]): string => JSON.stringify({ version: COACH_HISTORY_VERSION, games });

// ---- storage ----

/** Storage that could not be read or written (not "no history yet"): this session keeps its games in memory only. */
export class CoachHistoryUnavailable extends Error {}

export type CoachHistoryLoad = { state: 'missing' } | { state: 'corrupt' } | { state: 'ok'; text: string };

/**
 * Where the history lives. Every backend merges INSIDE its own append, so no caller ever writes a whole history it read
 * earlier.
 *  - load: 'missing' (none yet), 'corrupt' (the shell file was not a history; it was moved aside), 'ok' + the text.
 *    Throws CoachHistoryUnavailable when the store cannot be read.
 *  - append: merges `records` in; resolves how many were new and the history as now stored.
 */
export interface CoachHistoryBackend {
  load(): Promise<CoachHistoryLoad>;
  append(records: readonly CoachGameRecord[]): Promise<{ written: number; text: string }>;
}

export type CoachHistoryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/**
 * The web / dev fallback, and the store of an app patch on a shell without the history commands: ONE localStorage key
 * per game (Sol r2 P1), `superFumbbl.coachHistory.v1.<serverId>|<gameId>` holding that record's JSON. Writing a game
 * sets only its own key, so two windows can never overwrite each other's games; reading scans the prefix. The cap
 * removes the oldest VALID keys beyond 200 (a race there can only drop old games). A key that does not hold a valid
 * record is left exactly where it is and skipped: it never hides or blocks the valid ones (Sol r2 P3).
 */
export function localStorageCoachHistoryBackend(storage: CoachHistoryStorage | null = typeof localStorage !== 'undefined' ? localStorage : null): CoachHistoryBackend & {
  /** The valid per-game entries with their keys (the migration's snapshot); null when localStorage cannot be read. */
  entries(): { key: string; record: CoachGameRecord }[] | null;
  /** Removes exactly these keys. */
  remove(keys: readonly string[]): void;
} {
  const need = (): CoachHistoryStorage => { if (!storage) throw new CoachHistoryUnavailable('no localStorage'); return storage; };
  const scan = (): { key: string; record: CoachGameRecord }[] => {
    const s = need();
    try {
      const keys: string[] = [];
      for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k?.startsWith(COACH_HISTORY_KEY_PREFIX)) keys.push(k); }
      const out: { key: string; record: CoachGameRecord }[] = [];
      for (const key of keys) {
        let value: unknown = null;
        try { value = JSON.parse(s.getItem(key) ?? 'null'); } catch { value = null; }
        if (isCoachGameRecord(value) && key === COACH_HISTORY_KEY_PREFIX + historyKey(value)) out.push({ key, record: value });
      }
      return out.sort((a, b) => a.record.savedAt - b.record.savedAt);
    } catch (error) { throw new CoachHistoryUnavailable(String(error)); }
  };
  return {
    async load() {
      const held = scan();
      return held.length ? { state: 'ok', text: historyText(held.map((e) => e.record)) } : { state: 'missing' };
    },
    async append(records) {
      const s = need();
      let written = 0;
      try {
        for (const record of records) {
          const key = COACH_HISTORY_KEY_PREFIX + historyKey(record);
          if (s.getItem(key) != null) continue; // this game is held (or its key holds bytes we keep untouched)
          s.setItem(key, JSON.stringify(record));
          written++;
        }
      } catch (error) { throw new CoachHistoryUnavailable(`write failed: ${String(error)}`); }
      let held = scan();
      if (held.length > COACH_HISTORY_CAP) {
        const drop = held.slice(0, held.length - COACH_HISTORY_CAP);
        try { for (const e of drop) s.removeItem(e.key); } catch { /* the cap retries on the next write */ }
        held = held.slice(drop.length);
      }
      return { written, text: historyText(held.map((e) => e.record)) };
    },
    entries() { try { return scan(); } catch { return null; } },
    remove(keys) { for (const key of keys) storage?.removeItem(key); },
  };
}

async function invokeShell<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

/** The shell's own errors start with "coach-history:"; anything else from a missing command means an older shell. */
const isShellHistoryError = (error: unknown): boolean => String((error as { message?: unknown })?.message ?? error).startsWith('coach-history:');

/**
 * The shell's file (src-tauri/src/coach_history.rs): load, and an append that reads, quarantines invalid entries,
 * dedupes, merges, caps and writes under a cross-process lock. A shell WITHOUT the commands (an app patch on an older
 * shell) uses the localStorage fallback for the session, exactly as before. A shell error is CoachHistoryUnavailable.
 *
 * MIGRATION (an app patch wrote to localStorage; a later installer brings the commands): every load snapshots the valid
 * per-game localStorage entries, appends them through the shell's locked append, and only after that succeeded removes
 * EXACTLY those keys (a game another window adds meanwhile has its own key and stays for the next load). A failed append
 * removes nothing. Invalid keys are never migrated or removed. This is also the recovery of a corrupt file: the shell
 * moved the bytes aside and the valid localStorage games go into the fresh file - no empty history is ever written.
 */
export function shellCoachHistoryBackend(fallback: ReturnType<typeof localStorageCoachHistoryBackend> = localStorageCoachHistoryBackend()): CoachHistoryBackend {
  let olderShell = false;
  const viaShell = async <T>(run: () => Promise<T>, onFallback: () => Promise<T>): Promise<T> => {
    if (olderShell) return onFallback();
    try { return await run(); } catch (error) {
      if (error instanceof CoachHistoryUnavailable) throw error;
      if (isShellHistoryError(error)) throw new CoachHistoryUnavailable(String((error as { message?: unknown })?.message ?? error));
      console.warn('[coachHistory] the shell has no history commands; using local storage', error);
      olderShell = true;
      return onFallback();
    }
  };
  const shellAppend = (records: readonly CoachGameRecord[]) => invokeShell<{ written: number; text: string }>('coach_history_append', { records: JSON.stringify(records) });
  const loadAndMigrate = async (): Promise<CoachHistoryLoad> => {
    const loaded = await invokeShell<{ state: 'missing' | 'corrupt' | 'ok'; text?: string | null } | undefined>('coach_history_load');
    // a host that answers without the command's shape (a stub runtime) is a shell without the history commands
    if (!loaded || (loaded.state !== 'missing' && loaded.state !== 'corrupt' && loaded.state !== 'ok')) throw new Error('coach_history_load: no history command');
    const snapshot = fallback.entries() ?? [];
    if (snapshot.length) {
      try {
        const { text } = await shellAppend(snapshot.map((e) => e.record));
        fallback.remove(snapshot.map((e) => e.key)); // only after the file holds them, and only those
        return { state: 'ok', text };
      } catch (error) {
        if (!isShellHistoryError(error)) throw error;
        console.warn('[coachHistory] migration write failed; the local copies are kept', error);
        const file = loaded.state === 'ok' && loaded.text ? readCoachHistory(loaded.text)?.games ?? [] : [];
        return { state: 'ok', text: historyText(mergeCoachHistories(file, snapshot.map((e) => e.record))) };
      }
    }
    return loaded.state === 'ok' ? { state: 'ok', text: loaded.text ?? '' } : { state: loaded.state };
  };
  return {
    load: () => viaShell(loadAndMigrate, () => fallback.load()),
    append: (records) => viaShell(() => shellAppend(records), () => fallback.append(records)),
  };
}

const inTauri = (): boolean => typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

let backend: CoachHistoryBackend | null = null;
function store(): CoachHistoryBackend {
  backend ??= inTauri() ? shellCoachHistoryBackend() : localStorageCoachHistoryBackend();
  return backend;
}

/** What the coach card reads. `games` oldest first (valid records only). `persisting` = false when the store could
 *  not be read or written this session: new games are kept in memory only. */
export const coachHistory = reactive<{ loaded: boolean; persisting: boolean; games: CoachGameRecord[] }>({ loaded: false, persisting: true, games: [] });

/** Test seam: a backend (null = the default) and a fresh, unloaded state. */
export function setCoachHistoryBackendForTests(next: CoachHistoryBackend | null): void {
  backend = next;
  coachHistory.loaded = false;
  coachHistory.persisting = true;
  coachHistory.games = [];
  chain = Promise.resolve();
  loading = null;
}

let chain: Promise<unknown> = Promise.resolve();
let loading: Promise<void> | null = null;

function goMemoryOnly(error: unknown): void {
  if (coachHistory.persisting) console.warn('[coachHistory] storage unavailable; this session keeps its games in memory only', error);
  coachHistory.persisting = false;
}

/** Shows the stored history's valid records (records that do not validate stay where they are, unshown). */
function showStored(text: string): void {
  const read = readCoachHistory(text);
  if (read) coachHistory.games = read.games;
}

/** Loads the history once per session (the Play card calls it on mount). Never throws. */
export function ensureCoachHistoryLoaded(): Promise<void> {
  loading ??= (chain = chain.then(async () => {
    try {
      const loaded = await store().load();
      if (loaded.state === 'ok') showStored(loaded.text);
      else if (loaded.state === 'corrupt') console.warn('[coachHistory] the stored history was unreadable; it was moved aside');
    } catch (error) { goMemoryOnly(error); }
    coachHistory.loaded = true;
  })) as Promise<void>;
  return loading;
}

/** Appends one finished game (the store's merge, never a whole-history write). Resolves whether it was stored; with
 *  the store unavailable the game is still shown this session (memory only). */
export function appendCoachGame(record: CoachGameRecord): Promise<boolean> {
  return ensureCoachHistoryLoaded().then(() => (chain = chain.then(async () => {
    const remember = () => { const next = withCoachGame(coachHistory.games, record); if (next) coachHistory.games = next; };
    if (!coachHistory.persisting) { remember(); return false; }
    try {
      const { written, text } = await store().append([record]);
      showStored(text);
      return written > 0;
    } catch (error) {
      goMemoryOnly(error);
      remember();
      return false;
    }
  })) as Promise<boolean>);
}
