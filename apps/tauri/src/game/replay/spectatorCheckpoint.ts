import { createFollowupProjection, reduceFollowupProjection, type FollowupProjection } from '../followupProjection';
import { LOG_TAG_KINDS } from '../logTags';
import { isLogActionPlate } from '../logActionPlates';
import { trimLogRows } from '../logLanes';
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
import { allBlockDiceIndices, blockRerollOutcome, rerolledBlockDiceIndices } from '../blockRerollTumble';
import { createTeamCaptainRowQueue } from '../teamCaptainLogOrder';
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
import { applyLogEasterEgg, logEventKey, createReportLogContext, formatReportLines, injuryReportDedupeKey, setBlockDefenderHint, playerActionDescription, activationCancelReport, noteActivationLogged, noteActivationActivity, openActivationBefore, type ReportDisplay, type ReportLogContext } from '../reportFormatter';
import { createUpstreamLogState, renderUpstreamReport, upstreamLinesText, validUpstreamLogLines, validUpstreamLogState, type UpstreamLogLine, type UpstreamLogState } from '../upstreamLog';
import { reportCarriesDisplayedDice } from '../d6Log';
import { EMPTY_END_GAME, reduceEndGame, type EndGameState } from '../endGameHandler';
import { endGameFrameFromServer } from '../endGameFrame';
import { applyReplayCommand, normalizeZappedPlayerSnapshots } from './replayModel';
import type { ReplayCommand } from './replayController';
import { boardTurnKey, createBoardProjection, reduceBoardProjection, type BoardProjection } from '../boardProjection';
import { observedFailedMovementDestination, reduceObservedMovementOccurrence, type ObservedMovementOccurrence } from '../movementOccurrenceProjection';
import { createKickoffWeatherContext, kickoffWeatherPresentation, type KickoffWeatherContext } from '../kickoffWeatherPresentation';
import { captureTurnPresentationBefore, createTurnPresentationContext, turnPresentation, TURN_RESCUE_CONTEXT_KEYS, type TurnPresentationContext } from '../turnPresentation';
import { ballProjectilePresentation, createBallProjectileContext, type BallProjectileContext } from '../ballProjectilePresentation';
import { blastinStaleRerollDialog } from '../blastinSecondBeat';
import { createThrownCrowdProjection, reduceThrownCrowdProjection, validThrownCrowdProjection, type ThrownCrowdProjection } from '../thrownCrowdBlood';

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
  /** Owner 10-15: a row only the Graphical log style shows (block flow push / skill use). */
  graphicalOnly?: true;
  /** Owner 10-16 (FUMBBL log style): the report's upstream lines on its first row ([] on the others). */
  u?: UpstreamLogLine[];
  /** Owner 10-16: a row only the FUMBBL log style shows (a report upstream prints that the Text log does not list). */
  upstreamOnly?: true;
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
  /** Owner 10-16 (FUMBBL log style): upstream's StatusReport bookkeeping (the indent carried from report to report). */
  upstreamLog: UpstreamLogState;
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
  /** Owner 10-20 (Astra P2-1): thrown team-mates' crowd-injury blood relocations (thrownCrowdBlood.ts). Optional so
   *  checkpoints written before it existed still validate. */
  thrownCrowd?: ThrownCrowdProjection;
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

