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
import { effectiveArmour, effectiveStat, playerSkillValue } from '@fumbbl40k/ffb-protocol';
import { dodgeSkillCancelledAt, hasSkill as hasSkillWithGrants } from './logic/availableActions';
import {
  actionTrial, addCount, addTrial, armourBreakThreshold, binaryKey, blockFaceScores, blockRollKey, blockRollScore, emptyLuck, injuryKey,
  injuryScore6, injuryTrial, koWeight6, likelihoodOf, parseDist, twoD6AtLeast, type DiceLuck, type Likelihood, type LuckBucket, type LuckRow,
} from './diceLuck';

export { normalCdf, oneInOdds, type DiceLuck, type Likelihood } from './diceLuck';

export type D6 = 1 | 2 | 3 | 4 | 5 | 6;

/** Owner 10-01 (S67): dodge ATTEMPTS grouped by the number they needed. `attempts` counts first rolls; a re-roll
 *  resolves its attempt as passed-after-re-roll or failed-after-re-roll. Failures with no re-roll = attempts - the
 *  other three. */
export interface DodgeTargetTally {
  attempts: number; passFirst: number; passReroll: number; failReroll: number;
  /** Owner 10-01 r4: attempts with the Dodge SKILL re-roll BUILT IN (the player had Dodge, unused this turn and not
   *  cancelled by Tackle) - whether or not it was needed; `builtFails` = those whose first roll failed (and so were
   *  re-rolled by the skill). Absent on rows tallied before r4. */
  built?: number; builtFails?: number;
}
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
  /** Owner 10-01 (S67): dodge attempts by target number (keys 2..6; absent on tallies cached before this field). */
  dodgeByTarget?: Record<number, DodgeTargetTally>;
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
  /** Owner 09-22: rush (Go For It) attempts and the ones that ended failed, same re-roll rule. */
  rushes: number;
  failedRushes: number;
  /** Owner 09-17 (fun facts): ordered sequences — every D6 face, every block-die face, and every success-tested
   *  roll (a D6 against a stated minimum) as it happened. */
  d6Seq: number[];
  blockSeq: number[];
  tests: { target: number; ok: boolean; face: number }[];
  /** Owner 09-25 (fun facts): one entry per completed team turn — how many players were activated before the
   *  turn ended, and whether it ended in a turnover. */
  turns: { half: number; turn: number; activations: number; turnover: boolean }[];
  /** Owner 10-09: the Likelihood rows' trials - every measured roll scored against its fair chance (diceLuck.ts).
   *  Absent on tallies cached before this field: those rows read "not measured". */
  luck?: DiceLuck;
}

export interface DiceStats {
  gameId: string | null;
  seen: Set<number>;
  teams: Record<string, DiceTally>;
  players: Record<string, DiceTally>;
  /** Report-stream context that spans reports: the attacker of the block sequence in progress. */
  lastBlockAttacker: string | null;
  lastFailedDodge: { playerId: string; teamId: string } | null;
  /** Owner 10-01 r4: the source of the last `reRoll` report per player (a re-rolled dodge reads whether the Dodge skill paid for it). */
  lastRerollSource?: { playerId: string; source: string } | null;
  /** S67 r5 (review): the dodge attempt a reroll belongs to - ONE attempt lands in ONE field of the column of its
   *  FIRST roll, whatever the rerolled roll's own target or command. `passed`/`built` = what the first roll tallied. */
  openDodges?: Record<string, { target: number | null; passed: boolean; built: boolean }>;
  lastFailedPickup: { playerId: string; teamId: string } | null;
  lastFailedRush: { playerId: string; teamId: string } | null;
  /** Owner 09-25: the turn in progress per team — the distinct players activated so far (not serialised). */
  activeTurn: Record<string, { half: number; turn: number; players: Set<string> }>;
  /** Owner 10-09 (luck trials): the defender of the block in progress, whether a `block` report has announced a NEW
   *  roll since the last `blockRoll`, whether that roll rerolled only some of its dice, and the rolls waiting for
   *  the `blockChoice` report (it states who picks). */
  lastBlockDefender?: string | null;
  blockRollArmed?: boolean;
  blockRollPartial?: boolean;
  pendingBlockRolls?: { attacker: string | null; defender: string | null; faces: number[]; blitz: boolean; defenderTacklezones: boolean }[];
  /** The acting player when `lastBlockAttacker` was latched: a different acting player means the latch is stale. */
  lastBlockActing?: string | null;
  /** The block-roll reroll in progress was REFUSED by its own roll (a failed Pro / Loner / Team Mascot): the dice that
   *  follow are re-stated, not rolled. Lives only between a `block` report and its `blockRoll`, inside one frame. */
  rerollGateFailed?: boolean;
  /** Rolls of a Multiple Block that were reported and already counted "not measured", per defender: the rest of that
   *  defender's rolls are counted at its `blockChoice`. */
  multiBlockCounted?: Record<string, number>;
  /** `commandNr|defender|dice` of the last armour / injury roll taken as a trial (one roll is one trial). */
  lastArmourTrial?: string | null;
  lastInjuryTrial?: string | null;
}

