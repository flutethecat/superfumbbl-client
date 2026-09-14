import { createFollowupProjection, reduceFollowupProjection, type FollowupProjection } from '../followupProjection';
import { LOG_TAG_KINDS } from '../logTags';
import { TEAM_SIDES } from '../teamSide';
import { D6_LOG_TOKEN_KINDS } from '../d6Log';
import { OBSERVED_MOVEMENT_PHASES } from '../movementOccurrenceProjection';
import { DRIVE_PROVENANCES } from '../driveProjection';
import { APOTHECARY_NONE_LABELS, APOTHECARY_OFFER_KINDS, APOTHECARY_OUTCOMES, APOTHECARY_TYPES } from '../logic/apothecaryOffer';
import { RE_ROLL_OPTION_ROLES, RE_ROLL_RESPONSES } from '../reRollDecisionProjection';
import { END_GAME_PHASES } from '../endGameHandler';
import { INJURY_RESULT_NAMES } from '../skillUseCardPresentation';
import { pushPresentation, type PendingPush } from '../pushPresentation';
import { createSkillDecisionProjection, reduceSkillDecisionProjection, type SkillDecisionProjection } from '../skillDecisionProjection';
import { buildBlockDecision, createBlockContext, reduceBlockContext, type BlockContextProjection, type BlockDecisionProjection } from '../blockDecisionProjection';
import { createInjuryOutcomeProjection, reduceInjuryOutcomes, type InjuryOutcomeProjection } from '../injuryOutcomeProjection';
import { createCasualtyRollProjection, reduceCasualtyRollProjection, type CasualtyRollProjection } from '../casualtyRollProjection';
import { apothecaryDecisionFromModel, buildApothecaryResult, type ApothecaryResultProjection, type ApothecaryDecisionProjection } from '../apothecaryDecisionProjection';
import { buildReRollDecision, type ReRollDecisionProjection } from '../reRollDecisionProjection';
import { createActionRollProjection, reduceActionRollProjection, PASS_RE_ROLL_RESULTS, PASS_ROLL_REPORT_IDS, type ActionRollProjection } from '../actionRollProjection';
import { reduceEndGameHud, type EndGameHudProjection } from '../endGameHudProjection';
import { reduceDriveProjection, type DriveProjection } from '../driveProjection';
import { reduceBlitzProjection, type BlitzProjection } from '../blitzProjection';
import { reduceGazeVictims, reduceRecoveringPlayers, stunnedPlayerIds, reduceHeldTeamMate, reduceFumblerooskie, reduceDodgySnackPlayers, type HeldTeamMate, type FumblerooskieMarker } from '../persistentPlayerMarkers';
import { NetCommandId, type GameJson } from '@fumbbl40k/ffb-protocol';
import { createReportLogContext, formatReportLines, injuryReportDedupeKey, setBlockDefenderHint, type ReportDisplay, type ReportLogContext } from '../reportFormatter';
import { reportCarriesDisplayedDice } from '../d6Log';
import { EMPTY_END_GAME, reduceEndGame, type EndGameState } from '../endGameHandler';
import { endGameFrameFromServer } from '../endGameFrame';
import { applyReplayCommand, normalizeZappedPlayerSnapshots } from './replayModel';
import type { ReplayCommand } from './replayController';
import { boardTurnKey, createBoardProjection, reduceBoardProjection, type BoardProjection } from '../boardProjection';
import { observedFailedMovementDestination, reduceObservedMovementOccurrence, type ObservedMovementOccurrence } from '../movementOccurrenceProjection';
import { createKickoffWeatherContext, kickoffWeatherPresentation, type KickoffWeatherContext } from '../kickoffWeatherPresentation';
import { captureTurnPresentationBefore, createTurnPresentationContext, turnPresentation, type TurnPresentationContext } from '../turnPresentation';
import { ballProjectilePresentation, createBallProjectileContext, type BallProjectileContext } from '../ballProjectilePresentation';

export interface SpectatorIdentity {
  sessionId: string;
  connectionGeneration: number;
  segmentId: number;
}
export interface SpectatorCursor extends SpectatorIdentity { sequence: number }
export interface SpectatorEvent {
  cursor: SpectatorCursor;
  command: Readonly<ReplayCommand>;
  receivedWallAt: number;
  receivedMonotonicAt: number;
  ingressOrder?: number;
  /** Latest ordered clock sample at this match event; clock ticks are not transport steps. */
  clock?: SpectatorClock | null;
}
export interface SpectatorClock {
  gameTime: number;
  turnTime: number;
  receivedMonotonicAt: number;
}
export const SPECTATOR_DECISION_STATES = ['offered', 'resolved'] as const;
export interface SpectatorDecision {
  type: string;
  teamId: string | null;
  coach: string | null;
  playerId: string | null;
  skill: string | null;
  source: SpectatorCursor;
  state: (typeof SPECTATOR_DECISION_STATES)[number];
  payload: Record<string, unknown>;
}
export interface SpectatorLogEntry extends ReportDisplay {
  ingressOrder: number;
  receivedWallAt: number;
  source: SpectatorCursor;
}

export const REPORT_PROVENANCE_FIELDS = ["gaze","recovering","actionRolls","casualtyRolls","injuryOutcomes","block","fumblerooskie","dodgySnack","log","skillDecision","endGameHud","pushes"] as const;
/** Observed means this family has received evidence, not that pre-join history is complete. */
export const REPORT_PROVENANCE_VALUES = ['unknown', 'observed'] as const;
export type ReportProvenance = Record<typeof REPORT_PROVENANCE_FIELDS[number], (typeof REPORT_PROVENANCE_VALUES)[number]>;
const unknownReportProvenance = (): ReportProvenance => Object.fromEntries(REPORT_PROVENANCE_FIELDS.map((key) => [key, 'unknown'])) as ReportProvenance;

/** Stage-one projection schema. Store migration must inventory remaining spectator fields
 * before this becomes the rendering owner; this type is not yet that certification. */
