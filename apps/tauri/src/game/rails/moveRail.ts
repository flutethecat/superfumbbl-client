import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { availableActions, allowsFumblerooskieAction, fumblerooskieAvailable } from '../logic/availableActions';
import type { MoveRailDiagnostic } from '../railDiagnostics';
import type { DecisionContext, PresentationEnvelope, RailFrame, RailHandler } from './contracts';

type Coordinate = readonly [number, number];

interface MoveSquareSource {
  coordinate?: unknown;
  minimumRollGfi?: unknown;
  minimumRollDodge?: unknown;
}

interface MoveGameFacts {
  turnMode?: unknown;
  homePlaying?: unknown;
  actingPlayer?: { playerId?: unknown; playerAction?: unknown; leaping?: unknown };
  fieldModel?: {
    moveSquareArray?: readonly MoveSquareSource[];
    playerDataArray?: readonly { playerId?: unknown; playerCoordinate?: unknown; playerState?: unknown }[];
  };
  teamHome?: { teamId?: unknown; playerArray?: readonly { playerId?: unknown; skillArray?: readonly unknown[] }[] };
  teamAway?: { teamId?: unknown; playerArray?: readonly { playerId?: unknown; skillArray?: readonly unknown[] }[] };
}

interface MoveOutgoingEvent {
  kind: string;
  command?: Readonly<Record<string, unknown>>;
}

export interface MoveRailFrame extends RailFrame<MoveGameFacts, Record<string, unknown>, Record<string, unknown>> {
  event: Readonly<MoveOutgoingEvent>;
}

export interface MoveSquareFact {
  coordinate: Coordinate;
  minimumRollGfi: number;
  minimumRollDodge: number;
}

export interface MoveTransaction {
  /** Compatibility slot for the mixed handler registry. Commands never become reducer/model truth. */
  event: null;
  key: string;
  factsKey: string;
  commandNr: number;
  actingPlayerId: string | null;
  actingPlayerAction: string | null;
  leaping: boolean;
  actingPlayerCoordinate: Coordinate | null;
  actingTeamId: string | null;
  turnMode: string;
  dialogKey: string | null;
  moveSquares: readonly Readonly<MoveSquareFact>[];
  status: 'inactive' | 'active' | 'locked';
  replanned: boolean;
  diagnostic: Readonly<MoveRailDiagnostic> | null;
}

export type MoveDecision =
  | { kind: 'declare'; playerId: string; playerAction: string; leaping: boolean }
  | { kind: 'undeclare'; leaping: boolean }
  | {
    kind: 'move';
    actingPlayerId: string;
    coordinateFrom: Coordinate;
    coordinatesTo: readonly Coordinate[];
  }
  | { kind: 'use-fumblerooskie' };

export type MoveCommand =
  | {
    netCommandId: 'clientActingPlayer';
    playerId: string | null;
    playerAction: string | null;
    leaping: boolean;
  }
  | {
    netCommandId: 'clientMove';
    actingPlayerId: string;
    coordinateFrom: [number, number];
    coordinatesTo: [number, number][];
  }
  | { netCommandId: 'clientUseFumblerooskie' };

export interface MovePresentation {
  status: MoveTransaction['status'];
  actingPlayerId: string | null;
  actingPlayerAction: string | null;
  leaping: boolean;
  actingPlayerCoordinate: Coordinate | null;
  turnMode: string;
  dialogKey: string | null;
  moveSquares: readonly Readonly<MoveSquareFact>[];
  replanned: boolean;
}

export const INITIAL_MOVE_TRANSACTION: MoveTransaction = Object.freeze({
  event: null,
  key: 'move:none:-1',
  factsKey: '',
  commandNr: -1,
  actingPlayerId: null,
  actingPlayerAction: null,
  leaping: false,
  actingPlayerCoordinate: null,
  actingTeamId: null,
  turnMode: '',
  dialogKey: null,
  moveSquares: Object.freeze([]),
  status: 'inactive',
  replanned: false,
  diagnostic: null,
});

function coordinate(value: unknown): Coordinate | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function stableServerValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(stableServerValue).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableServerValue(record[key])}`).join(',')}}`;
}

function actingTeamId(game: Readonly<MoveGameFacts>, playerId: string | null): string | null {
  if (!playerId) return null;
  const home = game.teamHome?.playerArray?.some((player) => String(player.playerId ?? '') === playerId) ?? false;
  const away = game.teamAway?.playerArray?.some((player) => String(player.playerId ?? '') === playerId) ?? false;
  if (home === away) return null;
  return String((home ? game.teamHome : game.teamAway)?.teamId ?? '') || null;
}

function receivedMoveSquares(game: Readonly<MoveGameFacts>): readonly Readonly<MoveSquareFact>[] {
  const result: MoveSquareFact[] = [];
  for (const square of game.fieldModel?.moveSquareArray ?? []) {
    const received = coordinate(square.coordinate);
    if (!received) continue;
    result.push({
      coordinate: received,
      minimumRollGfi: Number(square.minimumRollGfi ?? 0),
      minimumRollDodge: Number(square.minimumRollDodge ?? 0),
    });
  }
  return result;
}

