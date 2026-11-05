/**
 * Owner 11-04 (spec-bug-report-updates-2026-11-04.md, lane 2): the reporter sees when their bug reports were actioned
 * and the owner's reply.
 *
 *  - On a successful submit the server answers `{ id, receipt }` (the receipt is a secret only this client holds; the
 *    server keeps its hash). `rememberBugReport` saves it here. A server that sends no receipt (an older one) is stored
 *    nothing.
 *  - Once per launch (App.vue on mount), when the store holds anything, ONE `POST /api/bug-reports/status` to the same
 *    base URL reports go to (bugReportBaseUrl: never FUMBBL). The receipts ride in the BODY only, never a URL, and are
 *    never logged. A failure is silent (retried next launch); a malformed answer is ignored. The "My reports" list's
 *    Refresh sends the same call.
 *  - `bugUpdatePending` = some report's server `updatedAt` is newer than the one the reporter last saw: the main
 *    screen's "BUG UPDATE" notice (components/BugUpdateNotice.vue) shows above the Report button. Opening the list marks
 *    the shown reports seen.
 *
 * Storage: `bug-receipts.json` in the app data directory (src-tauri/src/bug_receipts.rs), the coach history's
 * mechanism: a locked read -> merge -> cap -> atomic write in the shell, the corrupt file moved aside. In the web preview
 * / dev, or on a shell without these commands, localStorage stands in with one key per report. Capped to 50; entries
 * older than 180 days, or closed and seen more than 30 days ago, are dropped (decided inside the store's read-write). Never a throw.
 *
 * Privacy: the store is never attached to a bug report (it is not part of settings) and holds only this reporter's
 * own reports and what the server returned for them.
 */
import { computed, reactive } from 'vue';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { bugReportBaseUrl } from './settings';

export const BUG_RECEIPTS_VERSION = 1;
/** Mirrors RECEIPTS_CAP in src-tauri/src/bug_receipts.rs; also the contract's per-call maximum. */
export const BUG_RECEIPTS_CAP = 50;
export const BUG_RECEIPT_MAX_AGE_MS = 180 * 24 * 3600 * 1000;
export const BUG_RECEIPT_SEEN_DONE_MS = 30 * 24 * 3600 * 1000;
export const BUG_RECEIPT_TITLE_MAX = 80;
export const BUG_REPLY_MAX = 4000;
/** The localStorage fallback: one key per report, this prefix + the report id. */
export const BUG_RECEIPTS_KEY_PREFIX = 'superFumbbl.bugReceipts.v1.';

export type BugReportStatus = 'received' | 'triaged' | 'inProgress' | 'resolved' | 'closed';
const STATUSES: readonly BugReportStatus[] = ['received', 'triaged', 'inProgress', 'resolved', 'closed'];

/** What the status endpoint returns for one report (contract: nothing else is ever sent). */
export interface BugReportServerStatus {
  status: BugReportStatus;
  reply: string | null;
  replyAt: string | null;
  fixedIn: string | null;
  updatedAt: string;
}

export interface StoredBugReceipt {
  id: string;
  receipt: string;
  /** ms epoch of the submit. */
  submittedAt: number;
  /** The description's first line, at most 80 characters. */
  title: string;
  /** The server `updatedAt` the reporter last saw in the list (null = never). */
  lastSeenUpdatedAt: string | null;
  /** ms epoch when the list last marked this report seen (the 30-day expiry of a finished report). */
  seenAt: number | null;
  /** The last status the server returned (null = none yet). */
  latest: BugReportServerStatus | null;
}