/** S36 (upstream master e7f9858a1): the skillUse values a `reRollModifierChoice` modifier pick is reported with. */
const MODIFIER_CHOICE_SKILL_USES = new Set(['addDodgeModifier', 'addAgilityModifier', 'passDodgeWithoutModifiers', 'passJumpWithoutModifiers']);

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
      reportDedupe: { signature: null, commandNr: null, sourceSequence: cursor.sequence }, logContext: createReportLogContext(), upstreamLog: createUpstreamLogState(), log: [],
      injuryOutcomes: createInjuryOutcomeProjection(),
      casualtyRolls: createCasualtyRollProjection(),
      apothecaryResult: model.dialogParameter?.dialogId === 'apothecaryChoice' ? buildApothecaryResult(model, model.dialogParameter, createCasualtyRollProjection()) : null,
      apothecaryCard: apothecaryDecisionFromModel(model),
      blockCard: ['blockRoll', 'blockRollProperties', 'blockRollPartialReRoll'].includes(String(model.dialogParameter?.dialogId)) ? buildBlockDecision(model, model.dialogParameter!, true) : null,
      reRollCard: ['reRoll', 'reRollProperties', 'reRollModifierChoice'].includes(String(model.dialogParameter?.dialogId)) && !blastinStaleRerollDialog(model) ? buildReRollDecision(model, model.dialogParameter!, createActionRollProjection()) : null,
      followup: createFollowupProjection(), pendingPushes: [], movementOccurrence: null,
      kickoffWeather: createKickoffWeatherContext(model), turnPresentation: createTurnPresentationContext(),
      ballProjectile: createBallProjectileContext(),
      pendingDecision: decision(model, cursor, null), gazeVictimIds: [], recoveringIds: [], blitz: reduceBlitzProjection(null, model, { attackerId: null, defenderId: null }),
      drive: reduceDriveProjection(null, [], model),
      thrownCrowd: createThrownCrowdProjection(),
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
  // Owner 10-10 (g1951996 cmd 567, "Cannot assign to read only property 'targetSelectionStatusIsCommitted'"): the model
  // reducer stores object change values BY REFERENCE, so the checkpoint built below ends up holding the command's own
  // objects, and trust() deep-freezes them. A caller's mutable command (the store hands over the very frame command the
  // live game model was just reduced from) must therefore never be reduced directly: it would freeze objects the live
  // model still edits in place, and that frame is then dropped. The checkpoint owns what it freezes - an event that is
  // not already deep-frozen (history events are, and are shared with their checkpoints on purpose) is copied first.
  // (A clock sample is read for two numbers and never stored.)
  const command = clockOnly || deepFrozen(event.command) ? event.command : structuredClone(event.command) as ReplayCommand;
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
  // Owner 10-20: a Team Captain roll's rows follow the rerolled result (teamCaptainLogOrder), as the live log does
  const captainRows = createTeamCaptainRowQueue(reports);
  for (const [reportIndex, report] of reports.entries()) {
    captainRows.before(reportIndex);
    const signature = JSON.stringify(report);
    // A local receive occurrence is authoritative when no server identity is available.
    // Never collapse reports across two distinct unnumbered events.
    const sameCommand = (command.commandNr != null && command.commandNr === projection.reportDedupe.commandNr)
      || event.cursor.sequence === projection.reportDedupe.sourceSequence;
    if (signature === projection.reportDedupe.signature && sameCommand) continue;
    projection.reportDedupe = { signature, commandNr: command.commandNr ?? null, sourceSequence: event.cursor.sequence };
    // Owner 10-16 (FUMBBL log style): upstream's lines for every report in server order (its indent carries over)
    const upstream = renderUpstreamReport(report, next.model, projection.upstreamLog);
    const upstreamOnly = () => {
      if (upstream.length) {
        projection.log.push({ text: upstreamLinesText(upstream), d6: [], blockDice: [], names: [], tags: [], u: upstream, upstreamOnly: true,
          receivedWallAt: event.receivedWallAt, ingressOrder: event.ingressOrder ?? event.cursor.sequence, source: { ...event.cursor } });
      }
    };
    const injury = injuryReportDedupeKey(report);
    if (injury && injuries.has(injury)) { upstreamOnly(); continue; }
    if (injury) injuries.add(injury);
    // Always advance formatter context, even when the normal log filters this report.
    const activationOfRows = openActivationBefore(projection.logContext, report); // owner 10-16: before the formatter opens a new one
    const lines = applyLogEasterEgg(report, next.model, formatReportLines(report, next.model, projection.logContext),
      logEventKey(next.model, report));
    const id = String(report.reportId);
    if (reportCarriesDisplayedDice(report) || ['modifiedDodgeResultSuccessful', 'modifiedPassResult', 'coinThrow', 'handOver', 'apothecaryChoice', 'timeoutEnforced'].includes(id)
      || (id === 'playerAction' && !!playerActionDescription(report.playerAction)) // Astra 10-16: the declaration shows in replays too
      || (id === 'playerEvent' && typeof report.message === 'string' && report.message.trim())) {
      if (lines.length && captainRows.anchorOf(reportIndex) !== null) {
        // the captain's upstream lines stay at the wire position (FUMBBL-only entry); its rows wait for the result's
        upstreamOnly();
        captainRows.defer(reportIndex, () => projection.log.push(...lines.map((line) => ({ ...line, u: [], receivedWallAt: event.receivedWallAt, ingressOrder: event.ingressOrder ?? event.cursor.sequence, source: { ...event.cursor } }))));
      } else projection.log.push(...lines.map((line, index) => ({ ...line, u: index === 0 ? upstream : [], receivedWallAt: event.receivedWallAt, ingressOrder: event.ingressOrder ?? event.cursor.sequence, source: { ...event.cursor } })));
      noteActivationLogged(activationOfRows, lines.length); // owner 10-16: the same count the live log keeps (never the declaration's own row)
      if (!lines.length) upstreamOnly(); // FUMBBL-only rows never count as displayed rows of the activation
    } else if (['pushback', 'skillUse', 'skillUseOtherPlayer'].includes(id)) {
      // Owner 10-15 (Graphical block flow): steps only the Graphical style shows
      projection.log.push(...lines.filter((line) => line.g).map((line) => ({ ...line, graphicalOnly: true as const, receivedWallAt: event.receivedWallAt, ingressOrder: event.ingressOrder ?? event.cursor.sequence, source: { ...event.cursor } })));
      upstreamOnly();
    } else {
      upstreamOnly();
    }
  }
  captainRows.end();
  // Owner 10-13 (reroll re-tumble, Astra): the card before this frame and its roll occurrence, for rerolledDice below.
  const priorBlockCard = projection.blockCard;
  const priorBlockRollOccurrence = projection.block.rollOccurrence;
  projection.block = reduceBlockContext(projection.block, next.model, reports, new Map(previous.model.fieldModel.playerDataArray.map((p) => [p.playerId, p.playerCoordinate])));
  // Owner 10-16: the server cleared the acting player in this frame: an activation that logged nothing was cancelled
  noteActivationActivity(projection.logContext, changes);
  // StepPassBlock suspends (not cancels) the interrupted activation for a dump-off pass block (3.4.0)
  if (changes.some((ch) => ch.modelChangeId === 'actingPlayerSetPlayerId' && ch.modelChangeValue == null)
    && String(next.model.turnMode ?? '') !== 'dumpOffPassBlock') {
    const cancel = activationCancelReport(projection.logContext);
    if (cancel) {
      const lines = formatReportLines(cancel, next.model, projection.logContext);
      projection.log.push(...lines.map((line) => ({ ...line, receivedWallAt: event.receivedWallAt, ingressOrder: event.ingressOrder ?? event.cursor.sequence, source: { ...event.cursor } })));
    }
  }
  // owner 10-15: Graphical-only rows ride along without counting against the 500 ordinary rows (logLanes.trimLogRows)
  projection.log = trimLogRows(projection.log, 500, (row) => (row.graphicalOnly === true ? 'graphical' : row.upstreamOnly === true ? 'upstream' : false));
  projection.drive = reduceDriveProjection(projection.drive, reports, next.model);
  projection.thrownCrowd = reduceThrownCrowdProjection(projection.thrownCrowd ?? createThrownCrowdProjection(), command as Record<string, unknown>,
    ((previous.model.fieldModel.bloodspotArray ?? []) as unknown[]).length);
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
    // S36: a `reRollModifierChoice` resolves on a re-roll OR on the skillUse report(s) of the picked modifier option.
    if (pending.type === 'reRollModifierChoice') {
      return r.reportId === 'reRoll' || (r.reportId === 'skillUse' && r.used === true && MODIFIER_CHOICE_SKILL_USES.has(String(r.skillUse ?? '')));
    }
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
  const blockCard: BlockDecisionProjection | null = ['blockRoll', 'blockRollProperties', 'blockRollPartialReRoll'].includes(String(model.dialogParameter?.dialogId)) ? buildBlockDecision(model, model.dialogParameter!, true) : null;
  // Owner 10-13 (Astra): the published review re-tumbles exactly what live does. A card resent after a block reroll
  // carries the dice it replaced, [] after a failed use (the unchanged roll is resent with a blockRoll report, which
  // advances rollOccurrence); the same card keeps its value while it stands; a fresh roll carries none (all tumble).
  // Observer rules: no chooser command index here (rerolledBlockDiceIndices without ownIndices).
  if (blockCard) {
    const outcome = blockRerollOutcome(reports);
    if (outcome) {
      // owner 10-20: a failed Loner re-tumbles every die onto the faces the server resent (its original roll)
      if (outcome.lonerFailed) blockCard.lonerRetumble = true;
      blockCard.rerolledDice = outcome.lonerFailed ? allBlockDiceIndices(blockCard.dice.length) : outcome.rolled ? rerolledBlockDiceIndices({
        previous: priorBlockCard?.dice ?? null, next: blockCard.dice, rerolledFaces: outcome.faces, source: outcome.source,
      }) : [];
    } else if (projection.block.rollOccurrence === priorBlockRollOccurrence && priorBlockCard?.rerolledDice) {
      blockCard.rerolledDice = [...priorBlockCard.rerolledDice];
    }
  }
  projection.blockCard = blockCard;
  projection.reRollCard = projection.pendingDecision?.state === 'offered' && ['reRoll', 'reRollProperties', 'reRollModifierChoice'].includes(String(model.dialogParameter?.dialogId)) && !blastinStaleRerollDialog(model) ? buildReRollDecision(model, model.dialogParameter!, projection.actionRolls, false, undefined, projection.movementOccurrence) : null;
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
/** A log line's tokens (a Text row or its Graphical `g`): every token in range and in its exact shape. */
function validLogLineTokens(line: Pick<SpectatorLogEntry, 'text' | 'd6' | 'blockDice' | 'names' | 'tags'>): boolean {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const keys = (item: object, expected: string[]) => Object.keys(item).sort().join(',') === [...expected].sort().join(',');
  for (const tokens of [line.d6, line.blockDice, line.names, line.tags]) for (const token of tokens as unknown[]) {
    if (!object(token) || !Number.isInteger(token.index) || Number(token.index) < 0 || Number(token.index) >= line.text.length) return false;
  }
  // owner 10-13: an optional `team` (the server side that rolled the die) rides a d6 token;
  // owner 10-15: an optional `title` (an inline icon's tooltip, Graphical lines) rides a tag token
  return !(line.d6.some((t) => !(keys(t, ['index', 'value', 'kind']) || (keys(t, ['index', 'value', 'kind', 'team']) && TEAM_SIDES.includes((t as { team?: never }).team as never))) || !Number.isInteger(t.value) || t.value < 1 || t.value > 6 || !(D6_LOG_TOKEN_KINDS as readonly unknown[]).includes(t.kind))
    || line.blockDice.some((t) => !keys(t, ['index', 'value', 'result']) || !Number.isInteger(t.value) || t.value < 1 || t.value > 6 || typeof t.result !== 'string')
    || line.tags.some((t) => !(keys(t, ['index', 'length', 'kind']) || (keys(t, ['index', 'length', 'kind', 'title']) && typeof t.title === 'string'))
      || !Number.isInteger(t.length) || t.length < 0 || t.index + t.length > line.text.length || !(LOG_TAG_KINDS as readonly unknown[]).includes(t.kind))
    || line.names.some((t) => !(keys(t, ['index', 'length', 'team']) || (keys(t, ['index', 'length', 'team', 'playerId']) && typeof t.playerId === 'string'))
      || !Number.isInteger(t.length) || t.length < 0 || t.index + t.length > line.text.length || !TEAM_SIDES.includes(t.team as never)));
}

