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
 * Owner 11-12: the Coach Stats pane's "Sync FUMBBL games" button (coachStatsSync.ts) also adds records: the logged-in
 * coach's recent FUMBBL games, built through the same coachGameRecord from a cached Details snapshot or a replay
 * download, marked `synced`, ordered by when they were played.
 *
 * Privacy: the history is stored locally and never attached to a bug report. Nothing in this file makes a network
 * request; the only network use behind the history is that sync button (only on a press: the FUMBBL match list and
 * replay downloads the Play and Replay blades already make).
 */
import { reactive } from 'vue';
import type { GameJson } from '@fumbbl40k/ffb-protocol';
import type { DiceTally } from './diceStats';
import type { Likelihood } from './diceLuck';
import { teamStatTotals } from './gameStatRows';
import { coachNameKey } from './fumbblCoachProfile';
import { STORED_KIND_MAX_COUNT, validKinds } from './diceLuck';
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
/** Owner 11-04: the per-game counts a record carries in `stats`, in the panel's PER GAME order. All but `dodges` are
 *  the end screen's Statistics totals (gameStatRows.teamStatTotals over the server's PlayerResults); `dodges` is the
 *  Statistics pane's Dodges attempts (the dice tally's `dodges`, one per first dodge roll the server reported). */
export const COACH_STAT_KEYS = ['touchdowns', 'casualties', 'blocks', 'fouls', 'dodges', 'spp'] as const;
export type CoachStatKey = typeof COACH_STAT_KEYS[number];
export type CoachStatPair = { for: number; against: number };

/** One Dice pane row's Likelihood, as stored (the fields the stats read; `zShown` > 0 = lucky, the pane's sign). */
export type CoachLuckFigure = Pick<Likelihood, 'measured' | 'n' | 'score' | 'expected' | 'z' | 'zShown' | 'average'>;

export interface CoachGameRecord {
  gameId: string;
  /** The server's finished stamp as it sent it (null when the final frame carried none). */
  finished: string | null;
  /** ms epoch when this client saw the final result, or for a `synced` record when the game was played (orders the
   *  history; the footer's "since" date). */
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
  /** Owner 11-04: OPTIONAL (records written before it have none, and still load): mine / the opponent's count of each
   *  COACH_STAT_KEYS stat. Never part of the record check; a reader takes only well-formed pairs. */
  stats?: Partial<Record<CoachStatKey, CoachStatPair>>;
  /** Owner 11-04: OPTIONAL - my team's Action dice row split by roll kind (the server report id; a Leap / Pogo jump is
   *  `leapRoll:leap`): the sub-bucket diceStats keeps alongside the action bucket, so the kinds sum to the Action row. */
  actionKinds?: Record<string, CoachActionKind>;
  /** Owner 11-04: OPTIONAL - the opponent's FUMBBL Coach Rating as the game-load rank bar fetched it (no request of its
   *  own); absent when the bar did not run, the lookup failed, or the server is not FUMBBL's. */
  opponentCr?: number;
  /** Owner 11-04: OPTIONAL - the KO recovery rolls of my team (`for`) and the opponent's (`against`) in this game, from
   *  the turnEnd reports' knockoutRecoveryArray (diceStats koRecovery). Old records have none. */
  koRecovery?: { for?: CoachActionKind; against?: CoachActionKind };
  /** Owner 11-12: OPTIONAL - set on a record the Coach Stats sync added rather than the end of a game played here:
   *  'details' = built from a cached end-of-game Details snapshot, 'replay' = from a downloaded replay. Its `savedAt` is
   *  when the game was played (the snapshot's settle time, or the server's finished stamp). Absent on played records. */
  synced?: 'details' | 'replay';
  luck: Record<CoachLuckKey, CoachLuckFigure>;
  /** The Armour row's counters: the team's armour rolls against the opponent, broken, and the fair expectation. */
  armourBreaks: { actual: number; rolls: number; expected: number } | null;
}

