/**
 * Owner 09-25: the end-of-game pane's projections, PURE over a PostGameSnapshot (the settled game JSON + both
 * sides' dice tallies + the end-game report feed). SpectateView builds the snapshot live from the store; the
 * Play blade's Details popup replays a cached one — same numbers, same pane (components/PostGamePanel.vue).
 * Moved out of SpectateView.vue (B9-12 G7 / #25-v2 / owner 09-14…09-23 rulings preserved verbatim).
 */
import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { POSTGAME_STATS, teamLogo } from './gameStatRows';
import { TWO_D6_SHARE, actionFaces, armourLikelihood, blockLikelihood, d6Likelihood, diceFacts, emptyTally, injuryLikelihood, oneInGames, twoD6Totals, type DiceFact, type DiceTally, type Likelihood } from './diceStats';
import { playerDetailSkills, type PlayerDetailSkill } from './skillDisplay';
import { sppEarnedThisGame } from './logic/sppEarned';
import { advancementReadiness, advancementsTaken, type AdvancementReadiness } from './postGameAdvancement';
import type { EndGameStatsProjection } from './endGameHudProjection';

export type Side = 'home' | 'away';

export interface PostGameSnapshot {
  version: 1;
  /** `${server}|${gameId}` — the Play blade looks a FUMBBL replay id up as `fumbbl|<id>`. */
  key: string;
  server: string;
  gameId: string;
  seat: 'play' | 'spectate' | 'replay';
  /** ms epoch when the pane settled in this client */
  savedAt: number;
  game: GameJson;
  tallies: { home: DiceTally; away: DiceTally };
  endGameStats: EndGameStatsProjection | null;
  defectors: string[] | null;
  /** playerId → renderer portrait data URL, captured at settle time (the renderer is gone by Details time) */
  portraits: Record<string, string>;
}

export function postGameKey(server: string, gameId: string | number): string { return `${server}|${gameId}`; }

// B9-12 G7: full post-game panel — Result / MVP / Statistics phases.
export type PostGameMvp = { name: string; position: string; awards: number; playerId: string }; // #44: playerId → renderer.playerPortrait (no new fetch)
export type PostGamePlayer = { playerId: string; nr: number; name: string; position: string; spp: number; addedSkills: string; addedSkillList: { name: string; label: string }[] }; // #25-v2 per-player roster/SPP row (+ owner 09-14 added skills, 09-15 player number)
export interface PostGameSide {
  which: Side;
  team: string;
  coach: string;
  logo: string | null;
  score: number;
  mvps: PostGameMvp[];
  // #25-v2: the roulette cycle pool (all team player names) — presentation only.
  players: string[];
  // #25-v2: per-player roster/SPP summary (name·position·SPP-gained this game), SPP-desc.
  roster: PostGamePlayer[];
  totals: Record<string, number>;
}
export interface PostGamePublic { home: PostGameSide; away: PostGameSide; winner: PostGameSide | null; draw: boolean }

const num = (r: Record<string, unknown>, k: string) => Number(r[k] ?? 0);
// Derive game-earned SPP from serialized achievement fields, not lifetime currentSpps.
const sppEarned = (r: Record<string, unknown>) =>
  num(r, 'playerAwards') * 4 + num(r, 'touchdowns') * 3 + num(r, 'casualties') * 2 +
  num(r, 'interceptions') * 2 + num(r, 'completions') + num(r, 'deflections') +
  num(r, 'completionsWithAdditionalSpp') + num(r, 'casualtiesWithAdditionalSpp') + num(r, 'catchesWithAdditionalSpp');

type Roster = { positionArray?: { positionId: string; positionName?: string; skillArray?: string[] }[]; logoUrl?: string; baseIconPath?: string };

