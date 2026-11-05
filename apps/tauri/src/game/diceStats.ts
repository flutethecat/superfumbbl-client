// Owner 09-17: per-game DICE STATISTICS, tallied from the server's report stream as frames are applied (live play,
// spectate and replay all pass through applyFrameContents). Everything here is derived from stated report fields —
// no client-side dice are ever counted. Feeds the end screen's Dice tab and the Statistics rows for failed
// blocks / dodges.
//
// Attribution: a roll belongs to the team (and player) that ROLLED it. Armour and injury dice are rolled by the
// attacking side, so they ride the attacker latched from the opening `block` report (or the acting player, as the
// log formatter does); dodge / rush / pickup / catch rolls belong to their playerId.
// Owner 10-13: armour and injury stats are ONLY the rolls a team made against its opponent. A roll with no attacker
// on the other team (a failed dodge / rush / jump, a crowd push, Ball & Chain, a team-mate landing on a player, a
// Stab or Chainsaw kickback on oneself) is nobody's attack, so it counts for neither team: no totals, no faces, no
// luck trial, and the victim's team gets no inverted trial for it.
import { reactive } from 'vue';
import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { effectiveArmour, effectiveStat, playerSkillValue } from '@fumbbl40k/ffb-protocol';
import { dodgeSkillCancelledAt, hasSkill as hasSkillWithGrants } from './logic/availableActions';
import { breatheFirePassed } from './breatheFireOutcome';
import {
  actionTrial, injuryTypeFamily, addCount, addTrial, armourBreakThreshold, armourModifierValue, binaryKey, blockFaceScores, blockRollKey, blockRollScore, EITHER_BY_TYPE,
  emptyBucket, emptyLuck, injuryKey, injuryModifierValue, injuryScore6, injuryTrial, koWeight6, likelihoodOf, parseDist, twoD6AtLeast,
  type ArmourRollInput, type BlockMatchup, type DiceLuck, type InjuryLevel, type Likelihood, type LuckBucket, type LuckRow,
} from './diceLuck';
import {
  attackOutcomes, attackerDownOn, blockArmourTiers, blockOutcomeChance, bookedTurns, chainPushOutcome, defenderDownOn, crowdPushForced, expectedTurns, freeSquareAround, koRecoveryFail6, onPitch, outcomeKey,
  reportArmourTiers, turnIndex, turnsLeftInHalf, turnsScore, varianceTurns, STEADY_FOOTING_FAIL6, TURNS_PER_HALF,
  type AttackOutcomes, type ArmourTier, type ChainPlayer, type ChainResult, type TurnClock,
} from './turnsLost';
import { prayerForWireValue } from './prayerCatalog';
import { createTurnPresentationContext, turnEndIsTurnover, turnoverArmStep, type TurnPresentationContext } from './turnPresentation';
import { cutCost, emptyCutShort, turnShare, FIRST_ACTION_SHARE, type CutShort } from './turnsCutShort';
import { breakDelta, emptyBreaks, injuryRollOutcomes, rollOutcomes, type BreakOutcome, type LuckBreaks } from './luckBreaks';
import { $t, data } from '../i18n';

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
  /** Owner 10-15 (turns lost by drive, the Luck story): every trial of the Turns lost row this TEAM booked, in order,
   *  with its expected value (provisional until its drive ends) and the turns it actually cost. Team tallies only. */
  turnsLog?: TurnsAttackRecord[];
  /** Owner 10-16 (the Luck row): the team's lucky and bad breaks from every roll scored (luckBreaks.ts), and those from
   *  the Turns lost trials' outcomes (`breaksTurns`, rebuilt from both teams' turnsLog after every frame). Team tallies
   *  only; absent on tallies kept before them (the row reads "not measured"). */
  breaks?: LuckBreaks;
  breaksTurns?: LuckBreaks;
  /** Owner 10-16: the "Turns cut short" line (turnsCutShort.ts): the acting team's turnovers weighted by the share of
   *  the turn left. Team tallies only; absent on tallies kept before it (the row reads "not measured"). */
  cutShort?: CutShort;
}

/** One trial of the Turns lost row: an attack, or a KO recovery roll credited to the attacker who caused the KO. */
export interface TurnsAttackRecord {
  id: number;
  /** The player credited (the attacker; for a recovery, the attacker who caused the KO). */
  attacker: string;
  victimTeamId: string; victim: string; victimName: string;
  /** What it was ("2-die block", "foul", "KO recovery" ...) and when: the credited team's turn. */
  label: string; half: number; turn: number;
  outcomes: AttackOutcomes;
  /** A stun's and a casualty's turns, fixed at the attack. */
  stun: number; cas: number;
  /** The drive whose victim-team turns value a KO (null for a recovery until the next drive starts, after `fromDrive`). */
  drive: string | null; fromDrive?: string;
  /** The victim team's turn index counted to, and the turns it has started in `drive` since. */
  idx: number; d: number;
  /** Still provisional (its drive has not ended): the KO term is `provisional` (the rest of the half). */
  open: boolean; provisional: number;
  /** The distribution key in the bucket now, its expected turns and variance (turns squared). */
  key: string; expected: number; variance: number;
  /** Turns actually lost to it so far, and how it came out ("KO", "Armour held" ...). */
  actual: number; outcome: string;
  /** The outcome before any result is booked ("Nothing (no knock-down)" for a block, "Armour held" for a foul ...). */
  idle: string;
  /** A recovery roll: no attack of its own (the `attacks` counter skips it). */
  recovery?: boolean;
  /** Owner 10-15: the blocker's own fall on his block, credited to the defender (`victim` = the blocker). */
  fall?: boolean;
  /** Owner 10-16 (the Luck chart): the team turns started in the half before the attack's (play order from 0). */
  slot?: number;
  /** Owner 10-16 (the Luck story): the credited player's name. */
  attackerName?: string;
  /** Owner 10-16 (Astra chart r3): the played-turn column of the attack (LuckBreaks.played index), or how many turns had
   *  been played when it fell outside them (BreakEntry.after). */
  col?: number; after?: number;
  /** Owner 10-16 (Astra chart r6): its place in the one order of Luck events (DiceStats.breakSeq), for the chart. */
  seq?: number;
  /** Owner 10-16: the crowd surf of a chain-pushed player on a block (`victim` = the player the chain was read to end
   *  with); credited to the blocker, or to the defender when the victim is the blocker's own team-mate. No attack of
   *  its own (the `attacks` counter skips it: the block is the attack). */
  chain?: boolean;
}

export interface DiceStats {
  gameId: string | null;
  /** Owner 11-04 (jumpKind): the player whose Leap / Pogo use was just reported, and the last jump's kind (its reroll). */
  leapSkillBy?: string | null;
  lastJump?: { playerId: string | null; kind: string } | null;
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
  pendingBlockRolls?: { attacker: string | null; defender: string | null; faces: number[]; blitz: boolean; defenderTacklezones: boolean; /** stats.frameSeq of the frame it was latched in. */ frame?: number }[];
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
  /** Owner 10-10: how much of the game a SPECTATED game's tallies cover (spectatorDiceLedger.ts). Absent = not a
   *  spectated game (play / replay / demo): the pane says nothing. */
  coverage?: DiceCoverage;
  /** Who feeds these tallies (claimDiceStats): a seat / mode change in the SAME game starts them afresh, because each
   *  feeder numbers its commands in its own key space (`seen`). */
  owner?: string;
  /** Bumped whenever the tallies are REPLACED by a rebuild (a pre-join import landing): what was saved from them
   *  before is out of date. */
  revision?: number;
  /** The spectator ledger's turnover context (turnPresentation.ts turnoverArmStep): it rides the tallies so that it
   *  crosses the join boundary with them. */
  turnover?: { turnoverArmed: boolean; turnoverAfterInjury: boolean };
  /** Owner 10-15 (turns lost): the turn state at the end of the last frame taken in - the state an attack in the next
   *  frame was made in (the model handed in is the one AFTER the frame, which may already have ended the turn). */
  turnClock?: TurnClock | null;
  /** The attack whose expected turns were booked at the BLOCK (or Chainsaw roll), per victim: its injury report books
   *  the actual turns against it (or nothing when it was unmeasured). Dropped at every turn end. */
  turnsLinks?: Record<string, TurnsLink>;
  /** Knock-outs counted live, and casualties counted on into overtime (see advanceTurnsLost). */
  turnsOpen?: TurnsEntry[];
  turnsSeq?: number;
  /** The model's defender at the end of the last frame taken in (a Chainsaw attack clears it as it resolves). */
  turnDefender?: string | null;
  /** `commandNr|defender|dice` of the last injury report taken for turns lost (one attack is one trial). */
  lastTurnsTrial?: string | null;
  /** Owner 10-15 (crowd pushes): the pitch at the end of the last frame taken in - each player on the pitch as
   *  [x, y, playerState]. A block's crowd push is read from it: the model handed in with the block may already show
   *  the defender pushed (or in the crowd), which would make the expectation depend on the result. */
  turnField?: Record<string, [number, number, number]> | null;
  /** The defender of the last `blockChoice` whose expectation carries a crowd push: only HIS crowd injury is booked
   *  against it (a chain-pushed player in the crowd is not the block's defender). */
  turnsCrowd?: string | null;
  /** Counts the frames taken in (a block roll latched in an EARLIER frame read the model before the block). */
  frameSeq?: number;
  /** Owner 10-15 (KO recovery by drive): the knocked-out players whose KO an attacker is credited with - each later
   *  recovery roll is that attacker's trial. `drive` = the drive the next roll's drive follows (null: see `recId`). */
  koChains?: Record<string, { teamId: string; attacker: string; drive: string | null; recId?: number; entry?: number }>;
  /** Numbers the Turns lost trials (TurnsAttackRecord.id). */
  turnsAttackSeq?: number;
  /** Owner 10-16: numbers the Luck events (BreakEntry.seq). */
  breakSeq?: number;
  /** Owner 10-16 (Astra luck r2): the trials of the last attack that still wait for their result (an injury report, a
   *  crowd injury, a Steady Footing roll): they count no outcome yet. From the face picked; dropped at the next roll,
   *  block or turn end. */
  turnsPending?: number[];
  /** Owner 10-16 (Turns cut short): the acting team's players on the pitch at the start of its turn (`key` =
   *  half|team|turnNr), the last turnover-capable roll or block (its share, whether its chance was measured), the
   *  client's own turnover heuristic and the roll that armed it, and whether each team's previous turn ended in a
   *  first-action turnover (streaks). */
  tcsStart?: { key: string; n: number } | null;
  tcsLast?: TcsHit | null;
  tcsArm?: TurnPresentationContext;
  tcsHit?: TcsHit | null;
  tcsLastFirst?: Record<string, boolean>;
  /** Owner 10-16 (chain pushes): the last block whose expectation carries a chain-push surf - a crowd injury of a player
   *  on `victimTeamId` other than the block's defender is booked against its trial. Dropped at the next block and at
   *  every turn end. */
  turnsChain?: TurnsChain | null;
  /** Owner 10-16 (Steady Footing): the players knocked down by the last block whose trial a successful Steady Footing
   *  roll names as its outcome (player -> TurnsAttackRecord.id and its team). Dropped at the next roll of any other kind. */
  turnsFooting?: Record<string, { teamId: string; attackId: number }> | null;
}
/** Owner 10-16 (Turns cut short): a turnover-capable roll or block of the acting team. */
/** `player` = the roller's id, `playerName` his name (Astra 10-17: the id drives the name chip's detail). */
export interface TcsHit { share: number; measured: boolean; label: string; player: string; playerName: string; teamId: string; half: number; slot: number; turn: number; col?: number; after?: number }
/** Owner 10-16: the chain-push surf trial of a block (see DiceStats.turnsChain). */
export interface TurnsChain {
  blockDefender: string;
  /** The team and player credited, and the trial. */
  teamId: string; attacker: string; attackId: number;
  victimTeamId: string;
}
/** What one attack's result booked, so a Piling On reroll of it can take it back. */
export interface TurnsBooking { value: number; level: InjuryLevel | null; entry: number | null; attackId?: number | null; crowd?: boolean }
export interface TurnsLink {
  attacker: string; measured: boolean; booked?: TurnsBooking | null; /** The trial booked at the attack (taken back if its report turns out unmeasurable). */ key?: string;
  /** The block's expectation carries a crowd push, whose injury roll takes `injuryShift`. */
  crowd?: { injuryShift: number } | null;
  /** The trial (TurnsAttackRecord.id) its result is booked against. */
  attackId?: number;
  /** Owner 10-15: the blocker's own fall, credited to the block's defender. */
  fall?: boolean;
}
export interface TurnsEntry {
  id: number; kind: 'ko' | 'cas';
  /** The attacking team and player the turns are counted for. */
  teamId: string; attacker: string;
  victimTeamId: string; playerId: string;
  /** The drive the injury happened in (TurnClock.drive); '' = the drive after `fromDrive`, not started yet (a failed
   *  KO recovery roll counts the next drive's turns). */
  drive: string; fromDrive?: string;
  /** The trial the turns are booked against. */
  attackId?: number | null;
  /** The victim team's turn index (turnsLost.turnIndex) counted up to so far. */
  idx: number;
  /** Turns added live so far. */
  added: number;
  /** Turns booked up front at the injury (a regulation casualty's), still counted. */
  booked: number;
  /** The victim team's turn index at the injury. */
  start: number;
  /** The lowest index it may be re-synchronised to (a casualty counts only overtime turns live: 16). */
  floor: number;
  /** Over: the player is back, or the booking was taken back. */
  done?: boolean;
}

/** The tally counters the Statistics rows read ("attempts / failed"), per team. */
export const DICE_ROW_KEYS = ['failedBlocks', 'dodges', 'failedDodges', 'pickups', 'failedPickups', 'rushes', 'failedRushes'] as const;
export type DiceRowTotals = Pick<DiceTally, typeof DICE_ROW_KEYS[number]>;
/**
 * Owner 10-10: the Statistics rows of a SPECTATED game AT THE DISPLAYED POSITION. The tallies themselves are folded
 * at ingress and run ahead of the picture (by the playback backlog; without bound while paused or reviewing), so a
 * pane a viewer can open DURING the game reads these instead: the ledger publishes the totals as they stood at the
 * command on screen. `gameId` null = no spectated game is on screen (play / replay / demo read their own tallies).
 */
export interface DisplayedDiceRows {
  gameId: string | null; teams: Record<string, DiceRowTotals>;
  /** The position on screen has no entry of its own (it was never folded, or its entry was dropped): `teams` are the
   *  LAST KNOWN rows and do not advance. Never the head totals. */
  held?: boolean;
}
/** No spectated game's picture is on screen any more (another feeder owns the tallies): the rows guard nothing. */
export function clearDisplayedDiceRows(rows: DisplayedDiceRows): void { rows.gameId = null; rows.teams = {}; rows.held = false; }
export const displayedDiceRows = reactive<DisplayedDiceRows>({ gameId: null, teams: {} }) as DisplayedDiceRows;

/** Owner 10-10: what a spectated game's dice tallies cover. `before` = the rolls from before the join: `none` (joined
 *  before any were made), `imported` (taken from the game's replay data), `missing` (no replay data). `gap` = the
 *  live feed dropped and came back with commands missing in between. */
export interface DiceCoverage { before: 'none' | 'imported' | 'missing'; gap: boolean }
export type DiceCoverageNote = 'whole' | 'before-join-missing' | 'gap';
/** The one line the Dice pane shows for a coverage (null = say nothing: not a spectated game). */
export function diceCoverageNote(coverage: DiceCoverage | null | undefined): DiceCoverageNote | null {
  if (!coverage) return null;
  if (coverage.before === 'missing') return 'before-join-missing';
  return coverage.gap ? 'gap' : 'whole';
}
/** The pane's wording (owner to rule). */
export const DICE_COVERAGE_TEXT: Readonly<Record<DiceCoverageNote, string>> = {
  get whole() { return $t('hud.diceStats.diceCoverageText.wholeGame'); },
  get 'before-join-missing'() { return $t('hud.diceStats.diceCoverageText.diceFromBeforeYou'); },
  get gap() { return $t('hud.diceStats.diceCoverageText.diceRolledWhileThe'); },
};

