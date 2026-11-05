import { FUMBBL_SITE, type CoachBadgeStyle } from './settings';

/**
 * Play screen coach card (owner 10-20): the coach's FUMBBL Overall record, win %, CR and status title.
 *
 * Traffic budget (owner): THREE requests at most, all to fumbbl.com, never per-game or per-team data:
 *   1. GET /api/coach/search/<name>  -> [{ id, name }]          (exact, case-insensitive name match)
 *   2. GET /api/coach/get/<id>       -> { id, name, rating }    (`rating` is the status title; by NAME it 404s in text)
 *   3. GET /~<name>                  -> coach page HTML          (only the `.rankings` Overall block is read)
 * One fetch per coach name per session (cached here), re-fetched only on an explicit Refresh. Fail-soft at every
 * step: a failed request leaves whatever the others returned, and `fetchFumbblCoachProfile` never throws.
 *
 * Server-derived: every number shown is one FUMBBL sent, or the win % computed from the record FUMBBL sent.
 */

export interface FumbblCoachRecord { w: number; d: number; l: number }

export interface FumbblOverallRanking {
  title?: string;
  cr?: number;
  record?: FumbblCoachRecord;
  winPct?: number;
}

export interface FumbblCoachProfile extends FumbblOverallRanking {
  /** FUMBBL's spelling of the name when a request returned it, else the name as set in Settings */
  name: string;
  id?: number;
}

