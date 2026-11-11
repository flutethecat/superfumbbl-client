import { type GameJson } from '@fumbbl40k/ffb-protocol';
import { injuryTypeName } from './casualtyRollProjection';
import { turnSideIsHome } from './blastinSecondBeat';
import { isModifierRescueReport } from './modifierRescue';

const TURNOVER_FAIL_IDS = new Set(['dodgeRoll', 'goForItRoll', 'pickUpRoll', 'passRoll', 'catchRoll', 'leapRoll']);

export interface TurnPresentationContext {
  turnoverArmed: boolean;
  turnoverAfterInjury: boolean;
  /** Sol r2 #1: an opposing player whose interceptionRoll just failed and may still be rescued by a modifier
   *  (bb2025 StepIntercept 177-197). Present only while it applies. */
  rescuableInterceptor?: string;
  /** Sol r3 #2 / r5: the playing-side FAILURE OCCURRENCE the turnover rests on (`armedFailure`, a per-context sequence
   *  number; its player and roll kind - 'passFumble' for a fumbled pass), when a failed roll armed it. A reroll of the
   *  same roll that fails again supersedes it. */
  armedBy?: string;
  armedByRoll?: string;
  armedFailure?: number;
  /** Sol r5: the latest playing-side failure occurrence - the one a reRollModifierChoice offer (and so its rescue) is
   *  about. A rescue disarms only when it is the armed occurrence (or a catch completing an inaccurate pass). */
  lastFailure?: number;
  lastFailureBy?: string;
  lastFailureRoll?: string;
  failureSeq?: number;
}
/** The optional rescue-context keys (persisted by the store and the checkpoint validator). */
export const TURN_RESCUE_CONTEXT_KEYS = ['rescuableInterceptor', 'armedBy', 'armedByRoll', 'armedFailure', 'lastFailure', 'lastFailureBy', 'lastFailureRoll', 'failureSeq'] as const;
/** A turn boundary ends every rescue window: no failure of the ending turn can be rescued (or rescue an interception)
 *  after its turnEnd, so the rescue keys never leak into the next turn's context (the boundary context is fresh). */
export function clearTurnRescueContext(context: TurnPresentationContext): void {
  for (const key of TURN_RESCUE_CONTEXT_KEYS) delete context[key];
}
function clearArming(context: TurnPresentationContext): void {
  delete context.armedBy; delete context.armedByRoll; delete context.armedFailure;
  delete context.lastFailure; delete context.lastFailureBy; delete context.lastFailureRoll;
}
/** Sol r4: a FUMBLED pass ends the turn even when a team-mate ends up with the ball (bb2025 StepEndPassing 267-278). */
function failureKind(id: string, report: Readonly<Record<string, unknown>>): string {
  return id === 'passRoll' && String(report.passResult ?? '').toUpperCase() === 'FUMBLE' ? 'passFumble' : id;
}

export interface TurnPresentationBefore {
  homePlaying: boolean;
  homeTurn: number;
  awayTurn: number;
  playingPlayerIds: string[];
}

/** Capture only the facts needed after publication; do not retain another model graph. */
export function captureTurnPresentationBefore(game: GameJson): TurnPresentationBefore {
  const side = turnSideIsHome(game) ? game.teamHome : game.teamAway;
  return {
    homePlaying: turnSideIsHome(game), // S46: the Blastin' second-beat flip is not a turn change
    homeTurn: Number(game.turnDataHome?.turnNr ?? 0),
    awayTurn: Number(game.turnDataAway?.turnNr ?? 0),
    playingPlayerIds: side.playerArray.map((player) => player.playerId),
  };
}

export const createTurnPresentationContext = (): TurnPresentationContext => ({
  turnoverArmed: false,
  turnoverAfterInjury: false,
});

export interface TurnTeamPresentation {
  side: 'home' | 'away';
  coach: string;
  teamName: string;
  logo: string | null;
}