export interface DurableProjection {
  version: 1;
  /** Snapshot-only seeds cannot establish these report-derived causes. */
  provenance: ReportProvenance;
  reportDedupe: { signature: string | null; commandNr: number | null; sourceSequence: number };
  logContext: ReportLogContext;
  log: SpectatorLogEntry[];
  followup: FollowupProjection;
  pendingPushes: { playerId: string; from: [number, number]; age: number }[];
  movementOccurrence: ObservedMovementOccurrence | null;
  kickoffWeather: KickoffWeatherContext;
  turnPresentation: TurnPresentationContext;
  ballProjectile: BallProjectileContext;
  pendingDecision: SpectatorDecision | null;
  reRollCard: ReRollDecisionProjection | null;
  blockCard: BlockDecisionProjection | null;
  apothecaryCard: ApothecaryDecisionProjection | null;
  casualtyRolls: CasualtyRollProjection;
  injuryOutcomes: InjuryOutcomeProjection;
  apothecaryResult: ApothecaryResultProjection | null;
  gazeVictimIds: string[];
  recoveringIds: string[];
  heldTeamMate: HeldTeamMate | null;
  fumblerooskie: FumblerooskieMarker | null;
  dodgySnackPlayers: string[];
  blitz: BlitzProjection | null;
  block: BlockContextProjection;
  endGame: EndGameState;
  endGameHud: EndGameHudProjection;
  actionRolls: ActionRollProjection;
  skillDecision: SkillDecisionProjection;
  board: BoardProjection;
  drive: DriveProjection;
}
export interface SpectatorCheckpoint {
  model: GameJson;
  durableProjection: DurableProjection;
  clock: SpectatorClock | null;
  cursor: SpectatorCursor;
  segmentId: number;
}

export function sameSpectatorIdentity(a: SpectatorIdentity, b: SpectatorIdentity): boolean {
  return a.sessionId === b.sessionId && a.connectionGeneration === b.connectionGeneration && a.segmentId === b.segmentId;
}

/** JSON-only checkpoint ownership. Freeze recursively so a renderer cannot mutate a journal anchor. */
export function freezeSpectatorValue<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSpectatorValue(child);
    Object.freeze(value);
  }
  return value;
}
/** True when every reachable object is frozen — a shallow-frozen shell over mutable descendants is not. */
function deepFrozen(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  for (const child of Object.values(value)) if (!deepFrozen(child)) return false;
  return true;
}
/** Perf 09-14: checkpoints this module produced (seed / reduce / clock spread) are deep-frozen AND validated at
 *  production, so a second `validateSpectatorCheckpoint` on the same object (publication, seek) is pure cost —
 *  1.5 ms per event on a 300-row log. Only this module's own outputs are trusted; a foreign or repaired graph
 *  (structuredClone → edit → freeze) is validated in full every time. */
const trustedCheckpoints = new WeakSet<object>();
function trust(checkpoint: SpectatorCheckpoint): SpectatorCheckpoint {
  // freezeSpectatorValue does not recurse through an already-frozen shell, so a foreign graph with a frozen top level
  // over mutable descendants must never be remembered as trusted (Astra 09-14).
  if (!deepFrozen(freezeSpectatorValue(checkpoint))) throw new Error('Spectator checkpoint is not deep-frozen');
  trustedCheckpoints.add(checkpoint);
  return checkpoint;
}
/** A trusted checkpoint with a newer ordered clock sample (clock ticks are not transport steps). */
export function withSpectatorClock(checkpoint: SpectatorCheckpoint, clock: SpectatorClock | null): SpectatorCheckpoint {
  if (clock !== null && !(typeof clock === 'object' && Object.getPrototypeOf(clock) === Object.prototype && Object.keys(clock).sort().join(',') === 'gameTime,receivedMonotonicAt,turnTime'
    && [clock.gameTime, clock.turnTime, clock.receivedMonotonicAt].every(Number.isFinite))) throw new Error('Invalid spectator clock');
  validateSpectatorCheckpoint(checkpoint);
  // A frozen sample keeps its identity (history compares an anchor's clock to the stored `clockAfter` by reference).
  return trust({ ...checkpoint, clock: clock && (Object.isFrozen(clock) ? clock : { gameTime: clock.gameTime, turnTime: clock.turnTime, receivedMonotonicAt: clock.receivedMonotonicAt }) });
}

function decision(model: GameJson, cursor: SpectatorCursor, previous: SpectatorDecision | null): SpectatorDecision | null {
  const raw = model.dialogParameter as Record<string, unknown> | null;
  if (!raw?.dialogId) return null;
  const playerId = raw.playerId == null ? null : String(raw.playerId);
  const team = [model.teamHome, model.teamAway].find((team) =>
    team.teamId === raw.teamId || (playerId && team.playerArray.some((p) => p.playerId === playerId)));
  const payload = structuredClone(raw);
  const unchanged = previous && JSON.stringify(previous.payload) === JSON.stringify(payload);
  return {
    type: String(raw.dialogId), teamId: team?.teamId ?? null, coach: team?.coach ?? null,
    playerId, skill: raw.skill == null ? null : String(raw.skill),
    source: unchanged ? previous.source : { ...cursor }, state: unchanged ? previous.state : 'offered', payload,
  };
}

export function seedSpectatorCheckpoint(snapshot: GameJson, cursor: SpectatorCursor, clock: SpectatorClock | null = null): SpectatorCheckpoint {
  const model = structuredClone(snapshot);
  normalizeZappedPlayerSnapshots(model);
  const result: SpectatorCheckpoint = {
    model, cursor: { ...cursor }, segmentId: cursor.segmentId, clock: clock && { ...clock },
    durableProjection: {
      version: 1, provenance: unknownReportProvenance(),
      reportDedupe: { signature: null, commandNr: null, sourceSequence: cursor.sequence }, logContext: createReportLogContext(), log: [],
      injuryOutcomes: createInjuryOutcomeProjection(),
      casualtyRolls: createCasualtyRollProjection(),
      apothecaryResult: model.dialogParameter?.dialogId === 'apothecaryChoice' ? buildApothecaryResult(model, model.dialogParameter, createCasualtyRollProjection()) : null,
      apothecaryCard: apothecaryDecisionFromModel(model),
      blockCard: ['blockRoll', 'blockRollProperties', 'blockRollPartialReRoll'].includes(String(model.dialogParameter?.dialogId)) ? buildBlockDecision(model, model.dialogParameter!, true) : null,
      reRollCard: ['reRoll', 'reRollProperties'].includes(String(model.dialogParameter?.dialogId)) ? buildReRollDecision(model, model.dialogParameter!, createActionRollProjection()) : null,
      followup: createFollowupProjection(), pendingPushes: [], movementOccurrence: null,
      kickoffWeather: createKickoffWeatherContext(model), turnPresentation: createTurnPresentationContext(),
      ballProjectile: createBallProjectileContext(),
      pendingDecision: decision(model, cursor, null), gazeVictimIds: [], recoveringIds: [], blitz: reduceBlitzProjection(null, model, { attackerId: null, defenderId: null }),
      drive: reduceDriveProjection(null, [], model),
      heldTeamMate: reduceHeldTeamMate(null, new Map(), model), fumblerooskie: null, dodgySnackPlayers: [],
      block: createBlockContext(),
      actionRolls: createActionRollProjection(),
      skillDecision: reduceSkillDecisionProjection(createSkillDecisionProjection(), model, [], JSON.stringify(cursor)),
      endGameHud: { stats: null, defectorNames: null },
      endGame: reduceEndGame(structuredClone(EMPTY_END_GAME), endGameFrameFromServer(model)),
      board: reduceBoardProjection({ ...createBoardProjection(), turnKey: boardTurnKey(model) }, model, {
        reports: [], recoveringPlayers: [], acknowledgedActingId: model.actingPlayer?.playerId ?? null,
        followupAttackerId: model.dialogParameter?.dialogId === 'followupChoice' ? model.actingPlayer?.playerId ?? null : null,
      }),
    },
  };
  validateSpectatorCheckpoint(result);
  return trust(result);
}