/** One roll kind's luck bucket as stored: the measured trials (n, x6 in sixths, the fair-distribution kinds), the rolls
 *  seen but not measured, and the passed / expected counters - enough to rebuild the bucket and merge it across games. */
export interface CoachActionKind { n: number; x6: number; unmeasured: number; kinds: Record<string, number>; passed: number; expected: number }

/** Owner 11-04: the opponent's CR as the rank bar's lookup found it, for ONE game on ONE server (Sol r1 P2). */
export interface CoachOpponentCr { serverId: string; gameId: string; coach: string; cr: number }

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
  /** owner 11-04: the rank bar's lookup of the opponent (gameLoadRankPanel.rankPanelOpponentCr); kept only when its
   *  server, game and opponent are this record's (Sol r1 P2) */
  opponentCr?: CoachOpponentCr | null;
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
  const kindBuckets = tally.luck?.actionKinds;
  const actionKinds = kindBuckets ? Object.fromEntries(Object.entries(kindBuckets).map(([kind, b]) => [kind, {
    n: b.n, x6: b.x6, unmeasured: b.unmeasured, kinds: { ...b.kinds }, passed: count(b.c.passed), expected: count(b.c.expected),
  } satisfies CoachActionKind])) : null;
  const bucketOf = (b: { n: number; x6: number; unmeasured: number; kinds: Record<string, number>; c: Record<string, number> } | undefined): CoachActionKind | undefined =>
    b && b.n + b.unmeasured > 0 ? { n: b.n, x6: b.x6, unmeasured: b.unmeasured, kinds: { ...b.kinds }, passed: count(b.c.passed), expected: count(b.c.expected) } : undefined;
  const koFor = bucketOf(tally.luck?.koRecovery), koAgainst = bucketOf(input.tallies[oppSide]?.luck?.koRecovery);
  const koRecovery = koFor || koAgainst ? { ...(koFor ? { for: koFor } : {}), ...(koAgainst ? { against: koAgainst } : {}) } : null;
  const oppCoach = text(team(oppSide)?.coach);
  const opponentCr = crMatches(input.opponentCr, input.serverId, String(game.gameId), oppCoach) ? input.opponentCr!.cr : null;
  const stats: Partial<Record<CoachStatKey, CoachStatPair>> = {};
  for (const key of COACH_STAT_KEYS) {
    if (key === 'dodges') {
      const mine = input.tallies[mySide]?.dodges, theirs = input.tallies[oppSide]?.dodges;
      if (Number.isFinite(mine) && Number.isFinite(theirs)) stats.dodges = { for: mine, against: theirs };
    } else stats[key] = { for: count(myTotals[key]), against: count(theirTotals[key]) };
  }
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
    stats,
    ...(actionKinds ? { actionKinds } : {}),
    ...(koRecovery ? { koRecovery } : {}),
    ...(opponentCr != null ? { opponentCr } : {}),
  };
}

