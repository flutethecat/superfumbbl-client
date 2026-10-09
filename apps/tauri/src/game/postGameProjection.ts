/**
 * Owner 09-25: the end-of-game pane's projections, PURE over a PostGameSnapshot (the settled game JSON + both
 * sides' dice tallies + the end-game report feed). SpectateView builds the snapshot live from the store; the
 * Play blade's Details popup replays a cached one — same numbers, same pane (components/PostGamePanel.vue).
 * Moved out of SpectateView.vue (B9-12 G7 / #25-v2 / owner 09-14…09-23 rulings preserved verbatim).
 */
import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { POSTGAME_STATS, teamLogo } from './gameStatRows';
import { TWO_D6_SHARE, actionFaces, armourLikelihood, blockLikelihood, d6Likelihood, diceFacts, emptyTally, injuryLikelihood, oneInGames, twoD6Totals, type DiceFact, type DiceTally, type Likelihood } from './diceStats';
import { addedSkillsLast, playerDetailSkills, type PlayerDetailSkill } from './skillDisplay';
import { sppEarnedThisGame } from './logic/sppEarned';
import { advancementReadiness, advancementsTaken, type AdvancementReadiness } from './postGameAdvancement';
import type { EndGameStatsProjection } from './endGameHudProjection';
import { playerProgress, type ValuePosition } from './playerValue';
import { casualtyTierLabel } from './injuryOutcomeProjection';
import type { RosterInjuryBadge } from './rosterLevelArt';

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
export type PostGamePlayer = {
  playerId: string; nr: number; name: string; position: string; spp: number; addedSkills: string; addedSkillList: { name: string; label: string }[];
  /** Owner 10-02: EVERY skill, sorted like the player portrait (base first, added last; `added` rings the icon gold). */
  skillList?: { name: string; label: string; added: boolean }[];
  /** Owner 10-02: current value in gold (playerValue.ts, the team builder's formula); null = position not on the roster */
  value: number | null;
  /** For the skill-icon lookup (pack icons can be per position). */
  positionId?: string | null;
  /** Owner 10-02: the injury this player suffered this game (or MNG when sitting one out) - replaces the LVL badge. */
  injury?: RosterInjuryBadge | null;
  /** Owner 10-09: the badge is an injury SUFFERED THIS GAME (gold box, like an added skill); see rosterInjuryIsNew. */
  injuryNew?: boolean;
  /** Owner 10-02: advancements taken (the "LVL n" badge; 0 = rookie, no badge) */
  advancements: number;
}; // #25-v2 per-player roster/SPP row (+ owner 09-14 added skills, 09-15 player number)
export interface PostGameSide {
  which: Side;
  team: string;
  coach: string;
  /** Owner 10-02: the team's race (GameJson team.race), the roster team switch's subtext */
  race: string;
  logo: string | null;
  score: number;
  mvps: PostGameMvp[];
  // #25-v2: the roulette cycle pool (all team player names) — presentation only.
  players: string[];
  // #25-v2: per-player roster/SPP summary (name·position·SPP-gained this game), SPP-desc.
  roster: PostGamePlayer[];
  /** Owner 10-02: players still available (isEligibleState) / players on the roster - the team switch's "11/13". */
  eligible?: number;
  rosterSize?: number;
  totals: Record<string, number>;
}
export interface PostGamePublic { home: PostGameSide; away: PostGameSide; winner: PostGameSide | null; draw: boolean }

const num = (r: Record<string, unknown>, k: string) => Number(r[k] ?? 0);
// Game-earned SPP from the serialized achievement fields, not lifetime currentSpps. Owner 10-09: ONE formula for every
// surface - logic/sppEarned.ts mirrors upstream PlayerResult.totalEarnedSpps() on the BB2025 SppMechanic (the team's
// Brawlin' Brutes swap, landings). The fixed 3 / 2 copy that lived here misread those teams and dropped landings.
const teamSpecialRules = (team: unknown) => (team as { specialRules?: string[] } | null | undefined)?.specialRules;

