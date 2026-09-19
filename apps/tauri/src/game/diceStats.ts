// Owner 09-17: per-game DICE STATISTICS, tallied from the server's report stream as frames are applied (live play,
// spectate and replay all pass through applyFrameContents). Everything here is derived from stated report fields —
// no client-side dice are ever counted. Feeds the end screen's Dice tab and the Statistics rows for failed
// blocks / dodges.
//
// Attribution: a roll belongs to the team (and player) that ROLLED it. Armour and injury dice are rolled by the
// attacking side, so they ride the attacker latched from the opening `block` report (or the acting player, as the
// log formatter does); dodge / rush / pickup / catch rolls belong to their playerId.
import { reactive } from 'vue';
import type { GameJson } from '@fumbbl40k/ffb-protocol';

export type D6 = 1 | 2 | 3 | 4 | 5 | 6;

export interface DiceTally {
  /** Face counts, index 1..6 (index 0 unused). Every D6 the side rolled: dodge, rush, pickup, catch, pass, armour, injury… */
  d6: number[];
  /** Block-die face counts, index 1..6 (1 attacker down, 2 both down, 3-4 push, 5 stumble, 6 pow). */
  block: number[];
  /** 2D6 armour totals and injury totals, one entry per roll. */
  armour: number[];
  injury: number[];
  /** Owner 09-17: dodge-die face counts (index 1..6); "action" dice = every other D6 that is not an armour,
   *  injury or dodge die (see actionFaces). */
  dodgeFaces: number[];
  /** Armour and injury FACE counts (index 1..6) so actionFaces can subtract them from the all-D6 tally. */
  armourFaces: number[];
  injuryFaces: number[];
  /** Two-or-more-dice blocks where EVERY die came up attacker-down or both-down for a blocker without Block. */
  oneNinth: number;
  /** Two-or-more-dice blocks where every die came up attacker-down (double skulls). */
  oneThirtySixth: number;
  blocks: number;
  /** Blocks whose CHOSEN result put the attacker down (attacker down; both down without Block or Wrestle). */
  failedBlocks: number;
  dodges: number;
  /** Dodge attempts that ended failed (a re-roll that then succeeds cancels the failure). */
  failedDodges: number;
  /** Owner 09-17: pickup attempts and the ones that ended failed, same re-roll rule as dodges. */
  pickups: number;
  failedPickups: number;
  /** Owner 09-17 (fun facts): ordered sequences — every D6 face, every block-die face, and every success-tested
   *  roll (a D6 against a stated minimum) as it happened. */
  d6Seq: number[];
  blockSeq: number[];
  tests: { target: number; ok: boolean; face: number }[];
}

export interface DiceStats {
  gameId: string | null;
  seen: Set<number>;
  teams: Record<string, DiceTally>;
  players: Record<string, DiceTally>;
  /** Report-stream context that spans reports: the attacker of the block sequence in progress. */
  lastBlockAttacker: string | null;
  lastFailedDodge: { playerId: string; teamId: string } | null;
  lastFailedPickup: { playerId: string; teamId: string } | null;
}

export function emptyTally(): DiceTally {
  return { d6: [0, 0, 0, 0, 0, 0, 0], block: [0, 0, 0, 0, 0, 0, 0], armour: [], injury: [],
    dodgeFaces: [0, 0, 0, 0, 0, 0, 0], armourFaces: [0, 0, 0, 0, 0, 0, 0], injuryFaces: [0, 0, 0, 0, 0, 0, 0], oneNinth: 0, oneThirtySixth: 0,
    blocks: 0, failedBlocks: 0, dodges: 0, failedDodges: 0, pickups: 0, failedPickups: 0, d6Seq: [], blockSeq: [], tests: [] };
}

export function emptyDiceStats(gameId: string | null = null): DiceStats {
  return { gameId, seen: new Set(), teams: {}, players: {}, lastBlockAttacker: null, lastFailedDodge: null, lastFailedPickup: null };
}

/** The live tally the end screen reads. Reset whenever a different game's frames start arriving. */
export const diceStats = reactive<DiceStats>(emptyDiceStats()) as DiceStats;

