/**
 * Ordered BB2025 EndGame reducer. `turnMode:endGame` starts the transaction;
 * live input requires `finished` or `gameStatistics` for the durable final panel;
 * a finite replay may separately authorize it when its input is exhausted.
 */

export type EndGameAudience = 'player' | 'spectator' | 'replay';
export type EndGamePhase =
  | 'idle' | 'initializing' | 'assignTouchdowns' | 'penaltyShootout'
  | 'mvp' | 'winnings' | 'dedicatedFans' | 'playerLoss'
  | 'statistics' | 'complete';

export interface EndGameDialog {
  id: string;
  teamId?: string;
  playerChoiceMode?: string;
  playerIds?: readonly string[];
  minSelects?: number;
  maxSelects?: number;
  payload?: Readonly<Record<string, unknown>>;
}

export type EndGameReport =
  | { kind: 'playerEvent'; playerId: string; text: string }
  | { kind: 'penaltyShootout'; payload: Readonly<Record<string, unknown>> }
  | { kind: 'mostValuablePlayers'; homeIds: readonly string[]; awayIds: readonly string[] }
  | { kind: 'winnings'; home: number; away: number }
  | { kind: 'dedicatedFans'; payload: Readonly<Record<string, unknown>> }
  | { kind: 'defectingPlayers'; playerIds: readonly string[]; rolls: readonly number[]; defecting: readonly boolean[] };

export interface EndGameFrame {
  gameId: string;
  commandNr: number;
  turnMode: string;
  finished: boolean;
  dialog: EndGameDialog | null;
  reports: readonly EndGameReport[];
}

export type EndGameDecision =
  | { kind: 'assignTouchdown'; instanceKey: string; playerIds: readonly string[]; min: 1; max: 1 }
  | { kind: 'penaltyShootout'; instanceKey: string; payload: Readonly<Record<string, unknown>> }
  | { kind: 'mvp'; instanceKey: string; playerIds: readonly string[]; min: number; max: number };

export type EndGameCommand =
  | { netCommandId: 'clientPlayerChoice'; playerChoiceMode: 'assignTouchdown' | 'mvp'; playerIds: readonly string[] }
  | { netCommandId: 'clientConfirm' };

export interface EndGameState {
  gameId: string | null;
  lastCommandNr: number;
  phase: EndGamePhase;
  dialog: EndGameDialog | null;
  decisionInstanceKey: string | null;
  touchdownAwards: readonly { playerId: string; text: string }[];
  shootoutReports: readonly Readonly<Record<string, unknown>>[];
  mvpHomeIds: readonly string[];
  mvpAwayIds: readonly string[];
  winnings: { home: number; away: number } | null;
  dedicatedFans: Readonly<Record<string, unknown>> | null;
  defectors: readonly { playerId: string; roll: number; defected: boolean }[];
  finished: boolean;
  finalPresentationReady: boolean;
}

export const EMPTY_END_GAME: EndGameState = {
  gameId: null,
  lastCommandNr: -1,
  phase: 'idle',
  dialog: null,
  decisionInstanceKey: null,
  touchdownAwards: [],
  shootoutReports: [],
  mvpHomeIds: [],
  mvpAwayIds: [],
  winnings: null,
  dedicatedFans: null,
  defectors: [],
  finished: false,
  finalPresentationReady: false,
};

export interface PenaltyShootoutPresentationState {
  identity: string | null;
  dismissedIdentity: string | null;
  seq: number;
  visible: boolean;
}

export const EMPTY_PENALTY_SHOOTOUT_PRESENTATION: PenaltyShootoutPresentationState = {
  identity: null,
  dismissedIdentity: null,
  seq: 0,
  visible: false,
};

