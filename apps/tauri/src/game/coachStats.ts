/**
 * Owner 11-03 (spec-coach-card-stats-2026-11-03.md): the coach card's performance stats, PURE over the local game
 * history (coachGameHistory.ts). No number here is invented: each is a count, a sum or an average of the server-derived
 * fields a record holds. Win % is FUMBBL's formula (a draw is half a win, fumbblCoachProfile.computeWinPct).
 *
 * Luck sign convention = the end screen's Dice pane: a row's `zShown` > 0 is lucky, < 0 unlucky, 0 about average.
 * Across games the figure is the mean `zShown` of the games whose row was measured; it reads "even" inside +-0.5 (the
 * band the pane's own Luck rows call average), lucky above it, unlucky below.
 */
import { coachNameKey, computeWinPct } from './fumbblCoachProfile';
import { pgSigned } from './postGameProjection';
import { STORED_KIND_MAX_COUNT, emptyBucket, likelihoodOf, validKinds, type LuckBucket } from './diceLuck';
import { COACH_STAT_KEYS, type CoachActionKind, type CoachGameRecord, type CoachLuckKey, type CoachResult, type CoachStatKey, type CoachStatPair } from './coachGameHistory';

export type CoachServerFilter = 'all' | 'fumbbl' | 'super';
export type LuckVerdict = 'lucky' | 'even' | 'unlucky';

/** |mean zShown| below this reads "even". */
export const LUCK_EVEN_BAND = 0.5;

/** Only `coach`'s own games (the coach name the server knew on the seat), compared as the profile compares names:
 *  a second account on the same machine never mixes in. */
export function filterByCoach(games: readonly CoachGameRecord[], coach: string): CoachGameRecord[] {
  const key = coachNameKey(coach);
  return key ? games.filter((g) => coachNameKey(g.coach ?? '') === key) : [];
}

export function filterByServer(games: readonly CoachGameRecord[], filter: CoachServerFilter): CoachGameRecord[] {
  return filter === 'all' ? [...games] : games.filter((g) => g.serverKind === filter);
}

/** Newest first. */
export function newestFirst(games: readonly CoachGameRecord[]): CoachGameRecord[] {
  return [...games].sort((a, b) => b.savedAt - a.savedAt);
}

export interface CoachForm { results: CoachResult[]; streak: { result: CoachResult; count: number } | null }

/** The last `n` results, newest first, and the current streak (the run of the newest result). */
export function coachForm(games: readonly CoachGameRecord[], n = 5): CoachForm {
  const ordered = newestFirst(games);
  const results = ordered.slice(0, n).map((g) => g.result);
  const first = ordered[0]?.result;
  if (!first) return { results, streak: null };
  let run = 0;
  while (run < ordered.length && ordered[run]!.result === first) run++;
  return { results, streak: { result: first, count: run } };
}

export function luckVerdict(mean: number): LuckVerdict {
  return Math.abs(mean) < LUCK_EVEN_BAND ? 'even' : mean > 0 ? 'lucky' : 'unlucky';
}

export interface LuckSummary {
  /** Games in the window whose row was measured. */
  games: number;
  mean: number | null;
  verdict: LuckVerdict | null;
  /** Each measured game's zShown, oldest to newest (the sparkline). */
  points: number[];
}

/** The `key` row over the newest `n` games (`n` = null: every game). */
export function luckSummary(games: readonly CoachGameRecord[], n: number | null = 10, key: CoachLuckKey = 'all'): LuckSummary {
  const window = n == null ? newestFirst(games) : newestFirst(games).slice(0, n);
  const points = window.reverse().map((g) => g.luck?.[key]).filter((f) => !!f && f.measured && f.n > 0).map((f) => f!.zShown);
  if (!points.length) return { games: 0, mean: null, verdict: null, points: [] };
  const mean = points.reduce((a, b) => a + b, 0) / points.length;
  return { games: points.length, mean, verdict: luckVerdict(mean), points };
}

/** A signed figure to one decimal ("+0.8", "−1.2" with a minus sign, "0.0"): the Dice pane's own formatter. */
export const signedLuck = pgSigned;