function receivedActingCoordinate(game: Readonly<MoveGameFacts>, playerId: string | null): Coordinate | null {
  if (!playerId) return null;
  const player = game.fieldModel?.playerDataArray?.find((value) => String(value.playerId ?? '') === playerId);
  return coordinate(player?.playerCoordinate);
}

export function reduceMoveTransaction(
  previous: Readonly<MoveTransaction>,
  frame: Readonly<MoveRailFrame>,
): MoveTransaction {
  const game = frame.game;
  const actingPlayerId = String(game.actingPlayer?.playerId ?? '') || null;
  const actingPlayerAction = String(game.actingPlayer?.playerAction ?? '') || null;
  const leaping = !!game.actingPlayer?.leaping;
  const turnMode = String(game.turnMode ?? '');
  const dialogKey = frame.dialog == null ? null : stableServerValue(frame.dialog);
  const moveSquares = receivedMoveSquares(game);
  const teamId = actingTeamId(game, actingPlayerId);
  const actingPlayerCoordinate = receivedActingCoordinate(game, actingPlayerId);
  const moving = allowsFumblerooskieAction(actingPlayerAction);
  const unknownMovingState = !!actingPlayerAction && !moving && moveSquares.length > 0;
  const status: MoveTransaction['status'] = unknownMovingState
    ? 'locked'
    : actingPlayerId && actingPlayerAction && moving && teamId ? 'active' : 'inactive';
  const factsKey = stableServerValue({
    moveSquares, actingPlayerId, actingPlayerAction, leaping, actingPlayerCoordinate, dialog: frame.dialog, turnMode,
  });
  const key = `move:${actingPlayerId ?? 'none'}:${actingPlayerAction ?? 'none'}:${frame.commandNr}`;
  const diagnostic: MoveRailDiagnostic | null = unknownMovingState ? {
    rail: 'move',
    code: 'unknown-state',
    key,
    action: actingPlayerAction!,
    message: `[move-rail] unknown moving action locked key=${key} action=${actingPlayerAction}`,
  } : null;

  return {
    event: null,
    key,
    factsKey,
    commandNr: frame.commandNr,
    actingPlayerId,
    actingPlayerAction,
    leaping,
    actingPlayerCoordinate,
    actingTeamId: teamId,
    turnMode,
    dialogKey,
    moveSquares,
    status,
    replanned: previous.commandNr >= 0 && (previous.factsKey !== factsKey || previous.key !== key),
    diagnostic,
  };
}

function exactMoveIntent(state: Readonly<MoveTransaction>, command: Readonly<Record<string, unknown>>): MoveDecision | null {
  const actingPlayerId = String(command.actingPlayerId ?? '');
  const destinations = Array.isArray(command.coordinatesTo)
    ? command.coordinatesTo.map(coordinate)
    : [];
  if (!state.actingPlayerId || actingPlayerId !== state.actingPlayerId || !state.actingPlayerCoordinate
      || destinations.length === 0 || destinations.some((value) => value == null)) return null;
  const offered = new Set(state.moveSquares.map((square) => `${square.coordinate[0]},${square.coordinate[1]}`));
  const coordinatesTo = destinations as Coordinate[];
  if (coordinatesTo.some((value) => !offered.has(`${value[0]},${value[1]}`))) return null;
  return { kind: 'move', actingPlayerId, coordinateFrom: state.actingPlayerCoordinate, coordinatesTo };
}

function playerContext(
  game: Readonly<MoveGameFacts>,
  context: Readonly<DecisionContext>,
): { myIsHome: boolean } | null {
  const homeTeamId = String(game.teamHome?.teamId ?? '');
  const awayTeamId = String(game.teamAway?.teamId ?? '');
  if (!context.myTeamId || homeTeamId === awayTeamId) return null;
  if (context.myTeamId === homeTeamId) return { myIsHome: true };
  if (context.myTeamId === awayTeamId) return { myIsHome: false };
  return null;
}

function offeredAction(
  frame: Readonly<MoveRailFrame>,
  context: Readonly<DecisionContext>,
  playerId: string,
  kind: 'declare' | 'endMove',
  action: string,
): boolean {
  const seat = playerContext(frame.game, context);
  if (!seat || actingTeamId(frame.game, playerId) !== context.myTeamId) return false;
  return availableActions(
    frame.game as unknown as GameJson,
    { mode: 'player', loggedIn: true, myIsHome: seat.myIsHome },
    playerId,
  ).some((offer) => offer.kind === kind && offer.action === action && offer.enabled);
}