export interface TurnPresentation {
  context: TurnPresentationContext;
  clearMoveTrail: boolean;
  splash: ({ kind: 'turnover'; afterInjury: boolean } | { kind: 'turnStart' }) & TurnTeamPresentation | null;
  toast: ({ turn: number; context: 'normal' | 'afterTurnover' } & TurnTeamPresentation) | null;
}

function teamPresentation(game: GameJson, side: 'home' | 'away'): TurnTeamPresentation {
  const team = side === 'home' ? game.teamHome : game.teamAway;
  return {
    side,
    coach: String(team.coach ?? ''),
    teamName: String(team.teamName ?? ''),
    logo: (team.roster as { logoUrl?: string } | undefined)?.logoUrl ?? null,
  };
}

/**
 * The turnover heuristic's per-report step - the ONE implementation (the live frame presenter, the review transport
 * and the spectator dice ledger all fold through turnoverArmStep below). FFB has no turnover flag on the wire
 * (ReportTurnEnd carries only playerIdTouchdown): a failing roll by the side whose turn it is ARMS, and the next
 * non-touchdown turnEnd in regular play fires. Only a roll owned by the playing side counts (owner 08-19) - opponent
 * reactions publish the same report ids; a successful opponent interception is the explicit exception.
 */
export function turnoverArmAfterReport(
  armed: boolean,
  report: Readonly<Record<string, unknown>>,
  playingPlayerIds: ReadonlySet<string>,
): boolean {
  const id = String(report.reportId ?? '');
  if (id === 'interceptionRoll') return report.successful === true ? true : armed;
  // Owner 09-06 (game 945): Swift as the Breeze turns a failed dodgeRoll into a success via the SAME-frame
  // `modifiedDodgeResultSuccessful` report (skill only, no playerId): the modification is the disarm.
  if (id === 'modifiedDodgeResultSuccessful') return false;
  // Owner 10-26 (g1075): an optional modifier picked on reRollModifierChoice (or Swift As The Breeze on a rush) makes the
  // failed roll pass on the same die; its skillUse is the only trace (modifierRescue.ts). Which failure it rescues needs
  // the context turnoverArmStep keeps (armedBy / rescuableInterceptor): on its own a rescue changes nothing.
  if (isModifierRescueReport(report)) return armed;
  // Owner 09-14 (g1942502): a SUCCESSFUL Steady Footing keeps the player on their feet (upstream bb2025
  // StepSteadyFooting publishes END_TURN=false, no armour / injury follows): it DISARMS the failed roll before it.
  // A failed one changes nothing here - the knockdown's injury report arms on its own.
  if (id === 'steadyFootingRoll') {
    const pid = String(report.playerId ?? '');
    return pid && playingPlayerIds.has(pid) && report.successful === true ? false : armed;
  }
  // Owner 09-19 (g1944287 seq 3552-3618): a catchRoll failed on a SCATTER is no turnover. A fresh activation by the
  // playing side (ReportPlayerAction) proves the turn did not end - a real turnover closes the turn first.
  if (id === 'playerAction') {
    const pid = String(report.actingPlayerId ?? report.playerId ?? '');
    return pid && playingPlayerIds.has(pid) ? false : armed;
  }
  if (!TURNOVER_FAIL_IDS.has(id)) return armed;
  const playerId = String(report.playerId ?? '');
  if (!playerId || !playingPlayerIds.has(playerId)) return armed;
  if (report.successful === false) return true;
  if (report.successful === true) return false;
  return armed;
}

/**
 * One command's reports through the heuristic, then the drive-boundary disarm. `playingPlayerIds` = the roster of the
 * side whose turn it was BEFORE the command. `knockedDown` names the playing-side player whose knockdown armed it in
 * this command (the live presenter logs it).
 *
 * Injury arming: a Knocked Down player always rolls Armour (an `injury` report); Wrestle places prone with none. A
 * crowd removal turns over through its own clause, a vampire's bite / a failed Right Stuff landing do not end the
 * turn, and a SAME-TEAM attacker knocking a team-mate down is no turnover (g868, bb2025 StepPushback:179-200).
 * `betweenTurns` is NOT a drive boundary - it is the transit mode of the server's own turn flip, which precedes the
 * turnEnd report (g868 nr144-148): only a real drive boundary (setup / kickoff / endGame ...) disarms.
 */