/** The sparkline as SVG polyline points in a `width` x `height` box; zero sits in the middle, +-4 at the edges. */
export function sparklinePoints(points: readonly number[], width = 60, height = 16, clamp = 4): string {
  if (!points.length) return '';
  const y = (v: number) => (height / 2 - (Math.max(-clamp, Math.min(clamp, v)) / clamp) * (height / 2 - 1)).toFixed(1);
  if (points.length === 1) return `0,${y(points[0]!)} ${width},${y(points[0]!)}`;
  const step = width / (points.length - 1);
  return points.map((v, i) => `${(i * step).toFixed(1)},${y(v)}`).join(' ');
}

export interface RaceRecord { race: string; games: number; w: number; d: number; l: number; winPct: number }

function tallyBy(games: readonly CoachGameRecord[], keyOf: (g: CoachGameRecord) => string): RaceRecord[] {
  const rows = new Map<string, RaceRecord>();
  for (const g of games) {
    const race = keyOf(g) || '?';
    const row = rows.get(race) ?? { race, games: 0, w: 0, d: 0, l: 0, winPct: 0 };
    row.games++;
    if (g.result === 'W') row.w++; else if (g.result === 'D') row.d++; else row.l++;
    rows.set(race, row);
  }
  for (const row of rows.values()) row.winPct = computeWinPct(row) ?? 0;
  return [...rows.values()].sort((a, b) => b.games - a.games || b.winPct - a.winPct || a.race.localeCompare(b.race));
}

/** Every race the coach played, most games first. */
export function raceRecords(games: readonly CoachGameRecord[]): RaceRecord[] {
  return tallyBy(games, (g) => g.myTeam.race);
}

export interface Matchup extends RaceRecord { best: boolean; worst: boolean }

/** The record against EVERY opponent race met, most met first (owner 11-04: the panel's table scrolls, so no cap; `n`
 *  limits it when a caller wants the top few); best / worst flagged when they differ. */
export function matchups(games: readonly CoachGameRecord[], n: number | null = null): Matchup[] {
  const all = tallyBy(games, (g) => g.opponent.race);
  const top = n == null ? all : all.slice(0, n);
  const pcts = top.map((r) => r.winPct);
  const hi = Math.max(...pcts), lo = Math.min(...pcts);
  const flag = top.length > 1 && hi !== lo;
  return top.map((r) => ({ ...r, best: flag && r.winPct === hi, worst: flag && r.winPct === lo }));
}

export interface CoachMatchRecord { coach: string; games: number; w: number; d: number; l: number; winPct: number }

/** Owner 11-04: the record against each opponent COACH. Names merge case-insensitively (coachNameKey, as the profile
 *  compares names) and show the spelling of the newest game; a record without an opponent name is left out. Most games
 *  first, then win %, then the name. */
export function opponentCoaches(games: readonly CoachGameRecord[]): CoachMatchRecord[] {
  const rows = new Map<string, CoachMatchRecord & { seen: number }>();
  for (const g of games) {
    const name = (g.opponent?.coach ?? '').trim();
    const key = coachNameKey(name);
    if (!key) continue;
    const row = rows.get(key) ?? { coach: name, games: 0, w: 0, d: 0, l: 0, winPct: 0, seen: -Infinity };
    row.games++;
    if (g.result === 'W') row.w++; else if (g.result === 'D') row.d++; else row.l++;
    if (g.savedAt >= row.seen) { row.coach = name; row.seen = g.savedAt; }
    rows.set(key, row);
  }
  return [...rows.values()]
    .map(({ seen: _seen, ...row }) => ({ ...row, winPct: computeWinPct(row) ?? 0 }))
    .sort((a, b) => b.games - a.games || b.winPct - a.winPct || a.coach.localeCompare(b.coach));
}

export interface HeadToHead { games: number; w: number; d: number; l: number; winPct: number }

/**
 * Owner 11-04 ("Every intro. Waiting Lobby and game open."): the local coach's record against `opponent`, from the
 * local history only. The same games the coach card counts: `me`'s own games (filterByCoach), and without fork
 * features only the FUMBBL server's (`allServers` false). The current game (`excludeGameId`) never counts itself.
 * Null when either name is missing (nothing to show); `games` 0 = a first meeting.
 */