export function postGameSide(game: GameJson, side: Side): PostGameSide {
  const team = side === 'home' ? game.teamHome : game.teamAway;
  const tr = side === 'home' ? game.gameResult.teamResultHome : game.gameResult.teamResultAway;
  const roster = team.roster as Roster;
  const results = tr.playerResults as unknown as Record<string, unknown>[];
  const totals: Record<string, number> = {};
  for (const { key } of POSTGAME_STATS) {
    if (key === 'spp') totals.spp = results.reduce((a, r) => a + sppEarned(r), 0);
    else totals[key] = results.reduce((a, r) => a + num(r, key), 0);
  }
  const posName = (pid: string | undefined) =>
    roster.positionArray?.find((x) => x.positionId === pid)?.positionName ?? pid?.split('.').pop() ?? '';
  const mvps: PostGameMvp[] = results
    .filter((r) => num(r, 'playerAwards') > 0)
    .map((r) => {
      const p = team.playerArray.find((pl) => pl.playerId === r.playerId);
      return { name: p?.playerName ?? '(unknown)', position: posName(p?.positionId as string | undefined), awards: num(r, 'playerAwards'), playerId: String(r.playerId ?? '') };
    });
  // #25-v2: per-player roster — name · position · SPP-gained (same server-authoritative sppEarned as the
  // team total), sorted SPP-desc so the game's standouts head the list.
  const rosterRows: PostGamePlayer[] = results
    .map((r) => {
      const p = team.playerArray.find((pl) => pl.playerId === r.playerId);
      // Owner 09-14: skills beyond the position's base (advancements + in-game grants) pop next to the player.
      // Owner 09-15: the in-game card's projection — a valued skill carries its value ("Hatred (Orc)", "Loner (4+)").
      const posSkills = new Set(roster.positionArray?.find((q) => q.positionId === p?.positionId)?.skillArray ?? []);
      const addedSkillList = p ? playerDetailSkills(p, posSkills).filter((sk) => sk.added).map((sk) => ({ name: sk.name, label: sk.label })) : [];
      const addedSkills = addedSkillList.map((sk) => sk.label).join(', ');
      return { playerId: String(r.playerId ?? ''), nr: p?.playerNr ?? 0, name: p?.playerName ?? '(unknown)', position: posName(p?.positionId as string | undefined), spp: sppEarned(r), addedSkills, addedSkillList };
    })
    .sort((a, b) => b.spp - a.spp);
  return {
    which: side,
    team: team.teamName,
    coach: team.coach,
    logo: teamLogo(team, side),
    score: tr.score,
    mvps,
    players: team.playerArray.map((pl) => pl.playerName).filter((n): n is string => !!n),
    roster: rosterRows,
    totals,
  };
}

export function postGamePublic(game: GameJson | null | undefined): PostGamePublic | null {
  if (!game) return null;
  const home = postGameSide(game, 'home');
  const away = postGameSide(game, 'away');
  const draw = home.score === away.score;
  const winner = draw ? null : home.score > away.score ? home : away;
  return { home, away, winner, draw };
}

/** Owner 09-09: the POSITIONAL only — no race prefix ("Tomb Kings Tomb Guardian" -> "Tomb Guardian"). */
export function positionNameFor(game: GameJson, side: Side, positionId: string): string {
  const team = side === 'home' ? game.teamHome : game.teamAway;
  const roster = team.roster as Roster;
  const rawPosition = roster.positionArray?.find((p) => p.positionId === positionId)?.positionName ?? positionId.split('.').pop() ?? '';
  const race = (team as { race?: string }).race?.trim();
  const startsWithRace = !!race && rawPosition.toLowerCase().startsWith(race.toLowerCase() + ' ');
  return startsWithRace ? rawPosition.slice(race!.length + 1).trim() || rawPosition : rawPosition;
}