export function turnoverArmStep(
  previous: Readonly<TurnPresentationContext>,
  playingPlayerIds: ReadonlySet<string>,
  reports: readonly Readonly<Record<string, unknown>>[],
  turnModeAfter: unknown,
): { context: TurnPresentationContext; knockedDown: string | null } {
  const context: TurnPresentationContext = { ...previous };
  let knockedDown: string | null = null;
  for (const report of reports) {
    const id = String(report.reportId);
    if (id === 'injury') {
      const fallen = String(report.defenderId ?? report.playerId ?? '');
      const injuryType = injuryTypeName(report.injuryType).toLowerCase();
      const nonKnockdown = /crowd|bitten|quickbite|ttmlanding/.test(injuryType);
      const attacker = String(report.attackerId ?? '');
      const sameTeamBlock = !!attacker && playingPlayerIds.has(attacker);
      if (fallen && !nonKnockdown && !sameTeamBlock && playingPlayerIds.has(fallen)) {
        if (!context.turnoverArmed) knockedDown = fallen;
        context.turnoverArmed = true;
        context.turnoverAfterInjury = true;
      }
      continue;
    }
    const pid = String(report.playerId ?? '');
    if (isModifierRescueReport(report)) {
      if (!playingPlayerIds.has(pid)) {
        if (context.rescuableInterceptor === pid) {
          context.turnoverArmed = true; // Sol r2 #1: the rescued interception succeeds, as a successful interceptionRoll arms
          delete context.rescuableInterceptor;
          clearArming(context);
        }
      } else if (context.lastFailureBy === pid && context.lastFailure !== undefined) {
        // Sol r3 #2 / r5: the rescue makes THIS player's latest failure pass. It disarms only when that occurrence is the
        // one the turnover rests on, or a catch completing an inaccurate (not fumbled) pass; any earlier committed
        // failure stays (StepPickUp 234-244 END_TURN, StepEndPassing 267-278).
        // Sol r6: a pass that was not fumbled ends by final possession (StepEndPassing 267-278), so a rescued catch
        // anywhere in its chain (after an inaccurate pass or a team-mate's failed catch) completes it.
        const rescuesArmed = context.turnoverArmed && (context.lastFailure === context.armedFailure
          || (context.lastFailureRoll === 'catchRoll' && (context.armedByRoll === 'passRoll' || context.armedByRoll === 'catchRoll')));
        delete context.lastFailure; delete context.lastFailureBy; delete context.lastFailureRoll;
        if (rescuesArmed) {
          context.turnoverArmed = false;
          context.turnoverAfterInjury = false;
          clearArming(context);
        }
      }
      continue;
    }
    if (id === 'interceptionRoll' && report.successful === false && pid && !playingPlayerIds.has(pid)) context.rescuableInterceptor = pid;
    else if (id !== 'reRoll' && id !== 'skillUse') delete context.rescuableInterceptor;
    const wasArmed = context.turnoverArmed;
    context.turnoverArmed = turnoverArmAfterReport(context.turnoverArmed, report, playingPlayerIds);
    const playingFailure = TURNOVER_FAIL_IDS.has(id) && report.successful === false && !!pid && playingPlayerIds.has(pid);
    if (playingFailure) {
      const seq = (context.failureSeq ?? 0) + 1;
      const kind = failureKind(id, report);
      context.failureSeq = seq;
      context.lastFailure = seq; context.lastFailureBy = pid; context.lastFailureRoll = kind;
      const sameRoll = context.armedBy === pid && (context.armedByRoll === id || (id === 'passRoll' && context.armedByRoll === 'passFumble'));
      // a fresh arming, or (Sol r5 #1) the reroll of the very roll the turnover rests on failing again: the latest
      // occurrence (and kind: an inaccurate pass rerolled into a fumble) is the one the turnover now rests on
      if (context.turnoverArmed && (!wasArmed || (report.reRolled === true && sameRoll))) {
        context.armedFailure = seq; context.armedBy = pid; context.armedByRoll = kind;
      }
    } else if (!wasArmed && context.turnoverArmed) {
      delete context.armedBy; delete context.armedByRoll; delete context.armedFailure;
    }
    if (!context.turnoverArmed) { context.turnoverAfterInjury = false; clearArming(context); }
  }
  const mode = String(turnModeAfter ?? '');
  // Sol r3 #1: the interception reaction mode (bb2025 StepIntercept 240-264) is mid-pass, never a drive boundary.
  if (mode !== 'regular' && mode !== 'betweenTurns' && mode !== 'interception') {
    context.turnoverArmed = false;
    context.turnoverAfterInjury = false;
    delete context.rescuableInterceptor;
    clearArming(context);
  }
  return { context, knockedDown };
}
/** Does this command's turnEnd close the turn as a TURNOVER? (`context` = after turnoverArmStep for the command.) */
export function turnEndIsTurnover(context: Readonly<TurnPresentationContext>, turnEnd: Readonly<Record<string, unknown>>, turnModeAfter: unknown): boolean {
  return !turnEnd.playerIdTouchdown && context.turnoverArmed && String(turnModeAfter ?? '') === 'regular';
}