export function headToHead(games: readonly CoachGameRecord[], opts: {
  me: string | null | undefined; opponent: string | null | undefined; allServers: boolean; excludeGameId?: string | number | null;
}): HeadToHead | null {
  const opp = coachNameKey(opts.opponent ?? '');
  if (!opp || !coachNameKey(opts.me ?? '')) return null;
  const own = filterByCoach(games, opts.me ?? '');
  const scoped = opts.allServers ? own : filterByServer(own, 'fumbbl');
  const skip = opts.excludeGameId == null ? '' : String(opts.excludeGameId).trim();
  const met = scoped.filter((g) => coachNameKey(g.opponent?.coach ?? '') === opp && (!skip || String(g.gameId) !== skip));
  const row = { games: met.length, w: 0, d: 0, l: 0, winPct: 0 };
  for (const g of met) { if (g.result === 'W') row.w++; else if (g.result === 'D') row.d++; else row.l++; }
  row.winPct = computeWinPct(row) ?? 0;
  return row;
}

export interface PerGame { games: number; tdFor: number; tdAgainst: number; casFor: number; casAgainst: number }

export function perGame(games: readonly CoachGameRecord[]): PerGame | null {
  if (!games.length) return null;
  const sum = (f: (g: CoachGameRecord) => number) => games.reduce((a, g) => a + f(g), 0) / games.length;
  return { games: games.length, tdFor: sum((g) => g.tds.for), tdAgainst: sum((g) => g.tds.against), casFor: sum((g) => g.cas.for), casAgainst: sum((g) => g.cas.against) };
}

export interface PerGameStat { key: CoachStatKey; games: number; for: number; against: number }

const finitePair = (p: unknown): p is CoachStatPair => !!p && typeof p === 'object'
  && Number.isFinite((p as CoachStatPair).for) && Number.isFinite((p as CoachStatPair).against);
/** A record's pair for `key`: its `stats` entry when well formed; touchdowns / casualties fall back to the `tds` / `cas`
 *  every record has, so an old record still counts for those two. */
function statPair(g: CoachGameRecord, key: CoachStatKey): CoachStatPair | null {
  const own = (g.stats as Record<string, unknown> | undefined)?.[key];
  if (finitePair(own)) return own;
  const legacy = key === 'touchdowns' ? g.tds : key === 'casualties' ? g.cas : null;
  return finitePair(legacy) ? legacy : null;
}

/** Owner 11-04: the PER GAME rows (Touchdowns, Casualties, Blocks, Fouls, Dodges, SPP), each averaged over ONLY the
 *  games that carry it (older records have no blocks / fouls / dodges / SPP); a stat no game carries is left out. */
export function perGameStats(games: readonly CoachGameRecord[]): PerGameStat[] {
  const rows: PerGameStat[] = [];
  for (const key of COACH_STAT_KEYS) {
    const pairs = games.map((g) => statPair(g, key)).filter((p): p is CoachStatPair => !!p);
    if (!pairs.length) continue;
    const mean = (f: (p: CoachStatPair) => number) => pairs.reduce((a, p) => a + f(p), 0) / pairs.length;
    rows.push({ key, games: pairs.length, for: mean((p) => p.for), against: mean((p) => p.against) });
  }
  return rows;
}

export interface ArmourBreaks { games: number; actual: number; expected: number; rolls: number }

/** Armour breaks against the fair expectation, summed over the games that carry the Armour row's counters. */
export function armourBreaks(games: readonly CoachGameRecord[]): ArmourBreaks | null {
  const held = games.filter((g) => g.armourBreaks && g.luck?.armour?.measured);
  if (!held.length) return null;
  return held.reduce((a, g) => ({ games: a.games + 1, actual: a.actual + g.armourBreaks!.actual, expected: a.expected + g.armourBreaks!.expected, rolls: a.rolls + g.armourBreaks!.rolls }),
    { games: 0, actual: 0, expected: 0, rolls: 0 });
}

export interface DiceWindow { size: number | null; games: number; rows: Record<CoachLuckKey, LuckSummary>; armour: ArmourBreaks | null }

/** Luck by category over the newest 10 / 25 / all games, and armour breaks over the same games. */
export function diceWindows(games: readonly CoachGameRecord[], sizes: readonly (number | null)[] = [10, 25, null]): DiceWindow[] {
  const ordered = newestFirst(games);
  return sizes.map((size) => {
    const window = size == null ? ordered : ordered.slice(0, size);
    return {
      size, games: window.length,
      rows: { all: luckSummary(window, null, 'all'), block: luckSummary(window, null, 'block'), armour: luckSummary(window, null, 'armour'), action: luckSummary(window, null, 'action') },
      armour: armourBreaks(window),
    };
  });
}