// ---- format ----

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strOrNull = (v: unknown): v is string | null => v === null || isStr(v);
const stamp = (v: string | null | undefined): number => (v ? Date.parse(v) : NaN);
/** The server's report id shape (server lane: [A-Za-z0-9_-]{1,160}); a numeric id is taken as its decimal text. */
const REPORT_ID = /^[A-Za-z0-9_-]{1,160}$/;
/** The receipt: base64url, 43 characters from the server (32 bytes); the bound leaves room, never a URL. */
const RECEIPT = /^[A-Za-z0-9_-]{16,200}$/;
const idOf = (v: unknown): string => {
  const id = isStr(v) ? v : isNum(v) && Number.isSafeInteger(v) && v >= 0 ? String(v) : '';
  return REPORT_ID.test(id) ? id : '';
};

/** Is `candidate` at least as new as `held`? Sol r1: compared as INSTANTS (Date.parse), never as text - as text a
 *  `+01:00` stamp can sort after a later `Z` one. Equal text is equal; unparseable on either side = yes (fail open: a
 *  date format never drops a reply). Mirrors not_older in src-tauri/src/bug_receipts.rs. */
export function notOlder(candidate: string, held: string): boolean {
  if (candidate === held) return true;
  const c = stamp(candidate), h = stamp(held);
  return Number.isNaN(c) || Number.isNaN(h) || c >= h;
}

/** Is `candidate` strictly newer than `held`? Instants; equal text is not newer; unparseable on either side = newer. */
export function isNewer(candidate: string, held: string): boolean {
  if (candidate === held) return false;
  const c = stamp(candidate), h = stamp(held);
  return Number.isNaN(c) || Number.isNaN(h) || c > h;
}

/** One status entry from the server, checked field by field; null = malformed (ignored). */
export function parseServerStatus(value: unknown): (BugReportServerStatus & { id: string }) | null {
  if (!isObj(value)) return null;
  const id = idOf(value.id);
  const { status, reply, replyAt, fixedIn, updatedAt } = value;
  if (!id || !STATUSES.includes(status as BugReportStatus)) return null;
  // an updatedAt this client cannot parse is still taken (Sol r1, fail open): it compares as newer, never drops a reply
  if (!strOrNull(reply) || !strOrNull(replyAt) || !strOrNull(fixedIn) || !isStr(updatedAt) || !updatedAt.trim() || updatedAt.length > 64) return null;
  return {
    id,
    status: status as BugReportStatus,
    reply: reply === null ? null : reply.slice(0, BUG_REPLY_MAX),
    replyAt,
    fixedIn: fixedIn === null ? null : fixedIn.slice(0, 40),
    updatedAt,
  };
}

function isServerStatus(v: unknown): v is BugReportServerStatus {
  return isObj(v) && STATUSES.includes(v.status as BugReportStatus) && strOrNull(v.reply) && strOrNull(v.replyAt)
    && strOrNull(v.fixedIn) && isStr(v.updatedAt);
}

export function isStoredReceipt(value: unknown): value is StoredBugReceipt {
  if (!isObj(value)) return false;
  const r = value;
  return isStr(r.id) && r.id !== '' && isStr(r.receipt) && r.receipt !== '' && isNum(r.submittedAt) && isStr(r.title)
    && strOrNull(r.lastSeenUpdatedAt) && (r.seenAt === null || isNum(r.seenAt))
    && (r.latest === null || isServerStatus(r.latest));
}

/** The store's valid entries; null = not a store (corrupt / unknown version). */
export function parseReceiptStore(raw: string): StoredBugReceipt[] | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!isObj(parsed) || parsed.version !== BUG_RECEIPTS_VERSION || !Array.isArray(parsed.reports)) return null;
  return parsed.reports.filter(isStoredReceipt).map(withoutSyntheticBaseline);
}

/**
 * Sol r2: "seen" is only ever the SERVER's updatedAt of what the list showed, never this client's clock. Builds before
 * this fix started a new receipt seen at its client-clock submit time; such a baseline (never marked in the list, equal
 * to submittedAt) is read back as null. Both merges (here and bug_receipts.rs) apply it.
 */