type Roster = { positionArray?: ({ positionId: string; positionName?: string; skillArray?: string[] } & ValuePosition)[]; logoUrl?: string; baseIconPath?: string };

const LINEMAN_WORD = /^(?:line(?:man|men|woman|women|person|people|player|players|orc|orcs))$/i;
/**
 * Owner 10-02: the roster's position label. (a) An exact team-race prefix is dropped ("Dark Elf Blitzer" -> "Blitzer"
 * on a Dark Elf team); (b) then a "<Word(s)> Lineman" (Linewoman / Lineperson / Lineplayer / Linemen ... as the LAST
 * word) renders only the words before it ("Zombie Lineman" -> "Zombie", "Human Lineman" on a non-Human team ->
 * "Human"). A bare "Lineman" stays; other roles ("Wight Blitzer") are untouched. Never empty: falls back to the full name.
 */
export function rosterPositionLabel(positionName: string, race: string | null | undefined): string {
  const full = positionName.trim();
  const r = race?.trim();
  let name = full;
  if (r && name.toLowerCase().startsWith(r.toLowerCase() + ' ')) name = name.slice(r.length + 1).trim() || full;
  const words = name.split(/\s+/);
  if (words.length > 1 && LINEMAN_WORD.test(words[words.length - 1]!)) name = words.slice(0, -1).join(' ');
  return name || full;
}


/** Owner 10-02: the roster's injury badge - the casualty this player is carrying out of this game (the end-of-game
 *  field state, so an apothecary-saved player shows none), most severe first: RIP > lasting stat > NI > SH > BH;
 *  a player who sat this game out on a Miss Next Game shows MNG. KO / stun are not injuries. */
/** Owner 10-02: a player available to this team right now - not knocked out (owner: KO'd players do not count),
 *  not a casualty (BH / SI / RIP), not sitting the game out (MISSING), not sent off (BANNED). */
// Astra review: + EXHAUSTED (0x0e, Sweltering Heat - boxed for the drive, upstream StepEndTurn).
const INELIGIBLE_BASES = new Set([0x05, 0x06, 0x07, 0x08, 0x0a, 0x0d, 0x0e]);
export function isEligibleState(game: GameJson, playerId: string): boolean {
  const data = game.fieldModel?.playerDataArray?.find((d) => d.playerId === playerId);
  return !INELIGIBLE_BASES.has(Number(data?.playerState ?? 0) & 0xff);
}

export function rosterInjuryBadge(game: GameJson, playerId: string, result: Record<string, unknown> | undefined): RosterInjuryBadge | null {
  const data = game.fieldModel?.playerDataArray?.find((d) => d.playerId === playerId);
  const base = Number(data?.playerState ?? 0) & 0xff;
  if (base === 0x0a) return 'mng'; // MISSING: carrying a Miss Next Game into this one
  if (base === 0x05) return 'ko'; // owner 10-02: KO'd players are tracked too (yellow plate)
  if (base < 0x06 || base > 0x08) return null;
  // Astra re-review: a Decay player carries a SECOND casualty (seriousInjuryDecay) - classify both, keep the worst.
  const badges = [result?.seriousInjury, result?.seriousInjuryDecay]
    .map((s) => casualtyTierLabel(s == null ? null : String(s), base))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .map(injuryBadgeForTier);
  if (!badges.length) return null;
  return badges.sort((a, b) => INJURY_SEVERITY.indexOf(a) - INJURY_SEVERITY.indexOf(b))[0]!;
}
/**
 * Owner 10-09 ("use the gold box over the injury to indicate injuries suffered that game"): is the row's badge an
 * injury the player suffered in THIS game? Decided from the server's fields only, the same two the badge reads:
 *  - the player's CURRENT state base in fieldModel.playerDataArray: 0x06 BADLY_HURT, 0x07 SERIOUS_INJURY, 0x08 RIP are
 *    this game's casualty boxes (a player cannot start a game in them), so every casualty badge - BH, SH, NI, a stat
 *    loss, RIP, classified from this game's playerResult.seriousInjury / seriousInjuryDecay - is new: gold.
 *  - 0x0a MISSING (MNG) is a state the player carried INTO the game: not gold. 0x05 KO is not an injury: not gold.
 *  - a casualty the apothecary patched back to the reserves, or a regenerated player, is no longer in 0x06-0x08, so
 *    the row shows no badge at all (and nothing gold), whatever the result's seriousInjury text still says.
 * Lasting injuries from EARLIER games (the roster's niggling / stat losses) have no badge in this row today, so there
 * is nothing of theirs to outline.
 */
