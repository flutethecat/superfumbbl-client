/**
 * Owner 09-25: the end-of-game pane's projections, PURE over a PostGameSnapshot (the settled game JSON + both
 * sides' dice tallies + the end-game report feed). SpectateView builds the snapshot live from the store; the
 * Play blade's Details popup replays a cached one — same numbers, same pane (components/PostGamePanel.vue).
 * Moved out of SpectateView.vue (B9-12 G7 / #25-v2 / owner 09-14…09-23 rulings preserved verbatim).
 */
import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { statsMechanicFor } from '@fumbbl40k/ffb-protocol';
import { POSTGAME_STATS, teamLogo } from './gameStatRows';
import { DICE_COVERAGE_TEXT, TWO_D6_SHARE, actionFaces, actionLikelihood, allDiceLikelihood, armourLikelihood, blockLikelihood, diceCoverageNote, diceFacts, emptyTally, turnsLikelihood, oneInOdds, twoD6Totals, type DiceCoverage, type DiceCoverageNote, type DiceFact, type DiceTally, type Likelihood, type TurnsAttackRecord } from './diceStats';
import { normalCdf, normalInv, LUCK_ODDS_CAP, NOT_MEASURED } from './diceLuck';
import { emptyBreaks, oneInX, type BreakEntry, type LuckBreaks } from './luckBreaks';
import type { CutShortEntry } from './turnsCutShort';
import { addedSkillsLast, playerRosterSkills, type RosterSkill } from './skillDisplay';
import { sppEarnedThisGame } from './logic/sppEarned';
import { advancementReadiness, advancementsTaken, type AdvancementReadiness } from './postGameAdvancement';
import type { EndGameStatsProjection } from './endGameHudProjection';
import { isStarOrMercenary, playerProgress, type ValuePosition } from './playerValue';
import { casualtyTierLabel } from './injuryOutcomeProjection';
import type { RosterInjuryBadge } from './rosterLevelArt';
import { $t } from '../i18n';
import { luckAttackDisplay, luckHeadDisplay, luckOutcomeDisplay, luckTailDisplay } from './luckLabelDisplay';

export type Side = 'home' | 'away';

export interface PostGameSnapshot {
  /** 2 (owner 10-13): armour / injury luck trials became attacker-only; a version-1 snapshot holds two-sided trial distributions.
   *  3 (owner 10-15): the injury figure became TURNS LOST; an older snapshot has no turns trials, so it is re-tallied.
   *  4 (owner 10-15): a KO is valued by its drive and each KO recovery roll is its own trial; re-tallied.
   *  5 (owner 10-16): Steady Footing discounts a fall, and a chain push into the crowd is its own trial; re-tallied.
   *  6 (owner 10-16): the Luck row counts lucky and bad breaks (DiceTally.breaks); re-tallied.
   *  7 (owner 10-16): the Turns cut short line (DiceTally.cutShort); re-tallied. */
  version: 7;
  /** `${server}|${gameId}` — the Play blade looks a FUMBBL replay id up as `fumbbl|<id>`. */
  key: string;
  server: string;
  gameId: string;
  seat: 'play' | 'spectate' | 'replay';
  /** ms epoch when the pane settled in this client */
  savedAt: number;
  game: GameJson;
  tallies: { home: DiceTally; away: DiceTally };
  /** Owner 10-10: what a SPECTATED game's tallies cover (absent on play / replay panes and on panes cached earlier). */
  diceCoverage?: DiceCoverage | null;
  endGameStats: EndGameStatsProjection | null;
  defectors: string[] | null;
  /** playerId → renderer portrait data URL, captured at settle time (the renderer is gone by Details time) */
  portraits: Record<string, string>;
}

export function postGameKey(server: string, gameId: string | number): string { return `${server}|${gameId}`; }

/** Owner 10-10: the Dice pane's coverage line for a spectated game - "Whole game", or what is not included. */
export function pgDiceCoverage(snapshot: Pick<PostGameSnapshot, 'diceCoverage'>): { kind: DiceCoverageNote; text: string } | null {
  const kind = diceCoverageNote(snapshot.diceCoverage);
  return kind ? { kind, text: DICE_COVERAGE_TEXT[kind] } : null;
}

// B9-12 G7: full post-game panel — Result / MVP / Statistics phases.
export type PostGameMvp = { name: string; position: string; awards: number; playerId: string }; // #44: playerId → renderer.playerPortrait (no new fetch)
/** One MVP AWARD (not one player): `key` = `${playerId}:${awardIndex}`, stable across re-renders. */
export type PostGameMvpAward = PostGameMvp & { key: string; awardIndex: number };
/** Owner 10-12: "In the event the server awards the same player the MVP, let's display that MVP twice in a concede
 *  scenario. There's no need to dedupe this." Each award the server counted on `playerAwards` (a concession's two
 *  random picks from one list, or EXTRA_MVP) is its own entry; one player's entries stay together, in `mvps` order. */