export function emptyTally(): DiceTally {
  return { d6: [0, 0, 0, 0, 0, 0, 0], block: [0, 0, 0, 0, 0, 0, 0], armour: [], injury: [],
    dodgeFaces: [0, 0, 0, 0, 0, 0, 0], armourFaces: [0, 0, 0, 0, 0, 0, 0], injuryFaces: [0, 0, 0, 0, 0, 0, 0], oneNinth: 0, oneThirtySixth: 0,
    blocks: 0, failedBlocks: 0, dodges: 0, failedDodges: 0, pickups: 0, failedPickups: 0, rushes: 0, failedRushes: 0, d6Seq: [], blockSeq: [], tests: [], turns: [],
    luck: emptyLuck(), breaks: emptyBreaks(), cutShort: emptyCutShort() };
}

export function emptyDiceStats(gameId: string | null = null): DiceStats {
  return { gameId, seen: new Set(), teams: {}, players: {}, lastBlockAttacker: null, lastFailedDodge: null, lastFailedPickup: null, lastFailedRush: null, activeTurn: {} };
}

/** Replace everything `target` holds with `source`'s tallies and report-stream context, in place (the end screen
 *  holds on to the one reactive `diceStats` object). */
export function adoptDiceStats(target: DiceStats, source: DiceStats): void {
  const fresh = emptyDiceStats(source.gameId);
  const keys = new Set([...Object.keys(target), ...Object.keys(fresh), ...Object.keys(source)]) as Set<keyof DiceStats>;
  const from = { ...fresh, openDodges: {}, pendingBlockRolls: [], multiBlockCounted: {}, turnsLinks: {}, turnsOpen: [], ...source } as Record<string, unknown>;
  for (const key of keys) {
    if (key in from) (target as unknown as Record<string, unknown>)[key] = from[key];
    else delete (target as unknown as Record<string, unknown>)[key];
  }
}

/** Make `owner` the feeder of `stats` for `gameId`: a different owner or game starts the tallies afresh. Returns true
 *  when it did. (Before 10-10 only a game change did - a spectated game then PLAYED kept `seen` keys from the other
 *  feeder's numbering and silently skipped rolls.) */
export function claimDiceStats(stats: DiceStats, owner: string, gameId: string | null): boolean {
  if (stats.owner === owner && stats.gameId === gameId) return false;
  adoptDiceStats(stats, { ...emptyDiceStats(gameId), owner });
  return true;
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
  // Bretonnian Pastries (10-23, pending upstream): one D6 for the Knocked-out player's team; a 2+ roll (pastriesAsTest).
  bretonnianPastriesRoll: ['roll'],
};

/** ReportBretonnianPastriesRoll carries {roll, successful} and no minimum: the rule is a plain 2+ (a natural 1 fails), so
 *  it is scored as a 2+ action trial with the server's own `successful`. Without the flag it is no trial. */
function pastriesAsTest(r: Record<string, unknown>): Record<string, unknown> {
  return typeof r.successful === 'boolean' ? { ...r, minimumRoll: 2 } : r;
}

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
function turnsOf(t: DiceTally): LuckBucket { return (t.luck ??= emptyLuck()).turns ??= emptyBucket(); }
/** The skill union the dodge helper reads: the player's own + roster position skills, or one granted for the game. */
function has(game: GameJson | null, playerId: string | null, name: string): boolean {
  return !!game && !!playerId && (hasSkill(teamOf(game, playerId), playerId, name) || hasSkillWithGrants(game, playerId, name));
}
function playerJson(game: GameJson | null, playerId: string | null): (PlayerLike & Record<string, unknown>) | null {
  return (teamOf(game, playerId)?.playerArray.find((p) => p.playerId === playerId) as (PlayerLike & Record<string, unknown>) | undefined) ?? null;
}
/** Owner 10-17 ("our luck chart is using player ids rather than names"): the wire's player carries `playerName`; the
 *  tallies read `name`, which no FUMBBL player has, so every break line fell back to the id. */