// Owner 09-14: the MVP tab lifts the in-game portrait card for the SELECTED award winner (first winner by default) —
// sprite, full skill rail in the user's icon/markings mode, SPP tag (pre-game + this game, upstream
// PlayerDetailComponent:390-395) and, only here, whether the banked SPP already buys the next advancement.
export interface PgMvpCard {
  playerId: string; nr: number; name: string; position: string; positionId: string; portrait: string | null;
  spp: number; sppGain: number; advancement: AdvancementReadiness; skills: PlayerDetailSkill[];
}
export function mvpCardFor(game: GameJson, side: Side, playerId: string, portrait: string | null): PgMvpCard | null {
  const team = side === 'home' ? game.teamHome : game.teamAway;
  const player = team.playerArray.find((pl) => pl.playerId === playerId);
  if (!player) return null;
  const results = side === 'home' ? game.gameResult.teamResultHome.playerResults : game.gameResult.teamResultAway.playerResults;
  const r = results.find((x) => x.playerId === playerId);
  const spp = (r?.currentSpps as number | undefined) ?? 0;
  const sppGain = r ? sppEarnedThisGame(r as unknown as Record<string, unknown>, (team as { specialRules?: string[] }).specialRules) : 0;
  const pos = (team.roster as Roster).positionArray?.find((x) => x.positionId === player.positionId);
  const baseline = new Set(pos?.skillArray ?? []);
  // Advancements already taken: skillArray is the LEARNED list (upstream RosterPlayer.java:680-683; a characteristic
  // improvement rides it as "+MA"/"+ST"/...), counted the BB2025 way (advancementsTaken mirrors bb2025
  // SkillMechanic.countAdvancements). Temporary grants live in temporarySkillsMap, so they never count.
  const taken = advancementsTaken((player.skillArray ?? []).filter((n) => !baseline.has(n)));
  return {
    playerId, nr: player.playerNr, name: player.playerName, position: positionNameFor(game, side, player.positionId), positionId: player.positionId,
    portrait, spp, sppGain,
    advancement: advancementReadiness(spp + sppGain, taken),
    skills: playerDetailSkills(player, baseline), // every skill the player has (owner 09-14), base + acquired
  };
}

/** The side that conceded (server dedicated-fans stats carry it): it forfeits its MVP, so no "Awaiting result". */
export function mvpConcededSides(game: GameJson | null | undefined, endGameStats: EndGameStatsProjection | null | undefined): Record<Side, boolean> {
  const conceded = endGameStats?.dedFans?.concededTeamId ?? null;
  return {
    home: !!game && !!conceded && conceded === game.teamHome.teamId,
    away: !!game && !!conceded && conceded === game.teamAway.teamId,
  };
}