type Report = Record<string, unknown>;
type PlayerLike = { playerId: string; positionId?: string; skillArray?: string[] };
type TeamLike = { teamId: string; playerArray: PlayerLike[]; roster?: { positionArray?: { positionId: string; skillArray?: string[] }[] } };

function isD6(v: unknown): v is D6 { return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 6; }

function teamOf(game: GameJson | null, playerId: string | null): TeamLike | null {
  if (!game || !playerId) return null;
  const home = game.teamHome as unknown as TeamLike;
  const away = game.teamAway as unknown as TeamLike;
  if (home.playerArray.some((p) => p.playerId === playerId)) return home;
  if (away.playerArray.some((p) => p.playerId === playerId)) return away;
  return null;
}

function hasSkill(team: TeamLike | null, playerId: string | null, ...names: string[]): boolean {
  if (!team || !playerId) return false;
  const player = team.playerArray.find((p) => p.playerId === playerId);
  if (!player) return false;
  const position = team.roster?.positionArray?.find((p) => p.positionId === player.positionId);
  const skills = [...(player.skillArray ?? []), ...(position?.skillArray ?? [])].map((s) => String(s).toLowerCase());
  return names.some((n) => skills.includes(n.toLowerCase()));
}

function tallyFor(stats: DiceStats, teamId: string | null, playerId: string | null): DiceTally[] {
  const out: DiceTally[] = [];
  if (teamId) out.push(stats.teams[teamId] ??= emptyTally());
  if (playerId) out.push(stats.players[playerId] ??= emptyTally());
  return out;
}

/** Report ids whose `roll` (or `rolls`) field is an ordinary D6 rolled by `playerId`. */
const D6_ROLL_FIELDS: Record<string, string[]> = {
  dodgeRoll: ['roll'], goForItRoll: ['roll'], pickUpRoll: ['roll'], catchRoll: ['roll'], passRoll: ['roll'],
  interceptionRoll: ['roll'], jumpRoll: ['roll'], leapRoll: ['roll'], standUpRoll: ['roll'], confusionRoll: ['roll'],
  wildAnimalRoll: ['roll'], reallyStupidRoll: ['roll'], takeRootRoll: ['roll'], boneHeadRoll: ['roll'],
  alwaysHungryRoll: ['roll'], escapeRoll: ['roll'], rightStuffRoll: ['roll'], safeThrowRoll: ['roll'],
  foulAppearanceRoll: ['roll'], dauntlessRoll: ['roll'], regenerationRoll: ['roll'], bloodLustRoll: ['roll'],
  hypnoticGazeRoll: ['roll'], animalSavageryRoll: ['roll'], unchannelledFuryRoll: ['roll'], breatheFire: ['roll'],
  steadyFootingRoll: ['roll'], argueTheCall: ['roll'], bribesRoll: ['roll'], throwInRoll: ['roll'],
  kickTeamMateRoll: ['rolls'], scatterBall: [], thrownPlayerRoll: ['rolls'],
};

function pushD6(tallies: DiceTally[], value: unknown, category?: 'armourFaces' | 'injuryFaces' | 'dodgeFaces'): void {
  if (!isD6(value)) return;
  for (const t of tallies) {
    t.d6[value] = (t.d6[value] ?? 0) + 1;
    t.d6Seq.push(value);
    if (category) t[category][value] = (t[category][value] ?? 0) + 1;
  }
}
/** A D6 rolled against a stated minimum (dodge, rush, pickup, catch, pass…): recorded in order for the streak facts. */
function pushTest(tallies: DiceTally[], r: Record<string, unknown>): void {
  const target = Number(r.minimumRoll);
  if (!isD6(r.roll) || !Number.isInteger(target) || target < 2 || target > 6 || typeof r.successful !== 'boolean') return;
  for (const t of tallies) t.tests.push({ target, ok: r.successful, face: r.roll });
}
/** Every D6 that is not an armour, injury or dodge die (index 1..6). */
export function actionFaces(t: DiceTally): number[] {
  return t.d6.map((n, i) => Math.max(0, n - (t.armourFaces[i] ?? 0) - (t.injuryFaces[i] ?? 0) - (t.dodgeFaces[i] ?? 0)));
}
/** 2D6 total counts, index 2..12 (0 and 1 unused). */
export function twoD6Totals(values: readonly number[]): number[] {
  const out = new Array<number>(13).fill(0);
  for (const v of values) if (v >= 2 && v <= 12) out[v] = (out[v] ?? 0) + 1;
  return out;
}
/** The fair share of each 2D6 total, index 2..12. */
export const TWO_D6_SHARE = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1].map((n) => n / 36);