function actingPlayerIntent(
  state: Readonly<MoveTransaction>,
  frame: Readonly<MoveRailFrame>,
  context: Readonly<DecisionContext>,
  command: Readonly<Record<string, unknown>>,
): MoveDecision | null {
  const playerId = String(command.playerId ?? '');
  if (!playerId) {
    if (!state.actingPlayerId || !offeredAction(frame, context, state.actingPlayerId, 'endMove', '')) return null;
    // Legacy store.ts:9043 sends clientActingPlayer{playerId:null}; jumping is server-echoed.
    return { kind: 'undeclare', leaping: state.leaping };
  }
  const playerAction = String(command.playerAction ?? '');
  if (!playerAction || !offeredAction(frame, context, playerId, 'declare', playerAction)) return null;
  // Ordinary declares preserve the server-echoed jumping flag. A Jump/Pogo/Leap menu election is the sole legal
  // way to change it: fresh activation sends MOVE+leaping=true, while a live mover toggles its current action.
  // Validate that independent synthetic offer before projecting the observed boolean, otherwise cutover would
  // silently rewrite a legal fresh Pogo command back to false. Upstream's literal-flat declares stay flat;
  // notably BB2025 SelectLogicModule sends SECURE_THE_BALL with `leaping=false` every time.
  let leaping = playerAction === 'throwKey' || playerAction === 'allYouCanEat' || playerAction === 'secureTheBall'
    ? false
    : state.leaping;
  const requestedLeaping = command.leaping === true;
  if (requestedLeaping !== leaping) {
    if (!offeredAction(frame, context, playerId, 'declare', 'jump')) return null;
    leaping = requestedLeaping;
  }
  return { kind: 'declare', playerId, playerAction, leaping };
}

export function deriveMoveDecision(
  state: Readonly<MoveTransaction>,
  frame: Readonly<MoveRailFrame>,
  context: Readonly<DecisionContext>,
): MoveDecision | null {
  if (context.audience !== 'player' || !context.maySend || frame.dialog != null) return null;
  const command = frame.event.command;
  const id = String(command?.netCommandId ?? '');
  if (!command) return null;
  if (id === 'clientActingPlayer') return actingPlayerIntent(state, frame, context, command);
  if (state.status !== 'active' || !state.actingTeamId || context.myTeamId !== state.actingTeamId) return null;
  if (id === 'clientMove') return exactMoveIntent(state, command);
  if (id === 'clientUseFumblerooskie'
      && fumblerooskieAvailable(frame.game as unknown as GameJson, state.actingPlayerId!)) {
    return { kind: 'use-fumblerooskie' };
  }
  return null;
}

export function presentMoveTransaction(
  state: Readonly<MoveTransaction>,
): readonly PresentationEnvelope<MovePresentation>[] {
  return [{
    key: state.key,
    rail: 'move',
    value: {
      status: state.status,
      actingPlayerId: state.actingPlayerId,
      actingPlayerAction: state.actingPlayerAction,
      leaping: state.leaping,
      actingPlayerCoordinate: state.actingPlayerCoordinate,
      turnMode: state.turnMode,
      dialogKey: state.dialogKey,
      moveSquares: state.moveSquares,
      replanned: state.replanned,
    },
  }];
}

export function buildMoveCommand(decision: Readonly<MoveDecision>): MoveCommand {
  if (decision.kind === 'declare') {
    return {
      netCommandId: 'clientActingPlayer', playerId: decision.playerId,
      playerAction: decision.playerAction, leaping: decision.leaping,
    };
  }
  if (decision.kind === 'undeclare') {
    return { netCommandId: 'clientActingPlayer', playerId: null, playerAction: null, leaping: decision.leaping };
  }
  if (decision.kind === 'use-fumblerooskie') return { netCommandId: 'clientUseFumblerooskie' };
  return {
    netCommandId: 'clientMove',
    actingPlayerId: decision.actingPlayerId,
    coordinateFrom: [decision.coordinateFrom[0], decision.coordinateFrom[1]],
    coordinatesTo: decision.coordinatesTo.map((value) => [value[0], value[1]]),
  };
}

export const MOVE_RAIL_HANDLER: RailHandler<
  MoveTransaction,
  MoveRailFrame,
  MoveDecision,
  MovePresentation,
  MoveCommand
> = {
  id: 'move',
  initial: INITIAL_MOVE_TRANSACTION,
  // Keep ordinary movement in shadow mode until this rail models locally answered
  // dialogs as well as the established action-surface lock.  The authoritative
  // server can leave an answered re-roll dialog in the same frame that re-opens
  // movement; treating that raw dialog as live made this rail falsely refuse the
  // next legal clientMove.  Fumblerooskie remains fully owned because its election
  // has no equivalent answered-dialog lifetime.
  ownedCommandIds: new Set<MoveCommand['netCommandId']>(['clientUseFumblerooskie']),
  observedCommandIds: new Set<MoveCommand['netCommandId']>(['clientActingPlayer', 'clientMove']),
  reduce: reduceMoveTransaction,
  deriveDecision: deriveMoveDecision,
  present: presentMoveTransaction,
  command: buildMoveCommand,
};