export function withoutSyntheticBaseline(e: StoredBugReceipt): StoredBugReceipt {
  return e.seenAt == null && e.lastSeenUpdatedAt != null && stamp(e.lastSeenUpdatedAt) === e.submittedAt ? { ...e, lastSeenUpdatedAt: null } : e;
}

/** The description's first non-empty line, trimmed to 80 characters. */
export function bugReportTitle(description: string): string {
  const line = description.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > BUG_RECEIPT_TITLE_MAX ? `${line.slice(0, BUG_RECEIPT_TITLE_MAX - 1)}…` : line;
}

/** The success answer's `{ id, receipt }`; null when either is missing (an older server: store nothing). */
export function receiptFromResponse(data: unknown): { id: string; receipt: string } | null {
  if (!isObj(data)) return null;
  const id = idOf(data.id);
  const receipt = isStr(data.receipt) ? data.receipt : '';
  if (!id || !RECEIPT.test(receipt)) return null;
  return { id, receipt };
}

/**
 * A report the server has actioned that the reporter has not seen: its updatedAt is newer (as an instant) than the
 * server updatedAt the list last showed (null = never shown). A bare "received" (no reply, no fixedIn) is never news.
 */
export function hasUnseenUpdate(entry: StoredBugReceipt): boolean {
  const latest = entry.latest;
  if (!latest) return false;
  if (latest.status === 'received' && !latest.reply && !latest.fixedIn) return false;
  if (entry.lastSeenUpdatedAt == null) return true;
  return isNewer(latest.updatedAt, entry.lastSeenUpdatedAt);
}

/** CLOSED and everything the server sent was shown (latest updatedAt not newer than lastSeenUpdatedAt, as instants). */
function closedAndSeen(e: StoredBugReceipt): boolean {
  if (e.latest?.status !== 'closed' || e.seenAt == null || e.lastSeenUpdatedAt == null) return false;
  const seen = e.lastSeenUpdatedAt, updated = e.latest.updatedAt;
  return seen === updated || (!Number.isNaN(stamp(seen)) && !Number.isNaN(stamp(updated)) && stamp(seen) >= stamp(updated));
}

const NONE: ReadonlySet<string> = new Set();

/**
 * One entry's expiry (mirrors expired in src-tauri/src/bug_receipts.rs): older than 180 days, or CLOSED (the contract's
 * state; a resolved report stays, Sol r1) and seen more than 30 days ago - the latter ONLY for an id in `confirmed`:
 * the ids a successful status answer just returned (Sol r2: never before polling, never for an id the answer left out,
 * never after a failed call), and only while what it returned is not newer than what was seen. Every store decides it
 * inside its own read-write, on what it just read (Sol r1).
 */
export function isExpiredReceipt(e: StoredBugReceipt, now: number, confirmed: ReadonlySet<string> = NONE): boolean {
  if (now - e.submittedAt > BUG_RECEIPT_MAX_AGE_MS) return true;
  return confirmed.has(e.id) && closedAndSeen(e) && now - e.seenAt! > BUG_RECEIPT_SEEN_DONE_MS;
}

/** `entries` without the expired ones, oldest first, at most 50: beyond the cap the closed-and-seen reports go first
 *  (the longest seen first), then the oldest submitted (mirrors cap in bug_receipts.rs). */
export function settleReceipts(entries: readonly StoredBugReceipt[], now: number, confirmed: ReadonlySet<string> = NONE): StoredBugReceipt[] {
  const kept = entries.filter((e) => !isExpiredReceipt(e, now, confirmed)).sort((a, b) => a.submittedAt - b.submittedAt);
  const over = kept.length - BUG_RECEIPTS_CAP;
  if (over <= 0) return kept;
  const done = kept.filter(closedAndSeen).sort((a, b) => a.seenAt! - b.seenAt!);
  const evict = new Set([...done, ...kept.filter((e) => !closedAndSeen(e))].slice(0, over).map((e) => e.id));
  return kept.filter((e) => !evict.has(e.id));
}