/** Feed one applied frame's reports. `commandNr` de-duplicates re-applied frames (replay seeks re-run history). */
export function ingestDiceReports(stats: DiceStats, gameId: string | null, commandNr: number | null, reports: readonly Report[], game: GameJson | null): void {
  if (gameId !== stats.gameId) {
    const fresh = emptyDiceStats(gameId);
    stats.gameId = fresh.gameId; stats.seen = fresh.seen; stats.teams = fresh.teams; stats.players = fresh.players;
    stats.lastBlockAttacker = null; stats.lastFailedDodge = null; stats.lastFailedPickup = null;
  }
  if (commandNr != null) {
    if (stats.seen.has(commandNr)) return;
    stats.seen.add(commandNr);
  }
  const actingId = typeof game?.actingPlayer?.playerId === 'string' ? game.actingPlayer.playerId : null;
  for (const r of reports) {
    const id = String(r.reportId ?? '');
    const playerId = typeof r.playerId === 'string' ? r.playerId : null;

    if (id === 'block') {
      const attacker = typeof r.attackerId === 'string' ? r.attackerId : playerId ?? actingId;
      stats.lastBlockAttacker = attacker;
      const team = teamOf(game, attacker);
      for (const t of tallyFor(stats, team?.teamId ?? null, attacker)) t.blocks += 1;
      continue;
    }
    if (id === 'blockRoll' || id === 'blockReRoll') {
      const attacker = typeof r.attackerId === 'string' ? r.attackerId : stats.lastBlockAttacker ?? actingId;
      const team = teamOf(game, attacker);
      const faces = Array.isArray(r.blockRoll) ? (r.blockRoll as unknown[]).filter(isD6) : [];
      const tallies = tallyFor(stats, team?.teamId ?? null, attacker);
      for (const face of faces) for (const t of tallies) { t.block[face] = (t.block[face] ?? 0) + 1; t.blockSeq.push(face); }
      if (faces.length >= 2) {
        const allSkull = faces.every((f) => f === 1);
        const allBad = faces.every((f) => f === 1 || f === 2);
        if (allSkull) for (const t of tallies) t.oneThirtySixth += 1;
        if (allBad && (allSkull || !hasSkill(team, attacker, 'Block'))) for (const t of tallies) t.oneNinth += 1;
      }
      continue;
    }
    if (id === 'blockChoice') {
      const attacker = typeof r.attackerId === 'string' ? r.attackerId : stats.lastBlockAttacker ?? actingId;
      const team = teamOf(game, attacker);
      const chosen = Array.isArray(r.blockRoll) && typeof r.diceIndex === 'number' ? (r.blockRoll as unknown[])[r.diceIndex] : null;
      const result = String(r.blockResult ?? '');
      const attackerDown = chosen === 1 || /attacker.?down|skull/i.test(result);
      const bothDown = chosen === 2 || /both.?down/i.test(result);
      const failed = attackerDown || (bothDown && !hasSkill(team, attacker, 'Block', 'Wrestle'));
      if (failed) for (const t of tallyFor(stats, team?.teamId ?? null, attacker)) t.failedBlocks += 1;
      continue;
    }
    if (id === 'injury') {
      const attacker = typeof r.attackerId === 'string' ? r.attackerId : stats.lastBlockAttacker ?? actingId;
      const team = teamOf(game, attacker);
      const tallies = tallyFor(stats, team?.teamId ?? null, attacker);
      const armour = Array.isArray(r.armorRoll) ? (r.armorRoll as unknown[]).filter(isD6) : [];
      const injury = Array.isArray(r.injuryRoll) ? (r.injuryRoll as unknown[]).filter(isD6) : [];
      for (const v of armour) pushD6(tallies, v, 'armourFaces');
      for (const v of injury) pushD6(tallies, v, 'injuryFaces');
      if (armour.length === 2) for (const t of tallies) t.armour.push(armour[0]! + armour[1]!);
      if (injury.length === 2) for (const t of tallies) t.injury.push(injury[0]! + injury[1]!);
      continue;
    }
    if (id === 'dodgeRoll') {
      const team = teamOf(game, playerId);
      const tallies = tallyFor(stats, team?.teamId ?? null, playerId);
      pushD6(tallies, r.roll, 'dodgeFaces');
      pushTest(tallies, r);
      const reRolled = r.reRolled === true;
      const successful = r.successful === true;
      if (!reRolled) {
        for (const t of tallies) t.dodges += 1;
        if (!successful) { for (const t of tallies) t.failedDodges += 1; stats.lastFailedDodge = playerId && team ? { playerId, teamId: team.teamId } : null; }
        else stats.lastFailedDodge = null;
      } else if (successful && stats.lastFailedDodge?.playerId === playerId) {
        // The failed attempt was re-rolled into a success: it no longer counts as failed.
        for (const t of tallies) t.failedDodges = Math.max(0, t.failedDodges - 1);
        stats.lastFailedDodge = null;
      }
      continue;
    }
    if (id === 'pickUpRoll') {
      const team = teamOf(game, playerId);
      const tallies = tallyFor(stats, team?.teamId ?? null, playerId);
      pushD6(tallies, r.roll);
      pushTest(tallies, r);
      const reRolled = r.reRolled === true;
      const successful = r.successful === true;
      if (!reRolled) {
        for (const t of tallies) t.pickups += 1;
        if (!successful) { for (const t of tallies) t.failedPickups += 1; stats.lastFailedPickup = playerId && team ? { playerId, teamId: team.teamId } : null; }
        else stats.lastFailedPickup = null;
      } else if (successful && stats.lastFailedPickup?.playerId === playerId) {
        for (const t of tallies) t.failedPickups = Math.max(0, t.failedPickups - 1);
        stats.lastFailedPickup = null;
      }
      continue;
    }
    const fields = D6_ROLL_FIELDS[id];
    if (fields) {
      const team = teamOf(game, playerId ?? actingId);
      const tallies = tallyFor(stats, team?.teamId ?? null, playerId ?? actingId);
      for (const f of fields) {
        const v = r[f];
        if (Array.isArray(v)) for (const x of v) pushD6(tallies, x);
        else pushD6(tallies, v);
      }
      if (fields.includes('roll')) pushTest(tallies, r);
    }
  }
}

