/**
 * Owner 09-25: the end-of-game DETAILS cache. When the end-game pane settles, SpectateView stores the snapshot
 * (game JSON + dice tallies + end reports + portraits, ≈100–300 KB); the Play blade's Details popup replays it.
 * IndexedDB (not localStorage: a week of games would blow its ~5 MB cap); entries older than 7 days are pruned
 * on every write and on startup. Without IndexedDB (node tests) the memory backend stands in.
 */
import type { PostGameSnapshot } from './postGameProjection';

export const POST_GAME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PostGameBackend {
  get(key: string): Promise<PostGameSnapshot | null>;
  put(snapshot: PostGameSnapshot): Promise<void>;
  delete(key: string): Promise<void>;
  /** every stored key with its savedAt */
  index(): Promise<{ key: string; savedAt: number }[]>;
  /** ONE read-modify-write: `change` sees the row as it is stored NOW and returns its replacement (null = leave it).
   *  Nothing else can write that row between the read and the write. Resolves whether a row was written. */
  update(key: string, change: (current: PostGameSnapshot) => PostGameSnapshot | null): Promise<boolean>;
}

export function memoryPostGameBackend(): PostGameBackend {
  const rows = new Map<string, PostGameSnapshot>();
  return {
    async get(key) { return rows.get(key) ?? null; },
    async put(s) { rows.set(s.key, s); },
    async delete(key) { rows.delete(key); },
    async index() { return [...rows.values()].map((s) => ({ key: s.key, savedAt: s.savedAt })); },
    async update(key, change) {
      const current = rows.get(key); // read and write in one synchronous step: nothing can land in between
      const next = current ? change(current) : null;
      if (next) rows.set(key, next);
      return !!next;
    },
  };
}

const DB_NAME = 'super-fumbbl';
const STORE = 'postGame';

function idbPostGameBackend(): PostGameBackend {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' }).createIndex('savedAt', 'savedAt');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    });
    return dbPromise;
  };
  const run = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
    });
  };
  return {
    get: (key) => run<PostGameSnapshot | undefined>('readonly', (s) => s.get(key)).then((r) => r ?? null),
    put: (snapshot) => run('readwrite', (s) => s.put(snapshot)).then(() => undefined),
    delete: (key) => run('readwrite', (s) => s.delete(key)).then(() => undefined),
    index: async () => {
      const keys = await run<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
      const out: { key: string; savedAt: number }[] = [];
      for (const key of keys) {
        const row = await run<PostGameSnapshot | undefined>('readonly', (s) => s.get(key));
        if (row) out.push({ key: String(key), savedAt: row.savedAt });
      }
      return out;
    },
    update: async (key, change) => {
      const db = await open();
      return new Promise<boolean>((resolve, reject) => {
        // one readwrite transaction: the put is issued from the get's own success callback, so the transaction is
        // still active and no other write to this store can run between them
        const tx = db.transaction(STORE, 'readwrite');
        const rows = tx.objectStore(STORE);
        let written = false;
        const read = rows.get(key) as IDBRequest<PostGameSnapshot | undefined>;
        read.onsuccess = () => {
          const next = read.result ? change(read.result) : null;
          if (next) { rows.put(next); written = true; }
        };
        tx.oncomplete = () => resolve(written);
        tx.onerror = () => reject(tx.error ?? new Error('indexedDB update failed'));
        tx.onabort = () => reject(tx.error ?? new Error('indexedDB update aborted'));
      });
    },
  };
}

let backend: PostGameBackend | null = null;
function store(): PostGameBackend {
  if (!backend) backend = typeof indexedDB !== 'undefined' ? idbPostGameBackend() : memoryPostGameBackend();
  return backend;
}
/** Test seam. */
export function setPostGameBackendForTests(next: PostGameBackend | null): void { backend = next; }

/** Drop entries older than the retention window. Returns the keys removed. */
export async function prunePostGameSnapshots(now = Date.now(), maxAge = POST_GAME_MAX_AGE_MS): Promise<string[]> {
  const rows = await store().index();
  const stale = rows.filter((r) => !(r.savedAt > now - maxAge)).map((r) => r.key);
  for (const key of stale) await store().delete(key);
  return stale;
}

export async function savePostGameSnapshot(snapshot: PostGameSnapshot): Promise<void> {
  await store().put(snapshot);
  await prunePostGameSnapshots(snapshot.savedAt);
}

export async function loadPostGameSnapshot(key: string): Promise<PostGameSnapshot | null> {
  try {
    const row = await store().get(key);
    if (!row) return null;
    if ((row as { version?: number }).version !== 7) { await store().delete(key); return null; } // owner 10-13 (v2), 10-15 (v3, turns lost; v4, KO by drive), 10-16 (v5, Steady Footing and chain-push surfs; v6, Luck breaks; v7, Turns cut short): re-tallied, never shown under the new labels
    if (!(row.savedAt > Date.now() - POST_GAME_MAX_AGE_MS)) { await store().delete(key); return null; }
    return row;
  } catch { return null; }
}

/** The keys currently held (after pruning), for marking rows that have details. */
export async function postGameSnapshotKeys(): Promise<Set<string>> {
  try {
    await prunePostGameSnapshots();
    return new Set((await store().index()).map((r) => r.key));
  } catch { return new Set(); }
}

/** One held entry as the Modern Replay blade's "Recently watched" list draws it (owner 11-03, lane 3). */
export interface PostGameSummary {
  key: string;
  server: string;
  gameId: string;
  seat: PostGameSnapshot['seat'];
  savedAt: number;
  home: { name: string; coach: string; race: string };
  away: { name: string; coach: string; race: string };
}

/** The held entries for `server`, newest first, at most `limit` (the games this client saw to the end in the last
 *  7 days: played, spectated or replayed). Read-only; a failing store yields an empty list. */
export async function recentPostGameSummaries(server: string, limit = 8): Promise<PostGameSummary[]> {
  try {
    await prunePostGameSnapshots();
    const index = (await store().index()).filter((r) => r.key.startsWith(`${server}|`)).sort((a, b) => b.savedAt - a.savedAt);
    const out: PostGameSummary[] = [];
    for (const { key } of index) {
      if (out.length >= limit) break;
      const row = await loadPostGameSnapshot(key);
      if (!row) continue;
      const side = (t: { teamName?: string; coach?: string; race?: string } | undefined) => ({ name: t?.teamName ?? '', coach: t?.coach ?? '', race: t?.race ?? '' });
      out.push({ key, server: row.server, gameId: row.gameId, seat: row.seat, savedAt: row.savedAt, home: side(row.game?.teamHome), away: side(row.game?.teamAway) });
    }
    return out;
  } catch { return []; }
}

/**
 * Owner 10-10: a spectated game's pre-join dice can be imported AFTER its Details were saved (the replay download
 * outlived the end screen - or the view). Replace the saved entry's tallies and coverage; everything else it holds
 * stays as it was captured. No entry for that game = nothing is written. Returns whether an entry was updated.
 */
export async function refreshPostGameDice(key: string, dice: (snapshot: PostGameSnapshot) => Pick<PostGameSnapshot, 'tallies' | 'diceCoverage'> | null): Promise<boolean> {
  try {
    // one read-modify-write on the row as it is stored NOW: a capture that lands just before is kept whole, and only
    // its tallies and coverage are replaced
    return await store().update(key, (current) => {
      const next = dice(current);
      return next ? { ...current, tallies: next.tallies, diceCoverage: next.diceCoverage } : null;
    });
  } catch (error) { console.warn('[postGame] cache refresh failed', error); return false; }
}
