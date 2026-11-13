/**
 * Owner 11-12: the Coach Stats pane's "Sync FUMBBL games" button. On a press (never on its own) it adds the logged-in
 * coach's last 30 FUMBBL games to the local game history (coachGameHistory.ts), so a new user does not start empty.
 *
 * Rulings (owner 2026-11-12):
 *  1. One sync per coach per 24 hours, remembered across restarts (localStorage, one key per coach), with a fixed expiry
 *     (a clock turned back is corrected once, not on every read). One sync on the machine at a time (a cross-window
 *     lease); the cooldown is reserved before any request and released if no download was attempted and the list was
 *     not complete. Storage that cannot keep the cooldown refuses the sync.
 *  2. Local data first: a game the history already holds is skipped before anything is fetched; a game whose end-of-game
 *     Details snapshot is still cached (postGameCache.ts, 7 days) is built from it; only the rest are downloaded.
 *  3. FUMBBL only: the button exists only while the active server is Official FUMBBL (coachSyncVisible).
 *  4. Only the logged-in coach's own games, never while another coach's stats are shown (coachSyncVisible + the record's
 *     own coach check).
 *  5. Downloads run one at a time with progress and a cancel (which also reaches the listing, itself time-limited); games
 *     imported before a cancel or a failure stay; a game that fails is skipped. A run stops when the server target or
 *     the coach changes. A partial list is imported and reported as incomplete; the team cap is reported.
 *
 * Every record comes out of coachGameRecord, the end screen's own projections (teamStatTotals, pgLikelihoodRows), so a
 * synced game's numbers are the ones playing it in this client would have recorded:
 *  - from a Details snapshot: its own settled game JSON and dice tallies (the inputs the end screen read);
 *  - from a replay download: the server's final game state, with the dice tallied by the spectator ledger's per-command
 *    step (tallyDiceCommand) over the replay's commands, folded from the replay seed (createReplaySeed /
 *    applyReplayCommand). A replay whose commands cannot be followed keeps the server's result, score and Statistics
 *    totals and leaves every dice figure unmeasured: no number is invented.
 *
 * Pure apart from what is injected (the match list, the local snapshot read, the replay download, the history, the
 * clock, the storage); the Vue panel only wires it. Requests: the FUMBBL match list the Play blade already reads, and
 * the anonymous replay download the Replay launcher already uses. Nothing else, and only the coach's own name is sent.
 */
import { reactive } from 'vue';
import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { COACH_HISTORY_CAP, coachGameRecord, historyKey, type CoachAppendOutcome, type CoachGameRecord } from './coachGameHistory';
import { coachNameKey } from './fumbblCoachProfile';
import type { FumbblRecentMatch } from './fumbblRecentMatches';
import type { PostGameSnapshot } from './postGameProjection';
import { emptyDiceStats, emptyTally, type DiceTally } from './diceStats';
import { tallyDiceCommand } from './spectatorDiceLedger';
import { turnSideIsHome } from './blastinSecondBeat';
import { applyReplayCommand, createReplaySeed, REPLAY_MODEL_COMMANDS } from './replay/replayModel';
import type { ReplayBundle } from './replay/replayLoader';
import { replayWhenMs } from './replaySearch';

export const COACH_SYNC_GAMES = 30;
export const COACH_SYNC_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** One key per coach: this prefix + coachNameKey(coach), holding the cooldown (CoachSyncCooldownRecord JSON). */
export const COACH_SYNC_KEY_PREFIX = 'superFumbbl.coachStatsSync.v1.';
/** The cross-window lease: one sync at a time on this machine (CoachSyncLeaseRecord JSON). */
export const COACH_SYNC_LEASE_KEY = 'superFumbbl.coachStatsSync.lease.v1';
/** The Web Locks name taken alongside the lease where the webview has navigator.locks. */
export const COACH_SYNC_LOCK_NAME = 'superFumbbl.coachStatsSync';
/** A lease not renewed for this long is dead (its window crashed or closed): another window may take it. */
export const COACH_SYNC_LEASE_TTL_MS = 2 * 60 * 1000;
/** The whole listing (the coach's teams + their match pages) gives up after this long. */
export const COACH_SYNC_LIST_TIMEOUT_MS = 60_000;
/** Review 4 (#2): waiting for one history refresh gives up after this long (the shell's file lock can block). */
export const COACH_SYNC_REFRESH_TIMEOUT_MS = 15_000;
/** Review 5: every other awaited step of the run is time-limited too. */
export const COACH_SYNC_STEP_TIMEOUT_MS = { lease: 10_000, snapshot: 10_000, download: 5 * 60_000, append: 15_000 } as const;
/** Each listing request gives up after this long. */
export const COACH_SYNC_REQUEST_TIMEOUT_MS = 15_000;
/** The server identity a synced FUMBBL record carries: the one an official FUMBBL seat writes (store.ts playedServerId:
 *  the target id and, for an official FUMBBL join, no kept connect URL, so no host). */
export const FUMBBL_SYNC_SERVER_ID = 'fumbbl|';

export type CoachSyncStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Side = 'home' | 'away';