// ---- likelihood maths (the view's "standard deviation plots") ----

export interface Likelihood { n: number; mean: number; expected: number; z: number; percentile: number }

/** Standard normal CDF (Abramowitz-Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2; // erf argument
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return 0.5 * (1 + (z < 0 ? -erf : erf));
}

function likelihood(values: number[], expected: number, sd: number): Likelihood {
  const n = values.length;
  if (n === 0) return { n: 0, mean: expected, expected, z: 0, percentile: 50 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const z = (mean - expected) / (sd / Math.sqrt(n));
  return { n, mean, expected, z, percentile: Math.round(normalCdf(z) * 100) };
}

const D6_SD = Math.sqrt(35 / 12); // 1.7078
const TWO_D6_SD = Math.sqrt(35 / 6); // 2.4152
/** Block die "luck value": attacker down 0, both down 1, push 2, stumble 3, pow 4 → mean 2, sd √(5/3). */
const BLOCK_VALUE = [0, 0, 1, 2, 2, 3, 4];
const BLOCK_SD = Math.sqrt(5 / 3);

export function d6Likelihood(t: DiceTally): Likelihood {
  const values: number[] = [];
  for (let f = 1; f <= 6; f++) for (let i = 0; i < (t.d6[f] ?? 0); i++) values.push(f);
  return likelihood(values, 3.5, D6_SD);
}
export function armourLikelihood(t: DiceTally): Likelihood { return likelihood(t.armour, 7, TWO_D6_SD); }
export function injuryLikelihood(t: DiceTally): Likelihood { return likelihood(t.injury, 7, TWO_D6_SD); }
export function blockLikelihood(t: DiceTally): Likelihood {
  const values: number[] = [];
  for (let f = 1; f <= 6; f++) for (let i = 0; i < (t.block[f] ?? 0); i++) values.push(BLOCK_VALUE[f]!);
  return likelihood(values, 2, BLOCK_SD);
}
/** Owner 09-17: the likelihood as "1 in N games" — the chance of dice at least this far from fair in the observed
 *  direction (one-tailed). z = 0 reads 1 in 2; beyond |z| ≈ 4.75 the odds are capped at 1 in 1,000,000. */