export function mvpAwardEntries(mvps: readonly PostGameMvp[]): PostGameMvpAward[] {
  return mvps.flatMap((m) => Array.from({ length: Math.max(0, Math.floor(m.awards)) }, (_, awardIndex) => ({ ...m, key: `${m.playerId}:${awardIndex}`, awardIndex })));
}
export type PostGamePlayer = {
  playerId: string; nr: number; name: string; position: string; spp: number; addedSkills: string; addedSkillList: { name: string; label: string }[];
  /** Owner 10-02: EVERY skill, sorted like the player portrait (base first, added last; `added` rings the icon gold). */
  /** Owner 10-10: `innate` = the position's own entry, unchanged (skillDisplay playerRosterSkills) - what "Hide innate
   *  skills" removes. Not the inverse of `added`: a same-name grant or an improved value is neither added nor innate. */
  skillList?: { name: string; label: string; added: boolean; innate?: boolean }[];
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
      const detail = p ? playerRosterSkills(p, position) : [];
      const addedSkillList = detail.filter((sk) => sk.added).map((sk) => ({ name: sk.name, label: sk.label }));
      const skillList = addedSkillsLast(detail).map((sk) => ({ name: sk.name, label: sk.label, added: sk.added, innate: sk.innate }));
      const addedSkills = addedSkillList.map((sk) => sk.label).join(', ');
      const progress = p ? playerProgress(p, position, statsMechanicFor(game)) : { value: null, advancements: 0 };
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
  const roster = team.roster as Roster | null | undefined;
  const rawPosition = roster?.positionArray?.find((p) => p.positionId === positionId)?.positionName ?? positionId.split('.').pop() ?? ''; // Astra 10-17: a partial snapshot may carry no roster
  const race = (team as { race?: string }).race?.trim();
  const startsWithRace = !!race && rawPosition.toLowerCase().startsWith(race.toLowerCase() + ' ');
  return startsWithRace ? rawPosition.slice(race!.length + 1).trim() || rawPosition : rawPosition;
}

// Owner 09-14: the MVP tab lifts the in-game portrait card for the SELECTED award winner (first winner by default) —
// sprite, full skill rail in the user's icon/markings mode, SPP tag (pre-game + this game, upstream
// PlayerDetailComponent:390-395) and, only here, whether the banked SPP already buys the next advancement.
export interface PgMvpCard {
  playerId: string; nr: number; name: string; position: string; positionId: string; portrait: string | null;
  spp: number; sppGain: number; advancement: AdvancementReadiness;
  /** Owner 10-10: the card is the MVP tab's only listing of the player, so each chip carries the roster's `innate` flag
   *  (skillDisplay playerRosterSkills) and the tab's "Hide innate skills" box filters the card by it. */
  skills: RosterSkill[];
  /** Owner 10-10 (the roster row left the MVP tab): what only the row showed - the roster's own projections, so the
   *  card and the Roster tab can never disagree. Value in gold (null = position not on the roster); the injury badge and
   *  whether it was suffered this game; advancements taken (the LVL badge, shown when there is no injury). */
  value: number | null; injury: RosterInjuryBadge | null; injuryNew: boolean; advancements: number;
  /** MVP awards this game (a concession can award one player twice; owner 10-12: the MVP tab then shows two cards). */
  awards: number;
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
  const progress = playerProgress(player, pos);
  // Owner 10-20: "On the MVP pane, let's suppress Badly Hurt / KO results from being displayed. Only lasting injuries
  // that occurred in this game should be present." The card keeps SH / NI / a stat loss / RIP suffered this game (the
  // gold box) and drops BH and KO; a Miss Next Game carried INTO the game (MNG) is not this game's either. The Roster
  // tab's rows are untouched (owner 10-02: KO'd and BH players are tracked there).
  const injury = mvpPaneInjury(rosterInjuryBadge(game, playerId, r as unknown as Record<string, unknown> | undefined));
  return {
    playerId, nr: player.playerNr, name: player.playerName, position: positionNameFor(game, side, player.positionId), positionId: player.positionId,
    portrait, spp, sppGain,
    // Astra 10-10: a star, a mercenary or a dead player never advances, so the card offers no advancement advice.
    advancement: isStarOrMercenary(player, pos) || injury === 'rip' ? null : advancementReadiness(spp + sppGain, taken),
    skills: playerRosterSkills(player, pos), // every skill the player has (owner 09-14), base + acquired, each flagged innate or not
    value: progress.value, advancements: progress.advancements, injury, injuryNew: rosterInjuryIsNew(game, playerId, injury),
    awards: Number((r as { playerAwards?: number } | undefined)?.playerAwards ?? 0),
  };
}

/** Owner 10-20: the MVP card shows only a lasting injury suffered this game - never BH, KO or a carried-in MNG. */
export const MVP_PANE_HIDDEN_INJURIES: ReadonlySet<RosterInjuryBadge> = new Set<RosterInjuryBadge>(['bh', 'ko', 'mng']);
export function mvpPaneInjury(badge: RosterInjuryBadge | null): RosterInjuryBadge | null {
  return badge && MVP_PANE_HIDDEN_INJURIES.has(badge) ? null : badge;
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
  const expectedPath = bars.map((b, i) => `${i === 0 ? 'M' : 'L'}${(i * slot).toFixed(1)} ${b.ey.toFixed(1)} L${((i + 1) * slot).toFixed(1)} ${b.ey.toFixed(1)}`).join(' '); // SVG path DATA (i18n:data)
  return { bars, expectedPath, total };
}
/**
 * Where a standard score sits on the likelihood gauge (viewBox 0 0 200 44, centre 100, edges 10 / 190).
 * Astra N5: straight to |z| = 2.5 on the scale the gauge always had, then the far tail is compressed so the marker
 * keeps moving outward all the way to the 1-in-1,000,000 cap (|z| = 4.75) at the edge - it used to stop at 3.2, so
 * everything rarer than about 1 in 1,455 drew in one place. Monotone; the curve is drawn through the same mapping.
 */