// ---- Dice tab: distributions, expected counts and likelihood plots ----
export const BLOCK_FACE_LABELS = ['AD', 'BD', 'Push', 'Push', 'Stumble', 'Pow'];
export interface PgBar { label: string; count: number; expected: number; x: number; y: number; w: number; h: number; ey: number }
export interface PgChart { bars: PgBar[]; expectedPath: string; total: number }
export const PG_CHART_W = 240; export const PG_CHART_H = 96; export const PG_CHART_BASE = 84; export const PG_CHART_TOP = 8;
export function pgBarChart(counts: number[], expectedShare: number[], labels: string[]): PgChart {
  const total = counts.reduce((a, b) => a + b, 0);
  const expected = expectedShare.map((share) => total * share);
  const peak = Math.max(1, ...counts, ...expected);
  const slot = PG_CHART_W / counts.length;
  const scale = (PG_CHART_BASE - PG_CHART_TOP) / peak;
  const bars = counts.map((count, i) => {
    const w = slot * 0.62; const x = i * slot + (slot - w) / 2; const h = count * scale;
    return { label: labels[i] ?? String(i + 1), count, expected: expected[i]!, x, y: PG_CHART_BASE - h, w, h, ey: PG_CHART_BASE - expected[i]! * scale };
  });
  // the expected count as a dotted step line across each bar (a horizontal line when every share is equal)
  const expectedPath = bars.map((b, i) => `${i === 0 ? 'M' : 'L'}${(i * slot).toFixed(1)} ${b.ey.toFixed(1)} L${((i + 1) * slot).toFixed(1)} ${b.ey.toFixed(1)}`).join(' ');
  return { bars, expectedPath, total };
}
/** Standard normal curve for the likelihood gauges (viewBox 0 0 200 44, z from -3.2 to 3.2). */
export const PG_GAUGE_CURVE = (() => {
  const pts: string[] = [];
  for (let i = 0; i <= 64; i++) {
    const z = -3.2 + (6.4 * i) / 64;
    const y = 40 - 34 * Math.exp(-0.5 * z * z);
    pts.push(`${i === 0 ? 'M' : 'L'}${(100 + z * (90 / 3.2)).toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(' ');
})();
export function pgGaugeX(z: number): number { return 100 + Math.max(-3.2, Math.min(3.2, z)) * (90 / 3.2); }
export function pgZ(like: Likelihood): string { return like.n === 0 ? '—' : `${like.z >= 0 ? '+' : ''}${like.z.toFixed(2)}σ`; }
// Owner 09-17: the headline reads "1 in N" games — the chance of dice at least this far from fair, in this direction.
export function pgOdds(like: Likelihood): string {
  if (like.n === 0) return '—';
  const { n, capped } = oneInGames(like);
  return `1 in ${n.toLocaleString()}${capped ? '+' : ''}`;
}
export function pgLuck(like: Likelihood): string { return like.n === 0 ? 'no rolls' : Math.abs(like.z) < 0.05 ? 'dead average' : like.z > 0 ? 'this lucky' : 'this unlucky'; }
export interface PgDiceChartRow { key: string; title: string; chart: PgChart; block?: boolean }
export interface PgDiceSide {
  team: string; logo: string; charts: PgDiceChartRow[]; oneNinth: number; oneThirtySixth: number;
  /** Owner 09-17: per COACH (all of the side's dice grouped), not per player. */
  likelihoods: { label: string; like: Likelihood }[];
  facts: DiceFact[];
}
export function pgDiceSide(t: DiceTally | undefined, surface: { team: string; logo: string | null } | null, fallbackTeam: string): PgDiceSide {
  t ??= emptyTally();
  const even = [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6];
  const faces = ['1', '2', '3', '4', '5', '6'];
  const totals = ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
  // Owner 09-17: every D6 first, then the block dice, then armour / injury as 2D6 TOTALS (fair share is the
  // 1-2-3-4-5-6-5-4-3-2-1 / 36 triangle), then dodge D6 by face.
  // Owner 09-23: "D6 distribution" leads and the "action" (every other) D6 sits right under it.
  const charts: PgDiceChartRow[] = [
    { key: 'd6', title: 'D6 distribution', chart: pgBarChart(t.d6.slice(1), even, faces) },
    { key: 'action', title: 'Action dice', chart: pgBarChart(actionFaces(t).slice(1), even, faces) },
    { key: 'block', title: 'Block dice', chart: pgBarChart(t.block.slice(1), even, BLOCK_FACE_LABELS), block: true },
    { key: 'armour', title: 'Armour dice', chart: pgBarChart(twoD6Totals(t.armour).slice(2), TWO_D6_SHARE.slice(2), totals) },
    { key: 'injury', title: 'Injury dice', chart: pgBarChart(twoD6Totals(t.injury).slice(2), TWO_D6_SHARE.slice(2), totals) },
    { key: 'dodge', title: 'Dodge dice', chart: pgBarChart(t.dodgeFaces.slice(1), even, faces) },
  ];
  return {
    team: surface?.team ?? fallbackTeam, logo: surface?.logo ?? '', charts,
    oneNinth: t.oneNinth, oneThirtySixth: t.oneThirtySixth,
    likelihoods: [
      { label: 'All dice', like: d6Likelihood(t) }, { label: 'Armour', like: armourLikelihood(t) },
      { label: 'Injury', like: injuryLikelihood(t) }, { label: 'Block dice', like: blockLikelihood(t) },
    ],
    facts: diceFacts(t),
  };
}