/** The oldest game's savedAt (the footer's "since"). */
export function historySince(games: readonly CoachGameRecord[]): number | null {
  return games.length ? Math.min(...games.map((g) => g.savedAt)) : null;
}

/** "9/3/4 · 56%" pieces for a race row. */
export function recordText(r: Pick<RaceRecord, 'w' | 'd' | 'l'>): string { return `${r.w}/${r.d}/${r.l}`; }

// ---- owner 11-04: the Action roll breakdown (the Coach Stats "Details" pop-out) ----

export type ActionRollGroup = 'movement' | 'ballHandling' | 'negativeTraits' | 'other';
export const ACTION_ROLL_GROUPS: readonly ActionRollGroup[] = ['movement', 'ballHandling', 'negativeTraits', 'other'];

/** The group of each roll kind (the server report id; `leapRoll:leap` = a jump made with Leap / Pogo). Anything not
 *  listed is "other". */
const ACTION_ROLL_GROUP: Record<string, ActionRollGroup> = {
  dodgeRoll: 'movement', goForItRoll: 'movement', leapRoll: 'movement', 'leapRoll:leap': 'movement', jumpRoll: 'movement',
  standUpRoll: 'movement', jumpUpRoll: 'movement',
  pickUpRoll: 'ballHandling', catchRoll: 'ballHandling', passRoll: 'ballHandling', interceptionRoll: 'ballHandling',
  throwTeamMateRoll: 'ballHandling', rightStuffRoll: 'ballHandling', safeThrowRoll: 'ballHandling', kickTeamMateRoll: 'ballHandling',
  foulAppearanceRoll: 'negativeTraits', reallyStupidRoll: 'negativeTraits', bloodLustRoll: 'negativeTraits', boneHeadRoll: 'negativeTraits',
  wildAnimalRoll: 'negativeTraits', animalSavageryRoll: 'negativeTraits', takeRootRoll: 'negativeTraits', unchannelledFuryRoll: 'negativeTraits',
  confusionRoll: 'negativeTraits', alwaysHungryRoll: 'negativeTraits', escapeRoll: 'negativeTraits', animosityRoll: 'negativeTraits',
};
export function actionRollGroup(kind: string): ActionRollGroup { return ACTION_ROLL_GROUP[kind] ?? 'other'; }

export interface ActionRollRow {
  kind: string; group: ActionRollGroup;
  /** measured rolls, rolls seen but not measured, passed (measured), the fair expectation of passes */
  n: number; unmeasured: number; passed: number; expected: number;
  /** the Dice pane's own figure over the merged bucket (likelihoodOf), and its lucky / even / unlucky reading */
  zShown: number; verdict: LuckVerdict | null;
}

/** Each roll kind's rolls over the newest `size` games (null = all), the buckets merged across games and scored as one
 *  (likelihoodOf, the Action row's own maths). Kinds never rolled are not listed; grouped, most rolls first. */
export function actionBreakdown(games: readonly CoachGameRecord[], size: number | null = null): ActionRollRow[] {
  const window = size == null ? newestFirst(games) : newestFirst(games).slice(0, size);
  const merged = new Map<string, LuckBucket>();
  for (const g of window) {
    const held = g.actionKinds as unknown;
    if (!held || typeof held !== 'object' || Array.isArray(held)) continue;
    for (const [kind, k] of Object.entries(held as Record<string, unknown>)) {
      const b = merged.get(kind) ?? emptyBucket();
      if (mergeStoredBucket(b, k)) merged.set(kind, b);
    }
  }
  const rows: ActionRollRow[] = [];
  for (const [kind, b] of merged) {
    const row = bucketRow(b);
    if (row) rows.push({ kind, group: actionRollGroup(kind), ...row });
  }
  const groupAt = (g: ActionRollGroup) => ACTION_ROLL_GROUPS.indexOf(g);
  return rows.sort((a, b) => groupAt(a.group) - groupAt(b.group) || (b.n + b.unmeasured) - (a.n + a.unmeasured) || a.kind.localeCompare(b.kind));
}

/** Adds one stored bucket (a CoachActionKind) into `b`; false (and nothing added) when it is malformed (Sol r1 P1:
 *  records are sanitized on read; this is the backstop - never a throw). */