export function emptyTally(): DiceTally {
  return { d6: [0, 0, 0, 0, 0, 0, 0], block: [0, 0, 0, 0, 0, 0, 0], armour: [], injury: [],
    dodgeFaces: [0, 0, 0, 0, 0, 0, 0], armourFaces: [0, 0, 0, 0, 0, 0, 0], injuryFaces: [0, 0, 0, 0, 0, 0, 0], oneNinth: 0, oneThirtySixth: 0,
    blocks: 0, failedBlocks: 0, dodges: 0, failedDodges: 0, pickups: 0, failedPickups: 0, rushes: 0, failedRushes: 0, d6Seq: [], blockSeq: [], tests: [], turns: [],
    luck: emptyLuck() };
}

export function emptyDiceStats(gameId: string | null = null): DiceStats {
  return { gameId, seen: new Set(), teams: {}, players: {}, lastBlockAttacker: null, lastFailedDodge: null, lastFailedPickup: null, lastFailedRush: null, activeTurn: {} };
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

/** Owner 10-01 r4: was the Dodge skill re-roll BUILT IN to this dodge? The player has Dodge, has not used it this turn
 *  (`usedSkills`), and no opposing Tackle stood next to the square dodged FROM (the last track number; unknown = not
 *  cancelled). Read at the roll's own frame, so a dodge that passed first time is still counted. */
function dodgeRerollBuiltIn(game: GameJson | null, team: TeamLike | null, playerId: string | null): boolean {
  // r5 (review): a Dodge GRANTED for the game (prayer, card) counts - the server's own check reads the union
  if (!game || !team || !playerId || !(hasSkill(team, playerId, 'Dodge') || hasSkillWithGrants(game, playerId, 'Dodge'))) return false;
  const player = team.playerArray.find((p) => p.playerId === playerId) as { usedSkills?: unknown } | undefined;
  const used = Array.isArray(player?.usedSkills) ? (player!.usedSkills as unknown[]).map((s) => String(s).toLowerCase()) : [];
  if (used.includes('dodge')) return false;
  const track = ((game.fieldModel as unknown as { trackNumberArray?: { number?: unknown; coordinate?: unknown }[] } | undefined)?.trackNumberArray ?? [])
    .filter((t) => typeof t?.number === 'number' && Array.isArray(t.coordinate))
    .sort((a, b) => Number(b.number) - Number(a.number))[0];
  const origin = track ? (track.coordinate as [number, number]) : null;
  return !(origin && dodgeSkillCancelledAt(game, playerId, [Number(origin[0]), Number(origin[1])]));
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
  // Astra F4 (10-09): the rest of upstream's ReportSkillRoll family (report/ReportSkillRoll.java:107-123 - one D6 as
  // `roll`, a `minimumRoll`, a `successful`): each is a D6 the side rolled and an action trial.
  chainsawRoll: ['roll'], animosityRoll: ['roll'], throwTeamMateRoll: ['roll'], jumpUpRoll: ['roll'], weepingDaggerRoll: ['roll'],
  projectileVomit: ['roll'], lookIntoMyEyesRoll: ['roll'], balefulHex: ['roll'], allYouCanEat: ['roll'], catchOfTheDay: ['roll'],
  gettingEvenRoll: ['roll'], saboteurRoll: ['roll'], chompRoll: ['roll'],
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

// ---- luck trials (owner 10-09; the maths and the rules mirrors live in diceLuck.ts) ----

/** skipInjuryParts values that hide the armour / the injury part (report/logcontrol/SkipInjuryParts.java:3-10). */
const ARMOUR_PART_HIDDEN = new Set(['ARMOUR', 'ARMOUR_AND_CAS', 'ARMOUR_AND_INJURY', 'EVERYTHING_BUT_CAS']);
const INJURY_PART_HIDDEN = new Set(['INJURY', 'ARMOUR_AND_INJURY', 'EVERYTHING_BUT_CAS']);

function luckOf(t: DiceTally, row: LuckRow): LuckBucket { return (t.luck ??= emptyLuck())[row]; }
/** The skill union the dodge helper reads: the player's own + roster position skills, or one granted for the game. */
function has(game: GameJson | null, playerId: string | null, name: string): boolean {
  return !!game && !!playerId && (hasSkill(teamOf(game, playerId), playerId, name) || hasSkillWithGrants(game, playerId, name));
}
function playerJson(game: GameJson | null, playerId: string | null): (PlayerLike & Record<string, unknown>) | null {
  return (teamOf(game, playerId)?.playerArray.find((p) => p.playerId === playerId) as (PlayerLike & Record<string, unknown>) | undefined) ?? null;
}
function otherTeam(game: GameJson | null, team: TeamLike | null): TeamLike | null {
  if (!game || !team) return null;
  const home = game.teamHome as unknown as TeamLike;
  return home.teamId === team.teamId ? (game.teamAway as unknown as TeamLike) : home;
}
/** Mighty Blow's value for this attacker (skill/bb2025/MightyBlow.java:4 - default 1): the player's own, else the roster position's. */
function mightyBlowValue(game: GameJson | null, attackerId: string | null): number {
  const player = playerJson(game, attackerId);
  if (!player) return 1;
  const own = playerSkillValue(player as never, 'Mighty Blow');
  if (own != null && own > 0) return own;
  const position = (teamOf(game, attackerId)?.roster?.positionArray ?? []).find((p) => p.positionId === player.positionId) as { skillArray?: string[]; skillValues?: (string | null)[] } | undefined;
  const at = (position?.skillArray ?? []).indexOf('Mighty Blow');
  const value = at >= 0 ? Number(position?.skillValues?.[at]) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : 1;
}
function gameOption(game: GameJson | null, id: string): string | null {
  const options = (game as unknown as { gameOptions?: { gameOptionArray?: { gameOptionId?: unknown; gameOptionValue?: unknown }[] } } | null)?.gameOptions?.gameOptionArray ?? [];
  const hit = options.find((o) => o.gameOptionId === id);
  return hit ? String(hit.gameOptionValue) : null;
}
/** The KO weight for a victim on `team` (diceLuck.koWeight6): that team's Bloodweiser Kegs + Bugman's XXXXXX in the
 *  game model at this frame (turnData inducementSet; inducement/bb2025/InducementCollection.java:61-62, :139-141).
 *  No inducement data in the model = no kegs = the owner's 0.5. */
function koWeightFor(game: GameJson | null, team: TeamLike | null): number {
  if (!game || !team) return koWeight6(0);
  const home = (game.teamHome as unknown as TeamLike).teamId === team.teamId;
  const set = ((home ? game.turnDataHome : game.turnDataAway) as { inducementSet?: { inducementArray?: unknown[] } } | undefined)?.inducementSet?.inducementArray ?? [];
  let modifier = 0;
  for (const entry of set as { inducementType?: unknown; value?: unknown }[]) {
    if (entry?.inducementType === 'bloodweiserBabes' || entry?.inducementType === 'bugmansXXXXXX') modifier += Number(entry.value) || 0;
  }
  return koWeight6(modifier);
}

/** A D6 against a stated minimum is one action trial for the roller - every roll, a rerolled one included.
 *  No stated minimum (absent, or the 0 an unset one serialises as) = not a trial. */
function pushActionLuck(tallies: DiceTally[], r: Record<string, unknown>, ruleUnknown = false): void {
  const minimum = Number(r.minimumRoll);
  if (!isD6(r.roll) || r.minimumRoll == null || !Number.isInteger(minimum) || minimum < 1 || typeof r.successful !== 'boolean') return;
  // Astra N6: whether a roll is measured must not depend on how the die fell. `ruleUnknown` is decided from the
  // report's kind and the roller alone (see passingRuleUnknown); the cross-check below is only a last-resort guard -
  // it fired on none of the 518 target rolls in the capture fixtures.
  const trial = ruleUnknown ? null : actionTrial(minimum, r.roll, r.successful);
  for (const t of tallies) {
    const bucket = luckOf(t, 'action');
    // UNMEASURED: the roll's rule is not "a 6 always passes, a 1 always fails, else roll >= minimum"
    if (!trial) { bucket.unmeasured += 1; continue; }
    addTrial(bucket, trial.key, trial.x6);
    addCount(bucket, 'passed', r.successful ? 1 : 0);
    addCount(bucket, 'expected', trial.p);
  }
}

/** A pass or a throw / kick of a team-mate by a player with no Passing stat fumbles on EVERY face, whatever minimum
 *  the report states (skillbehaviour/bb2025/ThrowTeamMateBehaviour.java:87-93, :131-137; mechanics/bb2025/
 *  PassMechanic.java:74, :99): not a fair-dice trial for any face - the whole roll is unmeasured. */
function passingRuleUnknown(game: GameJson | null, id: string, playerId: string | null): boolean {
  if (id !== 'passRoll' && id !== 'throwTeamMateRoll') return false;
  const player = playerJson(game, playerId);
  if (!player) return true;
  return !(Number(player.passing) > 0) || !(effectiveStat(player as never, 'PA') > 0);
}
/** PlayerState.hasTacklezones (PlayerState.java:230-233): standing, moving or blocked, and neither confused nor
 *  hypnotized. A state this model does not carry reads as having them (the ordinary case for a player being blocked). */
function defenderHasTacklezones(game: GameJson | null, playerId: string | null): boolean {
  const data = (game?.fieldModel?.playerDataArray as { playerId?: string; playerState?: unknown }[] | undefined)?.find((d) => d.playerId === playerId);
  const state = Number(data?.playerState);
  if (!data || !Number.isFinite(state)) return true;
  const base = state & 0xff;
  return (base === 0x01 || base === 0x02 || base === 0x0c) && (state & 0x200) === 0 && (state & 0x800) === 0;
}
/** The blocker of a block-family report that names none: the latched one while the same player is still acting,
 *  else the acting player (Astra N3: a Multiple Block's first rolls come with no `block` report to refresh the latch,
 *  so the previous blocker - possibly on the other team - must never be used). */
function currentBlocker(stats: DiceStats, actingId: string | null): string | null {
  if (actingId && (stats.lastBlockAttacker == null || stats.lastBlockActing !== actingId)) {
    stats.lastBlockAttacker = actingId;
    stats.lastBlockActing = actingId;
  }
  return stats.lastBlockAttacker ?? actingId;
}

/**
 * The armour roll and the injury roll of one `injury` report, as luck trials. PERSPECTIVE is by the DEFENDER's team:
 * the other team scores the roll as it fell (a break / a removal is good), the defender's own team scores it
 * inverted - whoever caused it (a block, its own failed dodge, the crowd). Each roll is a trial for both teams, for
 * the defender, and for the attacker when one is stated on the other team.
 */
function noteInjuryReportLuck(stats: DiceStats, game: GameJson | null, commandNr: number | null, r: Report, armour: [number, number] | null, injury: [number, number] | null): void {
  const defenderId = typeof r.defenderId === 'string' ? r.defenderId : null;
  const own = teamOf(game, defenderId);
  const them = otherTeam(game, own);
  const defender = playerJson(game, defenderId);
  if (!game || !own || !them || !defender) return; // nobody to score it for
  const attackerId = typeof r.attackerId === 'string' ? r.attackerId : null;
  const attackerTeam = teamOf(game, attackerId);
  const theirs = tallyFor(stats, them.teamId, attackerTeam?.teamId === them.teamId ? attackerId : null);
  const ours = tallyFor(stats, own.teamId, defenderId);
  const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  const armourModifiers = names(r.armorModifiers), injuryModifiers = names(r.injuryModifiers);
  const mightyBlow = mightyBlowValue(game, attackerId);

  if (armour && typeof r.armorBroken === 'boolean') {
    const key = `${commandNr}|${defenderId}|${armour[0]},${armour[1]}`;
    if (commandNr == null || key !== stats.lastArmourTrial) {
      stats.lastArmourTrial = key;
      const threshold = armourBreakThreshold({
        av: effectiveArmour(defender as never), total: armour[0] + armour[1], broken: r.armorBroken, injuryType: String(r.injuryType ?? ''),
        armourModifiers, injuryModifiers, hasInjuryRoll: Array.isArray(r.injuryRoll) && r.injuryRoll.length === 2, mightyBlow,
        attackerHasClaws: has(game, attackerId, 'Claws') || has(game, attackerId, 'Claw'),
        chainsawInvolved: has(game, attackerId, 'Chainsaw') || has(game, defenderId, 'Chainsaw'),
        defenderHasIronHardSkin: has(game, defenderId, 'Iron Hard Skin'),
        sameTeam: !!attackerTeam && attackerTeam.teamId === own.teamId,
        clawDoesNotStack: gameOption(game, 'clawDoesNotStack') !== 'false',
        mbStacksAgainstChainsaw: gameOption(game, 'mbStacksAgainstChainsaw') === 'true',
      });
      // UNMEASURED: see armourBreakThreshold - an unvalued modifier, a result that disagrees with this client's
      // armour value, or a break whose left-over modifiers cannot be read
      if (threshold == null) { for (const t of [...theirs, ...ours]) luckOf(t, 'armour').unmeasured += 1; }
      else {
        const breaks = twoD6AtLeast(threshold); // of 36
        for (const t of theirs) {
          const b = luckOf(t, 'armour');
          addTrial(b, binaryKey(breaks, 36), r.armorBroken ? 6 : 0);
          addCount(b, 'theirRolls', 1); addCount(b, 'theirBroken', r.armorBroken ? 1 : 0); addCount(b, 'theirExpected', breaks / 36);
        }
        for (const t of ours) {
          const b = luckOf(t, 'armour');
          addTrial(b, binaryKey(36 - breaks, 36), r.armorBroken ? 0 : 6);
          addCount(b, 'ownRolls', 1); addCount(b, 'ownBroken', r.armorBroken ? 1 : 0); addCount(b, 'ownExpected', breaks / 36);
        }
      }
    }
  }

  if (injury) {
    const key = `${commandNr}|${defenderId}|${injury[0]},${injury[1]}`;
    if (commandNr == null || key !== stats.lastInjuryTrial) {
      stats.lastInjuryTrial = key;
      const trial = injuryTrial({ dice: injury, modifiers: injuryModifiers, thickSkull: has(game, defenderId, 'Thick Skull'), mightyBlow, statedState: Number(r.injury) & 0xff });
      // UNMEASURED: an unvalued modifier, or a stated result that is not this table's for the roll
      if (!trial) { for (const t of [...theirs, ...ours]) luckOf(t, 'injury').unmeasured += 1; }
      else {
        const ko6 = koWeightFor(game, own); // the VICTIM's team's kegs
        const expected6 = parseDist(injuryKey(trial.counts, ko6, false)).mean6;
        for (const [list, mine, side] of [[theirs, false, 'their'], [ours, true, 'own']] as const) {
          for (const t of list) {
            const b = luckOf(t, 'injury');
            addTrial(b, injuryKey(trial.counts, ko6, mine), injuryScore6(trial.level, ko6, mine));
            addCount(b, `${side}Rolls`, 1);
            if (trial.level === 1) addCount(b, `${side}Kos`, 1);
            if (trial.level === 2) addCount(b, `${side}Casualties`, 1);
            addCount(b, `${side}Value`, injuryScore6(trial.level, ko6, false) / 6);
            addCount(b, `${side}Expected`, expected6 / 6);
          }
        }
      }
    }
  }
}

function blockTallies(stats: DiceStats, game: GameJson | null, attacker: string | null): DiceTally[] {
  return tallyFor(stats, teamOf(game, attacker)?.teamId ?? null, attacker);
}
/** Rolls still waiting for a `blockChoice` when the block moves on were never resolved: UNMEASURED (who picked is unknown). */
function dropPendingBlockRolls(stats: DiceStats, game: GameJson | null): void {
  for (const p of stats.pendingBlockRolls ?? []) for (const t of blockTallies(stats, game, p.attacker)) luckOf(t, 'block').unmeasured += 1;
  stats.pendingBlockRolls = [];
}
/** A `block` report: the dice are about to be rolled (or rolled again) - step/bb2025/block/StepBlockRoll.java:199-200. */
function noteBlockAnnounced(stats: DiceStats, game: GameJson | null, attacker: string | null, defender: string | null): void {
  const pending = stats.pendingBlockRolls ?? [];
  if (pending.some((p) => p.attacker !== attacker || (p.defender && defender && p.defender !== defender))) dropPendingBlockRolls(stats, game);
  stats.lastBlockDefender = defender;
  stats.blockRollArmed = true;
  stats.blockRollPartial = false;
  stats.rerollGateFailed = false;
}
function actingAction(game: GameJson | null): string {
  return String((game?.actingPlayer as { playerAction?: unknown } | undefined)?.playerAction ?? '');
}
/**
 * One block ROLL is one trial. The server re-states the same dice without rolling (a `blockRoll` with no `block`
 * report before it, when a reroll is declined - StepBlockRoll.java:191-194): that is not a new roll. A roll that
 * rerolled only SOME dice (a `blockReRoll` report first: Pro, Brawler ...) keeps dice of the roll already counted, so
 * it is UNMEASURED. The trial is settled at the `blockChoice`, which states who picks (nrOfDice < 0 = the defender):
 * `choosingTeamId` here names who answers the reroll dialog, not who picks the result (:349-357).
 *
 * MULTIPLE BLOCK (Astra F5): its first rolls are made with NO `block` / `blockRoll` report
 * (step/bb2025/mutliblock/StepBlockRollMultiple.java:223-240), only its rerolls are reported (:249, :262-263 - the
 * one path that states a defender on `blockRoll`), and its dice count is absolute (:226), so who picks cannot be
 * read. Scoring only the rerolled ones would be a biased sample: EVERY roll of a Multiple Block is UNMEASURED - the
 * reported ones here, the unreported first roll of each defender at its `blockChoice`.
 */
function noteBlockRollLuck(stats: DiceStats, game: GameJson | null, id: string, attacker: string | null, defender: string | null, faces: number[]): void {
  if (id === 'blockReRoll') { stats.blockRollPartial = true; stats.rerollGateFailed = false; return; } // dice were rolled
  const gateFailed = stats.rerollGateFailed === true;
  stats.rerollGateFailed = false;
  if (defender != null || actingAction(game) === 'multipleBlock') {
    stats.blockRollArmed = false; stats.blockRollPartial = false;
    // Astra N4: a failed reroll roll (Loner, Pro) still re-states the unchanged dice here
    // (StepBlockRollMultiple.java:246-264: the report is added whether or not useReRoll passed) - a repeat, not a roll
    if (gateFailed) return;
    const key = defender ?? stats.lastBlockDefender ?? '';
    const counted = (stats.multiBlockCounted ??= {});
    counted[key] = (counted[key] ?? 0) + 1;
    for (const t of blockTallies(stats, game, attacker)) luckOf(t, 'block').unmeasured += 1;
    return;
  }
  if (!stats.blockRollArmed) return;
  stats.blockRollArmed = false;
  if (stats.blockRollPartial) {
    stats.blockRollPartial = false;
    for (const t of blockTallies(stats, game, attacker)) luckOf(t, 'block').unmeasured += 1;
    return;
  }
  const target = defender ?? stats.lastBlockDefender ?? null;
  (stats.pendingBlockRolls ??= []).push({ attacker, defender: target, faces, blitz: actingAction(game) === 'blitz', defenderTacklezones: defenderHasTacklezones(game, target) });
}
function settleBlockRollLuck(stats: DiceStats, game: GameJson | null, attacker: string | null, nrOfDice: number | null, choiceDefender: string | null): void {
  const pending = stats.pendingBlockRolls ?? [];
  stats.pendingBlockRolls = [];
  const counted = stats.multiBlockCounted ?? {};
  const multi = actingAction(game) === 'multipleBlock' || (choiceDefender != null && choiceDefender in counted);
  if (multi) {
    // the defender's first roll was never reported: count it now (its reported rerolls were counted as they came)
    for (const t of blockTallies(stats, game, attacker)) luckOf(t, 'block').unmeasured += 1 + pending.length;
    if (choiceDefender != null) delete counted[choiceDefender];
    return;
  }
  // Juggernaut needs the action to be a Blitz: read where the roll was made and again here (the action is `blitz`
  // from the blitz's block onward - PlayerAction.BLITZ, JuggernautBehaviour.java:45)
  const blitzNow = actingAction(game) === 'blitz';
  for (const p of pending) {
    const defender = p.defender ?? choiceDefender;
    const tallies = blockTallies(stats, game, p.attacker);
    const attackerTeam = teamOf(game, p.attacker), defenderTeam = teamOf(game, defender);
    const dice = p.faces.length;
    // UNMEASURED: no stated dice count / sign, a count that is not this roll's, or a player this model cannot resolve
    if (nrOfDice == null || nrOfDice === 0 || Math.abs(nrOfDice) !== dice || dice < 1 || dice > 3 || !attackerTeam || !defenderTeam) {
      for (const t of tallies) luckOf(t, 'block').unmeasured += 1;
      continue;
    }
    const attackerChooses = nrOfDice > 0;
    const scores = blockFaceScores({
      attackerBlock: has(game, p.attacker, 'Block'), attackerWrestle: has(game, p.attacker, 'Wrestle'), attackerTackle: has(game, p.attacker, 'Tackle'),
      // Astra N1: a defender without tackle zones (confused, hypnotized ...) can use neither Block nor Wrestle
      defenderBlock: p.defenderTacklezones && has(game, defender, 'Block'), defenderDodge: has(game, defender, 'Dodge'),
      defenderWrestle: p.defenderTacklezones && has(game, defender, 'Wrestle'),
      attackerJuggernautBlitz: (p.blitz || blitzNow) && has(game, p.attacker, 'Juggernaut'),
    });
    const key = blockRollKey(dice, attackerChooses, scores);
    const score = blockRollScore(p.faces, attackerChooses, scores);
    const dist = parseDist(key);
    const chance = (s6: number) => dist.points.find((pt) => pt.s6 === s6)?.p ?? 0;
    for (const t of tallies) {
      const b = luckOf(t, 'block');
      addTrial(b, key, score * 6);
      if (score > 0) addCount(b, 'good', 1);
      if (score < 0) addCount(b, 'bad', 1);
      addCount(b, 'goodExpected', chance(6)); addCount(b, 'badExpected', chance(-6));
    }
  }
}

/** The four Likelihood rows of a tally, and all of them together. A tally without trial data reads "not measured". */
export function armourLikelihood(t: DiceTally): Likelihood { return likelihoodOf([t.luck?.armour]); }
export function injuryLikelihood(t: DiceTally): Likelihood { return likelihoodOf([t.luck?.injury]); }
export function actionLikelihood(t: DiceTally): Likelihood { return likelihoodOf([t.luck?.action]); }
export function blockLikelihood(t: DiceTally): Likelihood { return likelihoodOf([t.luck?.block]); }
export function allDiceLikelihood(t: DiceTally): Likelihood { return likelihoodOf([t.luck?.armour, t.luck?.injury, t.luck?.action, t.luck?.block]); }

/** Feed one applied frame's reports. `commandNr` de-duplicates re-applied frames (replay seeks re-run history). */
export function ingestDiceReports(stats: DiceStats, gameId: string | null, commandNr: number | null, reports: readonly Report[], game: GameJson | null): void {
  if (gameId !== stats.gameId) {
    const fresh = emptyDiceStats(gameId);
    stats.gameId = fresh.gameId; stats.seen = fresh.seen; stats.teams = fresh.teams; stats.players = fresh.players;
    stats.lastBlockAttacker = null; stats.lastFailedDodge = null; stats.lastFailedPickup = null; stats.lastFailedRush = null;
    stats.activeTurn = {}; stats.lastRerollSource = null; stats.openDodges = {};
    stats.lastBlockDefender = null; stats.blockRollArmed = false; stats.blockRollPartial = false; stats.pendingBlockRolls = []; stats.multiBlockCounted = {};
    stats.lastBlockActing = null; stats.rerollGateFailed = false;
    stats.lastArmourTrial = null; stats.lastInjuryTrial = null;
  }
  if (commandNr != null) {
    if (stats.seen.has(commandNr)) return;
    stats.seen.add(commandNr);
  }
  const actingId = typeof game?.actingPlayer?.playerId === 'string' ? game.actingPlayer.playerId : null;
  stats.rerollGateFailed = false; // the gate and its dice share a frame (see below)
  for (const r of reports) {
    // r4: remember who paid for a re-roll; the re-rolled roll that follows reads it (falls through: nothing else consumes it)
    if (String(r.reportId ?? '') === 'reRoll' && typeof r.playerId === 'string') stats.lastRerollSource = { playerId: r.playerId, source: String(r.reRollSource ?? '') };
    // Astra N4 / N4-R1 / N4-R2: the block-roll reroll GATE. Upstream adds, in one step result, `block`, then whatever
    // UtilServerReRoll.useReRoll reports, then `blockRoll` (StepBlockRollMultiple.java:249-263). Only a report in that
    // slot is the gate - the flag is dropped at every frame start and at every `block` / `blockReRoll` / `blockRoll`,
    // so a failed Pro from another roll or turn, or the modifier-test reroll report of
    // AbstractStepModifierMultipleBlock.java:154-157 (a different step), can never be mistaken for it. The last gate
    // report decides (mechanic/bb2025/RollMechanic.java:277-330): a reroll that needed its own roll and failed it
    // (`reRoll` with roll > 0: Pro, Loner; report/ReportReRoll.java:79-83), or a failed Team Mascot with no team
    // reroll to fall back on (`mascotUsed`, RollMechanic.java:295-305, :387-391).
    if (stats.blockRollArmed) {
      const gate = String(r.reportId ?? '');
      if (gate === 'reRoll') stats.rerollGateFailed = Number(r.roll) > 0 && r.successful === false;
      else if (gate === 'mascotUsed') stats.rerollGateFailed = r.successful === false && r.reRollUsed !== true;
    }
    const id = String(r.reportId ?? '');
    const playerId = typeof r.playerId === 'string' ? r.playerId : null;

    if (id === 'block') {
      const attacker = typeof r.attackerId === 'string' ? r.attackerId : playerId ?? actingId;
      stats.lastBlockAttacker = attacker;
      stats.lastBlockActing = actingId;
      const team = teamOf(game, attacker);
      for (const t of tallyFor(stats, team?.teamId ?? null, attacker)) t.blocks += 1;
      noteBlockAnnounced(stats, game, attacker, typeof r.defenderId === 'string' ? r.defenderId : null);
      continue;
    }
    if (id === 'blockRoll' || id === 'blockReRoll') {
      const attacker = typeof r.attackerId === 'string' ? r.attackerId : currentBlocker(stats, actingId);
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
      noteBlockRollLuck(stats, game, id, attacker, typeof r.defenderId === 'string' ? r.defenderId : null, faces);
      continue;
    }
    if (id === 'blockChoice') {
      const attacker = typeof r.attackerId === 'string' ? r.attackerId : currentBlocker(stats, actingId);
      const team = teamOf(game, attacker);
      const chosen = Array.isArray(r.blockRoll) && typeof r.diceIndex === 'number' ? (r.blockRoll as unknown[])[r.diceIndex] : null;
      const result = String(r.blockResult ?? '');
      const attackerDown = chosen === 1 || /attacker.?down|skull/i.test(result);
      const bothDown = chosen === 2 || /both.?down/i.test(result);
      const failed = attackerDown || (bothDown && !hasSkill(team, attacker, 'Block', 'Wrestle'));
      if (failed) for (const t of tallyFor(stats, team?.teamId ?? null, attacker)) t.failedBlocks += 1;
      settleBlockRollLuck(stats, game, attacker, typeof r.nrOfDice === 'number' ? r.nrOfDice : null, typeof r.defenderId === 'string' ? r.defenderId : null);
      continue;
    }
    if (id === 'injury') {
      const attacker = typeof r.attackerId === 'string' ? r.attackerId : stats.lastBlockAttacker ?? actingId;
      const team = teamOf(game, attacker);
      const tallies = tallyFor(stats, team?.teamId ?? null, attacker);
      // Owner 10-09: BB2025 reports one injury TWICE (server/mechanic/bb2025/StateMechanic.java:122-171): first with
      // skipInjuryParts "CAS" (the armour and injury rolls), then "EVERYTHING_BUT_CAS" (the casualty part) - both carry
      // the same dice. The flag says which parts that report SHOWS, so a roll is counted where it is shown, once.
      const skip = String(r.skipInjuryParts ?? 'NONE');
      const armour = !ARMOUR_PART_HIDDEN.has(skip) && Array.isArray(r.armorRoll) ? (r.armorRoll as unknown[]).filter(isD6) : [];
      const injury = !INJURY_PART_HIDDEN.has(skip) && Array.isArray(r.injuryRoll) ? (r.injuryRoll as unknown[]).filter(isD6) : [];
      for (const v of armour) pushD6(tallies, v, 'armourFaces');
      for (const v of injury) pushD6(tallies, v, 'injuryFaces');
      if (armour.length === 2) for (const t of tallies) t.armour.push(armour[0]! + armour[1]!);
      if (injury.length === 2) for (const t of tallies) t.injury.push(injury[0]! + injury[1]!);
      noteInjuryReportLuck(stats, game, commandNr, r, armour.length === 2 ? [armour[0]!, armour[1]!] : null, injury.length === 2 ? [injury[0]!, injury[1]!] : null);
      continue;
    }
    if (id === 'dodgeRoll') {
      const team = teamOf(game, playerId);
      const tallies = tallyFor(stats, team?.teamId ?? null, playerId);
      pushD6(tallies, r.roll, 'dodgeFaces');
      pushTest(tallies, r); pushActionLuck(tallies, r);
      const reRolled = r.reRolled === true;
      const successful = r.successful === true;
      const need = Number(r.minimumRoll);
      const builtIn = !reRolled && successful && dodgeRerollBuiltIn(game, team, playerId);
      const skillRerolled = reRolled && stats.lastRerollSource?.playerId === playerId && stats.lastRerollSource.source.toLowerCase() === 'dodge';
      if (reRolled) stats.lastRerollSource = null;
      // r5 (review): a reroll resolves the player's OPEN attempt - it files under that attempt's column and REPLACES
      // its first outcome. (Diving Tackle: the first roll is reported passed, the tackle fails it, then it is rerolled.)
      // r6 (review): one open attempt PER PLAYER, so another player's dodge in between cannot orphan a reroll
      const opens = (stats.openDodges ??= {});
      const open = reRolled && playerId ? opens[playerId] ?? null : null;
      const ownTarget = Number.isFinite(need) ? Math.min(6, Math.max(2, Math.round(need))) : null;
      const target = open ? open.target ?? ownTarget : ownTarget;
      // r6 (review): a reroll whose first roll was never seen (joined mid-attempt) is not charted - the Dodges row
      // does not count it either, so the two always agree
      if (target != null && (!reRolled || open)) {
        for (const t of tallies) {
          const by = (t.dodgeByTarget ??= {});
          const row = (by[target] ??= { attempts: 0, passFirst: 0, passReroll: 0, failReroll: 0 });
          if (!reRolled) {
            row.attempts += 1;
            // r4: a first-time pass still had the skill re-roll built in if the player could have used it
            if (successful) { row.passFirst += 1; if (builtIn) row.built = (row.built ?? 0) + 1; }
          } else {
            if (open?.passed) row.passFirst = Math.max(0, row.passFirst - 1);
            if (successful) row.passReroll += 1; else row.failReroll += 1;
            // r4: a first roll re-rolled BY THE DODGE SKILL was a built-in re-roll. r6 (review): `built` is about the
            // skill being AVAILABLE - an attempt counted built stays built whichever source the coach then picked
            if (skillRerolled) { if (!open?.built) row.built = (row.built ?? 0) + 1; row.builtFails = (row.builtFails ?? 0) + 1; }
          }
        }
      }
      if (!reRolled && playerId) opens[playerId] = { target, passed: successful, built: builtIn };
      else if (open) {
        // the reroll failed an attempt whose first roll was reported passed: it now counts as failed
        if (open.passed && !successful) for (const t of tallies) t.failedDodges += 1;
        delete opens[playerId!];
      }
      if (!reRolled) {
        for (const t of tallies) t.dodges += 1;
        if (!successful) { for (const t of tallies) t.failedDodges += 1; stats.lastFailedDodge = playerId && team ? { playerId, teamId: team.teamId } : null; }
        else stats.lastFailedDodge = null;
      } else if (successful && open && !open.passed) { // r6: keyed on the player's own open attempt, not a single last-failed slot
        // The failed attempt was re-rolled into a success: it no longer counts as failed.
        for (const t of tallies) t.failedDodges = Math.max(0, t.failedDodges - 1);
        stats.lastFailedDodge = null;
      }
      continue;
    }
    if (id === 'goForItRoll') {
      const team = teamOf(game, playerId);
      const tallies = tallyFor(stats, team?.teamId ?? null, playerId);
      pushD6(tallies, r.roll);
      pushTest(tallies, r); pushActionLuck(tallies, r);
      const reRolled = r.reRolled === true;
      const successful = r.successful === true;
      if (!reRolled) {
        for (const t of tallies) t.rushes += 1;
        if (!successful) { for (const t of tallies) t.failedRushes += 1; stats.lastFailedRush = playerId && team ? { playerId, teamId: team.teamId } : null; }
        else stats.lastFailedRush = null;
      } else if (successful && stats.lastFailedRush?.playerId === playerId) {
        for (const t of tallies) t.failedRushes = Math.max(0, t.failedRushes - 1);
        stats.lastFailedRush = null;
      }
      continue;
    }
    if (id === 'pickUpRoll') {
      const team = teamOf(game, playerId);
      const tallies = tallyFor(stats, team?.teamId ?? null, playerId);
      pushD6(tallies, r.roll);
      pushTest(tallies, r); pushActionLuck(tallies, r);
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
      if (fields.includes('roll')) {
        pushTest(tallies, r);
        pushActionLuck(tallies, r, passingRuleUnknown(game, id, playerId ?? actingId));
      }
    }
  }
}

export function d6Total(t: DiceTally): number { return t.d6.reduce((a, b) => a + b, 0); }

// ---- activations per turn (owner 09-25) ----
function turnKeyFor(game: GameJson, team: TeamLike): { half: number; turn: number } {
  const home = (game.teamHome as unknown as TeamLike).teamId === team.teamId;
  const td = (home ? game.turnDataHome : game.turnDataAway) as { turnNr?: number } | undefined;
  return { half: Number(game.half ?? 0) || 0, turn: Number(td?.turnNr ?? 0) || 0 };
}
/** The server activated `playerId` (actingPlayerSetPlayerId, non-null): count it once for its team's current turn. */
export function noteActivation(stats: DiceStats, game: GameJson | null, playerId: string | null): void {
  const team = teamOf(game, playerId);
  if (!game || !team || !playerId) return;
  if (String(game.turnMode ?? '') !== 'regular') return;
  const key = turnKeyFor(game, team);
  const cur = stats.activeTurn[team.teamId];
  if (cur && (cur.half !== key.half || cur.turn !== key.turn)) {
    // a turn we never saw end (seek / missed frame): close it as a plain turn so the ledger stays honest
    (stats.teams[team.teamId] ??= emptyTally()).turns.push({ half: cur.half, turn: cur.turn, activations: cur.players.size, turnover: false });
    delete stats.activeTurn[team.teamId];
  }
  const track = stats.activeTurn[team.teamId] ??= { ...key, players: new Set<string>() };
  track.players.add(playerId);
}
/** The side's turn ended (turnEnd report): record the activation count and whether it was a turnover. */
export function noteTurnEnd(stats: DiceStats, game: GameJson | null, side: 'home' | 'away', turnover: boolean): void {
  if (!game) return;
  const team = (side === 'home' ? game.teamHome : game.teamAway) as unknown as TeamLike;
  if (!team?.teamId) return;
  const cur = stats.activeTurn[team.teamId];
  const key = cur ? { half: cur.half, turn: cur.turn } : turnKeyFor(game, team);
  (stats.teams[team.teamId] ??= emptyTally()).turns.push({ ...key, activations: cur?.players.size ?? 0, turnover });
  delete stats.activeTurn[team.teamId];
}
export function activationFacts(t: DiceTally): DiceFact[] {
  if (!t.turns.length) return [];
  const facts: DiceFact[] = [];
  const avg = t.turns.reduce((a, x) => a + x.activations, 0) / t.turns.length;
  const turnovers = t.turns.filter((x) => x.turnover);
  facts.push({ label: 'Activations per turn', value: avg.toFixed(1), detail: `${t.turns.length} turns · ${turnovers.length} turnover${turnovers.length === 1 ? '' : 's'}` });
  if (turnovers.length) {
    const worst = turnovers.reduce((a, x) => (x.activations < a.activations ? x : a));
    facts.push({ label: 'Fewest activations before a turnover', value: `${worst.activations}`, detail: `${worst.half}HT${worst.turn}` });
  }
  return facts;
}

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
  facts.push(...activationFacts(t)); // owner 09-25
  return facts;
}
export function blockTotal(t: DiceTally): number { return t.block.reduce((a, b) => a + b, 0); }