// ---- visibility and cooldown ----

/** Ruling 3 + 4: only on Official FUMBBL, only for the logged-in coach's own stats. */
export function coachSyncVisible(input: { serverTarget: string; loggedInCoach: string; shownCoach: string }): boolean {
  const own = coachNameKey(input.loggedInCoach ?? '');
  return input.serverTarget === 'fumbbl' && !!own && own === coachNameKey(input.shownCoach ?? '');
}

const cooldownKey = (coach: string) => COACH_SYNC_KEY_PREFIX + coachNameKey(coach);

/**
 * The stored cooldown of one coach. `at` = when the sync started, `until` = the FIXED end of the cooldown (never
 * recomputed from the clock on a read). `reserved` = a sync is under way and has not yet attempted a replay download or
 * seen a complete list. It counts as a cooldown (24 h from its start) whether or not its lease is alive, and is removed
 * only by its own run ending cleanly with nothing consumed (review 2, #1: fail-closed).
 */
export interface CoachSyncCooldownRecord { at: number; until: number; reserved?: true }
export interface CoachSyncLeaseRecord { owner: string; coach: string; expires: number }

export type CoachSyncAvailability =
  | { state: 'available' }
  | { state: 'cooling'; until: number }
  /** another window is syncing this or another coach right now */
  | { state: 'busy'; until: number | null }
  /** the cooldown cannot be read or saved: syncing would be unenforced, so it is refused */
  | { state: 'unavailable' };

class StorageUnusable extends Error {}

function readRaw(storage: CoachSyncStorage | null, key: string): string | null {
  if (!storage) throw new StorageUnusable('no storage');
  try { return storage.getItem(key); } catch (error) { throw new StorageUnusable(String(error)); }
}
/** A write that is read back: anything else (a throw, quota, a value that did not stick) is StorageUnusable. */
function writeDurable(storage: CoachSyncStorage | null, key: string, value: string): void {
  if (!storage) throw new StorageUnusable('no storage');
  try { storage.setItem(key, value); } catch (error) { throw new StorageUnusable(String(error)); }
  if (readRaw(storage, key) !== value) throw new StorageUnusable('the value did not persist');
}

