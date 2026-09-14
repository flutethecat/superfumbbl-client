import { type GameJson } from '@fumbbl40k/ffb-protocol';
import { injuryTypeName } from './casualtyRollProjection';

const TURNOVER_FAIL_IDS = new Set(['dodgeRoll', 'goForItRoll', 'pickUpRoll', 'passRoll', 'catchRoll', 'leapRoll']);

export interface TurnPresentationContext {
  turnoverArmed: boolean;
  turnoverAfterInjury: boolean;
}

export interface TurnPresentationBefore {
  homePlaying: boolean;
  homeTurn: number;
  awayTurn: number;
  playingPlayerIds: string[];
}

/** Capture only the facts needed after publication; do not retain another model graph. */
export function captureTurnPresentationBefore(game: GameJson): TurnPresentationBefore {
  const side = game.homePlaying ? game.teamHome : game.teamAway;
  return {
    homePlaying: !!game.homePlaying,
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

/** Same active-side roll heuristic used by the live frame presenter. */
export function turnoverArmAfterReport(
  armed: boolean,
  report: Readonly<Record<string, unknown>>,
  playingPlayerIds: ReadonlySet<string>,
): boolean {
  const id = String(report.reportId ?? '');
  if (id === 'interceptionRoll') return report.successful === true ? true : armed;
  if (id === 'modifiedDodgeResultSuccessful') return false;
  if (!TURNOVER_FAIL_IDS.has(id)) return armed;
  const playerId = String(report.playerId ?? '');
  if (!playerId || !playingPlayerIds.has(playerId)) return armed;
  if (report.successful === false) return true;
  if (report.successful === true) return false;
  return armed;
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
  const context: TurnPresentationContext = { ...previous };
  const endingSide: 'home' | 'away' = before.homePlaying ? 'home' : 'away';
  const incomingSide: 'home' | 'away' = endingSide === 'home' ? 'away' : 'home';
  const playingIds = new Set(before.playingPlayerIds);

  for (const report of reports) {
    const id = String(report.reportId);
    if (id === 'interceptionRoll' || id === 'modifiedDodgeResultSuccessful' || TURNOVER_FAIL_IDS.has(id)) {
      context.turnoverArmed = turnoverArmAfterReport(context.turnoverArmed, report, playingIds);
      if (!context.turnoverArmed) context.turnoverAfterInjury = false;
    } else if (id === 'injury') {
      const fallen = String(report.defenderId ?? report.playerId ?? '');
      const injuryType = injuryTypeName(report.injuryType).toLowerCase();
      const nonKnockdown = /crowd|bitten|quickbite|ttmlanding/.test(injuryType);
      const attacker = String(report.attackerId ?? '');
      const sameTeamBlock = !!attacker && playingIds.has(attacker);
      if (fallen && !nonKnockdown && !sameTeamBlock && playingIds.has(fallen)) {
        context.turnoverArmed = true;
        context.turnoverAfterInjury = true;
      }
    }
  }

  const mode = String(after.turnMode ?? '');
  if (mode !== 'regular' && mode !== 'betweenTurns') {
    context.turnoverArmed = false;
    context.turnoverAfterInjury = false;
  }
  const turnEnd = reports.find((report) => String(report.reportId) === 'turnEnd');
  let splash: TurnPresentation['splash'] = null;
  let toast: TurnPresentation['toast'] = null;
  if (turnEnd) {
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
    const side: 'home' | 'away' = after.homePlaying ? 'home' : 'away';
    const beforeTurn = side === 'home' ? before.homeTurn : before.awayTurn;
    const turn = Number((side === 'home' ? after.turnDataHome : after.turnDataAway)?.turnNr ?? 0);
    if (turn >= 1 && turn > beforeTurn) toast = { ...teamPresentation(after, side), turn, context: 'normal' };
  }

  return { context, clearMoveTrail: !!turnEnd, splash, toast };
}