function mergeStoredBucket(b: LuckBucket, raw: unknown): boolean {
  const k = raw as Partial<CoachActionKind> | null;
  if (!k || typeof k !== 'object' || !Number.isFinite(k.n) || !Number.isFinite(k.x6) || !validKinds(k.kinds, STORED_KIND_MAX_COUNT)) return false; // Sol r2: the keys too
  b.n += Number(k.n); b.x6 += Number(k.x6); b.unmeasured += Number(k.unmeasured) || 0;
  for (const [key, c] of Object.entries(k.kinds)) b.kinds[key] = (b.kinds[key] ?? 0) + (Number(c) || 0);
  b.c.passed = (b.c.passed ?? 0) + (Number(k.passed) || 0);
  b.c.expected = (b.c.expected ?? 0) + (Number(k.expected) || 0);
  return true;
}
/** A merged bucket as a table row, scored as one (likelihoodOf, the Dice pane's maths); null when nothing was rolled. */
function bucketRow(b: LuckBucket): Omit<ActionRollRow, 'kind' | 'group'> | null {
  if (b.n + b.unmeasured <= 0) return null;
  const like = b.n > 0 ? likelihoodOf([b]) : null;
  return {
    n: b.n, unmeasured: b.unmeasured, passed: b.c.passed ?? 0, expected: b.c.expected ?? 0,
    zShown: like?.zShown ?? 0, verdict: like ? (like.average ? 'even' : like.zShown > 0 ? 'lucky' : 'unlucky') : null,
  };
}

export type KoRecoveryRow = Omit<ActionRollRow, 'kind' | 'group'>;
/** Owner 11-04: the KO recovery rolls over the newest `size` games (null = all) - mine (`for`) and the opponents'
 *  (`against`), each merged across the games that carry it and scored as one; null for a side with no roll. */
export function koRecoveries(games: readonly CoachGameRecord[], size: number | null = null): { for: KoRecoveryRow | null; against: KoRecoveryRow | null } {
  const window = size == null ? newestFirst(games) : newestFirst(games).slice(0, size);
  const mine = emptyBucket(), theirs = emptyBucket();
  for (const g of window) {
    const ko = g.koRecovery as unknown;
    if (!ko || typeof ko !== 'object' || Array.isArray(ko)) continue;
    mergeStoredBucket(mine, (ko as Record<string, unknown>).for);
    mergeStoredBucket(theirs, (ko as Record<string, unknown>).against);
  }
  return { for: bucketRow(mine), against: bucketRow(theirs) };
}

/** A readable name for a roll kind no label covers: `chompRoll` -> "Chomp", `catchOfTheDay` -> "Catch Of The Day". */
export function actionRollFallbackName(kind: string): string {
  const base = kind.replace(/:.*$/, '').replace(/Roll$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : kind;
}

// ---- owner 11-04: win rate vs the opponent's Coach Rating (the Coach Stats "Extra stats" pop-out) ----

/** The CR bands, lower bound inclusive (1500 is in 1500-1600). One constant: change the bands here. */
export const CR_BANDS: readonly { key: string; min: number | null; max: number | null }[] = [
  { key: 'under1400', min: null, max: 1400 },
  { key: '1400', min: 1400, max: 1500 },
  { key: '1500', min: 1500, max: 1600 },
  { key: '1600', min: 1600, max: 1700 },
  { key: '1700', min: 1700, max: null },
];
export interface CrBandRow { key: string; min: number | null; max: number | null; games: number; w: number; d: number; l: number; winPct: number | null }

/** Every band in order (an empty one too: win % null), and how many games carry no opponent rating. */
export function crBands(games: readonly CoachGameRecord[]): { rows: CrBandRow[]; unrated: number } {
  const rows: CrBandRow[] = CR_BANDS.map((b) => ({ ...b, games: 0, w: 0, d: 0, l: 0, winPct: null }));
  let unrated = 0;
  for (const g of games) {
    const cr = g.opponentCr;
    if (typeof cr !== 'number' || !Number.isFinite(cr)) { unrated++; continue; }
    const row = rows.find((r) => (r.min == null || cr >= r.min) && (r.max == null || cr < r.max));
    if (!row) { unrated++; continue; }
    row.games++;
    if (g.result === 'W') row.w++; else if (g.result === 'D') row.d++; else row.l++;
  }
  for (const row of rows) row.winPct = computeWinPct(row) ?? null;
  return { rows, unrated };
}