const deepFrozenLine = (line: { d6: unknown[]; blockDice: unknown[]; names: unknown[]; tags: unknown[] }): boolean => Object.isFrozen(line)
  && [line.d6, line.blockDice, line.names, line.tags].every((tokens) => Object.isFrozen(tokens) && tokens.every((token) => Object.isFrozen(token)));
const deepFrozenRow = (entry: SpectatorLogEntry): boolean => Object.isFrozen(entry) && Object.isFrozen(entry.source)
  && (entry.action === undefined || Object.isFrozen(entry.action))
  && (entry.alt === undefined || deepFrozenLine(entry.alt))
  && (entry.g === undefined || entry.g === null || entry.g.more === undefined || (Object.isFrozen(entry.g.more) && entry.g.more.every(deepFrozenLine)))
  && (entry.g === undefined || entry.g === null || (Object.isFrozen(entry.g) && [entry.g.d6, entry.g.blockDice, entry.g.names, entry.g.tags].every((tokens) => Object.isFrozen(tokens) && tokens.every((token) => Object.isFrozen(token)))))
  && [entry.d6, entry.blockDice, entry.names, entry.tags].every((tokens) => Object.isFrozen(tokens) && tokens.every((token) => Object.isFrozen(token)));

export function validateSpectatorCheckpoint(value: SpectatorCheckpoint): void {
  if (trustedCheckpoints.has(value)) return;
  if (value.durableProjection?.version !== 1) throw new Error('Unsupported spectator checkpoint schema');
  assertJson(value);
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const keys = (item: object, expected: string[]) => Object.keys(item).sort().join(',') === expected.sort().join(',');
  // `spp` (apothecary cards) is optional so checkpoints written before it existed still validate; when present it is null or {total, earned}.
  const withSpp = (item: object, expected: string[]) => keys(item, expected) || keys(item, [...expected, 'spp']);
  const validSpp = (item: object) => {
    const spp = (item as { spp?: unknown }).spp;
    if (!('spp' in item) || spp === null) return true;
    return object(spp) && keys(spp, ['total', 'earned']) && finite(spp.total) && finite(spp.earned) && (spp.earned as number) >= 0;
  };
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
  const projectionKeys = ['version', 'provenance', 'followup', 'pendingPushes', 'movementOccurrence', 'kickoffWeather', 'turnPresentation', 'ballProjectile', 'reportDedupe', 'logContext', 'upstreamLog', 'log', 'pendingDecision', 'reRollCard', 'blockCard', 'apothecaryCard', 'casualtyRolls', 'injuryOutcomes', 'apothecaryResult', 'gazeVictimIds', 'recoveringIds', 'blitz', 'block', 'endGame', 'endGameHud', 'actionRolls', 'skillDecision', 'board', 'heldTeamMate', 'fumblerooskie', 'dodgySnackPlayers', 'drive'];
  // owner 10-20: `thrownCrowd` is optional (checkpoints written before it existed)
  if (!keys(p, [...projectionKeys]) && !keys(p, [...projectionKeys, 'thrownCrowd'])) fail(3);
  if ('thrownCrowd' in p && !validThrownCrowdProjection(p.thrownCrowd)) fail(3);
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
  // owner 10-15: the Graphical-log latches are optional so checkpoints written before them still validate
  const contextKeys = object(p.logContext) ? Object.keys(p.logContext) : [];
  const requiredContextKeys = ['lastBlockAttackerId', 'lastBlockDefenderId', 'lastBlockChoosingTeamId'];
  const optionalContextKeys = ['lastHandOverCatcherId', 'lastRerollSource', 'lastRerollPlayerId', 'lastRerollTeamId', 'flowAttackerId', 'flowDefenderId', 'flowResult', 'flowPushed', 'activation'];
  // owner 10-16: the open activation (declaration head) rides the context as a small object, the other latches are strings
  const activation = (p.logContext as { activation?: unknown } | null)?.activation;
  const activationOk = activation === undefined || activation === null || (object(activation) && keys(activation, ['playerId', 'action', 'lines', 'acted'])
    && typeof activation.playerId === 'string' && typeof activation.action === 'string' && Number.isSafeInteger(activation.lines) && (activation.lines as number) >= 0 && typeof activation.acted === 'boolean');
  if (!object(p.logContext) || !requiredContextKeys.every((k) => contextKeys.includes(k))
    || !contextKeys.every((k) => requiredContextKeys.includes(k) || optionalContextKeys.includes(k))
    || !Object.entries(p.logContext).every(([k, v]) => k === 'activation' || nullableString(v)) || !activationOk || !strings(p.gazeVictimIds) || !strings(p.recoveringIds)) fail(11);
  if (value.clock !== null && (!object(value.clock) || !keys(value.clock, ['gameTime', 'turnTime', 'receivedMonotonicAt']) || !Object.values(value.clock).every(finite))) fail(12);
  if (!validUpstreamLogState(p.upstreamLog)) fail(11);
  const graphicalRow = (row: unknown) => !!(row as { graphicalOnly?: unknown }).graphicalOnly;
  const upstreamRow = (row: unknown) => !!(row as { upstreamOnly?: unknown }).upstreamOnly;
  if (!Array.isArray(p.log) || p.log.filter((row) => !graphicalRow(row) && !upstreamRow(row)).length > 500
    || p.log.filter(graphicalRow).length > 500 || p.log.filter(upstreamRow).length > 500) fail(13);
  for (const entry of p.log) {
    if (!object(entry) || !source(entry.source as SpectatorCursor)) fail(14);
    if (validatedLogRows.has(entry)) continue;
    // Owner 10-15: an optional `action` plate (kind + acting team's server side) and an optional Graphical-style line
    // `g` (null = left out in the Graphical style) ride a report's lines.
    const rowKeys = ['text', 'd6', 'blockDice', 'names', 'tags', 'receivedWallAt', 'ingressOrder', 'source'];
    const extraKeys = Object.keys(entry).filter((k) => !rowKeys.includes(k));
    if (!rowKeys.every((k) => k in entry) || !extraKeys.every((k) => k === 'action' || k === 'g' || k === 'graphicalOnly' || k === 'alt' || k === 'u' || k === 'upstreamOnly')
      || ('u' in entry && !validUpstreamLogLines(entry.u))
      || ('upstreamOnly' in entry && (entry as { upstreamOnly?: unknown }).upstreamOnly !== true)
      || ('alt' in entry && !(object(entry.alt) && keys(entry.alt as object, ['text', 'd6', 'blockDice', 'names', 'tags'])
        && typeof (entry.alt as { text?: unknown }).text === 'string'
        && [(entry.alt as { d6?: unknown }).d6, (entry.alt as { blockDice?: unknown }).blockDice, (entry.alt as { names?: unknown }).names, (entry.alt as { tags?: unknown }).tags].every(Array.isArray)
        && validLogLineTokens(entry.alt as never)))
      || ('graphicalOnly' in entry && (entry as { graphicalOnly?: unknown }).graphicalOnly !== true)
      || ('action' in entry && !isLogActionPlate(entry.action)) || typeof entry.text !== 'string'
      || ![entry.d6, entry.blockDice, entry.names, entry.tags].every(Array.isArray) || !finite(entry.receivedWallAt) || !Number.isSafeInteger(entry.ingressOrder) || entry.ingressOrder < 0) fail(14);
    if (!validLogLineTokens(entry)) fail(16);
    if ('g' in entry && entry.g !== null) {
      const g = entry.g as unknown;
      // a Graphical line, optionally expanding into further rows (`more`, one level, never nested)
      const graphicalLine = (line: unknown, allowMore: boolean): boolean => {
        if (!object(line)) return false;
        const base = ['text', 'd6', 'blockDice', 'names', 'tags', 'indent'];
        const hasMore = 'more' in line;
        const extras = ['join', 'joinPrevious'].filter((k) => k in line); // owner 10-16: the block-row join marks
        if (!(keys(line, [...base, ...extras]) || (allowMore && hasMore && keys(line, [...base, ...extras, 'more'])))) return false;
        const j = line as { join?: unknown; joinPrevious?: unknown };
        if ((j.join !== undefined && j.join !== 'block') || (j.joinPrevious !== undefined && j.joinPrevious !== 'block')) return false;
        const l = line as { text?: unknown; indent?: unknown; d6?: unknown; blockDice?: unknown; names?: unknown; tags?: unknown; more?: unknown };
        if (typeof l.text !== 'string' || ![0, 1, 2, 3].includes(l.indent as number) || ![l.d6, l.blockDice, l.names, l.tags].every(Array.isArray)) return false;
        if (!validLogLineTokens(line as unknown as SpectatorLogEntry)) return false;
        return !hasMore || (Array.isArray(l.more) && l.more.every((m) => graphicalLine(m, false)));
      };
      if (!graphicalLine(g, true)) fail(16);
    }
    if (deepFrozenRow(entry)) validatedLogRows.add(entry);
  }
  const follow = p.followup;
  const pitchSquare = (v: unknown) => Array.isArray(v) && numbers(v) && v.length === 2 && v.every(Number.isInteger) && v[0]! >= 0 && v[0]! < 26 && v[1]! >= 0 && v[1]! < 15;
  if (!object(follow) || !keys(follow, ['attackerId', 'defenderId', 'vacated', 'pending', 'outcome'])
    || ![follow.attackerId, follow.defenderId].every(v => v === null || typeof v === 'string')
    || !(follow.vacated === null || pitchSquare(follow.vacated))) fail(17);
  if (follow.pending !== null && (!object(follow.pending) || !keys(follow.pending, ['attackerId', 'from', 'vacated', 'resolvingAge', 'fromObserved'])
    || typeof follow.pending.attackerId !== 'string' || !pitchSquare(follow.pending.from)
    || !(follow.pending.vacated === null || pitchSquare(follow.pending.vacated)) || typeof follow.pending.fromObserved !== 'boolean'
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
  const optionalTurnKeys: readonly string[] = TURN_RESCUE_CONTEXT_KEYS;
  const numericTurnKeys = ['armedFailure', 'lastFailure', 'failureSeq'];
  if (!object(turn) || !('turnoverArmed' in turn) || !('turnoverAfterInjury' in turn)
    || Object.keys(turn).some((k) => k !== 'turnoverArmed' && k !== 'turnoverAfterInjury' && !optionalTurnKeys.includes(k))
    || optionalTurnKeys.some((k) => k in turn && (numericTurnKeys.includes(k) ? !Number.isSafeInteger(turn[k]) : typeof turn[k] !== 'string'))
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
  if (!object(skill) || !(keys(skill, ['current', 'lastScatter', 'hmpTrail']) || keys(skill, ['current', 'lastScatter']))) fail(33);
  const trail = skill.hmpTrail ?? null; // a checkpoint written before the trail existed has no such key
  const square = (v: unknown) => numbers(v) && (v as unknown[]).length === 2 && (v as number[]).every((n) => Number.isInteger(n));
  if (trail !== null && (!object(trail) || !keys(trail, ['gameId', 'playerId', 'aim', 'ball', 'scattering', 'final', 'lost', 'steps', 'decision'])
    || typeof trail.gameId !== 'string' || typeof trail.playerId !== 'string' || !square(trail.aim) || !(trail.ball === null || square(trail.ball))
    || ![trail.scattering, trail.final, trail.lost].every((v) => typeof v === 'boolean')
    || !Array.isArray(trail.steps) || trail.steps.length > 3 || !trail.steps.every(square)
    || !(trail.decision === null || (object(trail.decision) && keys(trail.decision, ['ordinal', 'direction', 'square']) && (trail.decision.square === null || square(trail.decision.square))
      && Number.isInteger(trail.decision.ordinal) && Number(trail.decision.ordinal) >= 1 && Number(trail.decision.ordinal) <= 3
      && typeof trail.decision.direction === 'string' && !!trail.decision.direction.trim())))) fail(55);
  if (skill.lastScatter !== null && (!object(skill.lastScatter) || !keys(skill.lastScatter, ['occurrence', 'gameId', 'playerId', 'context'])
    || ![skill.lastScatter.occurrence, skill.lastScatter.gameId, skill.lastScatter.playerId].every((v) => typeof v === 'string') || !scatterValid(skill.lastScatter.context))) fail(34);
  if (skill.current !== null) {
    const c = skill.current;
    if (!object(c) || !keys(c, ['occurrence', 'playerId', 'skill', 'details']) || ![c.occurrence, c.playerId, c.skill].every((v) => typeof v === 'string') || !object(c.details)) fail(35);
    const d = c.details;
    if (Object.keys(d).some((k) => !['roll', 'result', 'needed', 'injuryResult', 'armorDice', 'hmpScatter', 'modifyingSkill', 'modifiedResult'].includes(k))
      || ('roll' in d && !finite(d.roll)) || ('needed' in d && !finite(d.needed))
      || ('result' in d && !oneOf(PASS_RE_ROLL_RESULTS, d.result))
      || ('modifyingSkill' in d && (typeof d.modifyingSkill !== 'string' || !d.modifyingSkill.trim()))
      || ('modifiedResult' in d && !oneOf(PASS_RE_ROLL_RESULTS, d.modifiedResult))
      || ('injuryResult' in d && !oneOf(INJURY_RESULT_NAMES, d.injuryResult))
      || ('armorDice' in d && (!Array.isArray(d.armorDice) || d.armorDice.length !== 2 || !d.armorDice.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)))
      || ('hmpScatter' in d && !scatterValid(d.hmpScatter))) fail(36);
  }
  const result = p.apothecaryResult;
  if (result !== null && (!object(result) || !withSpp(result, ['playerId', 'player', 'side', 'square', 'oldInjury', 'newInjury', 'oldRoll', 'newRoll']) || !validSpp(result)
    || ![result.playerId, result.player, result.oldInjury, result.newInjury].every((v) => typeof v === 'string') || !oneOf(TEAM_SIDES, result.side)
    || !(result.square === null || (numbers(result.square) && result.square.length === 2)) || ![result.oldRoll, result.newRoll].every((v) => v === null || finite(v)))) fail(37);
  const apo = p.apothecaryCard;
  if (apo !== null) {
    const injuryKeys = ['index', 'playerId', 'player', 'side', 'square', 'base', 'outcome', 'injury', 'offeredTypes', 'options'];
    if (!object(apo) || !withSpp(apo, ['kind', 'teamId', ...injuryKeys, 'noneLabel', 'coach', 'injuries']) || !validSpp(apo)
      || !oneOf(APOTHECARY_OFFER_KINDS, apo.kind) || !nullableString(apo.teamId) || typeof apo.coach !== 'string'
      || !oneOf(APOTHECARY_NONE_LABELS, apo.noneLabel) || !Array.isArray(apo.injuries) || !apo.injuries.length) fail(38);
    for (const injury of [apo, ...apo.injuries]) {
      if (!object(injury) || (injury !== apo && !withSpp(injury, injuryKeys)) || !validSpp(injury) || !Number.isInteger(injury.index) || injury.index < 0
        || ![injury.playerId, injury.player, injury.injury].every((v) => typeof v === 'string') || !oneOf(TEAM_SIDES, injury.side)
        || !Number.isInteger(injury.base) || !oneOf(APOTHECARY_OUTCOMES, injury.outcome)
        || !(injury.square === null || (numbers(injury.square) && injury.square.length === 2)) || !strings(injury.offeredTypes)
        || !injury.offeredTypes.every((t) => oneOf(APOTHECARY_TYPES, t)) || !Array.isArray(injury.options)
        || injury.options.some((o) => !object(o) || !keys(o, ['type', 'label']) || typeof o.label !== 'string' || !(o.type === null || oneOf(APOTHECARY_TYPES, o.type)))) fail(39);
    }
  }
  const blockCard = p.blockCard;
  // owner 10-13 (Astra): rerolledDice = distinct integer die indexes within the card's dice
  const validRerolledDice = (value: unknown, dice: unknown) => Array.isArray(value) && Array.isArray(dice)
    && value.every((i) => Number.isInteger(i) && i >= 0 && i < dice.length) && new Set(value).size === value.length;
  if (blockCard !== null) {
    const bools = ['pickable', 'opponentRerollPending', 'chooserTeamRerollAvailable', 'teamRR', 'mascot', 'mascotTrr', 'pro', 'brawler', 'consummate'] as const;
    const labels = ['consummateLabel', 'singleBlockDie', 'singleBlockDieLabel', 'multiBlockDice', 'multiBlockDiceLabel', 'singleSkull', 'singleSkullLabel'] as const;
    // owner 10-13: `choosingTeamId` (the dice owner) is optional so checkpoints written before it existed still validate
    // owner 10-13: `rerolledDice` (the reroll re-tumble) is optional too: absent on a fresh roll and in older checkpoints
    const cardKeys = ['dice', 'nrOfDice', ...bools, ...labels];
    const optionalCardKeys = ['choosingTeamId', 'rerolledDice', 'lonerRetumble'];
    const cardKeySet = object(blockCard) ? Object.keys(blockCard) : [];
    if (!object(blockCard) || cardKeys.some((k) => !cardKeySet.includes(k)) || cardKeySet.some((k) => !cardKeys.includes(k) && !optionalCardKeys.includes(k))
      || ('choosingTeamId' in blockCard && !nullableString((blockCard as { choosingTeamId?: unknown }).choosingTeamId))
      || ('rerolledDice' in blockCard && !validRerolledDice((blockCard as { rerolledDice?: unknown }).rerolledDice, blockCard.dice))
      || ('lonerRetumble' in blockCard && (blockCard as { lonerRetumble?: unknown }).lonerRetumble !== true)
      || !numbers(blockCard.dice) || !finite(blockCard.nrOfDice)
      || !bools.every((k) => typeof blockCard[k] === 'boolean') || !labels.every((k) => nullableString(blockCard[k]))) fail(40);
  }
  const card = p.reRollCard;
  if (card !== null) {
    const required = ['playerId', 'reRolledAction', 'label', 'options', 'title', 'question', 'messages', 'fumble', 'loner', 'thresholdless'];
    const optional = ['result', 'roll', 'needed', 'lonerValue', 'dialogId', 'combinations'];
    if (!object(card) || required.some((k) => !(k in card)) || Object.keys(card).some((k) => ![...required, ...optional].includes(k))
      || ![card.playerId, card.reRolledAction, card.label, card.title, card.question].every((v) => typeof v === 'string') || !strings(card.messages)
      || ![card.fumble, card.loner, card.thresholdless].every((v) => typeof v === 'boolean') || !Array.isArray(card.options)) fail(41);
    // S36: a `modifier-choice` option also carries the received skillArray and its minimumRoll.
    if (card.options.some((o) => !object(o)
      || !(keys(o, ['label', 'source', 'response', 'role']) || (o.response === 'modifier-choice' && keys(o, ['label', 'source', 'response', 'role', 'skillArray', 'minimumRoll'])
        && strings(o.skillArray) && finite(o.minimumRoll)))
      || typeof o.label !== 'string' || typeof o.source !== 'string'
      || !oneOf(RE_ROLL_RESPONSES, o.response) || !oneOf(RE_ROLL_OPTION_ROLES, o.role))) fail(42);
    if (('dialogId' in card && card.dialogId !== 'reRollModifierChoice')
      || ('combinations' in card && (!Array.isArray(card.combinations)
        || card.combinations.some((c) => !object(c) || !keys(c, ['label', 'minimumRoll']) || typeof c.label !== 'string' || !finite(c.minimumRoll))))) fail(42);
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
  if (b !== null && (!object(b) || !keys(b, ['id', 'targetId', 'side', 'turnKey', 'visible', 'targetLive'])
    || ![b.id, b.targetId, b.turnKey].every((v) => typeof v === 'string') || typeof b.side !== 'boolean' || typeof b.visible !== 'boolean' || typeof b.targetLive !== 'boolean')) fail(46);
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