function parseCooldown(raw: string | null): CoachSyncCooldownRecord | null {
  if (raw == null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return { at: value, until: value + COACH_SYNC_COOLDOWN_MS }; // the first, never-shipped format
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  if (typeof r.at !== 'number' || !Number.isFinite(r.at) || typeof r.until !== 'number' || !Number.isFinite(r.until)) return null;
  return { at: r.at, until: r.until, ...(r.reserved === true ? { reserved: true as const } : {}) };
}

function parseLease(raw: string | null): CoachSyncLeaseRecord | null {
  if (raw == null) return null;
  try {
    const r = JSON.parse(raw) as Record<string, unknown>;
    return typeof r?.owner === 'string' && typeof r.coach === 'string' && typeof r.expires === 'number' ? { owner: r.owner, coach: r.coach, expires: r.expires } : null;
  } catch { return null; }
}
const liveLease = (lease: CoachSyncLeaseRecord | null, now: number): lease is CoachSyncLeaseRecord => !!lease && lease.expires > now;

/**
 * The stored lease, with a clock turned back corrected (review 2, #2): a lease is never valid for longer than one
 * normal lifetime from now, so a future-dated lease (a crashed window's, written before the clock moved back) is cut to
 * now + COACH_SYNC_LEASE_TTL_MS once and saved. Throws StorageUnusable when the read or that correction fails.
 */
function readLease(storage: CoachSyncStorage | null, now: number): CoachSyncLeaseRecord | null {
  const lease = parseLease(readRaw(storage, COACH_SYNC_LEASE_KEY));
  if (lease && lease.expires > now + COACH_SYNC_LEASE_TTL_MS) {
    const fixed: CoachSyncLeaseRecord = { ...lease, expires: now + COACH_SYNC_LEASE_TTL_MS };
    writeDurable(storage, COACH_SYNC_LEASE_KEY, JSON.stringify(fixed));
    return fixed;
  }
  return lease;
}

/**
 * Whether `coach` may sync now. Throws nothing: storage that cannot be read, or a clock correction that cannot be saved,
 * is 'unavailable'. A stored stamp from the future (the clock was turned back) is corrected ONCE to a fixed expiry of
 * now + 24 h and saved, so the deadline does not move on later reads; a future-dated lease likewise (readLease).
 *
 * Review 2 (#1): a reservation is a cooldown in its own right - 24 h from its start - until the run that wrote it
 * releases it on a clean end with nothing consumed. It does NOT lapse with its lease: a run whose cooldown write failed
 * after consuming the day (or a window that died mid-run) stays fail-closed.
 */
export function readCoachSyncAvailability(storage: CoachSyncStorage | null, coach: string, now: number): CoachSyncAvailability {
  if (!coachNameKey(coach)) return { state: 'unavailable' };
  try {
    const lease = readLease(storage, now);
    let record = parseCooldown(readRaw(storage, cooldownKey(coach)));
    if (record && (record.at > now || record.until > now + COACH_SYNC_COOLDOWN_MS)) {
      record = { at: now, until: now + COACH_SYNC_COOLDOWN_MS, ...(record.reserved ? { reserved: true as const } : {}) };
      writeDurable(storage, cooldownKey(coach), JSON.stringify(record));
    }
    const until = record && record.until > now ? record.until : null;
    if (liveLease(lease, now)) return { state: 'busy', until };
    if (until != null) return { state: 'cooling', until };
    return { state: 'available' };
  } catch { return { state: 'unavailable' }; }
}

/** When this coach may sync again (ms epoch), or null when it may now (or the state is not a plain cooldown). */
export function coachSyncCooldownUntil(storage: CoachSyncStorage | null, coach: string, now: number): number | null {
  const a = readCoachSyncAvailability(storage, coach, now);
  return a.state === 'cooling' ? a.until : a.state === 'busy' ? a.until : null;
}

// ---- the cross-window lease ----

type LocksLike = { request(name: string, options: { ifAvailable: true }, callback: (lock: unknown) => unknown): Promise<unknown> };

export interface CoachSyncLease {
  /** 'ok' = this window holds it; 'busy' = another window does; 'unavailable' = storage cannot hold a lease */
  acquire(): Promise<'ok' | 'busy' | 'unavailable'>;
  /** still ours (and renewed for another TTL)? False once another window took it or storage failed. */
  renew(): boolean;
  release(): void;
}

/**
 * One sync on this machine at a time. Where the webview has Web Locks, the lock is taken first (atomic across windows);
 * the localStorage lease record (owner id + expiry) is written in every case, read back, and - without Web Locks -
 * read again after a short wait so a window that wrote at the same moment is seen. A crashed window's lease expires
 * after COACH_SYNC_LEASE_TTL_MS; a running sync renews it before every request.
 */
export function createCoachSyncLease(input: {
  storage: CoachSyncStorage | null; coach: string; owner: string; now: () => number;
  locks?: LocksLike | null; settleMs?: number;
}): CoachSyncLease {
  let releaseLock: (() => void) | null = null;
  let held = false;
  const coach = coachNameKey(input.coach);
  const mine = (): boolean => {
    const lease = parseLease(readRaw(input.storage, COACH_SYNC_LEASE_KEY));
    return !!lease && lease.owner === input.owner && lease.expires > input.now();
  };
  const write = () => writeDurable(input.storage, COACH_SYNC_LEASE_KEY, JSON.stringify({ owner: input.owner, coach, expires: input.now() + COACH_SYNC_LEASE_TTL_MS } satisfies CoachSyncLeaseRecord));
  const dropLock = () => { releaseLock?.(); releaseLock = null; };
  return {
    async acquire() {
      // Only Web Locks make "one sync at a time across windows" atomic; a storage lease read back after a delay can be
      // overwritten between the read and the write. Without them there is no sync at all.
      if (!input.locks) return 'unavailable';
      if (input.locks) {
        const got = await new Promise<boolean>((resolve) => {
          input.locks!.request(COACH_SYNC_LOCK_NAME, { ifAvailable: true }, (lock) => {
            if (!lock) { resolve(false); return undefined; }
            resolve(true);
            return new Promise<void>((done) => { releaseLock = done; });
          }).catch(() => resolve(false));
        });
        if (!got) return 'busy';
      }
      try {
        const current = readLease(input.storage, input.now()); // a future-dated lease is cut to one lifetime first
        if (liveLease(current, input.now()) && current.owner !== input.owner) { dropLock(); return 'busy'; }
        write();
        if (!input.locks) {
          await new Promise((r) => setTimeout(r, input.settleMs ?? 50));
          if (!mine()) { dropLock(); return 'busy'; }
        }
        held = true;
        return 'ok';
      } catch { dropLock(); return 'unavailable'; }
    },
    renew() {
      if (!held) return false;
      try { if (!mine()) { held = false; return false; } write(); return true; } catch { held = false; return false; }
    },
    release() {
      try { if (mine()) input.storage?.removeItem(COACH_SYNC_LEASE_KEY); } catch { /* it expires on its own */ }
      held = false;
      dropLock();
    },
  };
}

// ---- building a record ----

/** The side the coach played: the row's team id, else the coach name on the team. */
function sideOf(game: GameJson, row: Pick<FumbblRecentMatch, 'myTeamId'>, coach: string): Side | null {
  const id = String(row.myTeamId ?? '');
  if (id && String(game.teamHome?.teamId) === id) return 'home';
  if (id && String(game.teamAway?.teamId) === id) return 'away';
  const key = coachNameKey(coach);
  const home = coachNameKey(String((game.teamHome as { coach?: unknown } | undefined)?.coach ?? ''));
  const away = coachNameKey(String((game.teamAway as { coach?: unknown } | undefined)?.coach ?? ''));
  if (key && home === key && away !== key) return 'home';
  if (key && away === key && home !== key) return 'away';
  return null;
}

/** When the game was played, from the server's finished stamp, else the match list's date (both site time, read as UTC
 *  as the Replay blade reads them). Null = neither parses. */
export function playedAtMs(finished: unknown, when: string | undefined): number | null {
  for (const text of [typeof finished === 'string' ? finished : '', when ?? '']) {
    if (!text) continue;
    const ms = replayWhenMs(text);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return null;
}

/** Both teams' result as the server sent it: a finite score and the player results the Statistics totals are summed
 *  from. Without them a record would read as a 0-0 draw with zero totals, numbers the server never stated. */
function resultComplete(game: GameJson): boolean {
  const result = game.gameResult;
  return [result?.teamResultHome, result?.teamResultAway].every((team) =>
    !!team && typeof team.score === 'number' && Number.isFinite(team.score) && Array.isArray(team.playerResults));
}

/** A finished game's record, or null (no result, not finished, not this coach's). */
function syncedRecord(game: GameJson, tallies: { home: DiceTally; away: DiceTally }, row: FumbblRecentMatch, coach: string,
  savedAt: number, synced: CoachSyncSource): CoachGameRecord | null {
  if (!game?.finished || !resultComplete(game)) return null;
  const mySide = sideOf(game, row, coach);
  if (!mySide) return null;
  const record = coachGameRecord({ game, tallies, mySide, server: 'fumbbl', serverId: FUMBBL_SYNC_SERVER_ID, savedAt });
  if (!record || coachNameKey(record.coach) !== coachNameKey(coach) || record.gameId !== String(row.replayId)) return null;
  return { ...record, synced };
}

export type CoachSyncSource = NonNullable<CoachGameRecord['synced']>;

/** Ruling 2: a cached end-of-game Details snapshot the record can come from. Only one whose dice tallies are the whole
 *  game: a PLAYED seat (the tallies the live record reads) or a spectated game that covered every roll. A replay seat's
 *  tallies depend on how the coach moved through it, so it is not used. */
export function snapshotUsable(snapshot: PostGameSnapshot | null, gameId: number): snapshot is PostGameSnapshot {
  if (!snapshot || snapshot.version !== 7 || snapshot.server !== 'fumbbl' || String(snapshot.gameId) !== String(gameId)) return false;
  if (!snapshot.game?.gameResult || !snapshot.game.finished || !snapshot.tallies?.home || !snapshot.tallies?.away) return false;
  if (snapshot.seat === 'play') return true;
  const coverage = snapshot.diceCoverage;
  return snapshot.seat === 'spectate' && !!coverage && !coverage.gap && (coverage.before === 'none' || coverage.before === 'imported');
}

export function recordFromSnapshot(snapshot: PostGameSnapshot, row: FumbblRecentMatch, coach: string): CoachGameRecord | null {
  // dated by when the game was played, like a replay-derived record: the cache's own savedAt can be days later
  // (a snapshot re-saved by a later Details view), which would reorder the history and its recent-game windows
  const savedAt = playedAtMs(snapshot.game?.finished, row.when);
  if (savedAt == null) return null;
  return syncedRecord(snapshot.game, snapshot.tallies, row, coach, savedAt, 'details');
}

/**
 * Both teams' dice tallies over a replay's commands, as the spectator ledger folds them (the same per-command step, in
 * order from the replay seed). Null when a command cannot be followed: the tallies would be partial.
 */
export function replayTallies(bundle: Pick<ReplayBundle, 'finalState' | 'commands'>): { home: DiceTally; away: DiceTally } | null {
  try {
    const model = createReplaySeed(bundle.finalState);
    const stats = emptyDiceStats(String(bundle.finalState.gameId));
    let ordinal = 0;
    for (const raw of bundle.commands) {
      if (!REPLAY_MODEL_COMMANDS.has(String(raw.netCommandId))) continue;
      const command = structuredClone(raw) as typeof raw;
      const homeWas = turnSideIsHome(model);
      applyReplayCommand(model, command);
      tallyDiceCommand(stats, ++ordinal, homeWas, model, command);
    }
    // A replay that stops before the final whistle (a short download, a truncated file) folds cleanly but holds only
    // part of the game's dice: it is not this game's tally.
    if (!model.finished) return null;
    return { home: stats.teams[String(model.teamHome.teamId)] ?? emptyTally(), away: stats.teams[String(model.teamAway.teamId)] ?? emptyTally() };
  } catch (error) {
    console.warn('[coachSync] replay could not be followed; the game is skipped', error);
    return null;
  }
}

/** The record from a downloaded replay: the server's final state + the folded tallies. Without tallies (a replay that
 *  could not be followed) the dice figures are left unmeasured rather than read as zero. */
export function recordFromReplay(bundle: Pick<ReplayBundle, 'finalState' | 'commands'>, row: FumbblRecentMatch, coach: string): CoachGameRecord | null {
  const game = bundle.finalState;
  const savedAt = playedAtMs(game?.finished, row.when);
  if (savedAt == null) return null;
  // No record from a replay that cannot be followed to its final whistle: the game is skipped (counted as failed) and
  // can be picked up by a later sync. A half-measured record would sit in the history as if it were the whole game.
  const tallies = replayTallies(bundle);
  if (!tallies) return null;
  return syncedRecord(game, tallies, row, coach, savedAt, 'replay');
}

// ---- the sync ----

export interface CoachSyncProgress {
  phase: 'listing' | 'syncing';
  /** 1-based position in the list (0 while listing). */
  index: number;
  total: number;
}

export type CoachSyncStatus =
  | 'done' | 'cancelled' | 'failed' | 'cooling'
  /** another window holds the sync lease (or took it over) */
  | 'busy'
  /** the cooldown cannot be read or saved: refused, never run unenforced */
  | 'unavailable'
  /** the server target or the logged-in coach changed while it ran */
  | 'stopped';

export interface CoachSyncResult {
  status: CoachSyncStatus;
  total: number;
  /** records added to the history */
  imported: number;
  /** of those, built from a local Details snapshot (no download) */
  fromLocal: number;
  /** replays downloaded */
  downloaded: number;
  /** already in the history as this coach's record (skipped before any download) */
  already: number;
  /** review 2 (#4): the history holds ANOTHER coach's record of the same game (the store keeps one record per server +
   *  game), so this coach's record cannot be stored: skipped before any download, reported in the result line */
  notAdded: number;
  /** older than every game the full history keeps (skipped: it would be capped away at once) */
  tooOld: number;
  /** games that could not be read (skipped) */
  failed: number;
  /** false = some of the coach's team match pages could not be read: the list may miss games */
  listComplete: boolean;
  /** set when only the coach's most recently active teams were read (fumbblRecentMatches RECENT_TEAM_CAP) */
  teamCap?: { shown: number; total: number };
  /** this run CONSUMED the day (a complete list, or a replay download attempted): its reservation is never released */
  cooldownApplied: boolean;
  /** review 2 (#1): the consumed cooldown was also written as a plain cooldown. False with cooldownApplied = the write
   *  failed; the reservation then stands as the cooldown (24 h from its start) and the run ended 'unavailable'. */
  cooldownSaved: boolean;
}

/** What the listing step hands back: the rows, and how complete they are. */
export interface CoachSyncListing {
  matches: FumbblRecentMatch[];
  /** team match pages requested / failed (0 / 0 = the coach has no team) */
  pagesRequested: number;
  pagesFailed: number;
  teamCap?: { shown: number; total: number };
}

export interface CoachSyncDeps {
  /** the logged-in coach */
  coach: string;
  /** the coach's recent games; must give up when `signal` aborts */
  listMatches(coach: string, signal: AbortSignal): Promise<CoachSyncListing>;
  /** re-reads the STORED history into what `history()` returns (coachGameHistory.refreshCoachHistory): another window
   *  may have written games since this one loaded. Called under the lease before deduplicating and before each download. */
  refreshHistory(): Promise<boolean>;
  /** one refresh's time limit (default COACH_SYNC_REFRESH_TIMEOUT_MS); a refresh that runs out fails the run */
  refreshTimeoutMs?: number;
  /** review 5: the other steps' time limits (defaults COACH_SYNC_STEP_TIMEOUT_MS) */
  timeouts?: Partial<Record<keyof typeof COACH_SYNC_STEP_TIMEOUT_MS, number>>;
  /** the history as it stands now (all coaches) */
  history(): readonly CoachGameRecord[];
  /** a cached Details snapshot for this FUMBBL game id, or null */
  loadSnapshot(gameId: number): Promise<PostGameSnapshot | null>;
  downloadReplay(gameId: number, signal: AbortSignal): Promise<ReplayBundle>;
  /** appends one record and says what the store did (coachGameHistory.appendCoachGameOutcome) */
  append(record: CoachGameRecord): Promise<CoachAppendOutcome>;
  /** still the server target and coach this run started for? Checked before every request and every append. */
  stillBound(): boolean;
  /** the cross-window lease (createCoachSyncLease) */
  lease: CoachSyncLease;
  now(): number;
  storage: CoachSyncStorage | null;
  signal: AbortSignal;
  onProgress?(progress: CoachSyncProgress): void;
  /** the whole listing's time limit (default COACH_SYNC_LIST_TIMEOUT_MS) */
  listTimeoutMs?: number;
}

/** Review 2 (#4): who holds this FUMBBL game in the history - this coach ('mine'), only other coaches ('other'), or
 *  nobody. Any FUMBBL server id counts (an official seat writes 'fumbbl|', older paths may carry a host). */
function heldFumbblGame(games: readonly CoachGameRecord[], gameId: number, coach: string): 'mine' | 'other' | null {
  const same = games.filter((g) => g.serverKind === 'fumbbl' && g.gameId === String(gameId));
  if (!same.length) return null;
  return same.some((g) => coachNameKey(g.coach ?? '') === coachNameKey(coach)) ? 'mine' : 'other';
}

const isAbort = (error: unknown): boolean => (error as { name?: unknown })?.name === 'AbortError';

/** A run that has to stop with this status (raised by the guards). */
class SyncStop extends Error { constructor(readonly status: CoachSyncStatus) { super(status); } }

/** The listing, bounded: it ends when it answers, when the run's signal aborts, or after `ms` - even if the listing
 *  itself ignored its signal. */
async function boundedListing(deps: CoachSyncDeps, coach: string, ms: number): Promise<CoachSyncListing> {
  const ctl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctl.abort();
  if (deps.signal.aborted) ctl.abort(); else deps.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, ms);
  const stop = new Promise<never>((_, reject) => {
    const fail = () => reject(timedOut ? new Error('the FUMBBL game list timed out') : new DOMException('cancelled', 'AbortError'));
    if (ctl.signal.aborted) fail(); else ctl.signal.addEventListener('abort', fail, { once: true });
  });
  stop.catch(() => undefined);
  try { return await Promise.race([deps.listMatches(coach, ctl.signal), stop]); } finally {
    clearTimeout(timer);
    deps.signal.removeEventListener('abort', onAbort);
  }
}

/** The outcome of one bounded step: its value, or `timedOut` when it ran past its time limit. */
type Bounded<T> = { ok: true; value: T } | { ok: false; timedOut: true };

/**
 * Review 5: the ONE rule for every awaited step of the run (lease, refresh, listing, snapshot read, download, append) -
 * it is abortable and time-limited. A cancel rejects with SyncStop('cancelled') (or 'stopped' when the server target or
 * coach changed); running past `ms` resolves `{ ok: false }` so the caller decides what a timeout means for that step.
 * The step's own signal is aborted either way (a step that honours it stops; one that cannot - an IndexedDB read, a
 * history operation queued on the history's own chain - is simply no longer waited for, and stays serialized there).
 * A step that settled first wins the race, so an outcome that is already known is never lost to a later cancel.
 */
async function bounded<T>(deps: CoachSyncDeps, step: (signal: AbortSignal) => Promise<T>, ms: number): Promise<Bounded<T>> {
  const stopStatus = (): CoachSyncStatus => (deps.stillBound() ? 'cancelled' : 'stopped');
  if (deps.signal.aborted) throw new SyncStop(stopStatus());
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let onAbort: (() => void) | null = null;
  const stop = new Promise<Bounded<T>>((resolve, reject) => {
    timer = setTimeout(() => { ctl.abort(); resolve({ ok: false, timedOut: true }); }, ms);
    onAbort = () => { ctl.abort(); reject(new SyncStop(stopStatus())); };
    deps.signal.addEventListener('abort', onAbort, { once: true });
  });
  stop.catch(() => undefined);
  try {
    return await Promise.race([Promise.resolve().then(() => step(ctl.signal)).then((value): Bounded<T> => ({ ok: true, value })), stop]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) deps.signal.removeEventListener('abort', onAbort);
  }
}

/**
 * One sync: lease, reservation, list, then each game in turn (newest first), strictly one at a time. Never throws, and
 * every await is bounded (`bounded` / boundedListing), so the run always reaches `finally`: the lease is released and an
 * unused reservation is given back.
 *
 * Cooldown (owner 11-12 review): before any request the coach's cooldown is RESERVED in storage under the cross-window
 * lease (a second window sees "busy" / "next sync"). The reservation becomes the real 24 h cooldown as soon as a replay
 * download is attempted or the list came back complete; a run that ends before either (an error, a cancel, a list that
 * failed or came back partial with nothing to download) releases it so the coach can retry. A reservation that is not
 * released (a failed promotion, or a window that died mid-run) holds as a cooldown for 24 h from its start. Storage
 * that cannot hold the cooldown refuses the sync outright, and so does a history that cannot be read back from storage
 * (review 5: the sync needs a DURABLE history; it never classifies from a record that lives only in memory).
 */
export async function runCoachStatsSync(deps: CoachSyncDeps): Promise<CoachSyncResult> {
  const result: CoachSyncResult = { status: 'done', total: 0, imported: 0, fromLocal: 0, downloaded: 0, already: 0, notAdded: 0, tooOld: 0, failed: 0, listComplete: true, cooldownApplied: false, cooldownSaved: false };
  const end = (status: CoachSyncStatus): CoachSyncResult => ({ ...result, status });
  const limit = (step: keyof NonNullable<CoachSyncDeps['timeouts']>, fallback: number) => deps.timeouts?.[step] ?? fallback;
  const coach = deps.coach.trim();
  if (!coach) return end('failed');
  if (!deps.stillBound()) return end('stopped');
  const before = readCoachSyncAvailability(deps.storage, coach, deps.now());
  if (before.state !== 'available') return end(before.state);
  if (deps.signal.aborted) return end('cancelled');

  // the lease (bounded): a lease granted after this run stopped waiting is released at once
  const acquiring = deps.lease.acquire();
  let leased: Bounded<'ok' | 'busy' | 'unavailable'>;
  try { leased = await bounded(deps, () => acquiring, limit('lease', COACH_SYNC_STEP_TIMEOUT_MS.lease)); } catch (error) {
    void acquiring.then((got) => { if (got === 'ok') deps.lease.release(); }, () => undefined);
    return end(error instanceof SyncStop ? error.status : 'failed');
  }
  if (!leased.ok) { void acquiring.then((got) => { if (got === 'ok') deps.lease.release(); }, () => undefined); return end('failed'); }
  if (leased.value !== 'ok') return end(leased.value);

  const key = cooldownKey(coach);
  let previous: string | null = null;
  let reserved = false;
  const heartbeat = setInterval(() => { deps.lease.renew(); }, Math.floor(COACH_SYNC_LEASE_TTL_MS / 4));
  const guard = (): void => {
    if (!deps.stillBound()) throw new SyncStop('stopped');
    if (deps.signal.aborted) throw new SyncStop('cancelled');
    if (!deps.lease.renew()) throw new SyncStop('busy');
  };
  // Review 2 (#1): CONSUMING the day and PERSISTING it are separate. Once consumed, the reservation is never released;
  // if the promotion write fails the run stops fail-closed and the reservation stands as the cooldown.
  const applyCooldown = (): void => {
    if (result.cooldownApplied) return;
    result.cooldownApplied = true;
    const at = deps.now();
    try { writeDurable(deps.storage, key, JSON.stringify({ at, until: at + COACH_SYNC_COOLDOWN_MS } satisfies CoachSyncCooldownRecord)); }
    catch { throw new SyncStop('unavailable'); }
    result.cooldownSaved = true;
  };
  /** Review 3/4/5: re-read the STORED history. Timed out = 'failed'; not read back from storage (memory only) = `whenNotDurable`. */
  const refresh = async (whenNotDurable: CoachSyncStatus): Promise<void> => {
    const r = await bounded(deps, () => deps.refreshHistory(), deps.refreshTimeoutMs ?? COACH_SYNC_REFRESH_TIMEOUT_MS);
    if (!r.ok) { console.warn('[coachSync] the stored history could not be read in time'); throw new SyncStop('failed'); }
    if (r.value !== true) { console.warn('[coachSync] the history cannot be read back from storage'); throw new SyncStop(whenNotDurable); }
  };
  try {
    guard(); // the lease wait was an await
    // under the lease: read again (another window may have just finished), then reserve BEFORE any request
    const now = deps.now();
    try {
      previous = readRaw(deps.storage, key);
      const record = parseCooldown(previous);
      if (record && record.until > now) return end('cooling');
      writeDurable(deps.storage, key, JSON.stringify({ at: now, until: now + COACH_SYNC_COOLDOWN_MS, reserved: true } satisfies CoachSyncCooldownRecord));
      reserved = true;
    } catch { return end('unavailable'); }

    deps.onProgress?.({ phase: 'listing', index: 0, total: 0 });
    // review 3 + 5: under the lease, before any request, dedupe against the history as STORED; a history that cannot be
    // read back from storage cannot keep what the sync adds: the run ends 'unavailable' and nothing is requested
    await refresh('unavailable');
    guard();
    let listing: CoachSyncListing;
    try { listing = await boundedListing(deps, coach, deps.listTimeoutMs ?? COACH_SYNC_LIST_TIMEOUT_MS); } catch (error) {
      if (deps.signal.aborted || isAbort(error)) throw new SyncStop(deps.stillBound() ? 'cancelled' : 'stopped');
      console.warn('[coachSync] the FUMBBL game list could not be read', error);
      return end('failed');
    }
    guard();
    if (listing.teamCap) result.teamCap = { ...listing.teamCap };
    result.listComplete = listing.pagesFailed === 0;
    if (listing.pagesRequested > 0 && listing.pagesFailed >= listing.pagesRequested) {
      console.warn('[coachSync] every FUMBBL match page failed');
      return end('failed');
    }
    if (result.listComplete) applyCooldown(); // a complete list: the day is used even if nothing needs downloading
    const rows = listing.matches.slice(0, COACH_SYNC_GAMES);
    result.total = rows.length;
    for (let i = 0; i < rows.length; i++) {
      guard();
      const row = rows[i]!;
      deps.onProgress?.({ phase: 'syncing', index: i + 1, total: rows.length });
      const history = deps.history();
      const holder = heldFumbblGame(history, row.replayId, coach);
      if (holder === 'mine') { result.already++; continue; }
      if (holder === 'other') { result.notAdded++; continue; } // cannot be stored: never downloaded
      // a full history keeps its newest 200: a game older than all of them would be dropped as soon as it was added
      const played = playedAtMs(null, row.when);
      if (history.length >= COACH_HISTORY_CAP && played != null && played < Math.min(...history.map((g) => g.savedAt))) { result.tooOld++; continue; }
      try {
        let record: CoachGameRecord | null = null;
        let local = false;
        // review 5: the Details read is bounded; one that does not answer in time is treated as no snapshot
        const read = await bounded(deps, () => deps.loadSnapshot(row.replayId).catch(() => null), limit('snapshot', COACH_SYNC_STEP_TIMEOUT_MS.snapshot));
        guard();
        const snapshot = read.ok ? read.value : null;
        if (snapshotUsable(snapshot, row.replayId)) { record = recordFromSnapshot(snapshot, row, coach); local = !!record; }
        if (!record) {
          // review 3: another window may have stored this game during this run - look again before downloading it.
          // review 5: a refresh that fails here stops the run as a failure (the cooldown stands only if already consumed)
          await refresh('failed');
          guard(); // review 4 (#3): a cancel or a lost lease during the refresh never reaches the cooldown or the download
          const now = heldFumbblGame(deps.history(), row.replayId, coach);
          if (now === 'mine') { result.already++; continue; }
          if (now === 'other') { result.notAdded++; continue; }
          applyCooldown(); // a replay download is about to be attempted
          const download = await bounded(deps, (signal) => deps.downloadReplay(row.replayId, signal), limit('download', COACH_SYNC_STEP_TIMEOUT_MS.download));
          guard();
          if (!download.ok) { console.warn(`[coachSync] game ${row.replayId}: the replay download timed out`); result.failed++; continue; }
          result.downloaded++;
          record = recordFromReplay(download.value, row, coach);
        }
        if (!record) { result.failed++; continue; }
        guard();
        // review 3 + 4: the append's OWN outcome decides; for a duplicate, the stored record's coach says whose it is.
        // In-memory key presence never counts ('unsaved' = shown this session only, lost on restart = failed).
        // review 5: the append wait is bounded. On a cancel or a timeout its outcome is UNKNOWN (the write may still be
        // queued on the history's chain, or land later): the game is counted as failed and the run ends; the cooldown
        // stands because a download was attempted. An outcome that arrived first is counted from that outcome.
        const recordKey = historyKey(record);
        let appended: Bounded<CoachAppendOutcome>;
        try { appended = await bounded(deps, () => deps.append(record!), limit('append', COACH_SYNC_STEP_TIMEOUT_MS.append)); } catch (error) {
          if (error instanceof SyncStop) result.failed++; // outcome unknown
          throw error;
        }
        if (!appended.ok) { result.failed++; console.warn(`[coachSync] game ${row.replayId}: saving it did not finish in time`); throw new SyncStop('failed'); }
        const outcome = appended.value;
        const stored = deps.history().find((g) => historyKey(g) === recordKey);
        const storedMine = !!stored && coachNameKey(stored.coach ?? '') === coachNameKey(coach);
        if (outcome === 'written') { if (storedMine) { result.imported++; if (local) result.fromLocal++; } else result.tooOld++; } // else: the 200 cap dropped it at once
        else if (outcome === 'duplicate') { if (storedMine) result.already++; else if (stored) result.notAdded++; else result.failed++; }
        else result.failed++;
        guard(); // the outcome above is recorded first on purpose: it reports a write that has already happened
      } catch (error) {
        if (error instanceof SyncStop) throw error;
        if (deps.signal.aborted || isAbort(error)) throw new SyncStop(deps.stillBound() ? 'cancelled' : 'stopped');
        guard(); // a rejected await is still an await - stopped / cancelled / lease lost before counting it
        console.warn(`[coachSync] game ${row.replayId} skipped`, error);
        result.failed++;
      }
    }
    return result;
  } catch (error) {
    if (error instanceof SyncStop) return end(error.status);
    console.warn('[coachSync] sync failed', error);
    return end('failed');
  } finally {
    clearInterval(heartbeat);
    if (reserved && !result.cooldownApplied) {
      // nothing consumed (no download attempted, the list not complete): give the coach the day back
      try { if (previous == null) deps.storage?.removeItem(key); else deps.storage?.setItem(key, previous); } catch { /* the reservation then holds as a cooldown: fail-closed */ }
    }
    deps.lease.release();
  }
}

// ---- the one sync of this window (the panel can close and reopen while it runs) ----

export const coachSyncState = reactive<{
  running: boolean;
  coach: string;
  progress: CoachSyncProgress | null;
  last: CoachSyncResult | null;
}>({ running: false, coach: '', progress: null, last: null });

let controller: AbortController | null = null;

/** Starts a sync unless one is running in this window. Resolves with its result (null = one was already running).
 *  The running state is cleared whatever happens. */
export async function startCoachStatsSync(deps: Omit<CoachSyncDeps, 'signal' | 'onProgress'>): Promise<CoachSyncResult | null> {
  if (coachSyncState.running) return null;
  const abort = new AbortController();
  controller = abort;
  coachSyncState.running = true;
  coachSyncState.coach = deps.coach.trim();
  coachSyncState.progress = null;
  coachSyncState.last = null;
  let result: CoachSyncResult | null = null;
  try {
    result = await runCoachStatsSync({ ...deps, signal: abort.signal, onProgress: (p) => { coachSyncState.progress = p; } });
    return result;
  } finally {
    if (controller === abort) controller = null;
    coachSyncState.running = false;
    coachSyncState.progress = null;
    coachSyncState.last = result;
  }
}

/** Cancels this window's sync (the Cancel button, or the server / coach changing under it). */
export function cancelCoachStatsSync(): void { controller?.abort(); }

/** Test seam. */
export function resetCoachSyncStateForTests(): void {
  controller?.abort();
  controller = null;
  coachSyncState.running = false;
  coachSyncState.coach = '';
  coachSyncState.progress = null;
  coachSyncState.last = null;
}