/** The ids `settleReceipts` drops (expired, or beyond the cap). */
export function expiredReceiptIds(entries: readonly StoredBugReceipt[], now: number, confirmed: ReadonlySet<string> = NONE): string[] {
  const kept = new Set(settleReceipts(entries, now, confirmed).map((e) => e.id));
  return entries.filter((e) => !kept.has(e.id)).map((e) => e.id);
}

/** `stored` + `incoming` by id, the shell's merge (bug_receipts.rs merge_entry): the stored copy keeps its identity
 *  fields, "seen" only moves forward, the newer server status wins (instants, unparseable = newer). Oldest first. */
export function mergeReceipts(stored: readonly StoredBugReceipt[], incoming: readonly StoredBugReceipt[]): StoredBugReceipt[] {
  const byId = new Map<string, StoredBugReceipt>();
  for (const e of stored) byId.set(e.id, withoutSyntheticBaseline(e));
  for (const raw of incoming) {
    const e = withoutSyntheticBaseline(raw);
    const held = byId.get(e.id);
    if (!held) { byId.set(e.id, e); continue; }
    const a = held.lastSeenUpdatedAt, b = e.lastSeenUpdatedAt;
    const seen = a != null && b != null ? (notOlder(b, a) ? b : a) : a ?? b;
    const seenAt = held.seenAt == null ? e.seenAt : e.seenAt == null ? held.seenAt : Math.max(held.seenAt, e.seenAt);
    const latest = !e.latest ? held.latest : !held.latest || notOlder(e.latest.updatedAt, held.latest.updatedAt) ? e.latest : held.latest;
    byId.set(e.id, { ...held, lastSeenUpdatedAt: seen, seenAt, latest });
  }
  return [...byId.values()].sort((a, b) => a.submittedAt - b.submittedAt);
}

const storeText = (reports: readonly StoredBugReceipt[]): string => JSON.stringify({ version: BUG_RECEIPTS_VERSION, reports });

// ---- storage ----

export type ReceiptLoad = { state: 'missing' } | { state: 'corrupt' } | { state: 'ok'; text: string };
export class BugReceiptsUnavailable extends Error {}

/** Where the receipts live. `update` merges `upsert` in, then decides the expiry at `now` on what it just read inside
 *  its own read-write (Sol r1: never from an earlier read), caps and writes. An empty `upsert` = the expiry alone. */
export interface BugReceiptBackend {
  load(): Promise<ReceiptLoad>;
  update(upsert: readonly StoredBugReceipt[], now: number, confirmed?: readonly string[]): Promise<string>;
}

