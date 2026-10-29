/**
 * Perf (JLeav 1.0.296, owner "option 2"): the Log pane's rows keep their IDENTITY and their KEY while unchanged.
 *
 * Profiled: the Log rows were keyed by index, so once the visible log hit its cap (about 400 rows, minute 34-38 of a
 * game) every new line shifted every row by one and Vue rewrote all of them, remounting their dice and plates
 * (~15 ms per line early, ~52 ms late; 250-300 ms per block with the debug log on). A row's key is now its object's
 * identity (entries are immutable once pushed), and the rows the view derives (a Graphical expansion, a joined row,
 * a FUMBBL-style row) are memoised on their source objects so the same row is the same object on every recompute.
 * The memoised LogRow component then skips every row whose props did not change: only the new row renders.
 */

const ids = new WeakMap<object, number>();
let nextId = 0;

/** A row's stable key: one number per object, for as long as the object lives. */
export function logRowKey(row: object): number {
  let id = ids.get(row);
  if (id === undefined) {
    id = ++nextId;
    ids.set(row, id);
  }
  return id;
}

/** The keys of one rendered list. The same object twice in one list (never expected) still gets distinct keys - its
 *  later copies are keyed by position, which is what every row had before. */
export function logRowKeys(rows: readonly object[]): (number | string)[] {
  const seen = new Set<number>();
  return rows.map((row, index) => {
    const key = logRowKey(row);
    if (!seen.has(key)) {
      seen.add(key);
      return key;
    }
    return `${key}#${index}`;
  });
}

/** Rows derived from one source object, built once per source (the source is immutable, so the rows are too). */
const derived = new WeakMap<object, readonly object[]>();
export function memoRows<S extends object, R extends object>(source: S, build: (source: S) => R[]): R[] {
  const hit = derived.get(source);
  if (hit) return hit as R[];
  const rows = build(source);
  derived.set(source, rows);
  return rows;
}

/**
 * The spectator / replay log is composed afresh on every read (a copy of each checkpoint row: `{ ...row, kind, time,
 * category }`), so its entries are new objects on every published position. Each copy still carries its checkpoint
 * row's own `source` object; an entry whose content is the same as the one already seen for that `source` is THAT
 * entry again (same text, tokens and fields by identity), so the view keeps it and its row stays put. A row that did
 * change (any field differs) is taken as new. Entries without a `source` object are returned unchanged.
 */
const interned = new WeakMap<object, object>();
export function internLogEntry<T extends object>(entry: T): T {
  const source = (entry as { source?: unknown }).source;
  if (!source || typeof source !== 'object') return entry;
  const prior = interned.get(source) as T | undefined;
  if (prior && prior !== entry && shallowSame(prior, entry)) return prior;
  if (prior !== entry) interned.set(source, entry);
  return entry;
}

function shallowSame(a: object, b: object): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const key of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
  }
  return true;
}