function playerDisplayName(game: GameJson | null, playerId: string | null): string | null {
  const player = playerJson(game, playerId);
  const name = player?.playerName ?? player?.name;
  return typeof name === 'string' && name ? name : null;
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
function pushActionLuck(tallies: DiceTally[], r: Record<string, unknown>, ruleUnknown = false, kind = String(r.reportId ?? '') || 'unknown'): void {
  const minimum = Number(r.minimumRoll);
  if (!isD6(r.roll) || r.minimumRoll == null || !Number.isInteger(minimum) || minimum < 1 || typeof r.successful !== 'boolean') return;
  // Astra N6: whether a roll is measured must not depend on how the die fell. `ruleUnknown` is decided from the
  // report's kind and the roller alone (see passingRuleUnknown); the cross-check below is only a last-resort guard -
  // it fired on none of the 518 target rolls in the capture fixtures.
  const trial = ruleUnknown ? null : actionTrial(minimum, r.roll, r.successful);
  for (const t of tallies) {
    // owner 11-04: the roll kind's own sub-bucket, under the same rule (the Coach Stats Action breakdown)
    const kinds = ((t.luck ??= emptyLuck()).actionKinds ??= {});
    for (const bucket of [luckOf(t, 'action'), kinds[kind] ??= emptyBucket()]) {
      // UNMEASURED: the roll's rule is not "a 6 always passes, a 1 always fails, else roll >= minimum"
      if (!trial) { bucket.unmeasured += 1; continue; }
      addTrial(bucket, trial.key, trial.x6);
      addCount(bucket, 'passed', r.successful ? 1 : 0);
      addCount(bucket, 'expected', trial.p);
    }
  }
}

/** Owner 11-04: the breakdown kind of a jump. Upstream reports EVERY jump as `leapRoll` (ReportId.JUMP_ROLL's wire id;
 *  report/ReportJumpRoll.java, server step bb2025/move/StepJump.java), with no field naming the skill. The one server
 *  signal is the `skillUse` report StepJump adds when the jumper uses Leap / Pogo to ignore the jump modifiers
 *  (SkillUse PASS_JUMP_WITHOUT_MODIFIERS, or the after-roll choice): such a jump is `leapRoll:leap`, any other `leapRoll`.
 *  A reroll of the jump keeps the kind of the roll it rerolls. */
function jumpKind(stats: DiceStats, r: Record<string, unknown>, playerId: string | null): string {
  if (r.reRolled === true && stats.lastJump && stats.lastJump.playerId === playerId) return stats.lastJump.kind;
  const kind = playerId && stats.leapSkillBy === playerId ? 'leapRoll:leap' : 'leapRoll';
  stats.leapSkillBy = null;
  stats.lastJump = { playerId, kind };
  return kind;
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
  return stateHasTacklezones(state);
}
function stateHasTacklezones(state: number): boolean {
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

/*
 * WHICH injury reports are an attack roll (owner 10-13: only the rolls you made against your opponent count).
 * Audited against upstream fumbbl40k-server (every InjuryType in ffb-common/.../injury and every handleInjury call
 * site; wire names, "ForSpp" / "WithChainsaw" stripped by injuryTypeFamily). An opposing `attackerId` alone is NOT
 * proof: upstream passes the BLOCK DEFENDER as "attacker" when the blocker himself falls and on a failed Blitz rush
 * (bb2025/shared/StepDropFallingPlayers.java:192, :202), and the acting player as "attacker" for Wrestle on a
 * Ball & Chain player (WrestleBehaviour.java:95; the roll is the hard-coded [5,5] of InjuryTypeBallAndChain).
 *
 *  COUNTS for the attacker's team (stated attacker, on the other team from the victim):
 *    block, blockProne, blockStunned (+ForSpp)  EXCEPT the blocker's own fall (Skull / Both Down): the stated "attacker"
 *                                               is the model's block DEFENDER and the victim the acting player
 *    saboteur, sabotaged                        sabotage by the opposing player (victim may be the acting player)
 *    foul (+ForSpp, +WithChainsaw), chainsaw, stab, breatheFire, projectileVomit, quickBite, bitten,
 *    pilingOnArmor, pilingOnInjury   (pilingOnKnockedOut passes a null attacker and rolls no dice, so it never counts)
 *    (a kickback on oneself names a same-team victim, so the team test drops it)
 *  COUNTS for the ACTING player when the victim is on the other team: the thrower of record at the moment of the
 *    hit. The stated attacker is NEVER used: it names the SPP / skill beneficiary, not the owner: bombForSpp = the
 *    ORIGINAL bombardier (StepPass.java:165, StepSpecialEffect.java:178), who is not the thrower once a catcher
 *    re-throws or fumbles (StepEndBomb.java:154); ttmHitPlayerForSpp = the thrown player (Lethal Flight) or the
 *    thrower / kicker for the KTM SPP property (StepInitScatterPlayer.java:310, :318-322);
 *    a victim on the acting player's own team counts for nobody. The acting player is not always the original
 *    thrower either (Swoop re-actors to the swooper, StepSwoop.java:233), and that is the intent:
 *    bomb (+ForSpp), ttmHitPlayer (+ForSpp), startedBlastin, kegHit
 *  COUNTS for NOBODY (no opposing attack, or environmental):
 *    dropDodge, dropDodgeForSpp (Arm Bar supplies the opposing player but it is a failed dodge), dropGfi, dropLeap,
 *    crowdpush, crowdpushForSpp, ktmCrowd, trapdoorFall (+ForSpp: environmental), ttmLanding, eatPlayer,
 *    ktmInjury, ktmFumbleInjury, ktmFumbleApoKoInjury, fireball, lightning, throwARock (inducement / spell /
 *    fan: no player in the report to credit)
 *  SYNTHETIC dice, ignored: ballAndChain (a fixed [5,5], not rolled)
 *  Anything unknown: nobody.
 */
const ATTACK_FAMILIES = new Set(['block', 'blockProne', 'blockStunned', 'saboteur', 'sabotaged', 'foul', 'chainsaw', 'stab', 'breatheFire',
  'projectileVomit', 'quickBite', 'bitten', 'pilingOnArmor', 'pilingOnInjury']);
const BLOCK_FALL_FAMILIES = new Set(['block', 'blockProne', 'blockStunned']);
const ACTING_ATTACK_FAMILIES = new Set(['bomb', 'ttmHitPlayer', 'startedBlastin', 'kegHit']);

/**
 * The attacker whose armour / injury roll an `injury` report is, or null when it is nobody's attack (see the table
 * above). Always on the OTHER team from the defender.
 */
function inflictingAttacker(stats: DiceStats, game: GameJson | null, r: Report, actingId: string | null): string | null {
  const type = String(r.injuryType ?? '');
  const family = injuryTypeFamily(type);
  const defenderId = typeof r.defenderId === 'string' ? r.defenderId : null;
  const stated = typeof r.attackerId === 'string' ? r.attackerId : null;
  let attacker: string | null = null;
  if (family === '' || BLOCK_FALL_FAMILIES.has(family) || family === 'foul') {
    // a block / foul report that names no attacker: the latched blocker / acting player, as the log formatter does
    attacker = stated ?? stats.lastBlockAttacker ?? actingId;
    // the blocker's own fall: upstream names the block defender as the attacker and the acting player as the victim
    // Upstream's fall is the exact mirror of a block: the "attacker" is the model's block DEFENDER and the victim is the
    // acting player; a real block has the acting player as the attacker. (Victim = acting alone proves nothing: a stale
    // actor can be blocked. Game 1949262 command 1363 is a genuine Skull fall, rejected correctly by this rule.)
    if (family !== 'foul' && stated && defenderId && defenderId === (actingId ?? stats.lastBlockAttacker) && stated === (game as { defenderId?: string } | null)?.defenderId) return null;
  } else if (ATTACK_FAMILIES.has(family)) attacker = stated;
  else if (ACTING_ATTACK_FAMILIES.has(family)) attacker = actingId;
  const a = teamOf(game, attacker), d = teamOf(game, defenderId);
  return attacker && a && d && a.teamId !== d.teamId ? attacker : null;
}

/**
 * The armour roll and the injury roll of one `injury` report, as luck trials for the ATTACKER's team (and the
 * attacker) only: the roll as it fell (a break / a removal is good). The defender's team gets no inverted trial.
 */
/** The armour roll of an `injury` report, as diceLuck.armourBreakThreshold reads it. */
function armourInputFor(game: GameJson | null, r: Report, attackerId: string, armour: [number, number]): ArmourRollInput {
  const defenderId = typeof r.defenderId === 'string' ? r.defenderId : null;
  const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  const attackerTeam = teamOf(game, attackerId), own = teamOf(game, defenderId);
  return {
    av: effectiveArmour(playerJson(game, defenderId) as never), total: armour[0] + armour[1], broken: r.armorBroken === true, injuryType: String(r.injuryType ?? ''),
    armourModifiers: names(r.armorModifiers), injuryModifiers: names(r.injuryModifiers), hasInjuryRoll: Array.isArray(r.injuryRoll) && r.injuryRoll.length === 2,
    mightyBlow: mightyBlowValue(game, attackerId),
    attackerHasClaws: has(game, attackerId, 'Claws') || has(game, attackerId, 'Claw'),
    chainsawInvolved: has(game, attackerId, 'Chainsaw') || has(game, defenderId, 'Chainsaw'),
    defenderHasIronHardSkin: has(game, defenderId, 'Iron Hard Skin'),
    sameTeam: !!attackerTeam && !!own && attackerTeam.teamId === own.teamId,
    clawDoesNotStack: gameOption(game, 'clawDoesNotStack') !== 'false',
    mbStacksAgainstChainsaw: gameOption(game, 'mbStacksAgainstChainsaw') === 'true',
  };
}

function noteInjuryReportLuck(stats: DiceStats, game: GameJson | null, commandNr: number | null, r: Report, attackerId: string, armour: [number, number] | null, injury: [number, number] | null): void {
  const defenderId = typeof r.defenderId === 'string' ? r.defenderId : null;
  const own = teamOf(game, defenderId);
  const them = otherTeam(game, own);
  const defender = playerJson(game, defenderId);
  if (!game || !own || !them || !defender) return; // nobody to score it for
  const theirs = tallyFor(stats, them.teamId, attackerId);
  const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  const injuryModifiers = names(r.injuryModifiers);
  const mightyBlow = mightyBlowValue(game, attackerId);

  if (armour && typeof r.armorBroken === 'boolean') {
    const key = `${commandNr}|${defenderId}|${armour[0]},${armour[1]}`;
    if (commandNr == null || key !== stats.lastArmourTrial) {
      stats.lastArmourTrial = key;
      const threshold = armourBreakThreshold(armourInputFor(game, r, attackerId, armour));
      // UNMEASURED: see armourBreakThreshold - an unvalued modifier, a result that disagrees with this client's
      // armour value, or a break whose left-over modifiers cannot be read
      if (threshold == null) { for (const t of theirs) luckOf(t, 'armour').unmeasured += 1; }
      else {
        const breaks = twoD6AtLeast(threshold); // of 36
        // owner 10-16 (Luck): broken favours the attacker's team, held the victim's
        noteBreakEvent(stats, game, rollOutcomes(breaks / 36, them.teamId, own.teamId), r.armorBroken ? 0 : 1, `Armour ${r.armorBroken ? 'broken' : 'held'} (${threshold}+)`, attackerId, stats.turnClock ?? readTurnClock(game));
        for (const t of theirs) {
          const b = luckOf(t, 'armour');
          addTrial(b, binaryKey(breaks, 36), r.armorBroken ? 6 : 0);
          addCount(b, 'theirRolls', 1); addCount(b, 'theirBroken', r.armorBroken ? 1 : 0); addCount(b, 'theirExpected', breaks / 36);
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
      if (!trial) { for (const t of theirs) luckOf(t, 'injury').unmeasured += 1; }
      else {
        // owner 10-16 (Luck): a KO or a casualty favours the attacker's team, a stun the victim's only when removal was likelier
        noteBreakEvent(stats, game, injuryRollOutcomes(trial.counts, own.teamId, them.teamId),
          trial.level, `Injury roll: ${['stun', 'KO', 'casualty'][trial.level]}`, attackerId, stats.turnClock ?? readTurnClock(game));
        const ko6 = koWeightFor(game, own); // the VICTIM's team's kegs
        const expected6 = parseDist(injuryKey(trial.counts, ko6, false)).mean6;
        for (const [list, mine, side] of [[theirs, false, 'their']] as const) {
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

// ---- turns lost (owner 10-15; the definitions and the maths live in turnsLost.ts) ----
//
// EXPECTED turns, summed at the ATTACK over every attack a team makes on its opponent (owner 10-15: "indicative of the
// entire probability state" - an attack that misses still adds its chance):
//   expected += P(the attack reaches the armour roll)
//             x Σ over the ways the armour can break: P(2D6 breaks it that way)            (turnsLost.ArmourTier)
//             x Σ over the injury results: P(result | that way's injury modifier, the victim's table: Stunty, Thick Skull)
//             x turns(result, now)                                                         (turnsLost.turnsScore)
// P(reaches the armour roll), per kind of attack:
//   block            P(the defender is knocked down): the dice count and who picks (the `blockChoice`), and the match-up
//                    the Block dice row already reads (Block, Wrestle, Dodge, Tackle, Juggernaut on a Blitz, tackle zones)
//                    - turnsLost.blockKnockdownChance. Booked at the `blockChoice`, whatever is then picked; its armour from
//                    the model (AV, Mighty Blow, Claws, Chainsaw, Iron Hard Skin - turnsLost.blockArmourTiers). Rerolls of
//                    the block dice are not modelled: the chance is the dice count's own.
//   crowd push       (owner 10-15) when the push-back of this block is forced off the pitch (turnsLost.crowdPushForced,
//                    read from the pitch as the last frame left it, stats.turnField), every face that pushes sends the
//                    defender into the crowd: no armour roll, the injury roll straight away (turnsLost.blockOutcomeChance,
//                    turnsLost.CrowdReach), a stun there costing the rest of the half. Not when the defender can stop it:
//                    Stand Firm (with his tackle zones at the roll, or Rooted; Juggernaut on a Blitz cancels it), Sidestep
//                    (tackle zones at the roll and a free square next to him; the attacker's Grab cancels it outside a
//                    Blitz, or in one under grabCancelsSidestepDuringBlitz). Fend changes nothing (only the follow-up);
//                    Grab is the attacker's to decline, so it leaves the crowd in. The crowd injury is booked against
//                    the block (crowdpush reports state no attacker: the link supplies the blocker); for these turns
//                    only - the Armour / Injury rows still count a crowd push for nobody.
//   chain surf       (owner 10-16) when the push-back of this block is a chain push (all three squares on the pitch and
//                    taken) that ends in the crowd, resolved from the same pre-block pitch (turnsLost.chainPushOutcome:
//                    the attacker picks the squares, Stand Firm / Side Step in the chain are their coaches' calls, each
//                    side takes its best), the block carries a second trial: P(the picked face pushes) x the crowd
//                    injury on THAT player's table x his team's turns. Credited to the blocker, or to the defender when
//                    the surfed player is the blocker's own team-mate; booked against the chain-pushed player's crowd
//                    injury report (stats.turnsChain). A chain too long to read leaves the whole block unmeasured.
//   Steady Footing   (owner 10-16) the defender's knock-down and the blocker's own fall each times 5/6 for a player who
//                    has the skill and can use it (not confused or hypnotized): on a 6 he stays up, no armour roll and no
//                    injury report follow, the trial books 0 (turnsLost.STEADY_FOOTING_FAIL6). Not for a crowd push, not
//                    for the Chainsaw hit (the server rolls neither through it).
//   Chainsaw attack  the Chainsaw roll's own chance, (7 - minimum) / 6 (a 2+: 5/6), then armour +3 (none through Iron
//                    Hard Skin), no injury modifier (InjuryTypeChainsaw) - booked at its first `chainsawRoll`.
//   everything else  1 at the armour roll, read from the attack's own report (diceLuck.armourBreakThreshold and the
//                    armour-or-injury hand-over, turnsLost.reportArmourTiers): a foul (the victim is already down: assists
//                    +1 / -1 each on the armour only - InjuryTypeFoul.java:59-63 - and Dirty Player / A Sneaky Pair on the
//                    armour when the roll without them fails, else on the injury; no Mighty Blow), a Chainsaw foul (the
//                    Chainsaw roll is not modelled there), a stab, Breathe Fire, Projectile Vomit, bites, sabotage, bombs,
//                    thrown players, kegs, Then I Started Blastin. A hit that breaks armour with no armour roll reaches the
//                    injury roll with certainty.
//   Piling On        a reroll of an attack already counted: no new chance; its result replaces the earlier one.
// ACTUAL turns: the turns the victims actually missed from those attacks' results (turnsLost header): a stun and a
// casualty booked at the injury, a knock-out counted live through its own drive (advanceTurnsLost), a casualty counted
// on into overtime. Owner 10-15 (KO by drive): each trial's KO term is provisional (the rest of the half) until its
// drive ends, then the victim team's turns actually started in it (openAttack / advanceTurnAttacks); a KO recovery roll
// at a later kick-off is its own trial for the attacker who caused the KO (noteKoRecoveries). Every trial is kept in
// the team tally's turnsLog (expected, variance, actual, outcome) for the Luck row's story.
// A sent-off fouler costs his own team, not the opponent: nothing here. An attack whose chance cannot be read soundly
// (an unvalued modifier on an attack booked at its own report, a Multiple Block, a block whose `blockChoice` was not seen) is UNMEASURED for both figures.
// A crowd push the expectation did not carry (no pitch read for the block, a chain push read to end on the pitch, a push
// the model judged stoppable) books nothing: the attack stays measured on the expectation it was booked with, whatever
// the dice did.

/** The turn state of a model: null when it carries no half / turn data (the turns row then goes unmeasured). */
export function readTurnClock(game: GameJson | null): TurnClock | null {
  if (!game) return null;
  const half = Number(game.half);
  const home = Number((game.turnDataHome as { turnNr?: unknown } | undefined)?.turnNr);
  const away = Number((game.turnDataAway as { turnNr?: unknown } | undefined)?.turnNr);
  if (!Number.isInteger(half) || half < 1 || half > 3 || !Number.isFinite(home) || !Number.isFinite(away)) return null;
  const result = game.gameResult as { teamResultHome?: { score?: unknown }; teamResultAway?: { score?: unknown } } | undefined;
  const score = (Number(result?.teamResultHome?.score) || 0) + (Number(result?.teamResultAway?.score) || 0);
  return { half, turnHome: home, turnAway: away, drive: `${half}|${score}`, homePlaying: (game as { homePlaying?: unknown }).homePlaying === true, regular: String(game.turnMode ?? '') === 'regular' };
}
function clockTurnOf(game: GameJson, clock: TurnClock, teamId: string): number {
  return (game.teamHome as unknown as TeamLike).teamId === teamId ? clock.turnHome : clock.turnAway;
}
function playerBaseState(game: GameJson, playerId: string): number | null {
  const data = (game.fieldModel?.playerDataArray as { playerId?: string; playerState?: unknown }[] | undefined)?.find((d) => d.playerId === playerId);
  const state = Number(data?.playerState);
  return data && Number.isFinite(state) ? state & 0xff : null;
}
const STUNNED = 4, KNOCKED_OUT = 5, RESERVE = 9;
/**
 * Astra follow r3 #2 / r4: an `apothecaryChoice` report whose decided state is STUNNED: the apothecary turned a KO
 * into a stun (bb2025 StepApothecary.java:516-523, canApoKoIntoStun). The DECISION is the evidence - never the player
 * state, which may already have been STUNNED (a fouled player) before it. The stun's one turn is booked now (as any
 * stun is, at the injury), the KO entry closes and its recovery chain ends, so a later KO of the same player in this
 * drive is that injury's alone. A declined apothecary sends no such report: the KO stands, counted live.
 */
function noteApothecaryChoice(stats: DiceStats, game: GameJson | null, r: Report, clock: TurnClock | null): void {
  const playerId = typeof r.playerId === 'string' ? r.playerId : null;
  if (!game || !clock || !playerId || (Number(r.playerState) & 0xff) !== STUNNED) return;
  const e = [...(stats.turnsOpen ?? [])].reverse().find((x) => !x.done && x.kind === 'ko' && x.playerId === playerId && x.drive !== '' && x.added === 0);
  if (!e) return;
  e.done = true;
  const stun = Math.min(1, turnsLeftInHalf(clockTurnOf(game, clock, e.victimTeamId)));
  e.added = stun;
  if (stun > 0) addLostTurns(stats, e.teamId, e.attacker, stun, null, 1, e.attackId);
  resolveOutcome(stats, e, 'Stun (apothecary)');
  const chain = stats.koChains?.[playerId];
  if (chain && chain.entry === e.id) delete stats.koChains![playerId];
}
/** Astra luck r1 #3: an apothecary (or a casualty saved to the reserves) changes what an attack came to - its trial's
 *  outcome follows, so the Luck event reads the resolved result. */
function resolveOutcome(stats: DiceStats, e: TurnsEntry, outcome: string): void {
  const rec = e.attackId == null ? null : attackRecord(stats, e.teamId, e.attackId);
  if (rec && !rec.recovery) rec.outcome = outcome;
}
function turnsUnmeasured(tallies: DiceTally[]): void { for (const t of tallies) turnsOf(t).unmeasured += 1; }
function addTurnsTrial(tallies: DiceTally[], key: string, sign: 1 | -1 = 1, attack = true): void {
  const expected = expectedTurns(key);
  for (const t of tallies) {
    const b = turnsOf(t);
    if (sign > 0) addTrial(b, key, 0); // the actual turns are added as they are lost (bookTurns, advanceTurnsLost)
    else { b.n -= 1; b.kinds[key] = (b.kinds[key] ?? 0) - 1; if (b.kinds[key]! <= 0) delete b.kinds[key]; }
    if (attack) addCount(b, 'attacks', sign);
    addCount(b, 'expected', sign * expected);
  }
}
function addLostTurns(stats: DiceStats, teamId: string, attacker: string, turns: number, result: InjuryLevel | null, sign: 1 | -1, attackId?: number | null): void {
  const rec = attackId == null ? null : attackRecord(stats, teamId, attackId);
  if (rec) rec.actual += sign * turns;
  for (const t of tallyFor(stats, teamId, attacker)) {
    const b = turnsOf(t);
    b.x6 += sign * turns * 6;
    addCount(b, 'lost', sign * turns);
    if (result != null) addCount(b, result === 0 ? 'stuns' : result === 1 ? 'kos' : 'casualties', sign);
  }
}
const LEVEL_OUTCOME = ['Stun', 'KO', 'Casualty'] as const;
/** Book an attack's result for the attacking team: a stun and a casualty now, a knock-out live (an open entry). */
function bookTurns(stats: DiceStats, game: GameJson, clock: TurnClock, teamId: string, attacker: string, victimTeamId: string, playerId: string, level: InjuryLevel | null, crowd = false, attackId: number | null = null): TurnsBooking {
  const rec = attackId == null ? null : attackRecord(stats, teamId, attackId);
  if (level == null) return { value: 0, level: null, entry: null, attackId };
  // i18n 10-23 (Astra r1 #1): outcomes are invariant DATA (recordHappened parses them); the Luck display localises them.
  if (rec) rec.outcome = data(crowd ? `Crowd surf ${LEVEL_OUTCOME[level].toLowerCase()}` : LEVEL_OUTCOME[level]);
  const turnNr = clockTurnOf(game, clock, victimTeamId);
  // a crowd stun sends the player to the reserves for the rest of the drive: counted live like a knock-out
  const value = crowd && level === 0 ? 0 : level === 2 && clock.half >= 3 ? 0 : bookedTurns(level, turnsScore(clock.half, turnNr, 0));
  addLostTurns(stats, teamId, attacker, value, level, 1, attackId);
  if (level === 0 && !crowd) return { value, level, entry: null, attackId, crowd };
  const id = stats.turnsSeq = (stats.turnsSeq ?? 0) + 1;
  // a regulation casualty's turns are booked above (none for an overtime one, Astra r1 #4: a golden goal can end the
  // game before they are played); overtime turns are counted on as they start (from turn index 16)
  const start = turnIndex(clock.half, turnNr);
  const floor = level === 2 ? Math.max(start, 2 * TURNS_PER_HALF) : 0;
  (stats.turnsOpen ??= []).push({ id, kind: level === 2 ? 'cas' : 'ko', teamId, attacker, victimTeamId, playerId, drive: clock.drive, idx: Math.max(start, floor), added: 0, booked: value, start, floor, attackId });
  // owner 10-15: a KO starts the attacker's recovery chain (each roll at a later kick-off is his trial) - a KO in the
  // crowd too (Astra follow r1 #2); a crowd STUN is no KO and rolls no recovery
  if (level === 1) (stats.koChains ??= {})[playerId] = { teamId, attacker, drive: clock.drive, entry: id };
  return { value: 0, level, entry: id, attackId, crowd };
}
function unbookTurns(stats: DiceStats, teamId: string, attacker: string, booking: TurnsBooking | null | undefined): void {
  if (!booking) return;
  let value = booking.value;
  const entry = booking.entry == null ? null : (stats.turnsOpen ?? []).find((e) => e.id === booking.entry);
  if (entry) {
    value += entry.booked + entry.added; entry.done = true;
    const chain = stats.koChains?.[entry.playerId];
    if (chain && chain.entry === entry.id) delete stats.koChains![entry.playerId];
  }
  addLostTurns(stats, teamId, attacker, value, booking.level, -1, booking.attackId);
  const rec = booking.attackId == null ? null : attackRecord(stats, teamId, booking.attackId);
  if (rec && booking.level != null) rec.outcome = rec.idle;
}

// ---- the Turns lost trials and their drives (owner 10-15) ----
function attackRecord(stats: DiceStats, teamId: string, id: number): TurnsAttackRecord | null {
  return stats.teams[teamId]?.turnsLog?.find((rec) => rec.id === id) ?? null;
}
/** Swap a trial's distribution key in the bucket (its provisional value changed, or its drive ended). */
function retagTrial(stats: DiceStats, teamId: string, rec: TurnsAttackRecord, key: string): void {
  if (key === rec.key) return;
  const before = expectedTurns(rec.key), after = expectedTurns(key);
  for (const t of tallyFor(stats, teamId, rec.attacker)) {
    const b = turnsOf(t);
    b.kinds[rec.key] = (b.kinds[rec.key] ?? 0) - 1; if (b.kinds[rec.key]! <= 0) delete b.kinds[rec.key];
    b.kinds[key] = (b.kinds[key] ?? 0) + 1;
    addCount(b, 'expected', after - before);
  }
  rec.key = key; rec.expected = after; rec.variance = varianceTurns(key);
}
function recordKey(rec: TurnsAttackRecord, drive: number): string { return outcomeKey(rec.outcomes, { stun: rec.stun, drive, cas: rec.cas }); }
/**
 * Open one trial of the Turns lost row for `teamId` / `attacker`: its outcomes valued with the KO term provisional
 * (the rest of the half), counted as the victim team starts its turns in the drive (advanceTurnAttacks). Returns its id.
 */
function openAttack(stats: DiceStats, game: GameJson, clock: TurnClock, teamId: string, attacker: string, victim: string, outcomes: AttackOutcomes,
  label: string, outcome: string, opts: { recovery?: boolean; fromDrive?: string; fall?: boolean; chain?: boolean; turnTeam?: string } = {}): number {
  const victimTeam = teamOf(game, victim)!;
  const turnNr = clockTurnOf(game, clock, victimTeam.teamId);
  const score = turnsScore(clock.half, turnNr, 0);
  const id = stats.turnsAttackSeq = (stats.turnsAttackSeq ?? 0) + 1;
  const eventSeq = stats.breakSeq = (stats.breakSeq ?? 0) + 1;
  const name = playerDisplayName(game, victim);
  const rec: TurnsAttackRecord = {
    id, attacker, victimTeamId: victimTeam.teamId, victim, victimName: typeof name === 'string' && name ? name : victim,
    // the credited team's turn; the victim's for a fall or a recovery; `turnTeam` (the blocking team) for a chain surf
    label, half: clock.half, turn: clockTurnOf(game, clock, opts.turnTeam ?? (opts.fall || opts.recovery ? victimTeam.teamId : teamId)), outcomes,
    stun: opts.recovery ? 0 : score.stun, cas: opts.recovery ? 0 : score.cas,
    drive: opts.recovery ? null : clock.drive, fromDrive: opts.fromDrive, idx: turnIndex(clock.half, turnNr), d: 0,
    open: true, provisional: turnsLeftInHalf(turnNr), key: '', expected: 0, variance: 0, actual: 0, outcome, idle: outcome, recovery: opts.recovery, fall: opts.fall,
    seq: eventSeq, slot: clockSlot(clock).slot, ...playedCol(stats, (game.teamHome as unknown as TeamLike).teamId, clockSlot(clock)), attackerName: playerDisplayName(game, attacker) ?? attacker,
    ...(opts.chain ? { chain: true } : {}),
  };
  rec.key = recordKey(rec, rec.provisional); rec.expected = expectedTurns(rec.key); rec.variance = varianceTurns(rec.key);
  ((stats.teams[teamId] ??= emptyTally()).turnsLog ??= []).push(rec);
  addTurnsTrial(tallyFor(stats, teamId, attacker), rec.key, 1, !opts.recovery && !opts.chain);
  return id;
}
const gameOver = (game: GameJson) => !!(game as { finished?: unknown }).finished || String(game.turnMode ?? '') === 'endGame';
/**
 * Count each open trial's drive: the victim team's turns started in it since the attack (regular play only, as for the
 * KO entries). When the drive ends (another drive, or the game over) the trial is FINALISED: its KO term becomes those
 * turns. A recovery's drive is the first drive after `fromDrive`; its provisional value is re-read when that drive
 * starts (the rest of its half). Idempotent like advanceTurnsLost.
 */
function advanceTurnAttacks(stats: DiceStats, game: GameJson, clock: TurnClock): void {
  const regular = String(game.turnMode ?? '') === 'regular';
  const over = gameOver(game);
  for (const [teamId, tally] of Object.entries(stats.teams)) {
    for (const rec of tally.turnsLog ?? []) {
      if (!rec.open) continue;
      const turnNr = clockTurnOf(game, clock, rec.victimTeamId);
      const cur = turnIndex(clock.half, turnNr);
      if (rec.drive == null) {
        if (!over && clock.drive === rec.fromDrive) continue;
        if (over) { rec.open = false; retagTrial(stats, teamId, rec, recordKey(rec, rec.d)); continue; }
        rec.drive = clock.drive; rec.idx = cur; rec.provisional = turnsLeftInHalf(turnNr);
        retagTrial(stats, teamId, rec, recordKey(rec, rec.provisional));
      }
      if (over || clock.drive !== rec.drive) { rec.open = false; retagTrial(stats, teamId, rec, recordKey(rec, rec.d)); continue; }
      if (!regular) { rec.idx = cur; continue; }
      if (cur > rec.idx) { rec.d += cur - rec.idx; rec.idx = cur; }
    }
  }
}
/** A `turnEnd` report's KO recovery rolls (bb2025 StepEndTurn.recoverKnockout): each roll of a player whose KO an
 *  attacker is credited with is that attacker's trial (see turnsLost.ts header). */
/**
 * Owner 11-04 (Coach Stats "KO recoveries"): one entry of the turnEnd report's `knockoutRecoveryArray` (upstream
 * KnockoutRecovery: playerId, recovering, roll, bloodweiserBabes, bugmansXXXXXXModifier; step/bb2025/StepEndTurn.java
 * recoverKnockout) is one trial for the player's team. The report states no target: it is derived from the report's
 * OWN modifiers (kegs + Bugman's, never re-read from the team) by the server's rule (DiceInterpreter
 * .isRecoveringFromKnockout: roll > 1 and roll + modifier > 3, i.e. 4+ base, 3+ / 2+ with +1 / +2, a 1 always fails).
 * A roll whose stated result disagrees with that rule is counted unmeasured.
 */
function noteKoRecoveryRoll(stats: DiceStats, game: GameJson, roll: Record<string, unknown>): void {
  const playerId = typeof roll.playerId === 'string' ? roll.playerId : null;
  const team = teamOf(game, playerId);
  if (!team || typeof roll.recovering !== 'boolean') return;
  const modifier = (Number(roll.bloodweiserBabes ?? roll.bloodweiserKegs) || 0) + (Number(roll.bugmansXXXXXXModifier) || 0);
  const target = Math.max(2, 4 - modifier);
  const trial = isD6(roll.roll) ? actionTrial(target, roll.roll, roll.recovering) : null;
  for (const t of tallyFor(stats, team.teamId, playerId)) {
    const b = (t.luck ??= emptyLuck()).koRecovery ??= emptyBucket();
    if (!trial) { b.unmeasured += 1; continue; }
    addTrial(b, trial.key, trial.x6);
    addCount(b, 'passed', roll.recovering ? 1 : 0);
    addCount(b, 'expected', trial.p);
  }
}

function noteKoRecoveries(stats: DiceStats, game: GameJson | null, r: Report, clock: TurnClock | null): void {
  const list = Array.isArray(r.knockoutRecoveryArray) ? (r.knockoutRecoveryArray as Record<string, unknown>[]) : [];
  if (game) for (const roll of list) noteKoRecoveryRoll(stats, game, roll);
  if (!game || !clock || !list.length) return;
  for (const roll of list) {
    const playerId = typeof roll.playerId === 'string' ? roll.playerId : null;
    // owner 10-16 (Luck): every recovery roll, credited or not - recovered favours the player's team, failed the other
    {
      const own = teamOf(game, playerId), other = otherTeam(game, own);
      const mod = (Number(roll.bloodweiserBabes ?? roll.bloodweiserKegs) || 0) + (Number(roll.bugmansXXXXXXModifier) || 0);
      if (own && other && typeof roll.recovering === 'boolean') {
        const fail6 = koRecoveryFail6(mod);
        noteBreakEvent(stats, game, rollOutcomes((6 - fail6) / 6, own.teamId, other.teamId), roll.recovering ? 0 : 1, `KO recovery ${roll.recovering ? 'passed' : 'failed'}`, playerId, clock);
      }
    }
    const chain = playerId ? stats.koChains?.[playerId] : undefined;
    if (!playerId || !chain || !teamOf(game, chain.attacker) || !teamOf(game, playerId)) continue;
    // Astra follow r1 #1: the kegs travel as `bloodweiserBabes` (IJsonOption.BLOODWEISER_KEGS keeps the old key)
    const modifier = (Number(roll.bloodweiserBabes ?? roll.bloodweiserKegs) || 0) + (Number(roll.bugmansXXXXXXModifier) || 0);
    const fail = koRecoveryFail6(modifier);
    const recovered = roll.recovering === true;
    const prev = chain.recId != null ? attackRecord(stats, chain.teamId, chain.recId) : null;
    const fromDrive = prev ? prev.drive ?? prev.fromDrive ?? '' : chain.drive ?? '';
    const id = openAttack(stats, game, clock, chain.teamId, chain.attacker, playerId, { den: 6, nothing: 6 - fail, stun: 0, ko: fail, cas: 0, crowdStun: 0 },
      'KO recovery', recovered ? 'Recovered' : 'Failed', { recovery: true, fromDrive });
    for (const t of tallyFor(stats, chain.teamId, chain.attacker)) {
      const b = turnsOf(t);
      addCount(b, 'recoveries', 1);
      if (!recovered) addCount(b, 'recoveryFails', 1);
    }
    if (recovered) { delete stats.koChains![playerId]; continue; }
    // a failed roll: the player misses the next drive, counted live against this roll's trial
    const entry = stats.turnsSeq = (stats.turnsSeq ?? 0) + 1;
    const victimTeam = teamOf(game, playerId)!;
    (stats.turnsOpen ??= []).push({ id: entry, kind: 'ko', teamId: chain.teamId, attacker: chain.attacker, victimTeamId: victimTeam.teamId, playerId,
      drive: '', fromDrive, idx: 0, added: 0, booked: 0, start: 0, floor: 0, attackId: id });
    chain.recId = id; chain.entry = entry;
  }
}
/**
 * Count the turns the victims of open knock-outs (and casualties, into overtime) miss as the victim's team starts its
 * turns. A knock-out counts every team turn started during the injury's drive (the player cannot come back in it,
 * apothecary or not), and in any later drive while the player is still knocked out (a failed recovery roll at that
 * kick-off); the first later drive where the player is no longer knocked out ends it. Idempotent: an index counted
 * once is never counted again, so a re-applied frame or a replay seek adds nothing.
 */
export function advanceTurnsLost(stats: DiceStats, game: GameJson | null): void {
  const clock = readTurnClock(game);
  if (!game || !clock) return;
  advanceTurnAttacks(stats, game, clock);
  // Astra follow r2 / r3 / r4: a recovery chain ends once its player is seen in the RESERVES without a recovery roll
  // claiming him. An apothecary's stun is resolved from its own report (noteApothecaryChoice), never from the player
  // state: the server reports the injury before the apothecary decision and keeps the prior state (standing,
  // falling, or STUNNED for a fouled player) until it is made (StepApothecary.java:325, :364)
  for (const id of Object.keys(stats.koChains ?? {})) if (playerBaseState(game, id) === RESERVE) delete stats.koChains![id];
  if (!stats.turnsOpen?.length) return;
  // Astra r2 #3: team turns START only in regular play. Outside it (set-up, kick-off) a turn marker can move without a
  // turn being played (a kick-off Time-out moves both by one, either way - StepApplyKickoffResult.handleTimeout): the
  // entries follow the marker without counting
  const regular = String(game.turnMode ?? '') === 'regular';
  for (const e of stats.turnsOpen) {
    if (e.done) continue;
    const state = playerBaseState(game, e.playerId);
    // Astra r2 #2: a casualty saved to the reserves (an apothecary's Badly Hurt, Regeneration) was never out for the
    // game: its up-front booking is taken back and it is counted from the injury like a knock-out (the rest of that
    // drive; nothing once he is available again)
    if (e.kind === 'cas' && state === RESERVE) {
      addLostTurns(stats, e.teamId, e.attacker, e.booked + e.added, null, -1, e.attackId);
      Object.assign(e, { kind: 'ko', idx: e.start, floor: 0, booked: 0, added: 0 });
      resolveOutcome(stats, e, 'KO (saved to the reserves)');
    }
    const cur = turnIndex(clock.half, clockTurnOf(game, clock, e.victimTeamId));
    // owner 10-15: a failed recovery roll counts the NEXT drive: it starts when the drive after `fromDrive` does
    if (e.drive === '') {
      if (clock.drive === e.fromDrive) continue;
      e.drive = clock.drive; e.idx = cur;
    }
    // owner 10-15 (KO recovery by drive): a knock-out costs the turns of its own drive only - a later drive is the
    // recovery roll's trial (noteKoRecoveries)
    if (e.kind === 'ko' && clock.drive !== e.drive) {
      e.done = true;
      // Astra follow r1 #3: a player no longer knocked out when his drive ends (an apothecary's stun) rolls no
      // recovery: his chain ends here (a recovery report in this frame has already moved or ended it)
      const chain = stats.koChains?.[e.playerId];
      if (chain && chain.entry === e.id && state !== KNOCKED_OUT) delete stats.koChains![e.playerId];
      continue;
    }
    if (!regular) { e.idx = Math.max(cur, e.floor); continue; }
    if (cur <= e.idx) continue;
    // Astra r1 #2 / r2 #1: a team turn has started and the player is back ON the pitch in the injury's own drive - an
    // apothecary turned the KO into a stun (StepApothecary.java:516-518), and the turn start has already turned him
    // over (prone, unable to act: UtilPlayer.refreshPlayersForTurnStart). It costs what a stun costs: this one turn.
    if (e.kind === 'ko' && state != null && state !== KNOCKED_OUT && state !== RESERVE) {
      e.done = true;
      if (e.added === 0) { e.added = 1; addLostTurns(stats, e.teamId, e.attacker, 1, null, 1, e.attackId); }
      resolveOutcome(stats, e, 'Stun (apothecary)');
      const chain = stats.koChains?.[e.playerId];
      if (chain && chain.entry === e.id) delete stats.koChains![e.playerId]; // back on the pitch: no recovery roll follows
      continue;
    }
    const add = cur - e.idx;
    e.idx = cur; e.added += add;
    addLostTurns(stats, e.teamId, e.attacker, add, null, 1, e.attackId);
  }
}
function turnsScoreFor(game: GameJson, clock: TurnClock, victim: TeamLike) {
  return turnsScore(clock.half, clockTurnOf(game, clock, victim.teamId), koWeightFor(game, victim));
}

/** A `blockChoice`: one block thrown. Books its expected turns (see the chain above) and links the victim to it. */
function noteBlockTurns(stats: DiceStats, game: GameJson | null, attacker: string | null, nrOfDice: number | null, defender: string | null, multi: boolean, clock: TurnClock | null,
  atRoll: { defenderTacklezones: boolean; blitz: boolean; sameFrame: boolean } | null, pitch: DiceStats['turnField'] = null, crowdReadable = true, chosenFace: number | null = null): void {
  const a = teamOf(game, attacker), d = teamOf(game, defender);
  stats.turnsPending = [];
  stats.tcsLast = null;
  if (!game || !attacker || !defender || !a || !d || a.teamId === d.teamId) return;
  const links = (stats.turnsLinks ??= {});
  stats.turnsCrowd = null; stats.turnsChain = null; stats.turnsFooting = null;
  const tallies = tallyFor(stats, a.teamId, attacker);
  // owner 10-15: the blocker's own fall is a trial for the DEFENDER's team, measured exactly when the block is
  const fallTallies = tallyFor(stats, d.teamId, defender);
  const fallUnmeasured = () => { turnsUnmeasured(fallTallies); links[attacker] = { attacker: defender, measured: false, fall: true }; };
  const dice = nrOfDice == null ? 0 : Math.abs(nrOfDice);
  const defenderJson = playerJson(game, defender);
  const ironHardSkin = has(game, defender, 'Iron Hard Skin');
  // Astra r2 #4: an ordinary block never uses the ATTACKER's Chainsaw (StepDropFallingPlayers.java:135 builds
  // InjuryTypeBlock(REGULAR, false)): only a defender carrying one adds the +3
  const chainsaw = has(game, defender, 'Chainsaw');
  // UNMEASURED: a Multiple Block (who picks cannot be read), no dice count, no turn data, a Chainsaw block under
  // mbStacksAgainstChainsaw (see diceLuck.armourBreakThreshold), or a Ball & Chain victim (Astra r4 #4: knocked down
  // with no armour roll and a stun read as a KO, UtilServerInjury + BallAndChain.java - not modelled here)
  if (multi || !clock || !Number.isInteger(dice) || dice < 1 || dice > 3 || !defenderJson) {
    turnsUnmeasured(tallies);
    links[defender] = { attacker, measured: false };
    fallUnmeasured();
    return;
  }
  // (Astra cut r1 #4: these leave the attack and the fall unmeasured below, after the blocker's turnover chance is read)
  const attackUnread = has(game, defender, 'Ball & Chain') || has(game, defender, 'Ball and Chain') || (chainsaw && !ironHardSkin && gameOption(game, 'mbStacksAgainstChainsaw') === 'true');
  // Astra r1 #1 / crowd r1 #2 / crowd r2 #2: the defender's tackle zones as he stood when the dice were ROLLED. The
  // model handed in with the block already shows its result (falling, down, removed, in the reserves - and the server
  // clears confused / hypnotized when it changes the base state), so it is never read for this. In order: his state on
  // the pitch the last frame left (stats.turnField), else the state latched at a blockRoll made in an EARLIER frame;
  // neither = his tackle zones cannot be read, which matters only for his Block or Wrestle (owner 10-16: and his Steady
  // Footing, which a confused or hypnotized player cannot use): such a block is UNMEASURED (whatever the dice did - the
  // reading does not depend on them)
  const before = pitch?.[defender];
  const tzKnown = before ? stateHasTacklezones(before[2]) : atRoll && !atRoll.sameFrame ? atRoll.defenderTacklezones : null;
  if (tzKnown == null && (has(game, defender, 'Block') || has(game, defender, 'Wrestle') || has(game, defender, STEADY_FOOTING))) {
    turnsUnmeasured(tallies);
    links[defender] = { attacker, measured: false };
    fallUnmeasured();
    return;
  }
  const tacklezones = tzKnown ?? true;
  const matchup: BlockMatchup = {
    attackerBlock: has(game, attacker, 'Block'), attackerWrestle: has(game, attacker, 'Wrestle'), attackerTackle: has(game, attacker, 'Tackle'),
    defenderBlock: tacklezones && has(game, defender, 'Block'), defenderDodge: has(game, defender, 'Dodge'),
    defenderWrestle: tacklezones && has(game, defender, 'Wrestle'),
    attackerJuggernautBlitz: (!!atRoll?.blitz || actingAction(game) === 'blitz') && has(game, attacker, 'Juggernaut'),
  };
  const blitz = !!atRoll?.blitz || actingAction(game) === 'blitz';
  const crowd = crowdReadable ? crowdPushOf(pitch, game, attacker, defender, tacklezones, blitz, a) : null;
  // owner 10-16: a chain push that ends in the crowd, resolved from the pre-block board (chainPushOf); one that cannot be
  // read (too long, or coming back on itself) leaves the whole block unmeasured, whatever the dice did
  const chain = crowdReadable && !crowd ? chainPushOf(pitch, game, attacker, defender, tacklezones, blitz, a, clock) : null;
  if (chain === 'capped') {
    turnsUnmeasured(tallies);
    links[defender] = { attacker, measured: false };
    fallUnmeasured();
    return;
  }
  // Astra footing r2 #1: facing a surf of his own team-mate the blocker declines Juggernaut's push (JuggernautBehaviour:
  // declined, the both down stands), so the faces are read without it
  // (Astra footing r3 #1: Juggernaut on a Blitz still cancels the defender's Wrestle - WrestleBehaviour - declined or not)
  const faceScores = blockFaceScores(chain?.own ? { ...matchup, attackerJuggernautBlitz: false, defenderWrestle: matchup.attackerJuggernautBlitz ? false : matchup.defenderWrestle } : matchup);
  const outcome = blockOutcomeChance(dice, nrOfDice! > 0, faceScores, matchup.defenderBlock,
    crowd ?? (chain ? { bothDownPushes: !chain.own && blitz && has(game, attacker, 'Juggernaut'), chain: { attackerWants: !chain.own } } : null));
  // owner 10-16 (Steady Footing): a knocked-down player who has it stays up on a 6 (STEADY_FOOTING_FAIL6 of 6 fail), and
  // no armour roll follows; a confused or hypnotized one cannot use it (StepSteadyFooting.java:181). The defender as he
  // stood at the roll (`tacklezones`); the blocker as the pitch before the frame shows him (an acting blocker otherwise)
  const defenderFooting = has(game, defender, STEADY_FOOTING) && tacklezones ? STEADY_FOOTING_FAIL6 : 6;
  const attackerBefore = pitch?.[attacker];
  const attackerFooting = has(game, attacker, STEADY_FOOTING) && (!attackerBefore || (attackerBefore[2] & DISTRACTED_BITS) === 0) ? STEADY_FOOTING_FAIL6 : 6;
  // owner 10-16 (Turns cut short): the blocker's fall turns the turn over - P(he falls) x the share of the turn left
  noteCutShortRoll(stats, game, attacker, outcome.attackerDown * attackerFooting / (outcome.den * 6), `${blockLabel(nrOfDice!)}: own fall`, clock);
  if (attackUnread) {
    turnsUnmeasured(tallies);
    links[defender] = { attacker, measured: false };
    fallUnmeasured();
    return;
  }
  const tiers = blockArmourTiers({
    av: effectiveArmour(defenderJson as never), mightyBlow: has(game, attacker, 'Mighty Blow') ? mightyBlowValue(game, attacker) : 0,
    claws: has(game, attacker, 'Claws') || has(game, attacker, 'Claw'), chainsaw, ironHardSkin,
    clawDoesNotStack: gameOption(game, 'clawDoesNotStack') !== 'false',
  });
  const outcomes = attackOutcomes({ num: outcome.down * defenderFooting, den: outcome.den * 6 }, tiers, { stunty: has(game, defender, 'Stunty'), thickSkull: has(game, defender, 'Thick Skull') },
    crowd ? { num: outcome.surf * 6, injuryShift: crowd.injuryShift } : null);
  const attackId = openAttack(stats, game, clock, a.teamId, attacker, defender, outcomes, blockLabel(nrOfDice!), 'Nothing (no knock-down)');
  // Astra luck r2: which of this block's trials still wait for a result, from the face picked (no face read: all of them)
  const juggernautBlitz = blitz && has(game, attacker, 'Juggernaut');
  const pushFace = (f: number) => f >= 3 || (f === 2 && juggernautBlitz);
  const waits = (down: boolean, push: boolean) => chosenFace == null || down || push;
  // (Astra chart r1 A1: a Juggernaut both down may still be declined and knock the defender down)
  // (Astra chart r2: a both down always waits - Wrestle, Juggernaut and Block decisions may still put either player down)
  // (Astra chart r3: a stumble waits too - the defender's Dodge is his coach's choice)
  if (waits(defenderDownOn(chosenFace ?? 0, faceScores, matchup.defenderBlock) || chosenFace === 2 || chosenFace === 5, !!crowd && pushFace(chosenFace ?? 0))) stats.turnsPending.push(attackId);
  links[defender] = { attacker, measured: true, attackId, crowd: crowd ? { injuryShift: crowd.injuryShift } : null };
  if (crowd) stats.turnsCrowd = defender;
  if (defenderFooting !== 6) (stats.turnsFooting ??= {})[defender] = { teamId: a.teamId, attackId };
  // OWNER 10-16 - the chain surf: P(the picked face pushes) x the crowd injury on the chained victim's table (no armour
  // roll; Mighty Blow only under Fan Interaction on an opposing victim) x turns(result, now, his team). Credited to the
  // blocker, or to the defender when the victim is the blocker's own team-mate. Its own trial (the defender may fall on
  // the same face: a pow pushes and knocks down), opened whether or not the dice push.
  if (chain) {
    const victimTeam = teamOf(game, chain.victim)!;
    const credited = chain.own ? { team: d.teamId, player: defender } : { team: a.teamId, player: attacker };
    const chainOutcomes = attackOutcomes({ num: 0, den: outcome.den }, [], chain.table, { num: outcome.surf, injuryShift: chain.injuryShift });
    const chainId = openAttack(stats, game, clock, credited.team, credited.player, chain.victim, chainOutcomes, `${blockLabel(nrOfDice!)} (chain push)`, 'Nothing (no surf)',
      { chain: true, turnTeam: a.teamId });
    if (waits(false, pushFace(chosenFace ?? 0))) stats.turnsPending.push(chainId);
    stats.turnsChain = { blockDefender: defender, teamId: credited.team, attacker: credited.player, attackId: chainId, victimTeamId: victimTeam.teamId };
  }
  // OWNER 10-15 - the blocker's own fall counts FOR THE OPPONENT: P(the picked face knocks the attacker down: a skull,
  // a both down he falls on) x his armour chain x his injury table x turns(result, now, his team). The server rolls it
  // as an ordinary block injury with the DEFENDER as its "attacker" (bb2025 StepDropFallingPlayers.java:199-207,
  // InjuryTypeBlock(): the defender's Claws, Mighty Blow and Chainsaw, the faller's own Chainsaw, Iron Hard Skin), and
  // this models what the server rolls. A Ball & Chain blocker, or a Chainsaw in play under mbStacksAgainstChainsaw, is
  // unmeasured (as for the defender's chain).
  const attackerJson = playerJson(game, attacker);
  const attackerIhs = has(game, attacker, 'Iron Hard Skin');
  const fallChainsaw = has(game, defender, 'Chainsaw') || has(game, attacker, 'Chainsaw');
  // Astra follow r1 #4: the defender's Mighty Blow needs him not distracted (MightyBlow.java: neither confused nor
  // hypnotized) - his state as the dice were rolled; unread (no earlier frame) it is unmeasured
  const defenderMb = has(game, defender, 'Mighty Blow');
  if (!attackerJson || has(game, attacker, 'Ball & Chain') || has(game, attacker, 'Ball and Chain') || (defenderMb && tzKnown == null)
    || (fallChainsaw && !attackerIhs && gameOption(game, 'mbStacksAgainstChainsaw') === 'true')) { fallUnmeasured(); return; }
  const fallTiers = blockArmourTiers({
    av: effectiveArmour(attackerJson as never), mightyBlow: defenderMb && tacklezones ? mightyBlowValue(game, defender) : 0,
    claws: has(game, defender, 'Claws') || has(game, defender, 'Claw'), chainsaw: fallChainsaw, ironHardSkin: attackerIhs,
    clawDoesNotStack: gameOption(game, 'clawDoesNotStack') !== 'false',
  });
  const fallOutcomes = attackOutcomes({ num: outcome.attackerDown * attackerFooting, den: outcome.den * 6 }, fallTiers, { stunty: has(game, attacker, 'Stunty'), thickSkull: has(game, attacker, 'Thick Skull') });
  const fallId = openAttack(stats, game, clock, d.teamId, defender, attacker, fallOutcomes, blockLabel(nrOfDice!), 'Nothing (no knock-down)', { fall: true });
  if (waits(attackerDownOn(chosenFace ?? 0, faceScores) || chosenFace === 2, false)) stats.turnsPending.push(fallId);
  links[attacker] = { attacker: defender, measured: true, attackId: fallId, fall: true };
  if (attackerFooting !== 6) (stats.turnsFooting ??= {})[attacker] = { teamId: d.teamId, attackId: fallId };
}
const ROOTED_BIT = 0x400;
/** PlayerState chomped (0x40000): MonstrousMouthBehaviour cancels any push of him. */
const CHOMPED_BIT = 0x40000;
/** PlayerState confused (0x200) and hypnotized (0x800): Steady Footing cannot be used (StepSteadyFooting.java:181). */
const DISTRACTED_BITS = 0x200 | 0x800;
const STEADY_FOOTING = 'Steady Footing';
/** The Luck story's name of a block: "2-die block", the defender picking "2-die uphill block (−2)". */
function blockLabel(nrOfDice: number): string {
  const n = Math.abs(nrOfDice);
  return data(nrOfDice < 0 ? `${n}-die uphill block (−${n})` : `${n}-die block`); // invariant Luck label
}
/** The active prayers of `team` (turnData.inducementSet.prayers) include Fan Interaction: the crowd push names the
 *  acting player as its attacker (bb2025 StepPushback.java:181-184), so his Mighty Blow reaches the injury roll. */
function fanInteraction(game: GameJson, team: TeamLike): boolean {
  const home = (game.teamHome as unknown as TeamLike).teamId === team.teamId;
  const prayers = ((home ? game.turnDataHome : game.turnDataAway) as { inducementSet?: { prayers?: unknown[] } } | undefined)?.inducementSet?.prayers;
  return Array.isArray(prayers) && prayers.some((p) => prayerForWireValue(p)?.name === 'Fan Interaction');
}
/**
 * Whether this block's push-back is forced into the crowd, read from the pitch as the last frame left it (see the
 * chain above); null = no crowd push in the expectation (no pitch read, not adjacent, a free square or a chain push,
 * or a defender who stops it). `bothDownPushes`: Juggernaut on a Blitz may turn a both down into a push.
 */
function crowdPushOf(field: DiceStats['turnField'], game: GameJson, attacker: string, defender: string, tacklezones: boolean, blitz: boolean, attackerTeam: TeamLike):
  { bothDownPushes: boolean; injuryShift: number } | null {
  const at = field?.[attacker], df = field?.[defender];
  if (!field || !at || !df || !onPitch(at[0], at[1]) || !onPitch(df[0], df[1])) return null;
  const taken = new Set(Object.values(field).filter(([x, y]) => onPitch(x, y)).map(([x, y]) => `${x},${y}`));
  const occupied = (x: number, y: number) => taken.has(`${x},${y}`);
  if (crowdPushForced([at[0], at[1]], [df[0], df[1]], occupied) !== true) return null;
  const juggernaut = blitz && has(game, attacker, 'Juggernaut');
  // TakeRootBehaviour (bb2025, Astra crowd r1 #3): a Rooted defender is never pushed, whatever his skills
  if ((df[2] & (ROOTED_BIT | CHOMPED_BIT)) !== 0) return null;
  // StandFirmBehaviour (bb2025): it needs tackle zones and is cancelled by Juggernaut on a Blitz
  if (has(game, defender, 'Stand Firm') && tacklezones && !juggernaut) return null;
  // SidestepBehaviour (bb2025): tackle zones, a free square next to him, and no cancelling Grab
  const grabCancels = has(game, attacker, 'Grab') && (!blitz || gameOption(game, 'grabCancelsSidestepDuringBlitz') === 'true');
  if ((has(game, defender, 'Sidestep') || has(game, defender, 'Side Step')) && tacklezones && !grabCancels && freeSquareAround([df[0], df[1]], occupied)) return null;
  const injuryShift = fanInteraction(game, attackerTeam) && has(game, attacker, 'Mighty Blow') ? mightyBlowValue(game, attacker) : 0;
  return { bothDownPushes: juggernaut, injuryShift };
}
/**
 * Owner 10-16: the crowd surf a chain push of this block ends in, read from the pitch as the last frame left it
 * (turnsLost.chainPushOutcome; see the chain above): null = none (no pitch read, not a chain push, a defender who stops
 * the push - Rooted, Stand Firm, Side Step with a free square, as crowdPushOf reads them - or a chain that ends on the
 * pitch); 'capped' = a chain too long to read. `table` and `injuryShift` are the surfed player's crowd injury roll.
 */
function chainPushOf(field: DiceStats['turnField'], game: GameJson, attacker: string, defender: string, tacklezones: boolean, blitz: boolean, attackerTeam: TeamLike, clock: TurnClock):
  { victim: string; own: boolean; table: { stunty: boolean; thickSkull: boolean }; injuryShift: number } | 'capped' | null {
  const at = field?.[attacker], df = field?.[defender];
  if (!field || !at || !df || !onPitch(at[0], at[1]) || !onPitch(df[0], df[1])) return null;
  const bySquare = new Map<string, string>();
  for (const [id, [x, y]] of Object.entries(field)) if (onPitch(x, y)) bySquare.set(`${x},${y}`, id);
  const occupied = (x: number, y: number) => bySquare.has(`${x},${y}`);
  const juggernaut = blitz && has(game, attacker, 'Juggernaut');
  // the defender himself: never pushed when Rooted; Stand Firm, or Side Step with a free square, is his coach's call
  // (Astra footing r1 #4: declined when the chain would surf one of the attacker's team-mates)
  if ((df[2] & (ROOTED_BIT | CHOMPED_BIT)) !== 0) return null;
  const grabCancels = has(game, attacker, 'Grab') && (!blitz || gameOption(game, 'grabCancelsSidestepDuringBlitz') === 'true');
  const defenderStops = (has(game, defender, 'Stand Firm') && tacklezones && !juggernaut)
    || ((has(game, defender, 'Sidestep') || has(game, defender, 'Side Step')) && tacklezones && !grabCancels && freeSquareAround([df[0], df[1]], occupied));
  const fan = fanInteraction(game, attackerTeam) && has(game, attacker, 'Mighty Blow') ? mightyBlowValue(game, attacker) : 0;
  const crowdOf = (id: string, own: boolean) => ({
    table: { stunty: has(game, id, 'Stunty'), thickSkull: has(game, id, 'Thick Skull') },
    // bb2025 StepPushback.java:179-187: Fan Interaction names the blocker only for a victim not on the acting team
    injuryShift: own ? 0 : fan,
  });
  const playerAt = (x: number, y: number): ChainPlayer | null => {
    const id = bySquare.get(`${x},${y}`);
    if (!id) return null;
    const state = field[id]![2];
    const own = teamOf(game, id)?.teamId === attackerTeam.teamId;
    const tz = stateHasTacklezones(state);
    return {
      // Astra footing r2 #3: a Chomped player is never moved either (MonstrousMouthBehaviour clears the push)
      id, own, rooted: (state & (ROOTED_BIT | CHOMPED_BIT)) !== 0,
      // StandFirmBehaviour: tackle zones; Juggernaut on a Blitz cancels it only for a player of the other team
      standFirm: has(game, id, 'Stand Firm') && tz && !(juggernaut && !own),
      // SidestepBehaviour: tackle zones (Grab cancels it only for the block's defender)
      sideStep: (has(game, id, 'Sidestep') || has(game, id, 'Side Step')) && tz,
    };
  };
  // the expected turns a crowd injury costs the player's team now (the KO term provisional, as every trial's is)
  const value = (id: string, own: boolean): number => {
    const team = teamOf(game, id);
    if (!team) return 0;
    const { table, injuryShift } = crowdOf(id, own);
    const o = attackOutcomes({ num: 0, den: 1 }, [], table, { num: 1, injuryShift });
    const sc = turnsScore(clock.half, clockTurnOf(game, clock, team.teamId), 0);
    return expectedTurns(outcomeKey(o, { stun: sc.stun, drive: sc.ko, cas: sc.cas }));
  };
  const result: ChainResult | null = chainPushOutcome([at[0], at[1]], [df[0], df[1]], playerAt, value, undefined, defenderStops);
  if (!result || result.kind === 'none') return null;
  if (result.kind === 'capped') return 'capped';
  // Astra footing r2 #2: facing a surf of his own team-mate, a blocker with Grab (a block, or a Blitz under
  // grabCancelsSidestepDuringBlitz: GrabBehaviour) pushes the defender into a free square next to him instead
  if (result.own && has(game, attacker, 'Grab') && (!blitz || gameOption(game, 'grabCancelsSidestepDuringBlitz') === 'true') && freeSquareAround([df[0], df[1]], occupied)) return null;
  // a player this model cannot place on a team: not read
  if (!teamOf(game, result.victim)) return 'capped';
  return { victim: result.victim, own: result.own, ...crowdOf(result.victim, result.own) };
}
/** The players of a model as [x, y, playerState], x = y = -1 for a player off the pitch (null when the model carries no field). */
function fieldSnapshot(game: GameJson | null): Record<string, [number, number, number]> | null {
  const list = game?.fieldModel?.playerDataArray as { playerId?: string; playerCoordinate?: unknown; playerState?: unknown }[] | undefined;
  if (!Array.isArray(list)) return null;
  const out: Record<string, [number, number, number]> = {};
  for (const d of list) {
    if (typeof d.playerId !== 'string') continue;
    const c = Array.isArray(d.playerCoordinate) ? d.playerCoordinate : [];
    const x = Number(c[0]), y = Number(c[1]);
    const on = Number.isInteger(x) && Number.isInteger(y) && onPitch(x, y);
    out[d.playerId] = [on ? x : -1, on ? y : -1, Number(d.playerState) || 0];
  }
  return out;
}
/** The level of a crowd injury's stated result (InjuryTypeCrowd.java): a stun becomes RESERVE, a KO and a casualty stand. */
function crowdLevel(r: Report): InjuryLevel | null {
  const base = Number(r.injury) & 0xff;
  return base === RESERVE || base === 4 ? 0 : base === KNOCKED_OUT ? 1 : base >= 6 && base <= 8 ? 2 : null;
}
/** A `crowdpush` injury report: the defender of the block whose expectation carried the crowd push, booked against
 *  that block's attacker; owner 10-16: a chain-pushed player of the team the block's chain surf was read for, booked
 *  against that trial. Anything else (no such block, a crowd push the expectation did not carry) books nothing - see
 *  the chain above. */
function noteCrowdTurns(stats: DiceStats, game: GameJson | null, commandNr: number | null, r: Report, injury: [number, number] | null, clock: TurnClock | null): void {
  const defenderId = typeof r.defenderId === 'string' ? r.defenderId : null;
  if (!game || !defenderId || !injury) return;
  if (stats.turnsCrowd !== defenderId) { noteChainCrowdTurns(stats, game, commandNr, r, defenderId, injury, clock); return; }
  const link = stats.turnsLinks?.[defenderId];
  if (!link || !link.measured || !link.crowd || !clock) return;
  const own = teamOf(game, defenderId), attackerTeam = teamOf(game, link.attacker);
  if (!own || !attackerTeam || own.teamId === attackerTeam.teamId) return;
  const key = `${commandNr}|${defenderId}||${injury}`;
  if (commandNr != null && key === stats.lastTurnsTrial) return;
  stats.lastTurnsTrial = key;
  // Astra crowd r1 #1: the measured status is settled at the block and never changed by what the crowd report states
  // (taking the attack out only when it surfs would select on the result): a stated injury modifier the expectation
  // did not carry is not checked here; the result is booked as it fell
  unbookTurns(stats, attackerTeam.teamId, link.attacker, link.booked);
  link.booked = bookTurns(stats, game, clock, attackerTeam.teamId, link.attacker, own.teamId, defenderId, crowdLevel(r), true, link.attackId ?? null);
}
/**
 * Owner 10-16: a chain-pushed player's crowd injury. The block whose expectation carried a chain surf (stats.turnsChain)
 * books it against that trial when the surfed player is on the team the surf was read for and is not the block's
 * defender (the player may differ from the one the chain was read to end with: the coaches may choose otherwise; the
 * result is booked as it fell, as for the defender). Its measured status was settled at the block.
 */
function noteChainCrowdTurns(stats: DiceStats, game: GameJson, commandNr: number | null, r: Report, playerId: string, injury: [number, number], clock: TurnClock | null): void {
  const chain = stats.turnsChain;
  if (!chain || !clock || playerId === chain.blockDefender || teamOf(game, playerId)?.teamId !== chain.victimTeamId) return;
  if (!teamOf(game, chain.attacker)) return;
  const key = `${commandNr}|${playerId}||${injury}`;
  if (commandNr != null && key === stats.lastTurnsTrial) return;
  stats.lastTurnsTrial = key;
  // Astra footing r1 #1: one push surfs one player - the trial is spent (a later crowd injury, such as a thrown
  // team-mate landing in the crowd, is never this block's)
  stats.turnsChain = null;
  bookTurns(stats, game, clock, chain.teamId, chain.attacker, chain.victimTeamId, playerId, crowdLevel(r), true, chain.attackId);
}
/** Owner 10-16: a successful Steady Footing roll of a player the last block knocked down: no armour roll follows and
 *  the trial books nothing (its expectation already carried the roll); it only names the outcome. */
function noteSteadyFootingTurns(stats: DiceStats, playerId: string | null, r: Report): void {
  const hit = playerId ? stats.turnsFooting?.[playerId] : undefined;
  if (!hit || r.successful !== true) return;
  delete stats.turnsFooting![playerId!];
  const rec = attackRecord(stats, hit.teamId, hit.attackId);
  if (rec && rec.outcome === rec.idle) rec.outcome = data('Steady Footing');
}
/** The first roll of a Chainsaw attack (a block made with the chainsaw): its chance to hit, then armour +3. */
function noteChainsawTurns(stats: DiceStats, game: GameJson | null, attacker: string | null, r: Report, clock: TurnClock | null): void {
  if (actingAction(game) === 'foul') return; // a Chainsaw foul is counted at its armour roll
  if (r.reRolled === true) {
    // Astra chart r1 A2: a reroll that hits sends the attack (opened at the first roll) to its armour roll after all
    const target = (game as { defenderId?: unknown } | null)?.defenderId ?? stats.turnDefender;
    const link = typeof target === 'string' ? stats.turnsLinks?.[target] : undefined;
    stats.turnsPending = r.successful === true && link?.measured && link.attackId != null ? [link.attackId] : [];
    return;
  }
  // Astra r3 #1: a Chainsaw attack that resolves inside this frame has already cleared the defender
  // (StepEndBlocking.java:422): the one the last frame left is the target
  const defender = (game as { defenderId?: unknown } | null)?.defenderId ?? stats.turnDefender;
  const victim = typeof defender === 'string' ? defender : null;
  const a = teamOf(game, attacker), d = teamOf(game, victim);
  if (!game || !attacker || !victim || !a || !d || a.teamId === d.teamId) return;
  const links = (stats.turnsLinks ??= {});
  const tallies = tallyFor(stats, a.teamId, attacker);
  const minimum = Number(r.minimumRoll);
  const defenderJson = playerJson(game, victim);
  if (!clock || !defenderJson || !Number.isInteger(minimum) || minimum < 1) { turnsUnmeasured(tallies); links[victim] = { attacker, measured: false }; return; }
  const target = Math.min(6, Math.max(2, minimum));
  const av = effectiveArmour(defenderJson as never);
  const tiers: ArmourTier[] = [{ threshold: has(game, victim, 'Iron Hard Skin') ? av : av - 3, injuryShift: 0 }];
  const outcomes = attackOutcomes({ num: 7 - target, den: 6 }, tiers, { stunty: has(game, victim, 'Stunty'), thickSkull: has(game, victim, 'Thick Skull') });
  const attackId = openAttack(stats, game, clock, a.teamId, attacker, victim, outcomes, 'chainsaw', 'Nothing (no knock-down)');
  links[victim] = { attacker, measured: true, attackId };
  // Astra luck r2: a hit waits for its armour roll; a miss is resolved now
  stats.turnsPending = r.successful === true ? [attackId] : [];
}
/** Injury types whose injury roll never takes Mighty Blow (MightyBlow.java: foul, stab, vomit-like, Chainsaw); a thrown
 *  player landing on an opponent takes Lethal Flight instead (InjuryTypeTTMHitPlayerForSpp.java:33-58, Astra r4 #2). */
const NO_MB_INJURY = new Set(['foul', 'stab', 'projectileVomit', 'breatheFire', 'chainsaw', 'ttmHitPlayer',
  // Astra r4 #1: InjuryTypeSabotaged applies no injury modifier at all
  'sabotaged']);
/** The families whose chance was booked at the block (or the Chainsaw roll): the report books only the result. */
function linkedFamily(family: string): boolean { return BLOCK_FALL_FAMILIES.has(family) || family === 'chainsaw' || family.startsWith('pilingOn'); }

/** An `injury` report of an attack on the opponent: the turns its result cost, and for the attacks counted at the
 *  armour roll, their expected turns too. */
function noteInjuryTurns(stats: DiceStats, game: GameJson | null, commandNr: number | null, r: Report, attackerId: string, armour: [number, number] | null, injury: [number, number] | null, clock: TurnClock | null): void {
  const defenderId = typeof r.defenderId === 'string' ? r.defenderId : null;
  const own = teamOf(game, defenderId), attackerTeam = teamOf(game, attackerId);
  if (!game || !defenderId || !own || !attackerTeam || own.teamId === attackerTeam.teamId) return;
  if (!armour && !injury) return; // the twin report that shows neither roll (skipInjuryParts EVERYTHING_BUT_CAS)
  const key = `${commandNr}|${defenderId}|${armour ?? ''}|${injury ?? ''}`;
  if (commandNr != null && key === stats.lastTurnsTrial) return;
  stats.lastTurnsTrial = key;
  const family = injuryTypeFamily(String(r.injuryType ?? ''));
  const tallies = tallyFor(stats, attackerTeam.teamId, attackerId);
  const broken = r.armorBroken === true;
  const base = Number(r.injury) & 0xff;
  const level: InjuryLevel | null = !broken ? null : base === 4 ? 0 : base === KNOCKED_OUT ? 1 : base >= 6 && base <= 8 ? 2 : null;
  const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  const injuryModifiers = names(r.injuryModifiers);
  const mightyBlow = mightyBlowValue(game, attackerId);
  // a stated modifier this client cannot value (Ram, Slayer, Niggling Injury ...): not a fair-dice outcome
  const unvalued = names(r.armorModifiers).some((name) => armourModifierValue(name, mightyBlow) == null)
    || injuryModifiers.some((name) => injuryModifierValue(name, mightyBlow) == null);
  if (linkedFamily(family)) {
    const link = stats.turnsLinks?.[defenderId];
    if (!link || link.attacker !== attackerId) { if (!family.startsWith('pilingOn')) turnsUnmeasured(tallies); return; }
    if (!link.measured || !clock) return;
    // Astra crowd r2 #1: the measured status of an attack booked at the block is settled there; a stated modifier this
    // client cannot value (Ram, Slayer ...) shows only on the outcomes that reach the armour roll, so taking the attack
    // out then would select on the result. The result is booked as it fell.
    // one attack, one result: a Piling On reroll (or a repeat) replaces what was booked for it
    unbookTurns(stats, attackerTeam.teamId, attackerId, link.booked);
    link.booked = bookTurns(stats, game, clock, attackerTeam.teamId, attackerId, own.teamId, defenderId, level, false, link.attackId ?? null);
    const rec = link.attackId == null ? null : attackRecord(stats, attackerTeam.teamId, link.attackId);
    if (rec && level == null && armour && !broken) rec.outcome = data('Armour held');
    return;
  }
  if (!clock || unvalued) { turnsUnmeasured(tallies); return; }
  const ironHardSkin = has(game, defenderId, 'Iron Hard Skin');
  let tiers: ArmourTier[] | null = null;
  if (armour) {
    const input = armourInputFor(game, r, attackerId, armour);
    const threshold = armourBreakThreshold(input);
    // in hand: stated on either roll; through Iron Hard Skin a roll that does not break states nothing, so the
    // skill's owner says it (Astra r1 #6) - it would have landed on the injury roll. The owner is the STATED attacker
    // (the fouler; for a thrown player's Lethal Flight, the thrown player), else the one credited.
    const stated = typeof r.attackerId === 'string' ? r.attackerId : null;
    const owner = stated ?? attackerId;
    const eitherNames = EITHER_BY_TYPE[family] ?? [];
    // Astra r4 #1: A Sneaky Pair also needs its partner marking the victim (ASneakyPair.java), which this client does
    // not read. Through Iron Hard Skin a held roll would not say whether it applied and a broken one would, so such an
    // attack is unmeasured whichever way the armour fell
    const sneakyUnknown = ironHardSkin && eitherNames.includes('A Sneaky Pair') && has(game, owner, 'A Sneaky Pair');
    const either: (number | null)[] = eitherNames
      .filter((name) => input.armourModifiers.includes(name) || injuryModifiers.includes(name) || (ironHardSkin && name !== 'A Sneaky Pair' && has(game, owner, name)))
      .map((name) => armourModifierValue(name, mightyBlow));
    // Astra r3 #2: an injury-only modifier lands on the injury roll whichever way the armour broke. Of the ones this
    // client values that is Mighty Blow off a block (MightyBlow.java: any injury roll by the stated attacker that is not
    // a foul, a stab, a vomit-like or a Chainsaw hit, when it was not used on the armour). It is read from the stated
    // attacker's skills, so a held armour roll gets the same chance; a broken roll that states otherwise is unmeasured.
    const mbInjury = !NO_MB_INJURY.has(family) && !input.armourModifiers.includes('Mighty Blow') && stated != null && has(game, stated, 'Mighty Blow') ? mightyBlowValue(game, stated) : 0;
    // Astra r4 #2: a stated Mighty Blow is the stated attacker's (a rethrown bomb's original bombardier), valued as his
    const statedMb = stated != null ? mightyBlowValue(game, stated) : mightyBlow;
    const statedOnly = injuryModifiers.filter((name) => !eitherNames.includes(name)).reduce((s, name) => s + (injuryModifierValue(name, statedMb) ?? 0), 0);
    const disagrees = broken && !!injury && statedOnly !== mbInjury;
    if (threshold != null && !disagrees && !sneakyUnknown && either.every((v) => v != null)) {
      tiers = reportArmourTiers(threshold, either as number[], ironHardSkin).map((t) => ({ ...t, injuryShift: t.injuryShift + mbInjury }));
    }
  } else if (broken && injury) {
    // broken with no armour roll (a hit that goes straight to the injury roll): reached with certainty
    const values = injuryModifiers.map((name) => injuryModifierValue(name, mightyBlow));
    if (values.every((v) => v != null)) tiers = [{ threshold: 2, injuryShift: (values as number[]).reduce((s, v) => s + v, 0) }];
  }
  if (!tiers) { turnsUnmeasured(tallies); return; }
  // Astra r4 #3: a thrown player landing on a victim adds only Lethal Flight to the injury roll
  // (InjuryTypeTTMHitPlayerForSpp.java:55-62), never Stunty, and the server picks the Stunty table from the stated modifiers
  // (Astra r5: only the ForSpp type skips Stunty; the ordinary ttmHitPlayer uses the usual factory, InjuryTypeTTMHitPlayer.java:45)
  const stuntyFromSkill = String(r.injuryType ?? '') !== 'ttmHitPlayerForSpp' && has(game, defenderId, 'Stunty');
  const table = { stunty: injuryModifiers.includes('Stunty') || stuntyFromSkill, thickSkull: has(game, defenderId, 'Thick Skull') };
  const attackId = openAttack(stats, game, clock, attackerTeam.teamId, attackerId, defenderId, attackOutcomes({ num: 1, den: 1 }, tiers, table), family || 'attack', 'Armour held');
  bookTurns(stats, game, clock, attackerTeam.teamId, attackerId, own.teamId, defenderId, level, false, attackId);
}

/** The armour and injury rolls an `injury` report SHOWS (see skipInjuryParts in the injury handler). */
function shownRolls(r: Report): [[number, number] | null, [number, number] | null] {
  const skip = String(r.skipInjuryParts ?? 'NONE');
  const armour = !ARMOUR_PART_HIDDEN.has(skip) && Array.isArray(r.armorRoll) ? (r.armorRoll as unknown[]).filter(isD6) : [];
  const injury = !INJURY_PART_HIDDEN.has(skip) && Array.isArray(r.injuryRoll) ? (r.injuryRoll as unknown[]).filter(isD6) : [];
  return [armour.length === 2 ? [armour[0]!, armour[1]!] : null, injury.length === 2 ? [injury[0]!, injury[1]!] : null];
}
/** Owner 10-15: a block-family injury on the BLOCKER (upstream states the block's defender as its attacker) whose
 *  block linked his fall to that defender: the defender is credited. */
function blockerFallCredit(stats: DiceStats, r: Report): string | null {
  const stated = typeof r.attackerId === 'string' ? r.attackerId : null;
  const victim = typeof r.defenderId === 'string' ? r.defenderId : null;
  if (!stated || !victim || !BLOCK_FALL_FAMILIES.has(injuryTypeFamily(String(r.injuryType ?? '')))) return null;
  const link = stats.turnsLinks?.[victim];
  return link?.fall && link.attacker === stated ? stated : null;
}
function blockTallies(stats: DiceStats, game: GameJson | null, attacker: string | null): DiceTally[] {
  return tallyFor(stats, teamOf(game, attacker)?.teamId ?? null, attacker);
}
// ---- the Luck row: lucky and bad breaks (owner 10-16; the definitions live in luckBreaks.ts) ----
/** Where a roll falls in the game: the half, its slot (team turns started in the half before the one in progress, play
 *  order from 0) and the turn number. */
function clockSlot(clock: TurnClock | null): { half: number; slot: number; turn: number } {
  if (!clock) return { half: 0, slot: 0, turn: 0 };
  const slot = Math.max(0, clock.turnHome + clock.turnAway - 1);
  const acting = clock.homePlaying == null ? null : clock.homePlaying ? clock.turnHome : clock.turnAway;
  return { half: clock.half, slot, turn: acting != null && acting >= 1 ? acting : Math.floor(slot / 2) + 1 };
}
function addBreak(b: LuckBreaks, d: ReturnType<typeof breakDelta>, entry: () => Omit<LuckBreaks['log'][number], 'lucky' | 'p'>): void {
  b.events += 1;
  b.luckyExpected += d.luckyExpected; b.luckyVar += d.luckyVar; b.badExpected += d.badExpected; b.badVar += d.badVar;
  if (d.happened === 0 || d.p == null) return;
  if (d.happened > 0) b.lucky += 1; else b.bad += 1;
  b.log.push({ ...entry(), lucky: d.happened > 0, p: d.p });
}
/** One event, scored for both teams (see luckBreaks.ts): its expectation from `outcomes`, its break from `happened`. */
function noteBreakEvent(stats: DiceStats, game: GameJson | null, outcomes: readonly BreakOutcome[], happened: number, label: string, playerId: string | null, clock: TurnClock | null): void {
  if (!game) return;
  const home = (game.teamHome as unknown as TeamLike).teamId, away = (game.teamAway as unknown as TeamLike).teamId;
  if (!home || !away) return;
  const seq = stats.breakSeq = (stats.breakSeq ?? 0) + 1;
  const at = { ...clockSlot(clock), ...playedCol(stats, home, clockSlot(clock)) };
  const name = playerDisplayName(game, playerId);
  for (const teamId of [home, away]) {
    addBreak((stats.teams[teamId] ??= emptyTally()).breaks ??= emptyBreaks(), breakDelta(outcomes, happened, teamId),
      () => ({ seq, label, player: playerId ?? '', playerName: typeof name === 'string' && name ? name : playerId ?? '', ...at }));
  }
}
const ROLL_NAMES: Record<string, string> = { dodgeRoll: 'dodge', goForItRoll: 'rush', pickUpRoll: 'pick-up', catchRoll: 'catch', passRoll: 'pass', interceptionRoll: 'interception',
  jumpRoll: 'jump', leapRoll: 'leap', standUpRoll: 'stand-up', throwTeamMateRoll: 'team-mate throw', rightStuffRoll: 'landing', breatheFire: 'Breathe Fire', chainsawRoll: 'Chainsaw',
  bretonnianPastriesRoll: data('Bretonnian Pastries') }; // invariant Luck data ("2+ Bretonnian Pastries made")
/** An action roll the Action dice row scores (pushActionLuck's own rule): success favours the roller's team. */
function noteActionBreak(stats: DiceStats, game: GameJson | null, id: string, r: Report, rollerId: string | null, ruleUnknown: boolean, clock: TurnClock | null): void {
  const minimum = Number(r.minimumRoll);
  if (ruleUnknown || !isD6(r.roll) || r.minimumRoll == null || !Number.isInteger(minimum) || minimum < 1 || typeof r.successful !== 'boolean') return;
  const trial = actionTrial(minimum, r.roll, r.successful);
  const own = teamOf(game, rollerId), other = otherTeam(game, own);
  if (!trial || !own || !other) return;
  const kind = ROLL_NAMES[id] ?? id.replace(/Roll$/, '').replace(/([A-Z])/g, ' $1').toLowerCase();
  noteBreakEvent(stats, game, rollOutcomes(trial.p, own.teamId, other.teamId), r.successful ? 0 : 1,
    `${Math.min(6, Math.max(2, Math.round(minimum)))}+ ${kind} ${r.successful ? 'made' : 'failed'}`, rollerId, clock);
}
/** Owner 10-16 (Astra chart r1): the team turn in progress at the end of a frame in regular play is a turn played -
 *  kept on both teams' breaks (the chart's axis). Idempotent: one entry per half and slot. */
function notePlayedTurn(stats: DiceStats, game: GameJson | null): void {
  const clock = readTurnClock(game);
  if (!game || !clock || !clock.regular || clock.turnHome + clock.turnAway < 1) return;
  const at = clockSlot(clock);
  const home = (game.teamHome as unknown as TeamLike).teamId, away = (game.teamAway as unknown as TeamLike).teamId;
  for (const teamId of [home, away]) {
    if (!teamId) continue;
    const b = (stats.teams[teamId] ??= emptyTally()).breaks ??= emptyBreaks();
    const played = (b.played ??= []);
    // Astra chart r3: a new entry whenever the turn in progress changes (a backward Time-out can repeat a slot)
    const last = played[played.length - 1];
    if (!last || last.half !== at.half || last.slot !== at.slot) played.push(at);
  }
}
/** The played-turn column a roll made now falls in: the last turn recorded as played, when it is this one. */
function playedCol(stats: DiceStats, teamId: string, at: { half: number; slot: number }): { col?: number; after?: number } {
  const played = stats.teams[teamId]?.breaks?.played ?? [];
  const last = played[played.length - 1];
  return last && last.half === at.half && last.slot === at.slot ? { col: played.length - 1 } : { after: played.length };
}
// ---- Turns cut short (owner 10-16; the definitions live in turnsCutShort.ts) ----
/** What the client treats as a turnover-capable failure (turnPresentation.ts TURNOVER_FAIL_IDS). */
const TCS_ROLL_IDS = new Set(['dodgeRoll', 'goForItRoll', 'pickUpRoll', 'passRoll', 'catchRoll', 'leapRoll',
  // Astra cut r1 #3 (the owner lists jumps): a failed jump's knock-down arms the turnover
  'jumpRoll']);
const playing = (team: TeamLike, id: string) => team.playerArray.some((p) => p.playerId === id);
function actingTeamOf(game: GameJson, clock: TurnClock | null): TeamLike {
  const home = clock?.homePlaying ?? (game as { homePlaying?: unknown }).homePlaying === true;
  return (home ? game.teamHome : game.teamAway) as unknown as TeamLike;
}
/** The share of the acting team's turn left at a roll by `actingId`, read from the pitch before the frame. */
function cutShortShare(stats: DiceStats, game: GameJson, team: TeamLike, actingId: string | null, clock: TurnClock | null): number {
  const ids = new Set(team.playerArray.map((p) => p.playerId));
  const onPitch = Object.entries(stats.turnField ?? {}).filter(([id, [x]]) => ids.has(id) && x >= 0).map(([id]) => id);
  const turnNr = clock ? clockTurnOf(game, clock, team.teamId) : 0;
  const act = stats.activeTurn?.[team.teamId];
  const activated = act && clock && act.half === clock.half && act.turn === turnNr ? act.players : new Set<string>();
  let unused = onPitch.filter((id) => !activated.has(id)).length;
  // the acting player's own activation is not complete: it counts as unused
  if (actingId && activated.has(actingId) && onPitch.includes(actingId)) unused += 1;
  const key = `${clock?.half}|${team.teamId}|${turnNr}`;
  return turnShare(unused, stats.tcsStart?.key === key ? stats.tcsStart.n : onPitch.length);
}
/** A turnover-capable roll (or block) of the acting team: P(failure) x the share, booked now; remembered as the roll a
 *  turnover would be charged to. `pFail` null = its chance cannot be read (nothing booked, and no turnover charged). */
function noteCutShortRoll(stats: DiceStats, game: GameJson | null, rollerId: string | null, pFail: number | null, label: string, clock: TurnClock | null): void {
  if (!game || !rollerId) return;
  // Astra cut r3: only a roll made in regular play can end a team turn (a kick-off Blitz! is not one) - read from the
  // turn state before the frame, never from a mode its own result changed
  if (clock?.regular === false) { stats.tcsLast = null; return; }
  const team = actingTeamOf(game, clock);
  if (!team.playerArray.some((p) => p.playerId === rollerId)) { stats.tcsLast = null; return; }
  // (Astra cut r1 #1: the unfinished activation is the acting player's - a catcher's roll is inside the passer's)
  const acting = typeof game.actingPlayer?.playerId === 'string' && playing(team, game.actingPlayer.playerId) ? game.actingPlayer.playerId : rollerId;
  const share = cutShortShare(stats, game, team, acting, clock);
  const at = clockSlot(clock);
  const name = playerDisplayName(game, rollerId);
  stats.tcsLast = { share, measured: pFail != null, label, player: rollerId, playerName: name ?? rollerId, teamId: team.teamId, ...at,
    ...playedCol(stats, (game.teamHome as unknown as TeamLike).teamId, at) };
  if (pFail == null) return;
  const c = ((stats.teams[team.teamId] ??= emptyTally()).cutShort ??= emptyCutShort());
  c.rolls += 1; c.expected += pFail * share; c.variance += share * share * pFail * (1 - pFail);
}
/** One report through Turns cut short: the expectation of a turnover-capable roll, the client's own turnover heuristic
 *  (turnPresentation.ts) and, at the turnEnd, the actual share of a turnover. */
function noteCutShortStep(stats: DiceStats, game: GameJson | null, r: Report, id: string, clock: TurnClock | null): void {
  if (!game || !clock) return;
  const team = actingTeamOf(game, clock);
  const playing = new Set(team.playerArray.map((p) => p.playerId));
  const roller = typeof r.playerId === 'string' ? r.playerId : null;
  // (Astra cut r2 #2: a bomb throw's failure does not end the turn - turnoverArmStep disarms it in bombAway)
  const bomb = id === 'passRoll' && (r.bomb === true || /bomb/i.test(actingAction(game)) || /bomb/i.test(String(game.turnMode ?? '')));
  if (TCS_ROLL_IDS.has(id) && !bomb && roller && playing.has(roller) && r.reRolled !== true && (id !== 'catchRoll' || /pass|hand/i.test(actingAction(game)))) {
    const minimum = Number(r.minimumRoll);
    const trial = isD6(r.roll) && Number.isInteger(minimum) && minimum >= 1 && typeof r.successful === 'boolean' && !passingRuleUnknown(game, id, roller)
      ? actionTrial(minimum, r.roll, r.successful) : null;
    const kind = ROLL_NAMES[id] ?? id;
    noteCutShortRoll(stats, game, roller, trial ? 1 - trial.p : null, `${Math.min(6, Math.max(2, Math.round(minimum) || 2))}+ ${kind} failed`, clock);
  } else if ((D6_ROLL_FIELDS[id] && id !== 'steadyFootingRoll' && !TCS_ROLL_IDS.has(id)) || ((id === 'dodgeRoll' || id === 'goForItRoll' || id === 'pickUpRoll') && !(roller && playing.has(roller)))) {
    stats.tcsLast = null; // another roll: a later knock-down is not charged to an earlier roll
  }
  const ctx = stats.tcsArm ?? createTurnPresentationContext();
  const before = ctx.turnoverArmed;
  const next = turnoverArmStep(ctx, playing, [r], game.turnMode).context;
  if (!before && next.turnoverArmed) stats.tcsHit = stats.tcsLast ?? null;
  // Astra cut r1 #2: a later failure while armed (a failed catch after an inaccurate pass) is the one charged
  else if (next.turnoverArmed && TCS_ROLL_IDS.has(id) && r.successful === false && roller && playing.has(roller) && stats.tcsLast) stats.tcsHit = stats.tcsLast;
  if (!next.turnoverArmed) stats.tcsHit = null;
  // Astra cut r2 #1: an interception is no failure of a turnover-capable roll of the acting team - nothing is charged
  if (id === 'interceptionRoll' && r.successful === true) stats.tcsHit = null;
  stats.tcsArm = next;
  // a successful roll arms nothing: it is no longer the roll a turnover would be charged to
  if (TCS_ROLL_IDS.has(id) && r.successful === true && roller && playing.has(roller)) stats.tcsLast = null;
  if (id !== 'turnEnd') return;
  const hit = turnEndIsTurnover(next, r, game.turnMode) ? stats.tcsHit : null;
  const counted = !!hit && hit.measured && hit.teamId === team.teamId;
  const first = counted && hit!.share >= FIRST_ACTION_SHARE;
  const lastFirst = (stats.tcsLastFirst ??= {});
  if (counted) {
    const streak = first && lastFirst[team.teamId] === true;
    const cost = cutCost(hit!.share, streak);
    const c = ((stats.teams[team.teamId] ??= emptyTally()).cutShort ??= emptyCutShort());
    c.actual += cost;
    const { measured: _m, teamId: _t, ...where } = hit!;
    c.log.push({ ...where, seq: stats.breakSeq = (stats.breakSeq ?? 0) + 1, playerName: hit!.playerName ?? hit!.player, share: hit!.share, cost, firstAction: first, streak });
  }
  lastFirst[team.teamId] = first;
  stats.tcsArm = createTurnPresentationContext(); stats.tcsHit = null; stats.tcsLast = null;
}
/** The acting team's players on the pitch when its turn starts (the first frame of the turn in regular play). */
function noteCutShortTurnStart(stats: DiceStats, game: GameJson | null): void {
  const clock = readTurnClock(game);
  if (!game || !clock || !clock.regular) return;
  const team = actingTeamOf(game, clock);
  const key = `${clock.half}|${team.teamId}|${clockTurnOf(game, clock, team.teamId)}`;
  if (stats.tcsStart?.key === key) return;
  const field = fieldSnapshot(game) ?? {};
  const ids = new Set(team.playerArray.map((p) => p.playerId));
  stats.tcsStart = { key, n: Object.entries(field).filter(([id, [x]]) => ids.has(id) && x >= 0).length };
}
/** The outcome a Turns lost trial came to: 0 nothing, 1 stun, 2 KO, 3 casualty, 4 crowd stun (its outcomes' order). */
function recordHappened(rec: TurnsAttackRecord): number {
  const o = rec.outcome.toLowerCase();
  if (/casualty/.test(o)) return 3;
  if (/\bko\b/.test(o)) return 2;
  if (/crowd surf stun/.test(o)) return 4;
  if (/^stun/.test(o)) return 1; // a stun, or a KO an apothecary turned into one
  return 0;
}
/**
 * Owner 10-16: the Turns lost trials' outcomes as Luck events (KO recovery trials are scored from their rolls instead):
 * nothing favours the victim's team, a stun / KO / casualty / crowd stun the credited team. Rebuilt from both teams'
 * logs after every frame, so a result taken back (Piling On, an apothecary) or booked later reads as it now stands.
 */
function rebuildTurnsBreaks(stats: DiceStats): void {
  const fresh: Record<string, LuckBreaks> = {};
  // Astra luck r1 #2: an attack whose result has not come in yet (its link still waiting: no injury booked, the turn not
  // over) has no outcome - only its expectation counts until it resolves
  // (Astra luck r2: only the last attack's trials can wait - see DiceStats.turnsPending)
  const pending = new Set<number>(stats.turnsPending ?? []);
  for (const [credited, tally] of Object.entries(stats.teams)) {
    for (const rec of tally.turnsLog ?? []) {
      if (rec.recovery) continue;
      const o = rec.outcomes;
      const outcomes: BreakOutcome[] = [
        { p: o.nothing / o.den, favours: rec.victimTeamId }, { p: o.stun / o.den, favours: credited }, { p: o.ko / o.den, favours: credited },
        { p: o.cas / o.den, favours: credited }, { p: o.crowdStun / o.den, favours: credited },
      ];
      const happened = rec.outcome === rec.idle && pending.has(rec.id) ? null : recordHappened(rec);
      const labelHead = data(`${rec.outcome} on ${rec.fall ? '' : `${rec.label} vs `}`); // invariant Luck data (luckLabelDisplay renders it)
      const labelTail = rec.fall ? `'s own ${rec.label}` : '';
      const label = `${labelHead}${rec.victimName}${labelTail}`;
      for (const id of new Set([credited, rec.victimTeamId])) {
        addBreak(fresh[id] ??= emptyBreaks(), breakDelta(outcomes, happened, id),
          () => ({ seq: rec.seq ?? -rec.id, label, player: rec.attacker, playerName: rec.attackerName ?? rec.attacker, victim: rec.victim, victimName: rec.victimName, labelHead, labelTail, half: rec.half, slot: rec.slot ?? 0, turn: rec.turn, ...(rec.col != null ? { col: rec.col } : {}), ...(rec.after != null ? { after: rec.after } : {}) }));
      }
    }
  }
  for (const [id, b] of Object.entries(fresh)) (stats.teams[id] ??= emptyTally()).breaksTurns = b;
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
  (stats.pendingBlockRolls ??= []).push({ attacker, defender: target, faces, blitz: actingAction(game) === 'blitz', defenderTacklezones: defenderHasTacklezones(game, target), frame: stats.frameSeq ?? 0 });
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
    // owner 10-16 (Luck): a good result favours the blocking team, a bad one the defending team
    noteBreakEvent(stats, game, [{ p: chance(6), favours: attackerTeam.teamId }, { p: chance(-6), favours: defenderTeam.teamId }, { p: chance(0), favours: null }],
      score > 0 ? 0 : score < 0 ? 1 : 2, `${dice}-die ${attackerChooses ? '' : 'uphill '}block: ${score > 0 ? 'defender down available' : score < 0 ? 'attacker down forced' : 'neither'}`, p.attacker, stats.turnClock ?? readTurnClock(game));
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
/** Owner 10-15: the Turns lost row (not part of All dice). A tally kept before it reads "not measured". */
export function turnsLikelihood(t: DiceTally): Likelihood { return likelihoodOf([t.luck?.turns]); }
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
    stats.turnClock = null; stats.turnDefender = null; stats.turnsLinks = {}; stats.turnsOpen = []; stats.turnsSeq = 0; stats.lastTurnsTrial = null;
    stats.turnField = null; stats.turnsCrowd = null; stats.koChains = {}; stats.turnsAttackSeq = 0; stats.turnsChain = null; stats.turnsFooting = null; stats.breakSeq = 0; stats.turnsPending = [];
    stats.tcsStart = null; stats.tcsLast = null; stats.tcsArm = createTurnPresentationContext(); stats.tcsHit = null; stats.tcsLastFirst = {};
    delete stats.coverage; delete stats.turnover; delete stats.revision;
  }
  if (commandNr != null) {
    if (stats.seen.has(commandNr)) return;
    stats.seen.add(commandNr);
  }
  stats.frameSeq = (stats.frameSeq ?? 0) + 1;
  const actingId = typeof game?.actingPlayer?.playerId === 'string' ? game.actingPlayer.playerId : null;
  stats.rerollGateFailed = false; // the gate and its dice share a frame (see below)
  // Owner 10-15 (turns lost): the turn an attack in this frame was made in. `game` is the model AFTER the frame, so
  // until a `turnEnd` report has gone by it is the state the last frame left (turnClock); after one, this model.
  let turnEnded = false;
  // crowd pushes: the pitch the last frame left holds only until a block resolves in this frame (a Frenzy second
  // block in the same frame stands where the first one's push and follow-up left it: no crowd read for it). Its
  // players' STATES still hold for that second block (Astra crowd r1 #2): the defender stood at the frame start
  let pitchStale = false;
  const rollClock = (): TurnClock | null => (turnEnded || !stats.turnClock ? readTurnClock(game) : stats.turnClock);
  for (const r of reports) {
    if (String(r.reportId ?? '') === 'turnEnd') { turnEnded = true; stats.turnsLinks = {}; stats.turnsChain = null; stats.turnsFooting = null; noteKoRecoveries(stats, game, r, rollClock()); }
    if (String(r.reportId ?? '') === 'apothecaryChoice') noteApothecaryChoice(stats, game, r, rollClock());
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
    noteCutShortStep(stats, game, r, id, id === 'turnEnd' ? stats.turnClock ?? rollClock() : rollClock()); // (a turnEnd: the turn it ends)
    // owner 10-16: a block's Steady Footing roll comes before any other roll; a successful one names its trial's outcome
    const actionRoll = id === 'dodgeRoll' || id === 'goForItRoll' || id === 'pickUpRoll' || !!D6_ROLL_FIELDS[id];
    if (stats.turnsFooting && actionRoll && id !== 'steadyFootingRoll') stats.turnsFooting = null;
    // Astra footing r1 #1: a block's push (and its crowd injury) comes before any other roll; a later action (a team-mate
    // thrown into the crowd ...) is not the block's
    if (actionRoll) stats.turnsChain = null;
    // Astra luck r2: the last attack is over once anything else is rolled or announced (its own Steady Footing roll aside)
    if ((actionRoll && id !== 'steadyFootingRoll') || id === 'block' || id === 'turnEnd') stats.turnsPending = [];
    // Astra chart r3: a Wrestle used on the both down puts both players down with no armour roll - resolved
    // (Astra chart r4: so does the defender's Dodge used on a stumble - a push, nobody down)
    // (Astra chart r5: unless the push it leaves may still go into the crowd)
    if (id === 'skillUse' && r.used === true) {
      const skill = String(r.skill ?? '').toLowerCase();
      if (/^(leap|pogo)/.test(skill) && playerId) stats.leapSkillBy = playerId; // owner 11-04: see jumpKind
      if (skill === 'wrestle' || (skill === 'dodge' && !stats.turnsCrowd && !stats.turnsChain)) stats.turnsPending = [];
    }
    if (id === 'steadyFootingRoll') noteSteadyFootingTurns(stats, playerId, r);

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
      {
        const choiceDefender = typeof r.defenderId === 'string' ? r.defenderId : stats.lastBlockDefender ?? null;
        const multi = actingAction(game) === 'multipleBlock' || (typeof r.defenderId === 'string' && r.defenderId in (stats.multiBlockCounted ?? {}));
        const rolled = [...(stats.pendingBlockRolls ?? [])].reverse().find((p) => p.attacker === attacker && (p.defender == null || p.defender === choiceDefender));
        noteBlockTurns(stats, game, attacker, typeof r.nrOfDice === 'number' ? r.nrOfDice : null, choiceDefender, multi, rollClock(),
          rolled ? { defenderTacklezones: rolled.defenderTacklezones, blitz: rolled.blitz, sameFrame: rolled.frame === (stats.frameSeq ?? 0) } : null, stats.turnField ?? null, !pitchStale,
          isD6(chosen) ? chosen : null);
        pitchStale = true;
      }
      settleBlockRollLuck(stats, game, attacker, typeof r.nrOfDice === 'number' ? r.nrOfDice : null, typeof r.defenderId === 'string' ? r.defenderId : null);
      continue;
    }
    if (id === 'injury' && injuryTypeFamily(String(r.injuryType ?? '')) === 'crowdpush') {
      // owner 10-13: a crowd push is nobody's armour / injury roll; owner 10-15: its turns go to the block that caused it
      const skip = String(r.skipInjuryParts ?? 'NONE');
      const roll = !INJURY_PART_HIDDEN.has(skip) && Array.isArray(r.injuryRoll) ? (r.injuryRoll as unknown[]).filter(isD6) : [];
      noteCrowdTurns(stats, game, commandNr, r, roll.length === 2 ? [roll[0]!, roll[1]!] : null, rollClock());
      continue;
    }
    if (id === 'injury') {
      const attacker = inflictingAttacker(stats, game, r, actingId);
      if (!attacker) {
        // owner 10-13: not a roll made against an opponent - counted for neither team's dice rows. Owner 10-15: the
        // blocker's own fall still costs his team turns, dealt by the defender (the link made at the blockChoice)
        const fallBy = blockerFallCredit(stats, r);
        if (fallBy) {
          const [armour, injury] = shownRolls(r);
          noteInjuryTurns(stats, game, commandNr, r, fallBy, armour, injury, rollClock());
        }
        continue;
      }
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
      noteInjuryReportLuck(stats, game, commandNr, r, attacker, armour.length === 2 ? [armour[0]!, armour[1]!] : null, injury.length === 2 ? [injury[0]!, injury[1]!] : null);
      noteInjuryTurns(stats, game, commandNr, r, attacker, armour.length === 2 ? [armour[0]!, armour[1]!] : null, injury.length === 2 ? [injury[0]!, injury[1]!] : null, rollClock());
      continue;
    }
    if (id === 'dodgeRoll') {
      const team = teamOf(game, playerId);
      const tallies = tallyFor(stats, team?.teamId ?? null, playerId);
      pushD6(tallies, r.roll, 'dodgeFaces');
      pushTest(tallies, r); pushActionLuck(tallies, r); noteActionBreak(stats, game, id, r, playerId, false, rollClock());
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
      pushTest(tallies, r); pushActionLuck(tallies, r); noteActionBreak(stats, game, id, r, playerId, false, rollClock());
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
      pushTest(tallies, r); pushActionLuck(tallies, r); noteActionBreak(stats, game, id, r, playerId, false, rollClock());
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
        // Breathe Fire's `successful` means "knocked down"; the trial against its minimum is the server's result.
        const bf = id === 'breatheFire' ? breatheFirePassed(r) : null;
        const tested = id === 'bretonnianPastriesRoll' ? pastriesAsTest(r) : bf === null ? r : { ...r, successful: bf };
        pushTest(tallies, tested);
        const ruleUnknown = passingRuleUnknown(game, id, playerId ?? actingId);
        pushActionLuck(tallies, tested, ruleUnknown, id === 'leapRoll' ? jumpKind(stats, r, playerId ?? actingId) : id);
        noteActionBreak(stats, game, id, tested, playerId ?? actingId, ruleUnknown, rollClock());
      }
      if (id === 'chainsawRoll') noteChainsawTurns(stats, game, playerId ?? actingId, r, rollClock());
    }
  }
  // turns lost: knock-outs missing the turns that started in this frame; then this frame's state is the next one's
  advanceTurnsLost(stats, game);
  rebuildTurnsBreaks(stats);
  noteCutShortTurnStart(stats, game);
  // Astra cut r2 #1: the heuristic's drive-boundary disarm (turnoverArmStep) also for a frame with no reports
  const modeNow = String(game?.turnMode ?? '');
  if (game && modeNow !== 'regular' && modeNow !== 'betweenTurns') { stats.tcsArm = createTurnPresentationContext(); stats.tcsHit = null; }
  notePlayedTurn(stats, game);
  const end = readTurnClock(game);
  if (end) stats.turnClock = end;
  const field = fieldSnapshot(game);
  if (field) stats.turnField = field;
  const target = (game as { defenderId?: unknown } | null)?.defenderId;
  stats.turnDefender = typeof target === 'string' ? target : null;
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
  facts.push({ get label() { return $t('hud.diceStats.text.activationsPerTurn'); }, value: avg.toFixed(1), get detail() { return $t('hud.diceStats.text.lengthTurnsLength1Turnover', { length: t.turns.length, length1: turnovers.length }); } });
  if (turnovers.length) {
    const worst = turnovers.reduce((a, x) => (x.activations < a.activations ? x : a));
    facts.push({ get label() { return $t('hud.diceStats.text.fewestActivationsBeforeA'); }, value: `${worst.activations}`, get detail() { return $t('hud.diceStats.text.halfHtTurn', { half: worst.half, turn: worst.turn }); } });
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
    facts.push({ get label() { return $t('hud.diceStats.text.luckiestStreak'); }, value: `1 in ${n.toLocaleString()}`,
      get detail() { return $t('hud.diceStats.text.lengthInARow', { length: streak.targets.length, p1: streak.targets.map((x) => `${x}+`).join(' · ') }); } }); // two lines: count, then the dice
  }
  const noOnes = longestRun(t.d6Seq, (v) => v !== 1);
  if (t.d6Seq.length) facts.push({ get label() { return $t('hud.diceStats.text.longestRunWithoutA'); }, value: `${noOnes} dice`, get detail() { return $t('hud.diceStats.text.ofLengthD6Rolled', { length: t.d6Seq.length }); } });
  const sixes = longestRun(t.d6Seq, (v) => v === 6);
  if (sixes >= 2) facts.push({ get label() { return $t('hud.diceStats.text.mostSixesInA'); }, value: `${sixes}`, get detail() { return $t('hud.diceStats.text.p0SixesAllGame', { p0: t.d6[6] ?? 0 }); } });
  const pows = longestRun(t.blockSeq, (v) => v === 6);
  if (t.blockSeq.length) facts.push({ get label() { return $t('hud.diceStats.text.mostPowsInA'); }, value: `${pows}`, get detail() { return $t('hud.diceStats.text.p0PowsInLength', { p0: t.block[6] ?? 0, length: t.blockSeq.length }); } });
  const skulls = longestRun(t.blockSeq, (v) => v === 1);
  if (skulls >= 2) facts.push({ get label() { return $t('hud.diceStats.text.mostSkullsInA'); }, value: `${skulls}`, get detail() { return $t('hud.diceStats.text.p0SkullsAllGame', { p0: t.block[1] ?? 0 }); } });
  if (t.armour.length) {
    const hi = Math.max(...t.armour); const lo = Math.min(...t.armour);
    facts.push({ get label() { return $t('hud.diceStats.text.armourRolls'); }, value: `${lo} – ${hi}`, get detail() { return $t('hud.diceStats.text.lengthRollsAverageP1', { length: t.armour.length, p1: (t.armour.reduce((a, b) => a + b, 0) / t.armour.length).toFixed(1) }); } });
  }
  if (t.injury.length) {
    const hi = Math.max(...t.injury);
    facts.push({ get label() { return $t('hud.diceStats.text.biggestInjuryRoll'); }, value: `${hi}`, get detail() { return $t('hud.diceStats.text.lengthInjuryRolls', { length: t.injury.length }); } });
  }
  const failedSixes = t.tests.filter((x) => x.target === 6).length;
  const madeSixes = t.tests.filter((x) => x.target === 6 && x.ok).length;
  if (failedSixes) facts.push({ get label() { return $t('hud.diceStats.text.neededA6'); }, value: `${madeSixes} of ${failedSixes}`, detail: madeSixes ? 'made it' : 'never landed' });
  facts.push(...activationFacts(t)); // owner 09-25
  return facts;
}
export function blockTotal(t: DiceTally): number { return t.block.reduce((a, b) => a + b, 0); }