/**
 * Deterministic turn-boundary projection. Persist the returned context with the
 * cursor; a turnEnd can arrive several commands after the failure that armed it.
 */
export function turnPresentation(
  previous: Readonly<TurnPresentationContext>,
  before: Readonly<TurnPresentationBefore>,
  after: GameJson,
  reports: readonly Record<string, unknown>[],
): TurnPresentation {
  const endingSide: 'home' | 'away' = before.homePlaying ? 'home' : 'away';
  const incomingSide: 'home' | 'away' = endingSide === 'home' ? 'away' : 'home';
  const mode = String(after.turnMode ?? '');
  const { context } = turnoverArmStep(previous, new Set(before.playingPlayerIds), reports, mode);
  const turnEnd = reports.find((report) => String(report.reportId) === 'turnEnd');
  let splash: TurnPresentation['splash'] = null;
  let toast: TurnPresentation['toast'] = null;
  if (turnEnd) {
    clearTurnRescueContext(context);
    if (turnEnd.playerIdTouchdown) {
      context.turnoverArmed = false;
      context.turnoverAfterInjury = false;
    } else if (context.turnoverArmed && mode === 'regular') {
      const afterInjury = context.turnoverAfterInjury;
      context.turnoverArmed = false;
      context.turnoverAfterInjury = false;
      const team = teamPresentation(after, endingSide);
      splash = { kind: 'turnover', afterInjury, ...team };
      const incoming = teamPresentation(after, incomingSide);
      const turn = Number((incomingSide === 'home' ? after.turnDataHome : after.turnDataAway)?.turnNr ?? 0);
      if (turn >= 1) toast = { ...incoming, turn, context: 'afterTurnover' };
    } else if (mode === 'regular') {
      const team = teamPresentation(after, incomingSide);
      splash = { kind: 'turnStart', ...team };
      const turn = Number((incomingSide === 'home' ? after.turnDataHome : after.turnDataAway)?.turnNr ?? 0);
      if (turn >= 1) toast = { ...team, turn, context: 'normal' };
    }
  } else if (mode === 'regular') {
    const side: 'home' | 'away' = turnSideIsHome(after) ? 'home' : 'away';
    const beforeTurn = side === 'home' ? before.homeTurn : before.awayTurn;
    const turn = Number((side === 'home' ? after.turnDataHome : after.turnDataAway)?.turnNr ?? 0);
    if (turn >= 1 && turn > beforeTurn) toast = { ...teamPresentation(after, side), turn, context: 'normal' };
  }

  return { context, clearMoveTrail: !!turnEnd, splash, toast };
}