export type BugReceiptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** The web / dev fallback (and an app patch on a shell without the commands): one localStorage key per report. */
export function localStorageReceiptBackend(storage: BugReceiptStorage | null = typeof localStorage !== 'undefined' ? localStorage : null): BugReceiptBackend & {
  /** The valid entries with their keys; null when localStorage cannot be read. */
  entries(): { key: string; entry: StoredBugReceipt }[] | null;
  /** EVERY key under the prefix, valid or not (the migration removes them all); null when unreadable. */
  keys(): string[] | null;
  remove(keys: readonly string[]): void;
} {
  const need = (): BugReceiptStorage => { if (!storage) throw new BugReceiptsUnavailable('no localStorage'); return storage; };
  const allKeys = (): string[] => {
    const s = need();
    try {
      const keys: string[] = [];
      for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k?.startsWith(BUG_RECEIPTS_KEY_PREFIX)) keys.push(k); }
      return keys;
    } catch (error) { throw new BugReceiptsUnavailable(String(error)); }
  };
  const scan = (): { key: string; entry: StoredBugReceipt }[] => {
    const s = need();
    try {
      const out: { key: string; entry: StoredBugReceipt }[] = [];
      for (const key of allKeys()) {
        let value: unknown = null;
        try { value = JSON.parse(s.getItem(key) ?? 'null'); } catch { value = null; }
        if (isStoredReceipt(value) && key === BUG_RECEIPTS_KEY_PREFIX + value.id) out.push({ key, entry: value });
      }
      return out.sort((a, b) => a.entry.submittedAt - b.entry.submittedAt);
    } catch (error) { throw new BugReceiptsUnavailable(String(error)); }
  };
  return {
    async load() {
      const held = scan();
      return held.length ? { state: 'ok', text: storeText(held.map((e) => e.entry)) } : { state: 'missing' };
    },
    // Sol r3: localStorage has no lock shared with other windows, so this fallback NEVER runs the closed-and-seen expiry
    // (`confirmed` is ignored: only the shell's locked file does it). It keeps the 180-day age rule and the 50 cap, and
    // every key is re-read immediately before it is written (merged: the newer updatedAt wins) or removed: a key whose
    // server status CHANGED since the scan (another window stored a newer one) is kept; an unchanged one goes by the age
    // rule and the cap as usual, unseen or not (Sol r4). With navigator.locks the whole read-merge-write also runs under
    // a named lock.
    async update(upsert, at, _confirmed = []) {
      const s = need();
      const run = (): string => {
        const held = scan();
        const next = settleReceipts(mergeReceipts(held.map((e) => e.entry), upsert), at);
        const keep = new Set(next.map((e) => e.id));
        const current = (key: string): StoredBugReceipt | null => {
          let value: unknown = null;
          try { value = JSON.parse(s.getItem(key) ?? 'null'); } catch { value = null; }
          return isStoredReceipt(value) && key === BUG_RECEIPTS_KEY_PREFIX + value.id ? value : null;
        };
        const written: StoredBugReceipt[] = [];
        try {
          for (const e of next) {
            const key = BUG_RECEIPTS_KEY_PREFIX + e.id;
            const now = current(key);
            const merged = now ? mergeReceipts([now], [e])[0]! : e;
            s.setItem(key, JSON.stringify(merged));
            written.push(merged);
          }
          for (const e of held) {
            if (keep.has(e.entry.id)) continue;
            const now = current(e.key);
            if (now && statusNewerThan(now, e.entry)) { written.push(now); continue; } // another window's news since our read
            s.removeItem(e.key);
          }
        } catch (error) { throw new BugReceiptsUnavailable(`write failed: ${String(error)}`); }
        return storeText(written.sort((a, b) => a.submittedAt - b.submittedAt));
      };
      const locks = (globalThis.navigator as (Navigator & { locks?: { request?: unknown } }) | undefined)?.locks;
      if (locks && typeof locks.request === 'function') {
        return (locks as unknown as { request(name: string, cb: () => Promise<string>): Promise<string> }).request('sf-bug-receipts', async () => run());
      }
      return run();
    },
    entries() { try { return scan(); } catch { return null; } },
    keys() { try { return allKeys(); } catch { return null; } },
    remove(keys) { for (const key of keys) { try { storage?.removeItem(key); } catch { /* next load retries */ } } },
  };
}

/** Does `stored` (re-read now) hold a newer server status than `scanned` (the copy this update read)? */
function statusNewerThan(stored: StoredBugReceipt, scanned: StoredBugReceipt): boolean {
  if (!stored.latest) return false;
  if (!scanned.latest) return true;
  return stored.latest.updatedAt !== scanned.latest.updatedAt && notOlder(stored.latest.updatedAt, scanned.latest.updatedAt);
}

async function invokeShell<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

const isShellReceiptsError = (error: unknown): boolean => String((error as { message?: unknown })?.message ?? error).startsWith('bug-receipts:');

/**
 * The shell's file (src-tauri/src/bug_receipts.rs). A shell WITHOUT the commands uses the localStorage fallback for the
 * session. Every load migrates the valid localStorage entries into the file and then removes EVERY key under the prefix,
 * valid or not (Sol r1: a malformed entry must not keep a receipt forever; it is counted in the log, never shown). A
 * failed write removes nothing. This also refills a store whose corrupt file was moved aside.
 */