export function rosterInjuryIsNew(game: GameJson, playerId: string, badge: RosterInjuryBadge | null | undefined): boolean {
  if (!badge || badge === 'mng' || badge === 'ko') return false;
  const data = game.fieldModel?.playerDataArray?.find((d) => d.playerId === playerId);
  const base = Number(data?.playerState ?? 0) & 0xff;
  return base >= 0x06 && base <= 0x08;
}
/** Most severe first: RIP, a lasting stat loss, NI, SH, BH. */
const INJURY_SEVERITY: readonly RosterInjuryBadge[] = ['rip', 'ma', 'st', 'ag', 'pa', 'av', 'ni', 'sh', 'bh', 'mng'];
function injuryBadgeForTier(tier: NonNullable<ReturnType<typeof casualtyTierLabel>>): RosterInjuryBadge {
  if (tier.tier === 'DEAD') return 'rip';
  if (tier.tier === 'LASTING_INJURY') return (tier.stat ? tier.stat.slice(1).toLowerCase() : 'ni') as RosterInjuryBadge;
  if (tier.tier === 'SERIOUS_INJURY') return 'ni';
  if (tier.tier === 'SERIOUSLY_HURT') return 'sh';
  return 'bh';
}

export function postGameSide(game: GameJson, side: Side): PostGameSide {
  const team = side === 'home' ? game.teamHome : game.teamAway;
  const tr = side === 'home' ? game.gameResult.teamResultHome : game.gameResult.teamResultAway;
  const roster = team.roster as Roster;
  const results = tr.playerResults as unknown as Record<string, unknown>[];
  const totals: Record<string, number> = {};
  for (const { key } of POSTGAME_STATS) {
    if (key === 'spp') totals.spp = results.reduce((a, r) => a + sppEarnedThisGame(r, teamSpecialRules(team)), 0);
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
  // Owner 10-02: EVERY roster player (a Miss-Next-Game player has no playing result but still belongs on the list,
  // showing MNG); the game result supplies the SPP. Players killed in an earlier game are not on the roster at all.
  const resultById = new Map(results.map((r) => [String(r.playerId ?? ''), r]));
  const rosterRows: PostGamePlayer[] = [...team.playerArray]
    .sort((a, b) => (a.playerNr ?? 0) - (b.playerNr ?? 0))
    .map((p) => {
      const r = resultById.get(p.playerId) ?? { playerId: p.playerId };
      const injury = rosterInjuryBadge(game, String(r.playerId ?? ''), r);
      // Owner 09-14: skills beyond the position's base (advancements + in-game grants) pop next to the player.
      // Owner 09-15: the in-game card's projection — a valued skill carries its value ("Hatred (Orc)", "Loner (4+)").
      const position = roster.positionArray?.find((q) => q.positionId === p?.positionId);
      const posSkills = new Set(position?.skillArray ?? []);
      const detail = p ? playerDetailSkills(p, posSkills) : [];
      const addedSkillList = detail.filter((sk) => sk.added).map((sk) => ({ name: sk.name, label: sk.label }));
      const skillList = addedSkillsLast(detail).map((sk) => ({ name: sk.name, label: sk.label, added: sk.added }));
      const addedSkills = addedSkillList.map((sk) => sk.label).join(', ');
      const progress = p ? playerProgress(p, position) : { value: null, advancements: 0 };
      return {
        playerId: String(r.playerId ?? ''), nr: p?.playerNr ?? 0, name: p?.playerName ?? '(unknown)',
        position: rosterPositionLabel(posName(p?.positionId as string | undefined), (team as { race?: string }).race),
        spp: sppEarnedThisGame(r, teamSpecialRules(team)), addedSkills, addedSkillList, skillList, value: progress.value, advancements: progress.advancements,
        injury, injuryNew: rosterInjuryIsNew(game, String(r.playerId ?? ''), injury),
        positionId: (p?.positionId as string | undefined) ?? null,
      };
    })
    .sort((a, b) => b.spp - a.spp); // stable: equal SPP keeps roster-number order
  const eligible = team.playerArray.filter((pl) => isEligibleState(game, pl.playerId)).length;
  return {
    which: side,
    team: team.teamName,
    coach: team.coach,
    race: String((team as { race?: string }).race ?? ''),
    logo: teamLogo(team, side),
    score: tr.score,
    mvps,
    players: team.playerArray.map((pl) => pl.playerName).filter((n): n is string => !!n),
    roster: rosterRows,
    eligible,
    rosterSize: team.playerArray.length,
    totals,
  };
}

/**
 * Owner 10-02: the roster team switch's subtext — "<Race> · (You)" on the local coach's team, "<Race> · <Coach>" on
 * the other one; with no local seat (spectate / replay) both read "<Race> · <Coach>".
 */
export function rosterTeamSubtext(team: Pick<PostGameSide, 'which' | 'race' | 'coach'>, localSide: Side | null | undefined): string {
  const who = localSide && team.which === localSide ? '(You)' : team.coach?.trim();
  return [team.race?.trim(), who].filter((part) => !!part).join(' · ');
}

/** Owner 10-09: the end-game MVP panels are PostGameRoster.vue with these layered on (selection + per-row additions). */
export interface RosterPick {
  eligibleIds: readonly string[];
  selectedIds: readonly string[];
  /** 'checkbox' = several (MVP nomination), 'radio' = exactly one (Assign Touchdown). */
  input: 'checkbox' | 'radio';
  /** The radio group's name / the list's accessible label. */
  label?: string;
}
export interface RosterRowExtra {
  /**
   * Owner 10-09 (pick panes): the SPP the player brought INTO the game (the server's PlayerResult.currentSpps, copied
   * from the roster at load and never added to). With it the row's SPP cell reads "<bank> SPP (+<earned this game>)" -
   * the bracket only when something was earned, never a summed figure (owner's final word, 10-09: "The total should be
   * what they came into the game with. The (+<N>) should be whatever they earned this game"). It is the old nomination
   * list's own format. Without it the cell is the H pane's "<earned> SPP".
   */
  sppBank?: number;
  /** A small team marker after the name: only when one panel has to list players of both teams (see assignTouchdownPanel). */
  teamTag?: string;
  /** MVP awards this game: the row is marked as the awarded MVP (a concession can award the same player twice). */
  awards?: number;
}

/**
 * Owner 10-09: "Assign touchdown will only ever have one team" - ONE fixed roster panel, the MVP nomination's layout.
 * Upstream (ffb-server step/bb2020/end/StepAssignTouchdowns.java) offers findPlayers(game, winningTeam) only, in a
 * dialog addressed to that team. The panel is the team the offered ids belong to. Defensive: should the server ever
 * offer ids from BOTH teams, no offered player is hidden - the one panel lists them all (my team's first) with a team
 * marker per row, and `mixed` tells the view to log a warning. Never a second layout.
 */
export function assignTouchdownPanel(
  teams: { home: PostGameSide; away: PostGameSide }, mine: Side, offeredIds: readonly string[],
): { side: Side; onlyIds: string[]; teams: { home: PostGameSide; away: PostGameSide }; teamTags: Record<string, string>; mixed: boolean } {
  const other: Side = mine === 'home' ? 'away' : 'home';
  const on = (side: Side) => offeredIds.filter((id) => teams[side].roster.some((pl) => pl.playerId === id));
  const [my, their] = [on(mine), on(other)];
  if (!my.length || !their.length) {
    const side = their.length ? other : mine;
    return { side, onlyIds: side === mine ? my : their, teams, teamTags: {}, mixed: false };
  }
  const merged = { ...teams[mine], roster: [...teams[mine].roster, ...teams[other].roster] };
  const teamTags: Record<string, string> = {};
  for (const id of my) teamTags[id] = teams[mine].team;
  for (const id of their) teamTags[id] = teams[other].team;
  return { side: mine, onlyIds: [...my, ...their], teams: { ...teams, [mine]: merged }, teamTags, mixed: true };
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
/** Owner 10-01 (S67): dodges BY TARGET (2+..6+). Per column, bottom to top: GREEN = passed without a re-roll, BLUE =
 *  passed after a re-roll, RED = failed even after a re-roll; the outline is every attempt (its empty part = failed
 *  with no re-roll); `ey` = expected passes WITH re-rolls (owner 10-01 r4):
 *  with p = (7 - target) / 6 and q = 1 - p, an attempt with the Dodge skill re-roll BUILT IN (used or not) expects
 *  1 - q x q (a 3+ = 89%, a 2+ = 97%); any other attempt expects p + q x R x p, R = the side's other re-rolls taken /
 *  other first rolls failed (team re-rolls are a choice, seen only when a dodge fails). A re-roll is never an attempt:
 *  it only decides which field its attempt lands in. */
export interface PgDodgeTargetBar {
  label: string; attempts: number; passed: number; passFirst: number; passReroll: number; failReroll: number; expected: number;
  x: number; w: number; yAttempts: number; hAttempts: number; yFirst: number; hFirst: number; yReroll: number; hReroll: number;
  yFail: number; hFail: number; ey: number;
  /** Baseline of the expected NUMBER: it sits ABOVE the left end of its line (`ey + PG_DODGE_EXP_DY`, owner 10-01),
   *  moved clear of the previous column's outside labels. */
  eny: number;
}
/** One number per colour field (owner 10-01 r2): centred in the field when it is tall enough, else beside it. */
export interface PgDodgeSegLabel { n: number; kind: 'first' | 'reroll' | 'fail'; x: number; y: number; inside: boolean }
export const PG_DODGE_LABEL_MIN_H = 7;
/** Owner 10-01: the expected number rests on top of its line's left end, not beside the line. */
export const PG_DODGE_EXP_DY = -2;
/** Vertical room one 7px number needs; outside labels closer than this are staggered upward (S67 r5, review). */
export const PG_DODGE_LABEL_GAP = 7;
export interface PgDodgeTargetChart { bars: PgDodgeTargetBar[]; attempts: number; passed: number; expected: number; labels: PgDodgeSegLabel[] }
export function pgDodgeTargetChart(byTarget: DiceTally['dodgeByTarget']): PgDodgeTargetChart | null {
  const rows = [2, 3, 4, 5, 6].map((target) => ({ target, ...(byTarget?.[target] ?? { attempts: 0, passFirst: 0, passReroll: 0, failReroll: 0 }) }));
  const attempts = rows.reduce((n, r) => n + r.attempts, 0);
  if (attempts === 0) return null;
  const builtFails = rows.reduce((n, r) => n + (r.builtFails ?? 0), 0);
  const otherFirstFails = rows.reduce((n, r) => n + Math.max(0, r.attempts - r.passFirst), 0) - builtFails;
  const otherRerolls = rows.reduce((n, r) => n + r.passReroll + r.failReroll, 0) - builtFails;
  const rerollRate = otherFirstFails > 0 ? Math.min(1, Math.max(0, otherRerolls / otherFirstFails)) : 0;
  const peak = Math.max(1, ...rows.map((r) => r.attempts));
  const slot = PG_CHART_W / rows.length;
  const scale = (PG_CHART_BASE - PG_CHART_TOP - 10) / peak; // 10 units of headroom for the "passed/attempts" caption
  const bars = rows.map((r, i) => {
    const w = slot * 0.62; const x = i * slot + (slot - w) / 2;
    const hAttempts = r.attempts * scale, hFirst = r.passFirst * scale, hReroll = r.passReroll * scale, hFail = r.failReroll * scale;
    const p = (7 - r.target) / 6; const q = 1 - p;
    const built = Math.min(r.attempts, r.built ?? 0);
    const expected = built * (1 - q * q) + (r.attempts - built) * (p + q * rerollRate * p);
    return {
      label: `${r.target}+`, attempts: r.attempts, passed: r.passFirst + r.passReroll, passFirst: r.passFirst, passReroll: r.passReroll, failReroll: r.failReroll, expected,
      x, w, yAttempts: PG_CHART_BASE - hAttempts, hAttempts, yFirst: PG_CHART_BASE - hFirst, hFirst,
      yReroll: PG_CHART_BASE - hFirst - hReroll, hReroll, yFail: PG_CHART_BASE - hFirst - hReroll - hFail, hFail,
      ey: PG_CHART_BASE - expected * scale, eny: PG_CHART_BASE - expected * scale + PG_DODGE_EXP_DY,
    };
  });
  const labels: PgDodgeSegLabel[] = [];
  let prevOutside: number[] = [];
  for (const b of bars) {
    // the expected number sits in the gap LEFT of the bar, where the previous column's outside labels are: step it clear
    for (let pass = 0; pass < prevOutside.length; pass++) {
      const clash = prevOutside.find((y) => Math.abs(y - b.eny) < PG_DODGE_LABEL_GAP);
      if (clash == null) break;
      b.eny = clash - PG_DODGE_LABEL_GAP;
    }
    const outside: number[] = [];
    for (const [kind, n, y, h] of [['first', b.passFirst, b.yFirst, b.hFirst], ['reroll', b.passReroll, b.yReroll, b.hReroll], ['fail', b.failReroll, b.yFail, b.hFail]] as const) {
      if (n <= 0) continue;
      const inside = h >= PG_DODGE_LABEL_MIN_H;
      let ly = y + h / 2 + 2.5;
      if (!inside) {
        // fields stack upward, so a thin field's number is never closer than one line to the one beneath it
        const below = outside[outside.length - 1];
        if (below != null && below - ly < PG_DODGE_LABEL_GAP) ly = below - PG_DODGE_LABEL_GAP;
        outside.push(ly);
      }
      labels.push({ n, kind, inside, x: inside ? b.x + b.w / 2 : b.x + b.w + 2, y: ly });
    }
    prevOutside = outside;
  }
  return { bars, attempts, passed: bars.reduce((n, b) => n + b.passed, 0), expected: bars.reduce((n, b) => n + b.expected, 0), labels };
}
export interface PgDiceSide {
  team: string; logo: string; charts: PgDiceChartRow[]; oneNinth: number; oneThirtySixth: number;
  /** Owner 10-01: blocks thrown (the Block Dice header shows this, not the number of dice rolled). */
  blocks: number;
  /** Owner 10-01 (S67): dodges by target, above the Dodge dice chart; null when the side never dodged. */
  dodgeTargets: PgDodgeTargetChart | null;
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
    oneNinth: t.oneNinth, oneThirtySixth: t.oneThirtySixth, blocks: t.blocks ?? 0, dodgeTargets: pgDodgeTargetChart(t.dodgeByTarget),
    likelihoods: [
      { label: 'All dice', like: d6Likelihood(t) }, { label: 'Armour', like: armourLikelihood(t) },
      { label: 'Injury', like: injuryLikelihood(t) }, { label: 'Block dice', like: blockLikelihood(t) },
    ],
    facts: diceFacts(t),
  };
}