/** No clocks, timers, reactive state, audio, renderer calls or network capabilities. */
export function reduceSpectatorCheckpoint(previous: SpectatorCheckpoint, event: SpectatorEvent): SpectatorCheckpoint {
  const clockOnly = event.command.netCommandId === NetCommandId.SERVER_GAME_TIME;
  if (!sameSpectatorIdentity(previous.cursor, event.cursor) || event.cursor.sequence !== previous.cursor.sequence + (clockOnly ? 0 : 1)) {
    throw new Error('Spectator event is not the next event in this segment');
  }
  // Inputs are trusted: every `previous` is a validated OUTPUT (seed, reduce, or a clock-only spread of one), so the
  // input check was pure cost — a 255-event seek paid 541 ms with both checks vs 397 ms with one (09-13 bench).
  const command = event.command;
  if (clockOnly) {
    const gameTime = Number(command.gameTime);
    const turnTime = Number(command.turnTime);
    if (!Number.isFinite(gameTime) || !Number.isFinite(turnTime)) throw new Error('Invalid spectator clock');
    if (!Number.isFinite(event.receivedMonotonicAt)) throw new Error('Invalid spectator clock receipt');
    return withSpectatorClock(previous, { gameTime, turnTime, receivedMonotonicAt: event.receivedMonotonicAt });
  }
  // Perf 09-14: the durable log (up to 500 frozen rows, ~2/3 of the checkpoint's bytes) is append-only and every
  // row is deep-frozen, so the next checkpoint shares the row objects and clones only the model + projections.
  const previousLog = previous.durableProjection.log;
  const clonedProjection = structuredClone({ ...previous.durableProjection, log: [] }) as DurableProjection;
  const next: SpectatorCheckpoint = {
    ...previous, model: structuredClone(previous.model), clock: previous.clock && { ...previous.clock },
    durableProjection: Object.fromEntries(Object.keys(previous.durableProjection).map((key) =>
      [key, key === 'log' ? previousLog.slice() : clonedProjection[key as keyof DurableProjection]])) as unknown as DurableProjection,
  };
  next.cursor = { ...event.cursor };
  if (event.clock !== undefined) next.clock = structuredClone(event.clock);
  applyReplayCommand(next.model, command);
  if (typeof command.gameTime === 'number' && typeof command.turnTime === 'number') {
    if (!Number.isFinite(command.gameTime) || !Number.isFinite(command.turnTime)) throw new Error('Invalid spectator clock');
    next.clock = { gameTime: command.gameTime, turnTime: command.turnTime, receivedMonotonicAt: event.receivedMonotonicAt };
  }
  const projection = next.durableProjection;
  const reports = (command.reportList as { reports?: Record<string, unknown>[] } | undefined)?.reports ?? [];
  const changes = (command.modelChangeList as { modelChangeArray?: { modelChangeId?: string; modelChangeKey?: unknown; modelChangeValue?: unknown }[] } | undefined)?.modelChangeArray ?? [];
  projection.movementOccurrence = reduceObservedMovementOccurrence(
    previous.durableProjection.movementOccurrence,
    previous.model,
    next.model,
    changes,
    reports,
    event.cursor.sequence,
  );
  projection.kickoffWeather = kickoffWeatherPresentation(
    previous.durableProjection.kickoffWeather,
    reports,
    next.model,
    previous.model,
  ).context;
  projection.turnPresentation = turnPresentation(
    previous.durableProjection.turnPresentation,
    captureTurnPresentationBefore(previous.model),
    next.model,
    reports,
  ).context;
  projection.ballProjectile = ballProjectilePresentation(command as Record<string, unknown>, reports, next.model, {
    playback: 'pacedReplay', previous: previous.durableProjection.ballProjectile,
    priorCoordinates: new Map(previous.model.fieldModel.playerDataArray.map((player) => [player.playerId, player.playerCoordinate])),
    fallbackThrownPlayerId: (next.model as { defenderId?: string }).defenderId,
  }).context;
  const pushContext = new Map<string, PendingPush>(previous.durableProjection.pendingPushes.map((p) => [p.playerId, { from: p.from, age: p.age }]));
  const pushes = pushPresentation(pushContext, reports, next.model, new Map(previous.model.fieldModel.playerDataArray.map((p) => [p.playerId, p.playerCoordinate])));
  projection.followup = reduceFollowupProjection(previous.durableProjection.followup, previous.model, next.model, pushes.lastFrom, reports);
  projection.pendingPushes = [...pushes.pending].map(([playerId, pending]) => ({ playerId, from: pending.from, age: pending.age }));
  if (reports.some((r) => r.reportId === 'pushback' || r.reportId === 'blockChoice')) projection.provenance.pushes = 'observed';
  const hint = reports.find((r) => ['block', 'blockChoice', 'blockRoll'].includes(String(r.reportId)) && typeof r.defenderId === 'string');
  if (hint) setBlockDefenderHint(String(hint.defenderId), projection.logContext);
  const injuries = new Set<string>();
  for (const report of reports) {
    const signature = JSON.stringify(report);
    // A local receive occurrence is authoritative when no server identity is available.
    // Never collapse reports across two distinct unnumbered events.
    const sameCommand = (command.commandNr != null && command.commandNr === projection.reportDedupe.commandNr)
      || event.cursor.sequence === projection.reportDedupe.sourceSequence;
    if (signature === projection.reportDedupe.signature && sameCommand) continue;
    projection.reportDedupe = { signature, commandNr: command.commandNr ?? null, sourceSequence: event.cursor.sequence };
    const injury = injuryReportDedupeKey(report);
    if (injury && injuries.has(injury)) continue;
    if (injury) injuries.add(injury);
    // Always advance formatter context, even when the normal log filters this report.
    const lines = formatReportLines(report, next.model, projection.logContext);
    const id = String(report.reportId);
    if (reportCarriesDisplayedDice(report) || ['modifiedDodgeResultSuccessful', 'modifiedPassResult', 'coinThrow'].includes(id)
      || (id === 'playerEvent' && typeof report.message === 'string' && report.message.trim())) {
      projection.log.push(...lines.map((line) => ({ ...line, receivedWallAt: event.receivedWallAt, ingressOrder: event.ingressOrder ?? event.cursor.sequence, source: { ...event.cursor } })));
    }
  }
  projection.block = reduceBlockContext(projection.block, next.model, reports, new Map(previous.model.fieldModel.playerDataArray.map((p) => [p.playerId, p.playerCoordinate])));
  projection.log = projection.log.slice(-500);
  projection.drive = reduceDriveProjection(projection.drive, reports, next.model);
  projection.heldTeamMate = reduceHeldTeamMate(projection.heldTeamMate, new Map(previous.model.fieldModel.playerDataArray.map((p) => [p.playerId, p.playerCoordinate])), next.model);
  projection.fumblerooskie = reduceFumblerooskie(projection.fumblerooskie, reports, next.model);
  projection.dodgySnackPlayers = reduceDodgySnackPlayers(projection.dodgySnackPlayers, reports, next.model);
  projection.gazeVictimIds = reduceGazeVictims(projection.gazeVictimIds, reports, next.model);
  if (reports.some((r) => r.reportId === 'hypnoticGazeRoll' && r.successful === true && typeof r.defenderId === 'string')) projection.provenance.gaze = 'observed';
  projection.recoveringIds = reduceRecoveringPlayers(projection.recoveringIds, stunnedPlayerIds(previous.model), next.model);
  if (projection.recoveringIds.length) projection.provenance.recovering = 'observed';
  projection.board = reduceBoardProjection(projection.board, next.model, {
    reports, recoveringPlayers: projection.recoveringIds, acknowledgedActingId: next.model.actingPlayer?.playerId ?? null,
    followupAttackerId: next.model.dialogParameter?.dialogId === 'followupChoice' ? next.model.actingPlayer?.playerId ?? null : null,
  });
  const model = next.model;
  projection.blitz = reduceBlitzProjection(projection.blitz, model, projection.block);
  const newDialog = changes.some((change) => change.modelChangeId === 'gameSetDialogParameter');
  projection.pendingDecision = decision(model, event.cursor, newDialog ? null : projection.pendingDecision);
  const pending = projection.pendingDecision;
  // A reported answer may leave the raw dialog standing. Only a fresh dialog push creates another offer.
  if (!newDialog && pending?.state === 'offered' && reports.some((r) => {
    if (typeof r.playerId !== 'string' || r.playerId !== pending.playerId) return false;
    if (['reRoll', 'reRollProperties'].includes(pending.type)) return r.reportId === 'reRoll';
    if (pending.type === 'skillUse') return r.reportId === 'skillUse' && String(r.skill ?? '') === String(pending.payload.skill ?? '');
    return false;
  })) pending.state = 'resolved';
  projection.skillDecision = reduceSkillDecisionProjection(projection.skillDecision, model, reports, JSON.stringify(pending?.source ?? event.cursor));
  projection.actionRolls = reduceActionRollProjection(projection.actionRolls, reports, model);
  const injuryCoordinates = new Map<string, readonly number[] | null>(previous.model.fieldModel.playerDataArray.map((p) => [p.playerId, p.playerCoordinate]));
  for (const report of reports) {
    const playerId = String(report.defenderId ?? report.playerId ?? '');
    const destination = observedFailedMovementDestination(projection.movementOccurrence, playerId);
    if (destination) injuryCoordinates.set(playerId, destination);
  }
  projection.injuryOutcomes = reduceInjuryOutcomes(projection.injuryOutcomes, projection.casualtyRolls, reports, model, injuryCoordinates);
  projection.casualtyRolls = reduceCasualtyRollProjection(projection.casualtyRolls, reports, model);
  projection.apothecaryResult = model.dialogParameter?.dialogId === 'apothecaryChoice' ? buildApothecaryResult(model, model.dialogParameter, projection.casualtyRolls) : null;
  projection.apothecaryCard = projection.pendingDecision?.state === 'offered' ? apothecaryDecisionFromModel(model) : null;
  projection.blockCard = ['blockRoll', 'blockRollProperties', 'blockRollPartialReRoll'].includes(String(model.dialogParameter?.dialogId)) ? buildBlockDecision(model, model.dialogParameter!, true) : null;
  projection.reRollCard = projection.pendingDecision?.state === 'offered' && ['reRoll', 'reRollProperties'].includes(String(model.dialogParameter?.dialogId)) ? buildReRollDecision(model, model.dialogParameter!, projection.actionRolls) : null;
  projection.endGameHud = reduceEndGameHud(projection.endGameHud, reports, model);
  projection.endGame = reduceEndGame(projection.endGame, endGameFrameFromServer(model, command));
  const observed = projection.provenance;
  if (projection.log.length) observed.log = 'observed';
  if (projection.actionRolls.players.length) observed.actionRolls = 'observed';
  if (projection.casualtyRolls.players.length) observed.casualtyRolls = 'observed';
  if (projection.injuryOutcomes.players.length) observed.injuryOutcomes = 'observed';
  if (projection.block.attackerId || projection.block.defenderId) observed.block = 'observed';
  if (projection.fumblerooskie) observed.fumblerooskie = 'observed';
  if (projection.dodgySnackPlayers.length) observed.dodgySnack = 'observed';
  if (projection.skillDecision.current && Object.keys(projection.skillDecision.current.details).length) observed.skillDecision = 'observed';
  if (projection.endGameHud.stats || projection.endGameHud.defectorNames) observed.endGameHud = 'observed';
  // Validate the OUTPUT: a projection the validator rejects must fail at the event that produced it (09-12: a
  // committed-but-invalid head failed one event later as a bare reducer error and stalled the live reader).
  validateSpectatorCheckpoint(next);
  return trust(next);
}