/** Stable presentation identity; unlike a decision key it deliberately ignores commandNr. */
export function penaltyShootoutPresentationIdentity(dialog: EndGameDialog | null): string | null {
  if (dialog?.id !== 'penaltyShootout') return null;
  const rolls = (value: unknown): number[] => Array.isArray(value) ? value.map(Number) : [];
  const homeRolls = rolls(dialog.payload?.rollsHome);
  const awayRolls = rolls(dialog.payload?.rollsAway);
  return `penaltyShootout:${homeRolls.join(',')}:${awayRolls.join(',')}`;
}

export function syncPenaltyShootoutPresentation(
  previous: PenaltyShootoutPresentationState,
  dialog: EndGameDialog | null,
): PenaltyShootoutPresentationState {
  const identity = penaltyShootoutPresentationIdentity(dialog);
  if (identity == null) {
    return { identity: null, dismissedIdentity: null, seq: previous.seq, visible: false };
  }
  if (identity === previous.dismissedIdentity) {
    return { ...previous, identity, visible: false };
  }
  if (identity === previous.identity) {
    return { ...previous, visible: true };
  }
  return { identity, dismissedIdentity: null, seq: previous.seq + 1, visible: true };
}

export function dismissPenaltyShootoutPresentation(
  previous: PenaltyShootoutPresentationState,
): PenaltyShootoutPresentationState {
  return { ...previous, dismissedIdentity: previous.identity, visible: false };
}

const dialogPhase = (dialog: EndGameDialog | null): EndGamePhase | null => {
  if (!dialog) return null;
  if (dialog.id === 'gameStatistics') return 'statistics';
  if (dialog.id === 'penaltyShootout') return 'penaltyShootout';
  if (dialog.id === 'playerChoice' && dialog.playerChoiceMode === 'assignTouchdown') return 'assignTouchdowns';
  if (dialog.id === 'playerChoice' && dialog.playerChoiceMode === 'mvp') return 'mvp';
  return null;
};

const reportPhase = (report: EndGameReport): EndGamePhase => {
  switch (report.kind) {
    case 'playerEvent': return 'assignTouchdowns';
    case 'penaltyShootout': return 'penaltyShootout';
    case 'mostValuablePlayers': return 'mvp';
    case 'winnings': return 'winnings';
    case 'dedicatedFans': return 'dedicatedFans';
    case 'defectingPlayers': return 'playerLoss';
  }
};

const phaseRank: Readonly<Record<EndGamePhase, number>> = {
  idle: 0, initializing: 1, assignTouchdowns: 2, penaltyShootout: 3, mvp: 4,
  winnings: 5, dedicatedFans: 6, playerLoss: 7, statistics: 8, complete: 9,
};

const later = (a: EndGamePhase, b: EndGamePhase): EndGamePhase => phaseRank[b] > phaseRank[a] ? b : a;

export function reduceEndGame(previous: EndGameState, frame: EndGameFrame): EndGameState {
  const base = previous.gameId !== frame.gameId ? { ...EMPTY_END_GAME, gameId: frame.gameId } : previous;
  if (frame.commandNr < base.lastCommandNr) return base;

  let phase: EndGamePhase = base.phase;
  if (frame.turnMode === 'endGame' && phase === 'idle') phase = 'initializing';
  const fromDialog = dialogPhase(frame.dialog);
  if (fromDialog) phase = later(phase, fromDialog);

  let touchdownAwards = base.touchdownAwards;
  let shootoutReports = base.shootoutReports;
  let mvpHomeIds = base.mvpHomeIds;
  let mvpAwayIds = base.mvpAwayIds;
  let winnings = base.winnings;
  let dedicatedFans = base.dedicatedFans;
  let defectors = base.defectors;

  for (const report of frame.reports) {
    phase = later(phase, reportPhase(report));
    switch (report.kind) {
      case 'playerEvent': touchdownAwards = [...touchdownAwards, report]; break;
      case 'penaltyShootout': shootoutReports = [...shootoutReports, report.payload]; break;
      case 'mostValuablePlayers': mvpHomeIds = report.homeIds; mvpAwayIds = report.awayIds; break;
      case 'winnings': winnings = { home: report.home, away: report.away }; break;
      case 'dedicatedFans': dedicatedFans = report.payload; break;
      case 'defectingPlayers':
        defectors = report.playerIds.map((playerId, index) => ({
          playerId,
          roll: report.rolls[index] ?? 0,
          defected: report.defecting[index] ?? false,
        }));
        break;
    }
  }

  // deviation: latch the authoritative finished fact across later informational frames.
  const finished = base.finished || frame.finished;
  const finalPresentationReady = base.finalPresentationReady || finished || frame.dialog?.id === 'gameStatistics';
  if (finalPresentationReady) phase = finished ? 'complete' : 'statistics';
  const decisionInstanceKey = frame.dialog
    ? `${frame.commandNr}:${frame.dialog.id}:${frame.dialog.playerChoiceMode ?? ''}:${frame.dialog.teamId ?? ''}`
    : null;

  return {
    ...base,
    lastCommandNr: frame.commandNr,
    phase,
    dialog: frame.dialog,
    decisionInstanceKey,
    touchdownAwards,
    shootoutReports,
    mvpHomeIds,
    mvpAwayIds,
    winnings,
    dedicatedFans,
    defectors,
    finished,
    finalPresentationReady,
  };
}