export function oneInGames(like: Likelihood): { n: number; capped: boolean } {
  if (like.n === 0) return { n: 2, capped: false };
  const p = 1 - normalCdf(Math.abs(like.z));
  if (p <= 1e-6) return { n: 1_000_000, capped: true };
  return { n: Math.max(1, Math.round(1 / p)), capped: false };
}
export function d6Total(t: DiceTally): number { return t.d6.reduce((a, b) => a + b, 0); }

// ---- fun facts (owner 09-17) ----
export interface DiceFact { label: string; value: string; detail: string }

function longestRun<T>(seq: readonly T[], keep: (v: T) => boolean): number {
  let best = 0, run = 0;
  for (const v of seq) { run = keep(v) ? run + 1 : 0; if (run > best) best = run; }
  return best;
}

/** The least likely string of consecutive SUCCESSFUL tested rolls: the run whose joint chance is smallest. */
export function luckiestStreak(t: DiceTally): { odds: number; targets: number[] } | null {
  let best: { odds: number; targets: number[] } | null = null;
  let p = 1, targets: number[] = [];
  const close = () => { if (targets.length >= 2 && (!best || p < best.odds)) best = { odds: p, targets: [...targets] }; };
  for (const test of t.tests) {
    if (test.ok) { p *= (7 - test.target) / 6; targets.push(test.target); }
    else { close(); p = 1; targets = []; }
  }
  close();
  return best;
}

export function diceFacts(t: DiceTally): DiceFact[] {
  const facts: DiceFact[] = [];
  const streak = luckiestStreak(t);
  if (streak) {
    const n = Math.max(1, Math.round(1 / streak.odds));
    facts.push({ label: 'Luckiest streak', value: `1 in ${n.toLocaleString()}`,
      detail: `${streak.targets.length} in a row\n${streak.targets.map((x) => `${x}+`).join(' · ')}` }); // two lines: count, then the dice
  }
  const noOnes = longestRun(t.d6Seq, (v) => v !== 1);
  if (t.d6Seq.length) facts.push({ label: 'Longest run without a 1', value: `${noOnes} dice`, detail: `of ${t.d6Seq.length} D6 rolled` });
  const sixes = longestRun(t.d6Seq, (v) => v === 6);
  if (sixes >= 2) facts.push({ label: 'Most sixes in a row', value: `${sixes}`, detail: `${t.d6[6] ?? 0} sixes all game` });
  const pows = longestRun(t.blockSeq, (v) => v === 6);
  if (t.blockSeq.length) facts.push({ label: 'Most pows in a row', value: `${pows}`, detail: `${t.block[6] ?? 0} pows in ${t.blockSeq.length} block dice` });
  const skulls = longestRun(t.blockSeq, (v) => v === 1);
  if (skulls >= 2) facts.push({ label: 'Most skulls in a row', value: `${skulls}`, detail: `${t.block[1] ?? 0} skulls all game` });
  if (t.armour.length) {
    const hi = Math.max(...t.armour); const lo = Math.min(...t.armour);
    facts.push({ label: 'Armour rolls', value: `${lo} – ${hi}`, detail: `${t.armour.length} rolls, average ${(t.armour.reduce((a, b) => a + b, 0) / t.armour.length).toFixed(1)}` });
  }
  if (t.injury.length) {
    const hi = Math.max(...t.injury);
    facts.push({ label: 'Biggest injury roll', value: `${hi}`, detail: `${t.injury.length} injury rolls` });
  }
  const failedSixes = t.tests.filter((x) => x.target === 6).length;
  const madeSixes = t.tests.filter((x) => x.target === 6 && x.ok).length;
  if (failedSixes) facts.push({ label: 'Needed a 6', value: `${madeSixes} of ${failedSixes}`, detail: madeSixes ? 'made it' : 'never landed' });
  return facts;
}
export function blockTotal(t: DiceTally): number { return t.block.reduce((a, b) => a + b, 0); }
