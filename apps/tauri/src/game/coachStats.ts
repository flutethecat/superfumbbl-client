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
import type { CoachGameRecord, CoachLuckKey, CoachResult } from './coachGameHistory';

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

/** The record against the opponent races met most often (top `n`); best / worst flagged when they differ. */
export function matchups(games: readonly CoachGameRecord[], n = 5): Matchup[] {
  const top = tallyBy(games, (g) => g.opponent.race).slice(0, n);
  const pcts = top.map((r) => r.winPct);
  const hi = Math.max(...pcts), lo = Math.min(...pcts);
  const flag = top.length > 1 && hi !== lo;
  return top.map((r) => ({ ...r, best: flag && r.winPct === hi, worst: flag && r.winPct === lo }));
}

export interface PerGame { games: number; tdFor: number; tdAgainst: number; casFor: number; casAgainst: number }

export function perGame(games: readonly CoachGameRecord[]): PerGame | null {
  if (!games.length) return null;
  const sum = (f: (g: CoachGameRecord) => number) => games.reduce((a, g) => a + f(g), 0) / games.length;
  return { games: games.length, tdFor: sum((g) => g.tds.for), tdAgainst: sum((g) => g.tds.against), casFor: sum((g) => g.cas.for), casAgainst: sum((g) => g.cas.against) };
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