/** A finite replay exhausting its frames is authoritative only for replay presentation readiness. */
export function authorizeEndGamePresentationAtInputEnd(
  previous: EndGameState,
  audience: EndGameAudience,
): EndGameState {
  if (audience !== 'replay' || previous.phase === 'idle' || previous.finalPresentationReady) return previous;
  return { ...previous, finalPresentationReady: true };
}

export interface EndGameDecisionContext {
  audience: EndGameAudience;
  myTeamId: string | null;
  maySend: boolean;
}

export function deriveEndGameDecision(
  state: EndGameState,
  context: EndGameDecisionContext,
): EndGameDecision | null {
  if (context.audience !== 'player' || !context.maySend || !context.myTeamId || !state.dialog) return null;
  if (state.dialog.teamId && state.dialog.teamId !== context.myTeamId) return null;
  const instanceKey = state.decisionInstanceKey!;

  // deviation: stale dialog payloads cannot construct a decision outside their ordered phase.
  if (state.dialog.id === 'penaltyShootout') {
    if (state.phase !== 'penaltyShootout') return null;
    return { kind: 'penaltyShootout', instanceKey, payload: state.dialog.payload ?? {} };
  }
  if (state.dialog.id !== 'playerChoice') return null;
  if (state.dialog.playerChoiceMode === 'assignTouchdown') {
    if (state.phase !== 'assignTouchdowns') return null;
    return { kind: 'assignTouchdown', instanceKey, playerIds: state.dialog.playerIds ?? [], min: 1, max: 1 };
  }
  if (state.dialog.playerChoiceMode === 'mvp') {
    if (state.phase !== 'mvp') return null;
    return {
      kind: 'mvp', instanceKey, playerIds: state.dialog.playerIds ?? [],
      min: Math.max(0, state.dialog.minSelects ?? 0),
      max: Math.max(1, state.dialog.maxSelects ?? 1),
    };
  }
  return null;
}

export function answerEndGameDecision(decision: EndGameDecision, playerIds: readonly string[] = []): EndGameCommand {
  if (decision.kind === 'penaltyShootout') return { netCommandId: 'clientConfirm' };
  if (playerIds.length < decision.min || playerIds.length > decision.max) {
    throw new Error(`${decision.kind} requires ${decision.min}..${decision.max} players.`);
  }
  return { netCommandId: 'clientPlayerChoice', playerChoiceMode: decision.kind, playerIds };
}

/** Spectator/replay close is local-only; upstream sends no confirm for that audience. */
export function closePenaltyShootoutLocally(audience: EndGameAudience): 'closed' {
  if (audience === 'player') throw new Error('A player must answer Penalty Shootout through its decision command.');
  return 'closed';
}