/** The CR lookup belongs to this game: the same server identity, the same gameId and the same opponent (Sol r1 P2). */
function crMatches(found: CoachOpponentCr | null | undefined, serverId: string, gameId: string, opponent: string): boolean {
  return !!found && typeof found.cr === 'number' && Number.isFinite(found.cr) && found.serverId === serverId && String(found.gameId) === gameId
    && !!opponent && coachNameKey(found.coach) === coachNameKey(opponent);
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

/** Sol r2: a stored bucket - finite counters, and `kinds` exactly as the writer makes them (validKinds: every
 *  distribution key parses to the writer's grammar, counts positive integers) whose counts add up to `n`. */
const isActionKind = (v: unknown): boolean => isObj(v) && isNum(v.n) && isNum(v.x6) && isNum(v.unmeasured) && isNum(v.passed) && isNum(v.expected)
  && validKinds(v.kinds, STORED_KIND_MAX_COUNT) && Object.values(v.kinds).reduce((a, c) => a + c, 0) === v.n;
/**
 * Sol r1 P1: the OPTIONAL fields (`stats`, `actionKinds`, `opponentCr`, `koRecovery`, `synced`) are never part of the record check; a malformed
 * one is DROPPED from the record (a malformed entry inside `stats` / `actionKinds` drops just that entry) and the rest
 * of the record stays. Applied to every record read (file, localStorage) and every record written.
 */
export function sanitizeCoachRecord(r: CoachGameRecord): CoachGameRecord {
  const raw = r as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...raw };
  delete out.stats; delete out.actionKinds; delete out.opponentCr; delete out.koRecovery; delete out.synced;
  if (raw.synced === 'details' || raw.synced === 'replay') out.synced = raw.synced;
  if (isObj(raw.koRecovery)) {
    const ko = Object.fromEntries(Object.entries(raw.koRecovery).filter(([side, k]) => (side === 'for' || side === 'against') && isActionKind(k)));
    if (Object.keys(ko).length) out.koRecovery = ko;
  }
  if (isObj(raw.stats)) {
    const stats = Object.fromEntries(Object.entries(raw.stats).filter(([key, pair]) => (COACH_STAT_KEYS as readonly string[]).includes(key) && isPair(pair)));
    if (Object.keys(stats).length) out.stats = stats;
  }
  if (isObj(raw.actionKinds)) {
    const kinds = Object.fromEntries(Object.entries(raw.actionKinds).filter(([, k]) => isActionKind(k)));
    if (Object.keys(kinds).length) out.actionKinds = kinds;
  }
  if (isNum(raw.opponentCr)) out.opponentCr = raw.opponentCr;
  return out as unknown as CoachGameRecord;
}

