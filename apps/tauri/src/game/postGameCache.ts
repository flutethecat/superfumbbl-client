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
}

export function memoryPostGameBackend(): PostGameBackend {
  const rows = new Map<string, PostGameSnapshot>();
  return {
    async get(key) { return rows.get(key) ?? null; },
    async put(s) { rows.set(s.key, s); },
    async delete(key) { rows.delete(key); },
    async index() { return [...rows.values()].map((s) => ({ key: s.key, savedAt: s.savedAt })); },
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