export function shellReceiptBackend(fallback: ReturnType<typeof localStorageReceiptBackend> = localStorageReceiptBackend()): BugReceiptBackend {
  let olderShell = false;
  const viaShell = async <T>(run: () => Promise<T>, onFallback: () => Promise<T>): Promise<T> => {
    if (olderShell) return onFallback();
    try { return await run(); } catch (error) {
      if (error instanceof BugReceiptsUnavailable) throw error;
      if (isShellReceiptsError(error)) throw new BugReceiptsUnavailable(String((error as { message?: unknown })?.message ?? error));
      console.warn('[bugReports] the shell has no receipt commands; using local storage');
      olderShell = true;
      return onFallback();
    }
  };
  const shellUpdate = (upsert: readonly StoredBugReceipt[], at: number, confirmed: readonly string[] = []) =>
    invokeShell<string>('bug_receipts_update', { upsert: JSON.stringify(upsert), now: at, confirmed: JSON.stringify(confirmed) });
  const loadAndMigrate = async (): Promise<ReceiptLoad> => {
    const loaded = await invokeShell<{ state: 'missing' | 'corrupt' | 'ok'; text?: string | null } | undefined>('bug_receipts_load');
    if (!loaded || (loaded.state !== 'missing' && loaded.state !== 'corrupt' && loaded.state !== 'ok')) throw new Error('bug_receipts_load: no receipt command');
    const snapshot = fallback.entries() ?? [];
    const keys = fallback.keys() ?? [];
    const malformed = keys.length - snapshot.length;
    if (snapshot.length) {
      try {
        const text = await shellUpdate(snapshot.map((e) => e.entry), now());
        fallback.remove(keys); // only after the file holds the valid ones; the malformed ones go too
        if (malformed > 0) console.warn(`[bugReports] dropped ${malformed} unreadable stored report(s) while moving them to the app data file`);
        return { state: 'ok', text };
      } catch (error) {
        if (!isShellReceiptsError(error)) throw error;
        const file = loaded.state === 'ok' && loaded.text ? parseReceiptStore(loaded.text) ?? [] : [];
        return { state: 'ok', text: storeText(mergeReceipts(file, snapshot.map((e) => e.entry))) };
      }
    }
    if (keys.length) {
      fallback.remove(keys); // nothing valid to move: the malformed keys are dropped all the same
      console.warn(`[bugReports] dropped ${malformed} unreadable stored report(s)`);
    }
    return loaded.state === 'ok' ? { state: 'ok', text: loaded.text ?? '' } : { state: loaded.state };
  };
  return {
    load: () => viaShell(loadAndMigrate, () => fallback.load()),
    update: (upsert, at, confirmed = []) => viaShell(() => shellUpdate(upsert, at, confirmed), () => fallback.update(upsert, at, confirmed)),
  };
}

const inTauri = (): boolean => typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

let backend: BugReceiptBackend | null = null;
function store(): BugReceiptBackend {
  backend ??= inTauri() ? shellReceiptBackend() : localStorageReceiptBackend();
  return backend;
}

export type StatusTransport = (input: string, init?: RequestInit) => Promise<Response>;
let transport: StatusTransport = (input, init) => tauriFetch(input, init);
let now: () => number = () => Date.now();

/** What the notice and the list read. `reports` oldest first. */
export const bugReportUpdates = reactive<{ loaded: boolean; persisting: boolean; checking: boolean; reports: StoredBugReceipt[] }>({
  loaded: false, persisting: true, checking: false, reports: [],
});

/** The main screen's "BUG UPDATE" notice shows while this is true. */
export const bugUpdatePending = computed(() => bugReportUpdates.reports.some(hasUnseenUpdate));

let chain: Promise<unknown> = Promise.resolve();
let loading: Promise<void> | null = null;
let launchCheck: Promise<void> | null = null;