/** Log rows that already passed every row-local check. Rows are only remembered once deep-frozen (the row, its
 *  four token arrays and every token), so a remembered row cannot change; the cursor-relative `source` check
 *  still runs on every validation. */
const validatedLogRows = new WeakSet<object>();
const deepFrozenRow = (entry: SpectatorLogEntry): boolean => Object.isFrozen(entry) && Object.isFrozen(entry.source)
  && [entry.d6, entry.blockDice, entry.names, entry.tags].every((tokens) => Object.isFrozen(tokens) && tokens.every((token) => Object.isFrozen(token)));

export function validateSpectatorCheckpoint(value: SpectatorCheckpoint): void {
  if (trustedCheckpoints.has(value)) return;
  if (value.durableProjection?.version !== 1) throw new Error('Unsupported spectator checkpoint schema');
  assertJson(value);
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const keys = (item: object, expected: string[]) => Object.keys(item).sort().join(',') === expected.sort().join(',');
  const nullableString = (item: unknown) => item === null || typeof item === 'string';
  const finite = (item: unknown) => typeof item === 'number' && Number.isFinite(item);
  const strings = (item: unknown) => Array.isArray(item) && item.every((entry) => typeof entry === 'string');
  const numbers = (item: unknown) => Array.isArray(item) && item.every(finite);
  const validCursor = (c: SpectatorCursor) => object(c) && keys(c, ['sessionId', 'connectionGeneration', 'segmentId', 'sequence'])
    && typeof c.sessionId === 'string' && c.sessionId.length > 0
    && [c.connectionGeneration, c.segmentId, c.sequence].every((n) => Number.isSafeInteger(n) && n >= 0);
  const source = (c: SpectatorCursor) => validCursor(c) && sameSpectatorIdentity(c, value.cursor) && c.sequence <= value.cursor.sequence;
  const oneOf = (list: readonly string[], item: unknown) => typeof item === 'string' && list.includes(item);
  const fail = (check: number): never => { throw new Error(`Invalid spectator checkpoint (check ${check})`); };
  if (!keys(value, ['model', 'durableProjection', 'clock', 'cursor', 'segmentId']) || !validCursor(value.cursor)
    || value.segmentId !== value.cursor.segmentId || !object(value.model)) fail(1);
  const model = value.model;
  if (![model.teamHome, model.teamAway, model.turnDataHome, model.turnDataAway, model.fieldModel, model.actingPlayer, model.gameResult].every(object)
    || !Array.isArray(model.teamHome.playerArray) || !Array.isArray(model.teamAway.playerArray)
    || !Array.isArray(model.fieldModel.playerDataArray)) fail(2);
  const p = value.durableProjection;
  if (!keys(p, ['version', 'provenance', 'followup', 'pendingPushes', 'movementOccurrence', 'kickoffWeather', 'turnPresentation', 'ballProjectile', 'reportDedupe', 'logContext', 'log', 'pendingDecision', 'reRollCard', 'blockCard', 'apothecaryCard', 'casualtyRolls', 'injuryOutcomes', 'apothecaryResult', 'gazeVictimIds', 'recoveringIds', 'blitz', 'block', 'endGame', 'endGameHud', 'actionRolls', 'skillDecision', 'board', 'heldTeamMate', 'fumblerooskie', 'dodgySnackPlayers', 'drive'])) fail(3);
  if (!object(p.drive) || !keys(p.drive, ['offenseIsHome', 'provenance']) || typeof p.drive.offenseIsHome !== 'boolean' || !oneOf(DRIVE_PROVENANCES, p.drive.provenance)) fail(4);
  if (!strings(p.dodgySnackPlayers)) fail(5);
  const held = p.heldTeamMate;
  if (held !== null && (!object(held) || !keys(held, ['thrownId', 'throwerId', 'fromSquare'])
    || typeof held.thrownId !== 'string' || typeof held.throwerId !== 'string'
    || !numbers(held.fromSquare) || held.fromSquare.length !== 2)) fail(6);
  const fumble = p.fumblerooskie;
  if (fumble !== null && (!object(fumble) || !keys(fumble, ['playerId']) || typeof fumble.playerId !== 'string')) fail(7);
  if (!object(p.board) || !keys(p.board, ['playingIsHome', 'sawActiveBit', 'turnKey', 'activePlayerId', 'actedPlayers'])
    || !(p.board.playingIsHome === null || typeof p.board.playingIsHome === 'boolean') || typeof p.board.sawActiveBit !== 'boolean'
    || typeof p.board.turnKey !== 'string' || !nullableString(p.board.activePlayerId) || !strings(p.board.actedPlayers)) fail(8);
  if (!object(p.provenance) || !keys(p.provenance, [...REPORT_PROVENANCE_FIELDS])
    || !Object.values(p.provenance).every((v) => oneOf(REPORT_PROVENANCE_VALUES, v))) fail(9);
  if (!object(p.reportDedupe) || !keys(p.reportDedupe, ['signature', 'commandNr', 'sourceSequence']) || !nullableString(p.reportDedupe.signature)
    || !(p.reportDedupe.commandNr === null || Number.isSafeInteger(p.reportDedupe.commandNr))
    || !Number.isSafeInteger(p.reportDedupe.sourceSequence) || p.reportDedupe.sourceSequence < 0 || p.reportDedupe.sourceSequence > value.cursor.sequence) fail(10);
  if (!object(p.logContext) || !keys(p.logContext, ['lastBlockAttackerId', 'lastBlockDefenderId', 'lastBlockChoosingTeamId'])
    || !Object.values(p.logContext).every(nullableString) || !strings(p.gazeVictimIds) || !strings(p.recoveringIds)) fail(11);
  if (value.clock !== null && (!object(value.clock) || !keys(value.clock, ['gameTime', 'turnTime', 'receivedMonotonicAt']) || !Object.values(value.clock).every(finite))) fail(12);
  if (!Array.isArray(p.log) || p.log.length > 500) fail(13);
  for (const entry of p.log) {
    if (!object(entry) || !source(entry.source as SpectatorCursor)) fail(14);
    if (validatedLogRows.has(entry)) continue;
    if (!keys(entry, ['text', 'd6', 'blockDice', 'names', 'tags', 'receivedWallAt', 'ingressOrder', 'source']) || typeof entry.text !== 'string'
      || ![entry.d6, entry.blockDice, entry.names, entry.tags].every(Array.isArray) || !finite(entry.receivedWallAt) || !Number.isSafeInteger(entry.ingressOrder) || entry.ingressOrder < 0) fail(14);
    for (const tokens of [entry.d6, entry.blockDice, entry.names, entry.tags]) for (const token of tokens) {
      if (!object(token) || !Number.isInteger(token.index) || Number(token.index) < 0 || Number(token.index) >= entry.text.length) fail(15);
    }
    if (entry.d6.some((t) => !keys(t, ['index', 'value', 'kind']) || !Number.isInteger(t.value) || t.value < 1 || t.value > 6 || !oneOf(D6_LOG_TOKEN_KINDS, t.kind))
      || entry.blockDice.some((t) => !keys(t, ['index', 'value', 'result']) || !Number.isInteger(t.value) || t.value < 1 || t.value > 6 || typeof t.result !== 'string')
      || entry.tags.some((t) => !keys(t, ['index', 'length', 'kind']) || !Number.isInteger(t.length) || t.length < 0 || t.index + t.length > entry.text.length
        || !oneOf(LOG_TAG_KINDS, t.kind))
      || entry.names.some((t) => !Number.isInteger(t.length) || t.length < 0 || t.index + t.length > entry.text.length || !oneOf(TEAM_SIDES, t.team))) fail(16);
    if (deepFrozenRow(entry)) validatedLogRows.add(entry);
  }
  const follow = p.followup;
  const pitchSquare = (v: unknown) => Array.isArray(v) && numbers(v) && v.length === 2 && v.every(Number.isInteger) && v[0]! >= 0 && v[0]! < 26 && v[1]! >= 0 && v[1]! < 15;
  if (!object(follow) || !keys(follow, ['attackerId', 'defenderId', 'vacated', 'pending', 'outcome'])
    || ![follow.attackerId, follow.defenderId].every(v => v === null || typeof v === 'string')
    || !(follow.vacated === null || pitchSquare(follow.vacated))) fail(17);
  if (follow.pending !== null && (!object(follow.pending) || !keys(follow.pending, ['attackerId', 'from', 'vacated', 'resolvingAge'])
    || typeof follow.pending.attackerId !== 'string' || !pitchSquare(follow.pending.from) || !pitchSquare(follow.pending.vacated)
    || !Number.isInteger(follow.pending.resolvingAge) || follow.pending.resolvingAge < 0 || follow.pending.resolvingAge > 2)) fail(18);
  if (follow.outcome !== null && (!object(follow.outcome) || !keys(follow.outcome, ['attackerId', 'square', 'followed'])
    || typeof follow.outcome.attackerId !== 'string' || !pitchSquare(follow.outcome.square) || typeof follow.outcome.followed !== 'boolean')) fail(19);
  if (!Array.isArray(p.pendingPushes)) fail(20);
  const pushIds = new Set<string>();
  for (const push of p.pendingPushes) {
    if (!object(push) || !keys(push, ['playerId', 'from', 'age']) || typeof push.playerId !== 'string' || pushIds.has(push.playerId)
      || !value.model.fieldModel.playerDataArray.some((player) => player.playerId === push.playerId)
      || !numbers(push.from) || push.from.length !== 2 || push.from[0]! < 0 || push.from[0]! >= 26 || push.from[1]! < 0 || push.from[1]! >= 15
      || !Number.isInteger(push.age) || push.age < 0 || push.age > 6) fail(21);
    pushIds.add(push.playerId);
  }
  const movement = p.movementOccurrence;
  if (movement !== null) {
    if (!object(movement) || !keys(movement, ['playerId', 'from', 'to', 'phase', 'observedAt', 'failedAt', 'injuryAt'])
      || typeof movement.playerId !== 'string' || !movement.playerId || !pitchSquare(movement.from) || !pitchSquare(movement.to)
      || !oneOf(OBSERVED_MOVEMENT_PHASES, movement.phase) || !Number.isSafeInteger(movement.observedAt)
      || movement.observedAt < 0 || movement.observedAt > value.cursor.sequence
      || !(movement.failedAt === null || (Number.isSafeInteger(movement.failedAt) && movement.failedAt >= movement.observedAt && movement.failedAt <= value.cursor.sequence))
      || !(movement.injuryAt === null || (Number.isSafeInteger(movement.injuryAt) && movement.failedAt !== null && movement.injuryAt >= movement.failedAt && movement.injuryAt <= value.cursor.sequence))
      || (movement.phase === 'observed' && (movement.failedAt !== null || movement.injuryAt !== null))
      || (movement.phase === 'failed' && (movement.failedAt === null || movement.injuryAt !== null))
      || (movement.phase === 'injury' && movement.injuryAt === null)) fail(22);
  }
  const kickoff = p.kickoffWeather;
  if (!object(kickoff) || !keys(kickoff, ['kickingSide', 'pendingWinner', 'weatherMageRoll', 'pendingPrayerEffects'])
    || !(kickoff.kickingSide === null || oneOf(TEAM_SIDES, kickoff.kickingSide))
    || !(kickoff.weatherMageRoll === null || numbers(kickoff.weatherMageRoll))
    || !Array.isArray(kickoff.pendingPrayerEffects)
    || kickoff.pendingPrayerEffects.some((pending) => !object(pending) || !keys(pending, ['roll', 'team'])
      || !Number.isInteger(pending.roll) || pending.roll < 1 || pending.roll > 16 || typeof pending.team !== 'string')) fail(23);
  if (kickoff.pendingWinner !== null && (!object(kickoff.pendingWinner) || !keys(kickoff.pendingWinner, ['result', 'roll'])
    || typeof kickoff.pendingWinner.result !== 'string' || !numbers(kickoff.pendingWinner.roll))) fail(24);
  const turn = p.turnPresentation;
  if (!object(turn) || !keys(turn, ['turnoverArmed', 'turnoverAfterInjury'])
    || typeof turn.turnoverArmed !== 'boolean' || typeof turn.turnoverAfterInjury !== 'boolean'
    || (turn.turnoverAfterInjury && !turn.turnoverArmed)) fail(25);
  const flight = p.ballProjectile;
  if (!object(flight) || !keys(flight, ['passAwaitingAuthoritativeThrow', 'passOrigin', 'kickAwaitingAuthoritativeThrow', 'kickPreview'])
    || typeof flight.passAwaitingAuthoritativeThrow !== 'boolean' || typeof flight.kickAwaitingAuthoritativeThrow !== 'boolean'
    || !(flight.passOrigin === null || pitchSquare(flight.passOrigin))
    || (flight.passAwaitingAuthoritativeThrow !== (flight.passOrigin !== null))) fail(26);
  if (flight.kickPreview !== null && (!object(flight.kickPreview)
    || !keys(flight.kickPreview, ['direction', 'directionRoll', 'distanceRoll', 'unreducedEndpoint', 'kickArc'])
    || typeof flight.kickPreview.direction !== 'string' || !Number.isInteger(flight.kickPreview.directionRoll)
    || !Number.isInteger(flight.kickPreview.distanceRoll) || !numbers(flight.kickPreview.unreducedEndpoint)
    || flight.kickPreview.unreducedEndpoint.length !== 2 || flight.kickPreview.kickArc !== null)) fail(27);
  if (flight.kickAwaitingAuthoritativeThrow !== (flight.kickPreview !== null)) fail(28);
  if (!object(p.injuryOutcomes) || !keys(p.injuryOutcomes, ['players']) || !Array.isArray(p.injuryOutcomes.players)) fail(29);
  const outcomeIds = new Set<string>();
  for (const entry of p.injuryOutcomes.players) {
    if (!object(entry) || !keys(entry, ['playerId', 'injury', 'roll', 'square']) || typeof entry.playerId !== 'string' || typeof entry.injury !== 'string' || outcomeIds.has(entry.playerId)
      || !(entry.roll === null || finite(entry.roll)) || !(entry.square === null || (numbers(entry.square) && entry.square.length === 2))) fail(30);
    outcomeIds.add(entry.playerId);
  }
  if (!object(p.casualtyRolls) || !keys(p.casualtyRolls, ['players']) || !Array.isArray(p.casualtyRolls.players)) fail(31);
  const casualtyIds = new Set<string>();
  for (const entry of p.casualtyRolls.players) {
    if (!object(entry) || !keys(entry, ['playerId', 'oldRoll', 'newRoll']) || typeof entry.playerId !== 'string' || casualtyIds.has(entry.playerId)
      || ![entry.oldRoll, entry.newRoll].every((v) => v === null || finite(v))) fail(32);
    casualtyIds.add(entry.playerId);
  }
  const skill = p.skillDecision;
  const scatterValid = (v: unknown) => object(v) && keys(v, ['ordinal', 'direction', 'showNeverUse'])
    && Number.isInteger(v.ordinal) && Number(v.ordinal) >= 1 && Number(v.ordinal) <= 3 && typeof v.direction === 'string' && !!v.direction.trim() && typeof v.showNeverUse === 'boolean';
  if (!object(skill) || !keys(skill, ['current', 'lastScatter'])) fail(33);
  if (skill.lastScatter !== null && (!object(skill.lastScatter) || !keys(skill.lastScatter, ['occurrence', 'gameId', 'playerId', 'context'])
    || ![skill.lastScatter.occurrence, skill.lastScatter.gameId, skill.lastScatter.playerId].every((v) => typeof v === 'string') || !scatterValid(skill.lastScatter.context))) fail(34);
  if (skill.current !== null) {
    const c = skill.current;
    if (!object(c) || !keys(c, ['occurrence', 'playerId', 'skill', 'details']) || ![c.occurrence, c.playerId, c.skill].every((v) => typeof v === 'string') || !object(c.details)) fail(35);
    const d = c.details;
    if (Object.keys(d).some((k) => !['roll', 'result', 'needed', 'injuryResult', 'armorDice', 'hmpScatter'].includes(k))
      || ('roll' in d && !finite(d.roll)) || ('needed' in d && !finite(d.needed))
      || ('result' in d && !oneOf(PASS_RE_ROLL_RESULTS, d.result))
      || ('injuryResult' in d && !oneOf(INJURY_RESULT_NAMES, d.injuryResult))
      || ('armorDice' in d && (!Array.isArray(d.armorDice) || d.armorDice.length !== 2 || !d.armorDice.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)))
      || ('hmpScatter' in d && !scatterValid(d.hmpScatter))) fail(36);
  }
  const result = p.apothecaryResult;
  if (result !== null && (!object(result) || !keys(result, ['playerId', 'player', 'side', 'square', 'oldInjury', 'newInjury', 'oldRoll', 'newRoll'])
    || ![result.playerId, result.player, result.oldInjury, result.newInjury].every((v) => typeof v === 'string') || !oneOf(TEAM_SIDES, result.side)
    || !(result.square === null || (numbers(result.square) && result.square.length === 2)) || ![result.oldRoll, result.newRoll].every((v) => v === null || finite(v)))) fail(37);
  const apo = p.apothecaryCard;
  if (apo !== null) {
    const injuryKeys = ['index', 'playerId', 'player', 'side', 'square', 'base', 'outcome', 'injury', 'offeredTypes', 'options'];
    if (!object(apo) || !keys(apo, ['kind', 'teamId', ...injuryKeys, 'noneLabel', 'coach', 'injuries'])
      || !oneOf(APOTHECARY_OFFER_KINDS, apo.kind) || !nullableString(apo.teamId) || typeof apo.coach !== 'string'
      || !oneOf(APOTHECARY_NONE_LABELS, apo.noneLabel) || !Array.isArray(apo.injuries) || !apo.injuries.length) fail(38);
    for (const injury of [apo, ...apo.injuries]) {
      if (!object(injury) || (injury !== apo && !keys(injury, injuryKeys)) || !Number.isInteger(injury.index) || injury.index < 0
        || ![injury.playerId, injury.player, injury.injury].every((v) => typeof v === 'string') || !oneOf(TEAM_SIDES, injury.side)
        || !Number.isInteger(injury.base) || !oneOf(APOTHECARY_OUTCOMES, injury.outcome)
        || !(injury.square === null || (numbers(injury.square) && injury.square.length === 2)) || !strings(injury.offeredTypes)
        || !injury.offeredTypes.every((t) => oneOf(APOTHECARY_TYPES, t)) || !Array.isArray(injury.options)
        || injury.options.some((o) => !object(o) || !keys(o, ['type', 'label']) || typeof o.label !== 'string' || !(o.type === null || oneOf(APOTHECARY_TYPES, o.type)))) fail(39);
    }
  }
  const blockCard = p.blockCard;
  if (blockCard !== null) {
    const bools = ['pickable', 'opponentRerollPending', 'chooserTeamRerollAvailable', 'teamRR', 'mascot', 'mascotTrr', 'pro', 'brawler', 'consummate'] as const;
    const labels = ['consummateLabel', 'singleBlockDie', 'singleBlockDieLabel', 'multiBlockDice', 'multiBlockDiceLabel', 'singleSkull', 'singleSkullLabel'] as const;
    if (!object(blockCard) || !keys(blockCard, ['dice', 'nrOfDice', ...bools, ...labels]) || !numbers(blockCard.dice) || !finite(blockCard.nrOfDice)
      || !bools.every((k) => typeof blockCard[k] === 'boolean') || !labels.every((k) => nullableString(blockCard[k]))) fail(40);
  }
  const card = p.reRollCard;
  if (card !== null) {
    const required = ['playerId', 'reRolledAction', 'label', 'options', 'title', 'question', 'messages', 'fumble', 'loner', 'thresholdless'];
    const optional = ['result', 'roll', 'needed', 'lonerValue'];
    if (!object(card) || required.some((k) => !(k in card)) || Object.keys(card).some((k) => ![...required, ...optional].includes(k))
      || ![card.playerId, card.reRolledAction, card.label, card.title, card.question].every((v) => typeof v === 'string') || !strings(card.messages)
      || ![card.fumble, card.loner, card.thresholdless].every((v) => typeof v === 'boolean') || !Array.isArray(card.options)) fail(41);
    if (card.options.some((o) => !object(o) || !keys(o, ['label', 'source', 'response', 'role']) || typeof o.label !== 'string' || typeof o.source !== 'string'
      || !oneOf(RE_ROLL_RESPONSES, o.response) || !oneOf(RE_ROLL_OPTION_ROLES, o.role))) fail(42);
    if (('roll' in card && !finite(card.roll)) || ('needed' in card && !finite(card.needed)) || ('lonerValue' in card && typeof card.lonerValue !== 'string')
      || ('result' in card && !oneOf(PASS_RE_ROLL_RESULTS, card.result))) fail(43);
  }
  const d = p.pendingDecision;
  if (d !== null && (!object(d) || !keys(d, ['type', 'teamId', 'coach', 'playerId', 'skill', 'source', 'state', 'payload'])
    || typeof d.type !== 'string' || ![d.teamId, d.coach, d.playerId, d.skill].every(nullableString)
    || !source(d.source) || !oneOf(SPECTATOR_DECISION_STATES, d.state) || !object(d.payload))) fail(44);
  if (!object(p.block) || !keys(p.block, ['attackerId', 'defenderId', 'chosenDice', 'defenderSquare', 'rollOccurrence']) || !Number.isSafeInteger(p.block.rollOccurrence) || Number(p.block.rollOccurrence) < 0 || !nullableString(p.block.attackerId)
    || !(p.block.defenderSquare === null || (numbers(p.block.defenderSquare) && p.block.defenderSquare.length === 2)) || !nullableString(p.block.defenderId) || !(p.block.chosenDice === null || numbers(p.block.chosenDice))) fail(45);
  const b = p.blitz;
  if (b !== null && (!object(b) || !keys(b, ['id', 'targetId', 'side', 'turnKey', 'visible'])
    || ![b.id, b.targetId, b.turnKey].every((v) => typeof v === 'string') || typeof b.side !== 'boolean' || typeof b.visible !== 'boolean')) fail(46);
  const action = p.actionRolls;
  if (!object(action) || !keys(action, ['players']) || !Array.isArray(action.players)) fail(47);
  const playerIds = new Set<string>();
  for (const entry of action.players) {
    if (!object(entry) || !keys(entry, ['playerId', 'roll', 'needed', 'pass']) || typeof entry.playerId !== 'string' || playerIds.has(entry.playerId)
      || !(entry.roll === null || (Number.isInteger(entry.roll) && entry.roll >= 1 && entry.roll <= 6))
      || !(entry.needed === null || (finite(entry.needed) && entry.needed >= 2 && entry.needed <= 6))) fail(48);
    playerIds.add(entry.playerId);
    const pass = entry.pass;
    if (pass !== null && (!object(pass) || Object.keys(pass).some((k) => !['reportId', 'roll', 'minimumRoll', 'result', 'bomb'].includes(k))
      || !oneOf(PASS_ROLL_REPORT_IDS, pass.reportId) || !Number.isInteger(pass.roll) || pass.roll < 1 || pass.roll > 6 || typeof pass.bomb !== 'boolean'
      || ('minimumRoll' in pass && (typeof pass.minimumRoll !== 'number' || !finite(pass.minimumRoll) || pass.minimumRoll <= 0))
      || ('result' in pass && !oneOf(PASS_RE_ROLL_RESULTS, pass.result)))) fail(49);
  }
  const hud = p.endGameHud;
  if (!object(hud) || !keys(hud, ['stats', 'defectorNames']) || !(hud.defectorNames === null || strings(hud.defectorNames))) fail(50);
  const stats = hud.stats;
  if (stats !== null) {
    if (!object(stats) || !keys(stats, ['winningsHome', 'winningsAway', 'dedFans']) || ![stats.winningsHome, stats.winningsAway].every((v) => v === null || finite(v))) fail(51);
    const fans = stats.dedFans;
    if (fans !== null && (!object(fans) || !keys(fans, ['rollHome', 'modHome', 'rollAway', 'modAway', 'concededTeamId']) || ![fans.rollHome, fans.modHome, fans.rollAway, fans.modAway].every(finite) || !nullableString(fans.concededTeamId))) fail(52);
  }
  const end = p.endGame;
  if (!object(end) || !keys(end, Object.keys(EMPTY_END_GAME)) || !nullableString(end.gameId) || !Number.isSafeInteger(end.lastCommandNr)
    || !oneOf(END_GAME_PHASES, end.phase)
    || !nullableString(end.decisionInstanceKey) || ![end.finished, end.finalPresentationReady].every((v) => typeof v === 'boolean')
    || !strings(end.mvpHomeIds) || !strings(end.mvpAwayIds) || !Array.isArray(end.touchdownAwards) || !Array.isArray(end.defectors)
    || !Array.isArray(end.shootoutReports) || !end.shootoutReports.every(object)
    || !(end.dialog === null || object(end.dialog)) || !(end.dedicatedFans === null || object(end.dedicatedFans))
    || !(end.winnings === null || (object(end.winnings) && keys(end.winnings, ['home', 'away']) && Object.values(end.winnings).every(finite)))) fail(53);
  if (end.touchdownAwards.some((a) => !object(a) || !keys(a, ['playerId', 'text']) || typeof a.playerId !== 'string' || typeof a.text !== 'string')
    || end.defectors.some((d) => !object(d) || !keys(d, ['playerId', 'roll', 'defected']) || typeof d.playerId !== 'string' || !finite(d.roll) || typeof d.defected !== 'boolean')) fail(54);
}

/** Reject cycles, nonfinite numbers, non-JSON prototypes and values lost by JSON.stringify. */
export function assertJson(value: unknown, path = '$', ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (!value || typeof value !== 'object' || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)
    || ancestors.has(value)) throw new Error(`Non-JSON spectator value at ${path}`);
  ancestors.add(value);
  for (const [key, child] of Object.entries(value)) assertJson(child, `${path}.${key}`, ancestors);
  ancestors.delete(value);
}

export function spectatorCheckpointFingerprint(value: SpectatorCheckpoint): string {
  validateSpectatorCheckpoint(value);
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : item;
  return JSON.stringify(stable(value));
}