export const PG_GAUGE_LINEAR_Z = 2.5;
export const PG_GAUGE_EDGE_Z = 4.7534243;
const PG_GAUGE_SLOPE = 90 / 3.2;
export function pgGaugeX(z: number): number {
  if (Number.isNaN(z)) return 100;
  const a = Math.min(PG_GAUGE_EDGE_Z, Math.abs(z));
  const knee = PG_GAUGE_LINEAR_Z * PG_GAUGE_SLOPE;
  const off = a <= PG_GAUGE_LINEAR_Z ? a * PG_GAUGE_SLOPE : knee + ((a - PG_GAUGE_LINEAR_Z) / (PG_GAUGE_EDGE_Z - PG_GAUGE_LINEAR_Z)) * (90 - knee);
  return 100 + (z < 0 ? -off : off);
}
/** Owner 11-05: the closing edge of the area under the gauge curve (the Both view shades it in the team colour). */
const PG_GAUGE_AREA_TAIL = ' L190 40 L10 40 Z';
/** Standard normal curve for the likelihood gauges, drawn through pgGaugeX so the marker always sits under it. */
export const PG_GAUGE_CURVE = (() => {
  const pts: string[] = [];
  for (let i = 0; i <= 96; i++) {
    const z = -PG_GAUGE_EDGE_Z + (2 * PG_GAUGE_EDGE_Z * i) / 96;
    const y = 40 - 34 * Math.exp(-0.5 * z * z);
    pts.push(`${i === 0 ? 'M' : 'L'}${pgGaugeX(z).toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(' ');
})();
export const PG_GAUGE_AREA = `${PG_GAUGE_CURVE}${PG_GAUGE_AREA_TAIL}`;
// Owner 09-17: the headline reads "1 in N". Owner 10-09: a tally with no trial data (cached before the rework) and a
// row with no rolls both read "—". Astra F1 / F2 (10-09): the odds are for fair dice ON THE ROLLS THAT WERE MADE (never
// "games"); a result whose one-sided chance is a half or more reads "about average" with the marker on the centre line,
// and otherwise the marker is placed from the same chance the "1 in N" states.
export function pgOdds(like: Likelihood): string {
  if (!like.measured || like.n === 0) return '—';
  const odds = oneInOdds(like);
  return odds ? $t('pg.odds.oneIn', { n: `${odds.n.toLocaleString()}${odds.capped ? '+' : ''}` }) : $t('pg.odds.aboutAverage');
}
export function pgLuck(like: Likelihood): string {
  if (!like.measured) return $t('pg.luck.notMeasured');
  return like.n === 0 ? $t('pg.luck.noRolls') : like.average ? $t('pg.odds.aboutAverage') : like.zShown > 0 ? $t('pg.luck.lucky') : $t('pg.luck.unlucky');
}
/** The sentence behind the number, for the hover text and screen readers. */
export function pgOddsSentence(like: Likelihood): string {
  if (!like.measured) return $t('pg.luck.notMeasured');
  if (like.n === 0) return $t('pg.luck.noRolls');
  if (like.average) return $t('pg.sentence.average');
  return like.zShown > 0 ? $t('pg.sentence.better', { odds: pgOdds(like) }) : $t('pg.sentence.worse', { odds: pgOdds(like) });
}
/** The marker is drawn only for a measured row with at least one trial. */
export function pgHasMarker(like: Likelihood): boolean { return like.measured && like.n > 0; }

// Owner 10-09: each Likelihood row states the plain numbers behind it - what happened, and what fair dice expect.
export interface PgLikelihoodRow {
  key: 'all' | 'armour' | 'turns' | 'luck' | 'cut' | 'action' | 'block';
  label: string;
  like: Likelihood;
  /** Owner 10-15 (the Luck row): the figure shown in place of the "1 in N", and its hover text. */
  value?: string;
  valueTitle?: string;
  /** Owner 10-16 (Injury dice): `value` is the even case (drawn as the other rows draw "about average"), and the
   *  gauge's spoken sentence (in place of pgOddsSentence: these odds are per game, not on the rolls made). */
  valueAverage?: boolean;
  sentence?: string;
  /** The row's numbers as one line (owner 10-10: no longer drawn under the row; `stats` carries the same numbers). */
  summary: string;
  /** Owner 10-10: the same numbers as short labelled lines, for the row's "i" popover. An empty label is a plain line. */
  stats: PgLikelihoodStat[];
  /** The hover text of the "1 in N". */
  detail: string;
}
/** Owner 10-17: a story line as tokens - plain text and the players it names (the view makes each a name chip). */
export type PgStatPart = string | { playerId: string; name: string };
export interface PgLikelihoodStat { label: string; value: string; parts?: PgStatPart[] }
/** Owner 10-17 ("a popup when the user highlights / clicks the name to show which player it was"): who a player id is
 *  on this game's rosters - "#7 Blitzer, Reikland Reavers"; the id itself when he is on neither. */
export function pgPlayerDetail(game: GameJson | null, playerId: string): string {
  if (!game) return playerId;
  for (const side of ['home', 'away'] as Side[]) {
    const team = side === 'home' ? game.teamHome : game.teamAway;
    const player = team.playerArray.find((p) => p.playerId === playerId) as (typeof team.playerArray[number] & { playerNr?: unknown; nr?: unknown; positionId?: unknown }) | undefined;
    if (!player) continue;
    const nr = Number(player.playerNr ?? player.nr);
    const position = typeof player.positionId === 'string' ? positionNameFor(game, side, player.positionId) : '';
    const teamName = String((team as { teamName?: unknown }).teamName ?? '').trim();
    return [Number.isFinite(nr) && nr > 0 ? `#${nr}` : '', position].filter(Boolean).join(' ') + (teamName ? `, ${teamName}` : '') || playerId;
  }
  return playerId;
}
const pgNotMeasured = (): string => $t('pg.notMeasuredForGame');
const exp1 = (v: number | undefined) => (v ?? 0).toFixed(1);
function unmeasuredNote(n: number): string { return n > 0 ? $t('pg.unmeasuredNote', { n }) : ''; }
function unmeasuredStat(n: number): PgLikelihoodStat[] { return n > 0 ? [{ get label() { return $t('cards.postGame.text.notMeasured'); }, value: String(n) }] : []; }
function pgLikelihoodRow(key: PgLikelihoodRow['key'], label: string, like: Likelihood, summary: string, stats: PgLikelihoodStat[], extra = ''): PgLikelihoodRow {
  if (!like.measured) return { key, label, like, summary: pgNotMeasured(), stats: [{ label: '', value: pgNotMeasured() }], get detail() { return $t('cards.postGame.text.thisGameWasSaved'); } };
  if (like.n === 0) return { key, label, like, get summary() { return $t('cards.postGame.text.noRollsP0', { p0: unmeasuredNote(like.unmeasured) }); }, stats: [{ label: '', value: $t('cards.postGame.text.noRolls') }, ...unmeasuredStat(like.unmeasured)], get detail() { return $t('cards.postGame.text.noRolls2'); } };
  const odds = pgOddsSentence(like);
  const sentence = odds.charAt(0).toUpperCase() + odds.slice(1);
  return { key, label, like, summary: summary + unmeasuredNote(like.unmeasured), stats: [...stats, ...unmeasuredStat(like.unmeasured)], detail: extra ? `${sentence} · ${extra}` : sentence };
}
export function pgLikelihoodRows(t: DiceTally): PgLikelihoodRow[] {
  const c = (row: 'armour' | 'action' | 'block') => t.luck?.[row].c ?? {};
  const n = (v: number | undefined) => v ?? 0;
  const all = allDiceLikelihood(t);
  const armour = c('armour'), action = c('action'), block = c('block'), turns = t.luck?.turns?.c ?? {};
  // Each figure is worded ONCE (`value`) and used by both the one-line summary and the popover's labelled line.
  // Owner 10-13: armour and injury cover only the rolls the team made against its opponent, so there is one figure per row.
  const armourValue = n(armour.theirRolls) ? $t('cards.postGame.armourValue.p0BrokenOfP1', { p0: n(armour.theirBroken), p1: n(armour.theirRolls), p2: exp1(armour.theirExpected) }) : '';
  const armourParts = armourValue ? [armourValue] : [];
  const armourStats = armourValue ? [{ get label() { return $t('cards.postGame.armourStats.armour'); }, value: armourValue }] : [];
  // Owner 10-15: the injury row is TURNS LOST (turnsLost.ts): the turns the opponents' victims missed against the turns
  // expected from every attack made (a block's chance to knock down included). Its "Injuries" figure is that number.
  const turnsLike = turnsLikelihood(t);
  const turnsValue = $t('cards.postGame.turnsValue.p0P1Expected', { n: n(turns.lost), p1: exp1(turns.expected) });
  const removals = $t('pg.removals', { cas: n(turns.casualties), ko: n(turns.kos), stun: n(turns.stuns) });
  // Owner 10-15: each KO recovery roll credited to an attacker is its own trial (turnsLost.ts header)
  const recoveries = $t('cards.postGame.recoveries.p0RolledP1Failed', { p0: n(turns.recoveries), p1: n(turns.recoveryFails) });
  const blockLike = blockLikelihood(t);
  const actionLike = actionLikelihood(t);
  const blockGood = $t('cards.postGame.blockGood.p0P1Expected', { p0: n(block.good), p1: exp1(block.goodExpected) });
  const blockBad = $t('cards.postGame.blockBad.p0P1Expected', { p0: n(block.bad), p1: exp1(block.badExpected) });
  return [
    pgLikelihoodRow('all', $t('pg.row.all'), all, $t('pg.summary.rollsMeasured', { n: all.n }), [{ get label() { return $t('cards.postGame.text.rollsMeasured'); }, value: String(all.n) }],
      $t('pg.extra.all')),
    pgLikelihoodRow('armour', $t('pg.row.armour'), armourLikelihood(t), armourParts.join(' · '), armourStats, $t('pg.extra.armour')),
    pgInjuryDiceRow(pgLikelihoodRow('turns', $t('pg.row.injury'), turnsLike, $t('pg.summary.injury', { turnsValue, removals, recoveries, attacks: n(turns.attacks) }),
      [{ get label() { return $t('cards.postGame.text.injuries'); }, value: turnsValue }, { get label() { return $t('cards.postGame.text.results'); }, value: removals }, { get label() { return $t('cards.postGame.text.koRecoveries'); }, value: recoveries }, { get label() { return $t('cards.postGame.text.attacks'); }, value: String(n(turns.attacks)) }],
      $t('pg.extra.injury', { turnsValue }))),
    pgLuckRow(t),
    pgCutShortRow(t),
    pgLikelihoodRow('action', $t('pg.row.action'), actionLike, $t('pg.summary.action', { passed: n(action.passed), n: actionLike.n, expected: exp1(action.expected) }),
      [{ get label() { return $t('cards.postGame.text.passed'); }, value: $t('pg.passedOf', { passed: n(action.passed), n: actionLike.n }) }, { get label() { return $t('cards.postGame.text.expected'); }, value: exp1(action.expected) }],
      $t('pg.extra.action')),
    pgLikelihoodRow('block', $t('pg.row.block'), blockLike,
      $t('pg.summary.block', { blockGood, blockBad, n: blockLike.n }),
      [{ get label() { return $t('cards.postGame.text.defenderDownAvailable'); }, value: blockGood }, { get label() { return $t('cards.postGame.text.attackerDownForced'); }, value: blockBad }, { get label() { return $t('cards.postGame.text.rolls'); }, value: String(blockLike.n) }],
      $t('pg.extra.block')),
  ];
}
/**
 * Owner 11-05 (Dice pane, Likelihood): each gauge reads three ways -
 * - a small tag on the marker line: the PERCENTILE the result falls into for fair dice (50th = dead average);
 * - the "1 in N" in the gauge's top corner, on the side the result fell (right = lucky, left = unlucky);
 * - a word on the right, by how many standard deviations the result sits from expected:
 *     under 1 "Just a game of Blood Bowl" · 1-2 "A bit lucky / unlucky" · 2-3 "Nuffle loves / hates you" ·
 *     3 or more "LUCKER DOG!!!!!" / "Comedy Mega Dicing".
 * `sigma` is signed lucky-positive, from the same chance the marker and the "1 in N" use (Luck and Turns cut short have
 * no exact tail: their own standard score). Nothing is invented: it is the row's own Likelihood, re-read.
 */
export type PgGaugeBand = 'average' | 'bitLucky' | 'bitUnlucky' | 'nuffleLoves' | 'nuffleHates' | 'luckerDog' | 'comedyMegaDicing';
export interface PgGaugeReading {
  sigma: number;
  /** "84th"; '' when the row has nothing measured */
  percentile: string;
  /** the corner "1 in N"; null when there is no rarity to state */
  odds: string | null;
  band: PgGaugeBand | null;
  /** the right-hand word ('—' / "not measured" style text when there is nothing to read) */
  word: string;
}
export function pgGaugeSigma(like: Likelihood): number {
  if (!like.measured || like.n === 0 || like.zShown === 0) return 0;
  const sign = Math.sign(like.zShown);
  if (like.tail < 1) return like.average ? 0 : sign * -normalInv(Math.min(0.5, Math.max(like.tail, 1e-12)));
  return sign * Math.abs(Number.isFinite(like.z) ? like.z : 0);
}
export function pgGaugeBand(sigma: number): PgGaugeBand {
  const a = Math.abs(sigma);
  if (a < 1) return 'average';
  if (a < 2) return sigma > 0 ? 'bitLucky' : 'bitUnlucky';
  if (a < 3) return sigma > 0 ? 'nuffleLoves' : 'nuffleHates';
  return sigma > 0 ? 'luckerDog' : 'comedyMegaDicing';
}
/** English ordinal suffix of a written number ("84" -> "th", "0.3" -> "rd", "11" -> "th"). */
function ordinalSuffix(text: string): string {
  if (text.includes('.')) return 'th'; // Sol r5: a decimal reads "99.2th", "0.3th" (the last digit is not an ordinal)
  const last = Number(text.slice(-1));
  const lastTwo = Number(text.replace(/^.*?(\d{1,2})$/, '$1'));
  if (!text.includes('.') && lastTwo >= 11 && lastTwo <= 13) return 'th';
  return last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th';
}
/** The percentile of a lucky-positive standard score: whole numbers, one decimal in the outer 1 %, capped at 0.1 / 99.9. */
export function pgPercentile(sigma: number): string {
  const p = 100 * normalCdf(sigma);
  if (p >= 99.95) return $t('pg.gauge.percentileTop');
  if (p < 0.05) return $t('pg.gauge.percentileBottom');
  // one decimal only in the outer 1 %; a value that rounds onto a whole number drops its ".0" (Sol r1: never "1.0th")
  const text = (p >= 99 || p < 1 ? p.toFixed(1) : String(Math.round(p))).replace(/\.0$/, '');
  return $t('pg.gauge.percentile', { p: text, suffix: ordinalSuffix(text) });
}
export function pgGaugeWord(band: PgGaugeBand): string {
  switch (band) {
    case 'average': return $t('pg.gauge.band.average');
    case 'bitLucky': return $t('pg.gauge.band.bitLucky');
    case 'bitUnlucky': return $t('pg.gauge.band.bitUnlucky');
    case 'nuffleLoves': return $t('pg.gauge.band.nuffleLoves');
    case 'nuffleHates': return $t('pg.gauge.band.nuffleHates');
    case 'luckerDog': return $t('pg.gauge.band.luckerDog');
    default: return $t('pg.gauge.band.comedyMegaDicing');
  }
}
/** The gauge's spoken text: the word and the percentile, then the odds sentence (just the sentence with nothing measured). */
export function pgGaugeAria(row: PgLikelihoodRow, g: PgGaugeReading, spoken: string): string {
  // Sol r2: Luck and Turns cut short speak counts, not odds - their "1 in N" box is spoken here (the box is aria-hidden)
  const sentence = (row.key === 'luck' || row.key === 'cut') && g.odds ? $t('pg.gauge.ariaOdds', { sentence: spoken, odds: g.odds }) : spoken;
  return g.percentile
    ? $t('pg.gauge.aria', { label: row.label, word: g.word, pct: $t('pg.gauge.percentileTitle', { p: g.percentile }), sentence })
    : $t('pg.gauge.ariaPlain', { label: row.label, sentence });
}
/** The word's hover text: Luck and Turns cut short keep their counts here (they used to be the right-hand figure). */
export function pgGaugeTitle(row: PgLikelihoodRow): string {
  const counts = row.key === 'luck' || row.key === 'cut' ? row.value : '';
  const rest = row.valueTitle ?? row.detail;
  return counts && rest ? $t('pg.gauge.titleJoin', { a: counts, b: rest }) : counts || rest;
}
export function pgGaugeReading(row: PgLikelihoodRow): PgGaugeReading {
  const like = row.like;
  if (!like.measured || like.n === 0) return { sigma: 0, percentile: '', odds: null, band: null, word: '—' };
  // Sol r1: Injury dice is a normal approximation - its own z, not the z read back from the derived tail (that round
  // trip lands a hair inside a band edge: z = 3 read as 2.99998)
  const sigma = row.key === 'turns' && like.zShown !== 0 && Number.isFinite(like.z) ? Math.sign(like.zShown) * Math.abs(like.z) : pgGaugeSigma(like);
  let odds: string | null;
  if (row.key === 'turns') odds = like.average ? null : row.value ?? null; // "1 in N games" (pgInjuryDiceRow)
  else if (row.key === 'luck' || row.key === 'cut') {
    const tail = sigma === 0 ? 1 : 1 - normalCdf(Math.abs(sigma));
    odds = tail >= 0.5 ? null : pgOdds({ ...like, tail, average: false });
  } else odds = like.average ? null : pgOdds(like);
  const band = pgGaugeBand(sigma);
  return { sigma, percentile: pgPercentile(sigma), odds, band, word: pgGaugeWord(band) };
}
/** A signed figure to one decimal: "+6.2", "−3.1" (a minus sign, not a hyphen), "0.0" at zero. */
export function pgSigned(v: number): string {
  const r = Math.round(v * 10) / 10;
  if (r === 0) return '0.0';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}`;
}
/**
 * Owner 10-16: the Turns lost row is labelled INJURY DICE and reads "1 in N games": N = 1 / P(a game at least this far
 * from the expected turns lost, in the observed direction), from the normal approximation with the stored per-trial
 * variances the Luck row uses (z = (actual - expected) / sqrt(sum of variances), the one-sided tail 1 - Phi(|z|)), held
 * to the other rows' bounds (diceLuck.oneInOdds: at least 2, rounded, capped at 1 in 1,000,000+). A tail of one half or
 * more (z = 0 included) is the even case the other rows show: "about average". The gauge marker sits on the same z.
 */
export function pgGamesOdds(like: Likelihood): { like: Likelihood; value: string } {
  if (!like.measured || like.n === 0) return { like, value: pgOdds(like) };
  const z = Number.isFinite(like.z) ? like.z : 0;
  const tail = z === 0 ? 1 : 1 - normalCdf(Math.abs(z));
  const average = tail >= 0.5;
  const games: Likelihood = { ...like, tail, average, zShown: average ? 0 : Math.sign(z) * -normalInv(Math.max(tail, 1 / LUCK_ODDS_CAP)) };
  const odds = pgOdds(games);
  return { like: games, value: average ? odds : $t('cards.postGame.text.oddsGames', { odds }) };
}
function pgInjuryDiceRow(row: PgLikelihoodRow): PgLikelihoodRow {
  if (!row.like.measured || row.like.n === 0) return row;
  const { like, value } = pgGamesOdds(row.like);
  // i18n (Astra r1 #8): whole sentences with the odds as a value (no string surgery on a localised message)
  const odds = pgOdds(like);
  const title = like.average
    ? $t('pg.injuryTitle.average')
    : like.zShown > 0 ? $t('pg.injuryTitle.more', { odds, z: pgSigned(row.like.z) }) : $t('pg.injuryTitle.fewer', { odds, z: pgSigned(row.like.z) });
  const sentence = title.charAt(0).toUpperCase() + title.slice(1);
  return { ...row, like, value, valueAverage: like.average, valueTitle: sentence, detail: sentence, sentence: title };
}
/** One Turns lost trial as a line of the Luck story: "<outcome> on <attack>, turn <N>: +x.x". */
export function pgSwingLine(rec: TurnsAttackRecord): string {
  const label = luckAttackDisplay(rec.label);
  const attack = rec.recovery ? $t('cards.postGame.attack.koRecoveryOfVictimname', { victimName: rec.victimName }) : rec.fall ? $t('cards.postGame.attack.victimnameSOwnLabel', { victimName: rec.victimName, label }) : $t('cards.postGame.attack.labelVsVictimname', { label, victimName: rec.victimName });
  // i18n (Astra r1 #8): outcome and turn phrase are localised whole; rec.outcome itself stays invariant data.
  return $t('cards.postGame.text.outcomeOnAttackWhen', { outcome: luckOutcomeDisplay(rec.outcome), attack, when: pgWhenText(rec.half, rec.turn), p3: pgSigned(rec.actual - rec.expected) });
}
/**
 * Owner 10-16: the LUCK row counts UNLIKELY EVENTS (luckBreaks.ts): "N lucky breaks (E expected)", its hover the bad
 * breaks the same way. A break is an outcome with a chance of UNLIKELY_P or less that went the team's way (a lucky
 * break) or the opponent's (a bad break); the expected numbers are the summed chances of those outcomes before the
 * dice fell. The popover lists the rarest breaks of each kind ("1 in X: <event>, <player>, turn N"). The gauge marker
 * sits at (lucky - expected) / sqrt(sum of each event's variance); no z is printed.
 */
export function pgTeamBreaks(t: DiceTally): LuckBreaks | null {
  if (!t.breaks && !t.breaksTurns) return null;
  const out = emptyBreaks();
  for (const b of [t.breaks, t.breaksTurns]) {
    if (!b) continue;
    out.lucky += b.lucky; out.luckyExpected += b.luckyExpected; out.luckyVar += b.luckyVar;
    out.bad += b.bad; out.badExpected += b.badExpected; out.badVar += b.badVar; out.events += b.events;
    out.log.push(...b.log);
  }
  out.log.sort((a, b) => a.half - b.half || a.slot - b.slot || Math.abs(a.seq) - Math.abs(b.seq));
  if (t.breaks?.played) out.played = [...t.breaks.played];
  return out;
}
/** Owner 10-16: one turnover of the Turns cut short line as a story line: "0.9 of a turn: 3+ dodge failed, Bob, turn 2
 *  (first action, second turn in a row)". */
export function pgCutShortLine(e: CutShortEntry): string { return pgCutShortParts(e).map((part) => typeof part === 'string' ? part : part.name).join(''); }
/** Owner 10-17: the same line as tokens (the roller is a name chip). */
export function pgCutShortParts(e: CutShortEntry): PgStatPart[] {
  const flag = e.streak ? $t('cards.postGame.cutShort.firstActionStreak') : e.firstAction ? $t('cards.postGame.cutShort.firstAction') : '';
  return [$t('cards.postGame.text.p0OfATurn', { p0: e.cost.toFixed(1), label: e.label }), { playerId: e.player, name: e.playerName || e.player }, `, ${pgWhen(e)}${flag}`];
}
/**
 * Owner 10-16: TURNS CUT SHORT, its own line under Luck (turnsCutShort.ts): the share of each turn the team lost to its
 * turnovers, against the shares expected from every turnover-capable roll. "A (E expected)", the hover the difference;
 * the popover lists the turnovers. One-sided: never credited to the opponent. The gauge marker sits at
 * (A - E) / sqrt(sum of share^2 x p x (1 - p)); no z is printed.
 */
function pgCutShortRow(t: DiceTally): PgLikelihoodRow {
  const c = t.cutShort;
  if (!c) return pgLikelihoodRow('cut', $t('cards.postGame.text.turnsCutShort'), NOT_MEASURED, '', [], '');
  const z = c.variance > 1e-12 ? (c.actual - c.expected) / Math.sqrt(c.variance) : 0;
  const like: Likelihood = { measured: true, n: c.rolls, unmeasured: 0, score: c.actual, expected: c.expected, z, tail: 1, average: Math.abs(z) < 0.5, zShown: Math.max(-4, Math.min(4, -z)) };
  if (c.rolls === 0 && c.log.length === 0) return pgLikelihoodRow('cut', $t('cards.postGame.text.turnsCutShort'), { ...like, n: 0 }, '', [], '');
  const value = $t('cards.postGame.value.p0P1Expected', { p0: c.actual.toFixed(1), p1: c.expected.toFixed(1) });
  const diff = $t('cards.postGame.diff.p0TurnsAgainstExpected', { p0: pgSigned(c.actual - c.expected) });
  return {
    key: 'cut', get label() { return $t('cards.postGame.text.turnsCutShort'); }, like, value, valueTitle: diff, valueAverage: like.average, sentence: `${value}; ${diff}`, summary: `${value} · ${diff}`, detail: diff,
    stats: [{ get label() { return $t('cards.postGame.text.turnsCutShort'); }, value: c.actual.toFixed(1) }, { get label() { return $t('cards.postGame.text.expected'); }, value: c.expected.toFixed(1) },
      ...(c.log.length ? [{ label: '', value: 'Turnovers' }, ...c.log.map((e) => ({ label: '', value: pgCutShortLine(e), parts: pgCutShortParts(e) }))] : [])],
  };
}
/** i18n (Astra r1 #8): the turn phrase as one whole message per half. */
function pgWhenText(half: number, turn: number): string {
  return half <= 1 ? $t('cards.postGame.when.turn', { turn }) : half === 2 ? $t('cards.postGame.when.turnHalf2', { turn }) : $t('cards.postGame.when.turnOvertime', { turn });
}
const pgWhen = (e: { half: number; turn: number }) => pgWhenText(e.half, e.turn);
/** One break as a story line: "1 in 6: 5+ dodge made, Bob, turn 3". */
export function pgBreakLine(e: BreakEntry): string {
  return `${oneInX(e.p)}: ${e.label}, ${e.playerName || e.player}, ${pgWhen(e)}`;
}
/** Owner 10-17: the same line as tokens; the attacker and (on an attack) the victim are name chips. Joined, the parts
 *  read exactly as pgBreakLine. */
export function pgBreakParts(e: BreakEntry): PgStatPart[] {
  const who = { playerId: e.player, name: e.playerName || e.player };
  const tail = `, ${pgWhen(e)}`;
  if (e.victim && e.labelHead != null && e.labelTail != null) {
    return [`${oneInX(e.p)}: ${luckHeadDisplay(e.labelHead)}`, { playerId: e.victim, name: e.victimName || e.victim }, `${luckTailDisplay(e.labelTail)}, `, who, tail].filter((part) => part !== '');
  }
  return [`${oneInX(e.p)}: ${e.label}, `, who, tail];
}
const breaksText = (n: number, e: number, kind: 'lucky' | 'bad') => kind === 'lucky'
  ? $t('cards.postGame.breaksText.lucky', { n, expected: e.toFixed(1) })
  : $t('cards.postGame.breaksText.bad', { n, expected: e.toFixed(1) });
function pgLuckRow(t: DiceTally): PgLikelihoodRow {
  const b = pgTeamBreaks(t);
  if (!b) return pgLikelihoodRow('luck', $t('cards.postGame.text.luck'), NOT_MEASURED, '', [], '');
  const z = b.luckyVar > 1e-12 ? (b.lucky - b.luckyExpected) / Math.sqrt(b.luckyVar) : 0;
  const like: Likelihood = { measured: true, n: b.events, unmeasured: 0, score: b.lucky, expected: b.luckyExpected, z, tail: 1, average: Math.abs(z) < 0.5, zShown: Math.max(-4, Math.min(4, z)) };
  if (b.events === 0) return pgLikelihoodRow('luck', $t('cards.postGame.text.luck'), like, '', [], '');
  const value = breaksText(b.lucky, b.luckyExpected, 'lucky');
  const bad = breaksText(b.bad, b.badExpected, 'bad');
  const rarest = (lucky: boolean) => b.log.filter((e) => e.lucky === lucky).sort((x, y) => x.p - y.p || x.half - y.half || x.slot - y.slot).slice(0, 3).map((e) => ({ label: '', value: pgBreakLine(e), parts: pgBreakParts(e) }));
  const luckyLines = rarest(true), badLines = rarest(false);
  const title = `${bad.charAt(0).toUpperCase()}${bad.slice(1)}`;
  return {
    key: 'luck', get label() { return $t('cards.postGame.text.luck'); }, like, value, valueTitle: title, valueAverage: like.average, sentence: `${value}; ${bad}`,
    summary: `${value} · ${bad}`, detail: title,
    stats: [{ get label() { return $t('cards.postGame.text.luckyBreaks'); }, value: $t('cards.postGame.text.luckyP1Expected', { lucky: b.lucky, p1: b.luckyExpected.toFixed(1) }) }, { get label() { return $t('cards.postGame.text.badBreaks'); }, value: $t('cards.postGame.text.badP1Expected', { bad: b.bad, p1: b.badExpected.toFixed(1) }) },
      ...(luckyLines.length ? [{ label: '', value: $t('cards.postGame.text.rarestLuckyBreaks') }, ...luckyLines] : []),
      ...(badLines.length ? [{ label: '', value: $t('cards.postGame.text.rarestBadBreaks') }, ...badLines] : [])],
  };
}
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
  /** Owner 09-17: per COACH (all of the side's dice grouped), not per player. Owner 10-09: results against their fair chance. */
  likelihoods: PgLikelihoodRow[];
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
    { key: 'd6', get title() { return $t('cards.postGame.charts.d6Distribution'); }, chart: pgBarChart(t.d6.slice(1), even, faces) },
    { key: 'action', get title() { return $t('cards.postGame.charts.actionDice'); }, chart: pgBarChart(actionFaces(t).slice(1), even, faces) },
    { key: 'block', get title() { return $t('cards.postGame.charts.blockDice'); }, chart: pgBarChart(t.block.slice(1), even, BLOCK_FACE_LABELS), block: true },
    { key: 'armour', get title() { return $t('cards.postGame.charts.armourDice'); }, chart: pgBarChart(twoD6Totals(t.armour).slice(2), TWO_D6_SHARE.slice(2), totals) },
    { key: 'injury', get title() { return $t('cards.postGame.charts.injuryDice'); }, chart: pgBarChart(twoD6Totals(t.injury).slice(2), TWO_D6_SHARE.slice(2), totals) },
    { key: 'dodge', get title() { return $t('cards.postGame.charts.dodgeDice'); }, chart: pgBarChart(t.dodgeFaces.slice(1), even, faces) },
  ];
  return {
    team: surface?.team ?? fallbackTeam, logo: surface?.logo ?? '', charts,
    oneNinth: t.oneNinth, oneThirtySixth: t.oneThirtySixth, blocks: t.blocks ?? 0, dodgeTargets: pgDodgeTargetChart(t.dodgeByTarget),
    likelihoods: pgLikelihoodRows(t),
    facts: diceFacts(t),
  };
}