/** Test seam: a backend, a transport and a clock (null = the defaults), and a fresh, unloaded state. */
export function setBugReportUpdatesForTests(next: { backend?: BugReceiptBackend | null; transport?: StatusTransport | null; now?: (() => number) | null } = {}): void {
  backend = next.backend ?? null;
  transport = next.transport ?? ((input, init) => tauriFetch(input, init));
  now = next.now ?? (() => Date.now());
  bugReportUpdates.loaded = false;
  bugReportUpdates.persisting = true;
  bugReportUpdates.checking = false;
  bugReportUpdates.reports = [];
  chain = Promise.resolve();
  loading = null;
  launchCheck = null;
}

function show(text: string): void {
  const parsed = parseReceiptStore(text);
  if (parsed) bugReportUpdates.reports = parsed;
}

/** Applies a change: through the store (its merge), or in memory only when the store is unavailable. Never throws. */
function apply(upsert: StoredBugReceipt[], opts: { expire?: boolean; confirmed?: readonly string[] } = {}): Promise<void> {
  return (chain = chain.then(async () => {
    const at = now();
    const confirmed = opts.confirmed ?? [];
    const remember = () => { bugReportUpdates.reports = settleReceipts(mergeReceipts(bugReportUpdates.reports, upsert), at, new Set(confirmed)); };
    if (!upsert.length && !opts.expire && !confirmed.length) return;
    if (!bugReportUpdates.persisting) { remember(); return; }
    try {
      // the store decides the expiry inside its own read-write, on what it reads there (Sol r1)
      show(await store().update(upsert, at, confirmed));
    } catch {
      console.warn('[bugReports] the report store is unavailable; this session keeps its reports in memory only');
      bugReportUpdates.persisting = false;
      remember();
    }
  })) as Promise<void>;
}

/** Loads the store once per session and drops expired entries. Never throws. */
export function ensureBugReportUpdatesLoaded(): Promise<void> {
  loading ??= (chain = chain.then(async () => {
    try {
      const loaded = await store().load();
      if (loaded.state === 'ok') show(loaded.text);
      else if (loaded.state === 'corrupt') console.warn('[bugReports] the stored reports were unreadable; they were moved aside');
    } catch {
      bugReportUpdates.persisting = false;
    }
    bugReportUpdates.loaded = true;
  })).then(() => {
    // expiry before any poll: the 180-day age and the cap only (closed-and-seen waits for a status answer, Sol r2);
    // only when this session's view shows something to drop, and then decided by the store on a fresh read
    const expired = expiredReceiptIds(bugReportUpdates.reports, now());
    return expired.length ? apply([], { expire: true }) : undefined;
  }) as Promise<void>;
  return loading;
}

/** A report was sent and the server returned `response` (its success body). Saves `{ id, receipt }`; nothing when the
 *  server sent no receipt. Never throws. */
export function rememberBugReport(response: unknown, description: string): Promise<boolean> {
  const got = receiptFromResponse(response);
  if (!got) return Promise.resolve(false);
  const submittedAt = now();
  const entry: StoredBugReceipt = {
    id: got.id, receipt: got.receipt, submittedAt, title: bugReportTitle(description),
    // Sol r2: never seen from this client's clock; a fresh "received" is kept quiet by the bare-received rule
    lastSeenUpdatedAt: null, seenAt: null, latest: null,
  };
  return ensureBugReportUpdatesLoaded().then(() => apply([entry])).then(() => true);
}

/** The status answer's valid entries for reports this client holds; null = the answer is malformed (ignored). */
export function parseStatusResponse(data: unknown, held: ReadonlySet<string>): (BugReportServerStatus & { id: string })[] | null {
  if (!isObj(data) || !Array.isArray(data.reports)) return null;
  return data.reports.map(parseServerStatus).filter((s): s is BugReportServerStatus & { id: string } => !!s && held.has(s.id));
}