/** The text as a history: its valid records and how many it holds that are not; null = not a history at all. */
export function readCoachHistory(raw: string): { games: CoachGameRecord[]; invalid: number } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!isObj(parsed) || parsed.version !== COACH_HISTORY_VERSION || !Array.isArray(parsed.games)) return null;
  const games = parsed.games.filter(isCoachGameRecord).map(sanitizeCoachRecord);
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
  /** Sol r1 P3: sets ONLY `opponentCr` on the stored record of (serverId, gameId) when that record exists, names this
   *  opponent and has none yet; nothing else changes. Resolves whether it patched. */
  patchOpponentCr?(found: CoachOpponentCr): Promise<boolean>;
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
        if (isCoachGameRecord(value) && key === COACH_HISTORY_KEY_PREFIX + historyKey(value)) out.push({ key, record: sanitizeCoachRecord(value) });
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
    async patchOpponentCr(found) {
      const s = need();
      const key = COACH_HISTORY_KEY_PREFIX + historyKey({ serverId: found.serverId, gameId: found.gameId });
      try {
        let value: unknown = null;
        try { value = JSON.parse(s.getItem(key) ?? 'null'); } catch { return false; }
        if (!isCoachGameRecord(value) || isNum((value as { opponentCr?: unknown }).opponentCr)) return false;
        if (!crMatches(found, value.serverId, value.gameId, value.opponent.coach)) return false;
        s.setItem(key, JSON.stringify({ ...(value as object), opponentCr: found.cr }));
        return true;
      } catch (error) { throw new CoachHistoryUnavailable(`write failed: ${String(error)}`); }
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
    // Sol r1 P3: the shell's locked patch; a shell from before the command patches nothing on disk (the session copy
    // still shows the CR) and never counts as "no history commands" for load / append
    patchOpponentCr: async (found) => {
      if (olderShell) return (await fallback.patchOpponentCr?.(found)) === true;
      try {
        return await invokeShell<boolean>('coach_history_patch_opponent_cr', { serverId: found.serverId, gameId: found.gameId, coach: found.coach, cr: found.cr }) === true;
      } catch (error) {
        if (isShellHistoryError(error)) throw new CoachHistoryUnavailable(String((error as { message?: unknown })?.message ?? error));
        return false;
      }
    },
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

/**
 * Owner 11-12 (coach stats sync review 3): re-reads the STORED history into `coachHistory.games`, replacing this
 * window's in-memory copy, so games another window wrote since this one loaded are seen (the sync dedupes against
 * them). Queued on the same chain as appends. Resolves whether the store was read; with the store unavailable (memory
 * only) the in-memory copy stays as it is. Never throws. Nothing else calls it: the end-of-game path is unchanged.
 */
export function refreshCoachHistory(): Promise<boolean> {
  return ensureCoachHistoryLoaded().then(() => (chain = chain.then(async () => {
    if (!coachHistory.persisting) return false;
    try {
      const loaded = await store().load();
      if (loaded.state === 'ok') showStored(loaded.text);
      // no stored history (never written, removed, or unreadable and moved aside): the store holds no games, and
      // neither may this window's copy, or the sync would skip games as already held that a restart would not show
      else coachHistory.games = [];
      return true;
    } catch (error) { goMemoryOnly(error); return false; }
  })) as Promise<boolean>);
}

/**
 * Sol r1 P3: a CR that arrives AFTER its game's record was written (the game ended - a concession - before the rank
 * bar's lookup answered). Patches ONLY `opponentCr` into that record, in memory and through the backend's own locked
 * write, when the record exists for this server + game, names this opponent and has no CR yet. No request; never an
 * append (no dedupe bypass). A record not written yet is left alone: its write reads the CR itself (store.ts).
 */
export function patchCoachGameOpponentCr(found: CoachOpponentCr): Promise<boolean> {
  if (!found || !isNum(found.cr)) return Promise.resolve(false);
  return ensureCoachHistoryLoaded().then(() => (chain = chain.then(async () => {
    const key = historyKey({ serverId: found.serverId, gameId: found.gameId });
    const at = coachHistory.games.findIndex((g) => historyKey(g) === key);
    const held = at >= 0 ? coachHistory.games[at]! : null;
    if (!held || isNum(held.opponentCr) || !crMatches(found, held.serverId, held.gameId, held.opponent.coach)) return false;
    const games = [...coachHistory.games];
    games[at] = { ...held, opponentCr: found.cr };
    coachHistory.games = games;
    if (!coachHistory.persisting) return false;
    try { return (await store().patchOpponentCr?.(found)) === true; } catch (error) { goMemoryOnly(error); return false; }
  })) as Promise<boolean>);
}

/** Owner 11-12 (coach stats sync review 4): what one append did. 'written' = the store saved it; 'duplicate' = the
 *  store already held a record for this server + game and kept that one; 'unsaved' = nothing was persisted (the store
 *  is unavailable or the write failed) - the game is shown this session only and a restart loses it. */
export type CoachAppendOutcome = 'written' | 'duplicate' | 'unsaved';

/** Appends one finished game and says what happened (appendCoachGame's richer twin; same chain, same merge). */
export function appendCoachGameOutcome(record: CoachGameRecord): Promise<CoachAppendOutcome> {
  record = sanitizeCoachRecord(record);
  return ensureCoachHistoryLoaded().then(() => (chain = chain.then(async (): Promise<CoachAppendOutcome> => {
    const remember = () => { const next = withCoachGame(coachHistory.games, record); if (next) coachHistory.games = next; };
    if (!coachHistory.persisting) { remember(); return 'unsaved'; }
    try {
      const { written, text } = await store().append([record]);
      showStored(text);
      return written > 0 ? 'written' : 'duplicate';
    } catch (error) {
      goMemoryOnly(error);
      remember();
      return 'unsaved';
    }
  })) as Promise<CoachAppendOutcome>);
}

/** Appends one finished game (the store's merge, never a whole-history write). Resolves whether it was stored; with
 *  the store unavailable the game is still shown this session (memory only). The live end-of-game path's API. */
export function appendCoachGame(record: CoachGameRecord): Promise<boolean> {
  return appendCoachGameOutcome(record).then((outcome) => outcome === 'written');
}