export type CoachProfileFetch = (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

// ---- title -> badge slug ----

export const COACH_TITLE_SLUGS = {
  'rookie': 'rookie',
  'experienced': 'experienced',
  'veteran': 'veteran',
  'emerging star': 'emerging-star',
  'star': 'star',
  'super star': 'super-star',
  'mega star': 'mega-star',
  'legend': 'legend',
} as const;
export type CoachTitleSlug = typeof COACH_TITLE_SLUGS[keyof typeof COACH_TITLE_SLUGS];

/** "Super Star" / " super  STAR " / "Mega-Star" -> "super-star" / "mega-star"; anything not one of FUMBBL's eight titles -> undefined. */
export function coachTitleSlug(title: string | undefined | null): CoachTitleSlug | undefined {
  if (typeof title !== 'string') return undefined;
  // Owner 10-25: FUMBBL writes "Mega-Star" (hyphenated) - hyphens / underscores read as the space between the words.
  const key = title.trim().replace(/[-_‐-―]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  return Object.prototype.hasOwnProperty.call(COACH_TITLE_SLUGS, key)
    ? COACH_TITLE_SLUGS[key as keyof typeof COACH_TITLE_SLUGS]
    : undefined;
}

/** Original badge art - never FUMBBL imagery: public/badges/coach (realistic, the default) or public/badges/coach-retro
 *  (pixel art), per the coachBadgeStyle setting (owner 10-20). */
export function coachTitleBadgeUrl(title: string | undefined | null, style: CoachBadgeStyle = 'realistic'): string | undefined {
  const slug = coachTitleSlug(title);
  if (!slug) return undefined;
  return style === 'retro' ? `/badges/coach-retro/${slug}-retro.png` : `/badges/coach/${slug}.png`; // -retro suffix: the app patch flattens image names across folders
}

// ---- pure parsers ----

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function positiveId(value: unknown): number | undefined {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined;
}
function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** /api/coach/search returns every coach whose name CONTAINS the query; only the exact (case-insensitive) one counts. */
export function pickFumbblCoachSearchMatch(payload: unknown, name: string): { id: number; name: string } | undefined {
  if (!Array.isArray(payload)) return undefined; // "No such coach found." and other text bodies
  const wanted = name.trim().toLowerCase();
  if (!wanted) return undefined;
  for (const entry of payload) {
    const row = asObject(entry);
    const id = positiveId(row?.id);
    const rowName = nonEmpty(row?.name);
    if (id !== undefined && rowName && rowName.toLowerCase() === wanted) return { id, name: rowName };
  }
  return undefined;
}

export function parseFumbblCoachGet(payload: unknown): { id?: number; name?: string; title?: string } {
  const data = asObject(payload);
  if (!data) return {};
  const out: { id?: number; name?: string; title?: string } = {};
  const id = positiveId(data.id);
  if (id !== undefined) out.id = id;
  const name = nonEmpty(data.name);
  if (name) out.name = name;
  const title = nonEmpty(data.rating);
  if (title) out.title = title;
  return out;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', sol: '/', frasl: '/', percnt: '%', num: '#',
  colon: ':', comma: ',', period: '.', lpar: '(', rpar: ')', hyphen: '-', dash: '-', ndash: '–', mdash: '—',
};

function codePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}

/** Decimal (&#47;), hex (&#x2F;) and the common named entities; an unknown named entity is left as written. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g, (whole, dec?: string, hex?: string, name?: string) => {
    if (dec !== undefined) return codePoint(Number(dec)) || whole;
    if (hex !== undefined) return codePoint(parseInt(hex, 16)) || whole;
    return NAMED_ENTITIES[(name ?? '').toLowerCase()] ?? whole;
  });
}

function decodeText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ''))
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/** Text of the first `<div class="... <cls> ...">`'s inner html up to the next `</div>` - the ranking cells hold no nested divs. */
function divText(chunk: string, classPattern: string): string | undefined {
  const re = new RegExp(`<div\\b[^>]*\\bclass\\s*=\\s*["'](?:[^"']*\\s)?${classPattern}(?:\\s[^"']*)?["'][^>]*>([\\s\\S]*?)</div>`, 'i');
  const match = re.exec(chunk);
  return match?.[1] !== undefined ? decodeText(match[1]) : undefined;
}

/** The value cell of `<div class="statrow <stat>">`. */
function statValue(chunk: string, stat: string): string | undefined {
  const re = new RegExp(`<div\\b[^>]*\\bclass\\s*=\\s*["'](?:[^"']*\\s)?statrow\\s+(?:[^"']*\\s)?${stat}(?:\\s[^"']*)?["'][^>]*>([\\s\\S]*?)(?=<div\\b[^>]*\\bclass\\s*=\\s*["'][^"']*\\bstatrow\\b|$)`, 'i');
  const row = re.exec(chunk)?.[1];
  return row ? divText(row, 'value') : undefined;
}

function parseNumber(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const match = /-?\d[\d,]*(?:\.\d+)?/.exec(text);
  if (!match) return undefined;
  const n = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

export function parseCoachRecord(text: string | undefined): FumbblCoachRecord | undefined {
  const match = text ? /^\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(text) : null;
  return match ? { w: Number(match[1]), d: Number(match[2]), l: Number(match[3]) } : undefined;
}

/** FUMBBL's formula: a draw is half a win. 20/12/16 -> 54. */
export function computeWinPct(record: FumbblCoachRecord | undefined): number | undefined {
  if (!record) return undefined;
  const games = record.w + record.d + record.l;
  return games > 0 ? Math.round(((record.w + 0.5 * record.d) / games) * 100) : undefined;
}

/** The Overall `.ranking` of the coach page's `.rankings` block; {} when the block (or the Overall entry) is absent. */
export function parseFumbblCoachOverall(html: unknown): FumbblOverallRanking {
  if (typeof html !== 'string') return {};
  const start = /<div\b[^>]*\bclass\s*=\s*["']rankings["'][^>]*>/i.exec(html);
  if (!start) return {};
  const after = html.slice(start.index + start[0].length);
  // The block ends where the coach content starts; cap it so a malformed page cannot drag the whole document in.
  const endMatch = /<div\b[^>]*\bclass\s*=\s*["']coachcontent["']/i.exec(after);
  const block = after.slice(0, endMatch ? endMatch.index : 20_000);
  const chunks = block.split(/<div\b[^>]*\bclass\s*=\s*["']ranking["'][^>]*>/i).slice(1);
  const overall = chunks.find((chunk) => divText(chunk, 'title')?.toLowerCase() === 'overall');
  if (!overall) return {};

  const out: FumbblOverallRanking = {};
  const title = divText(overall, 'level');
  if (title) out.title = title;
  const cr = parseNumber(statValue(overall, 'CR'));
  if (cr !== undefined) out.cr = cr;
  const record = parseCoachRecord(statValue(overall, 'record'));
  if (record) out.record = record;
  const winPct = parseNumber(statValue(overall, 'winp')) ?? computeWinPct(record);
  if (winPct !== undefined) out.winPct = winPct;
  return out;
}

// ---- fetch (fail-soft, cached per session) ----

/** A body FUMBBL sent: JSON when it parses, else the raw text ("No such coach found."). undefined on any failure. */
async function getBody(fetchFn: CoachProfileFetch, url: string, json: boolean): Promise<unknown> {
  try {
    const response = await fetchFn(url);
    if (!response.ok) return undefined;
    const text = await response.text();
    if (!json) return text;
    try { return JSON.parse(text); } catch { return text; }
  } catch {
    return undefined;
  }
}

const cache = new Map<string, Promise<FumbblCoachProfile>>();
/** One coach name, compared case-insensitively and trimmed (the profile cache key; the coach card's history filter). */
export const coachNameKey = (name: string): string => name.trim().toLowerCase();
const cacheKey = coachNameKey;

/**
 * Owner 11-04 ("reducing the number of calls is important... persist it across the 30 games and only discard when it
 * exceeds the list"): profiles that carry data are also SAVED (localStorage), so a restart does not fetch them again.
 * No time expiry: an entry stays until its coach drops out of the recent-games list (pruneStoredCoachProfiles, called
 * by the Play blade with a non-empty list), a forced Refresh replaces it, or the store passes COACH_PROFILE_STORE_MAX
 * entries (least recently used goes first; other screens save profiles too). A failed / empty lookup is never saved.
 * v2 (Sol r1): each entry carries `at`, its last save / use, for the LRU cap.
 */
export const COACH_PROFILE_STORE_KEY = 'sf.fumbblCoachProfiles.v2';
/** The 11-04 first cut (entries were bare profiles); carried into v2, then removed once v2 is written (Sol r2/r3). */
export const COACH_PROFILE_STORE_KEY_V1 = 'sf.fumbblCoachProfiles.v1';
export const COACH_PROFILE_STORE_MAX = 64;
/** `reserved`: a placeholder written BEFORE a lookup to prove the store has room (reserveCoachProfileSlot); never a hit. */
interface StoredProfile { profile: FumbblCoachProfile; at: number; reserved?: true }
type ProfileStore = Record<string, StoredProfile>;
/** The v1 store as v2 entries (bare profiles with data, stamped 0). */
function v1Entries(raw: string | null): ProfileStore {
  const out: ProfileStore = {};
  try {
    const old = raw ? JSON.parse(raw) as unknown : null;
    if (old && typeof old === 'object' && !Array.isArray(old)) {
      for (const [key, p] of Object.entries(old as Record<string, unknown>)) {
        const profile = p as FumbblCoachProfile | null;
        if (profile && typeof profile === 'object' && typeof profile.name === 'string' && hasData(profile)) out[key] = { profile, at: 0 };
      }
    }
  } catch { /* unreadable v1: nothing to carry */ }
  return out;
}
/**
 * Sol r2/r3: v1 is migrated by WRITING v2 first and only then deleting v1. If the v2 write fails (quota), v1 stays
 * and reads are served from it (readStore), so its coaches still cost no request; the next successful v2 write
 * (writeStore) carries them over and deletes v1.
 */
function migrateV1(ls: Storage): void {
  try {
    const raw = ls.getItem(COACH_PROFILE_STORE_KEY_V1);
    if (raw === null) return;
    if (ls.getItem(COACH_PROFILE_STORE_KEY) === null) ls.setItem(COACH_PROFILE_STORE_KEY, JSON.stringify(v1Entries(raw)));
    ls.removeItem(COACH_PROFILE_STORE_KEY_V1);
  } catch { /* no room for v2: keep v1 and read from it */ }
}
function readStore(): ProfileStore {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return {};
    migrateV1(ls);
    const raw = ls.getItem(COACH_PROFILE_STORE_KEY);
    if (raw === null) return v1Entries(ls.getItem(COACH_PROFILE_STORE_KEY_V1));
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ProfileStore = {};
    for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const e = entry as Partial<StoredProfile> | null;
      if (e && typeof e === 'object' && e.profile && typeof e.profile.name === 'string' && typeof e.at === 'number') out[key] = e as StoredProfile;
    }
    return out;
  } catch { return {}; }
}
/** A saved, non-placeholder profile. */
function savedEntry(key: string): StoredProfile | undefined {
  const e = readStore()[key];
  return e && !e.reserved ? e : undefined;
}
/** false when the store could not be written (quota, blocked storage, no localStorage). */
function writeStore(store: ProfileStore): boolean {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return false;
    // Sol r3: placeholders never count against the cap and never push a real profile out
    const all = Object.entries(store);
    const real = all.filter(([, e]) => !e.reserved).sort((x, y) => y[1].at - x[1].at).slice(0, COACH_PROFILE_STORE_MAX);
    const reserved = all.filter(([key, e]) => e.reserved && !real.some(([k]) => k === key));
    ls.setItem(COACH_PROFILE_STORE_KEY, JSON.stringify(Object.fromEntries([...real, ...reserved])));
    if (ls.getItem(COACH_PROFILE_STORE_KEY_V1) !== null) ls.removeItem(COACH_PROFILE_STORE_KEY_V1); // v1 now carried
    return true;
  } catch { return false; }
}
function hasData(p: FumbblCoachProfile): boolean {
  return p.title !== undefined || p.cr !== undefined || p.record !== undefined;
}
/** Save (or re-stamp) one profile; false when the store cannot be written. */
function saveProfile(key: string, profile: FumbblCoachProfile): boolean {
  return writeStore({ ...readStore(), [key]: { profile, at: Date.now() } });
}
/** Sol r4: save a profile the caller already holds (the opponent session's own copy); false when it cannot be saved.
 *  A profile without data is not saved (true: nothing to do). */
export function saveCoachProfile(name: string, profile: FumbblCoachProfile): boolean {
  const key = coachNameKey(name);
  return !key || !hasData(profile) || saveProfile(key, profile);
}
/** Is this coach's profile saved (no request needed)? */
export function hasSavedCoachProfile(name: string): boolean {
  return !!savedEntry(coachNameKey(name));
}
/**
 * Sol r2 (persist-then-fetch): before an EXTRA lookup (a recent-games opponent), write a placeholder as large as a full
 * profile under the coach's key. false = the store has no room / cannot be written, so the caller must not fetch.
 * The real profile replaces it on success; a lookup that returns nothing removes it.
 * Sol r3: a coach with a SAVED profile is never reserved over (the save would clobber it): true without writing - the
 * refreshed profile replaces an entry of the same size, and a failed save there still breaks the cache.
 */
export function reserveCoachProfileSlot(name: string): boolean {
  const key = coachNameKey(name);
  if (!key) return false;
  if (savedEntry(key)) return true;
  const filler: FumbblCoachProfile = { name, id: 999_999_999, title: 'Emerging Star', cr: 9999.99, record: { w: 9999, d: 9999, l: 9999 }, winPct: 100 };
  return writeStore({ ...readStore(), [key]: { profile: filler, at: Date.now(), reserved: true } });
}
function dropReservation(key: string): void {
  const store = readStore();
  if (store[key]?.reserved) { delete store[key]; writeStore(store); }
}
/** Keep only the saved profiles of these coach names (the coach and the recent-games list's opponents). An empty list
 *  (a failed or transient load) prunes nothing. */
export function pruneStoredCoachProfiles(names: Iterable<string>): void {
  const keep = new Set([...names].map(coachNameKey).filter(Boolean));
  if (!keep.size) return;
  const store = readStore();
  const kept = Object.fromEntries(Object.entries(store).filter(([key]) => keep.has(key)));
  if (Object.keys(kept).length !== Object.keys(store).length) writeStore(kept);
}

/** Tests: forget the in-memory cache only (what an app restart does), keeping the saved profiles. */
export function clearFumbblCoachProfileMemoryCache(): void { cache.clear(); }

export function clearFumbblCoachProfileCache(): void {
  cache.clear();
  try { globalThis.localStorage?.removeItem(COACH_PROFILE_STORE_KEY); globalThis.localStorage?.removeItem(COACH_PROFILE_STORE_KEY_V1); } catch { /* ignore */ }
}

async function loadProfile(name: string, fetchFn: CoachProfileFetch): Promise<FumbblCoachProfile> {
  const profile: FumbblCoachProfile = { name };
  try {
    const encoded = encodeURIComponent(name);
    // The coach page is addressed by name, so it runs alongside the search -> get chain.
    const pageRequest = getBody(fetchFn, `${FUMBBL_SITE}/~${encoded}`, false);
    const match = pickFumbblCoachSearchMatch(await getBody(fetchFn, `${FUMBBL_SITE}/api/coach/search/${encoded}`, true), name);
    let apiTitle: string | undefined;
    if (match) {
      profile.id = match.id;
      profile.name = match.name;
      const got = parseFumbblCoachGet(await getBody(fetchFn, `${FUMBBL_SITE}/api/coach/get/${match.id}`, true));
      // The id came from the exact search hit, so get-by-id's name is canonical (a renamed coach shows the new name).
      if (got.name && (got.id === undefined || got.id === match.id)) profile.name = got.name;
      apiTitle = got.title;
    }
    const overall = parseFumbblCoachOverall(await pageRequest);
    const title = overall.title ?? apiTitle;
    if (title) profile.title = title;
    if (overall.cr !== undefined) profile.cr = overall.cr;
    if (overall.record) profile.record = overall.record;
    if (overall.winPct !== undefined) profile.winPct = overall.winPct;
  } catch {
    // fail-soft: whatever was gathered so far
  }
  return profile;
}

/**
 * The coach card's data. Cached per (case-insensitive) name for the session and saved across restarts (above); `force` re-fetches (the Refresh
 * button). Never throws, never retries: a failure is cached like any result until the next forced refresh.
 */
export function fetchFumbblCoachProfile(
  name: string,
  fetchFn: CoachProfileFetch,
  options: { force?: boolean; onSaveFailed?: () => void } = {},
): Promise<FumbblCoachProfile> {
  const trimmed = name.trim();
  if (!trimmed) return Promise.resolve({ name: '' });
  const key = cacheKey(trimmed);
  const cached = cache.get(key);
  if (cached && !options.force) {
    // write-through (Sol r1): a profile pruned from the store while still in memory is saved again on use
    void cached.then((profile) => {
      if (!hasData(profile)) { dropReservation(key); return; } // Sol r3: an empty memory hit leaves no placeholder
      if (!savedEntry(key) && !saveProfile(key, profile)) options.onSaveFailed?.();
    });
    return cached;
  }
  const previous = savedEntry(key)?.profile;
  const saved = options.force ? undefined : previous;
  if (saved) {
    saveProfile(key, saved); // re-stamp: recently used
    const hit = Promise.resolve(saved);
    cache.set(key, hit);
    return hit;
  }
  const request = loadProfile(trimmed, fetchFn).then((profile) => {
    if (!hasData(profile)) {
      dropReservation(key);
      // Sol r3: a Refresh that comes back empty keeps (and shows) the profile already saved
      return previous ?? profile;
    }
    if (!saveProfile(key, profile)) options.onSaveFailed?.();
    return profile;
  });
  cache.set(key, request);
  return request;
}

/** "Record 20/12/16 · 54 % · CR 1624 · +2.0 WAR" - only the parts FUMBBL sent (or the win % / WAR computed from the
 *  record it sent). */
export function coachProfileStatParts(profile: FumbblOverallRanking | null | undefined): string[] {
  return coachProfileStatItems(profile).map((item) => item.text);
}

/** Owner 10-21 (option A, no new requests): expected wins above replacement, where replacement is a .500 coach:
 *  WAR = (W + 0.5 D) - 0.5 G = 0.5 (W - L). Only from a parsed record with games; 0/0/0 -> undefined. */
export function winsAboveReplacement(record: FumbblCoachRecord | undefined): number | undefined {
  if (!record) return undefined;
  const games = record.w + record.d + record.l;
  return games > 0 ? (record.w + 0.5 * record.d) - 0.5 * games : undefined;
}

/** "+2.0" / "−2.5" / "0.0": signed, one decimal, half away from zero (".x5" rounds up in magnitude). */
export function formatWinsAboveReplacement(war: number): string {
  const magnitude = Math.floor(Math.abs(war) * 10 + 0.5 + 1e-9) / 10;
  if (magnitude === 0) return '0.0';
  return `${war < 0 ? '−' : '+'}${magnitude.toFixed(1)}`;
}

export const WAR_TITLE = 'wins above a .500 coach';

/** Owner 10-21 (1.0.252 follow-up): the in-game bar shows the stats as two lines - "Record W/D/L · win %" and
 *  "CR n · ±x.x WAR" - each omitted when none of its parts is available. */
export function coachProfileStatLines(profile: FumbblOverallRanking | null | undefined): { record: { text: string; title?: string }[]; rating: { text: string; title?: string }[] } {
  const items = coachProfileStatItems(profile);
  const isRecord = (text: string) => text.startsWith('Record ') || text.endsWith(' %');
  return { record: items.filter((i) => isRecord(i.text)), rating: items.filter((i) => !isRecord(i.text)) };
}

/** The stats line as parts, each with an optional tooltip / accessible description (the WAR part's). */
export function coachProfileStatItems(profile: FumbblOverallRanking | null | undefined): { text: string; title?: string }[] {
  if (!profile) return [];
  const items: { text: string; title?: string }[] = [];
  if (profile.record) items.push({ text: `Record ${profile.record.w}/${profile.record.d}/${profile.record.l}` });
  if (profile.winPct !== undefined) items.push({ text: `${profile.winPct} %` });
  if (profile.cr !== undefined) items.push({ text: `CR ${profile.cr}` });
  const war = winsAboveReplacement(profile.record);
  if (war !== undefined) items.push({ text: `${formatWinsAboveReplacement(war)} WAR`, title: WAR_TITLE });
  return items;
}