/**
 * ONE status call for every held report (the newest 50). No call when the store is empty. Resolves whether the call
 * succeeded; a failure (network, non-OK, malformed) changes nothing and logs nothing about the reports.
 */
export async function refreshBugReportStatuses(): Promise<boolean> {
  await ensureBugReportUpdatesLoaded();
  // the server de-duplicates ids case-insensitively: one entry per id ignoring case (the newest submitted wins)
  const byKey = new Map<string, StoredBugReceipt>();
  for (const e of bugReportUpdates.reports) { byKey.delete(e.id.toLowerCase()); byKey.set(e.id.toLowerCase(), e); }
  const held = [...byKey.values()].slice(-BUG_RECEIPTS_CAP);
  if (!held.length || bugReportUpdates.checking) return false;
  bugReportUpdates.checking = true;
  try {
    let data: unknown;
    try {
      const response = await transport(`${bugReportBaseUrl()}/api/bug-reports/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reports: held.map((e) => ({ id: e.id, receipt: e.receipt })) }),
      });
      if (!response.ok) return false;
      data = await response.json();
    } catch {
      return false;
    }
    const statuses = parseStatusResponse(data, new Set(held.map((e) => e.id)));
    if (!statuses) return false;
    const byId = new Map(bugReportUpdates.reports.map((e) => [e.id, e]));
    const upsert: StoredBugReceipt[] = [];
    const answered: string[] = [];
    for (const { id, ...latest } of statuses) {
      const entry = byId.get(id);
      if (!entry) continue;
      if (entry.latest?.updatedAt !== latest.updatedAt) upsert.push({ ...entry, latest });
      // Sol r2: this answer included the id and shows nothing newer than what the list showed
      if (entry.lastSeenUpdatedAt != null && !isNewer(latest.updatedAt, entry.lastSeenUpdatedAt)) answered.push(id);
    }
    // closed-and-seen expiry happens only here, after a successful answer, for the ids it confirmed (the store decides
    // again on its fresh read); an omitted id, a failure or a non-2xx never expires anything
    const view = mergeReceipts(bugReportUpdates.reports, upsert);
    const confirmed = expiredReceiptIds(view, now(), new Set(answered)).length > expiredReceiptIds(view, now()).length ? answered : [];
    await apply(upsert, { confirmed });
    return true;
  } finally {
    bugReportUpdates.checking = false;
  }
}

/** The launch check (App.vue on mount): at most once per launch, and only with a non-empty store. Never throws. */
export function checkBugReportUpdatesOnce(): Promise<void> {
  launchCheck ??= refreshBugReportStatuses().then(() => undefined, () => undefined);
  return launchCheck;
}

/** The ids with an unseen update right now (the list highlights them while it is open). */
export function unseenBugReportIds(): Set<string> {
  return new Set(bugReportUpdates.reports.filter(hasUnseenUpdate).map((e) => e.id));
}

/** The list was opened (or refreshed while open): every shown report with a server status is marked seen. */
export function markBugReportsSeen(): Promise<void> {
  const at = now();
  const upsert = bugReportUpdates.reports
    .filter((e) => e.latest && e.lastSeenUpdatedAt !== e.latest.updatedAt)
    .map((e) => ({ ...e, lastSeenUpdatedAt: e.latest!.updatedAt, seenAt: at }));
  return apply(upsert);
}

/** The status chip's i18n key and params. */
export function bugStatusChip(latest: BugReportServerStatus | null): { key: string; params?: Record<string, string> } {
  switch (latest?.status) {
    case 'inProgress': return { key: 'bugUpdates.status.inProgress' };
    case 'resolved': return latest.fixedIn ? { key: 'bugUpdates.status.fixedIn', params: { version: latest.fixedIn } } : { key: 'bugUpdates.status.fixed' };
    case 'closed': return { key: 'bugUpdates.status.closed' };
    default: return { key: 'bugUpdates.status.received' };
  }
}
