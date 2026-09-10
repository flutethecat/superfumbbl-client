import { dialogDescriptor } from '../dialogRegistry';
import { playerActionFallbackState } from '../playerActionRegistry';
import type { MoveRailDiagnostic, RailDiagnosticSink } from '../railDiagnostics';
import type { DecisionContext, RailId } from './contracts';
import {
  findShadowHandler,
  runShadowHandler,
  shadowHandler,
  type ShadowEvent,
  type ShadowRailFrame,
} from './handlers';

export const SHADOW_DIAGNOSTIC_PREFIX = '[rail-shadow] divergence';

export type DialogResolution = 'known-surface' | 'unknown-panel';
export type LegacyOutgoingOutcome = 'emitted' | 'dropped';
export type RefusalClassification = 'agree-send' | 'agree-refuse' | 'false-refusal' | 'false-permit';
export type RefusalDivergenceCounts = Record<RefusalClassification, number>;

export function createRefusalDivergenceCounts(): RefusalDivergenceCounts {
  return { 'agree-send': 0, 'agree-refuse': 0, 'false-refusal': 0, 'false-permit': 0 };
}

export interface ShadowFrameInput {
  commandNr: number;
  game: Readonly<unknown>;
  reports: readonly Readonly<Record<string, unknown>>[];
  dialog: Readonly<Record<string, unknown>> | null;
}

export interface ShadowModelObservation {
  frame: Readonly<ShadowFrameInput>;
  legacyDialogResolution: DialogResolution | null;
  legacyActionState: string | null;
}

const DIALOG_RAILS: Readonly<Record<string, RailId>> = Object.freeze({
  skillUse: 'skill-use',
  reRoll: 'reroll',
  reRollProperties: 'reroll',
  reRollForTargets: 'reroll',
  reRollBlockForTargets: 'reroll',
  reRollBlockForTargetsProperties: 'reroll',
  reRollRegenerationMultiple: 'reroll',
  interception: 'reaction',
  defenderAction: 'reaction',
  followupChoice: 'reaction',
  touchback: 'square-picker',
  selectWeather: 'square-picker',
  selectGazeTarget: 'square-picker',
  selectBlitzTarget: 'square-picker',
  selectPosition: 'square-picker',
  puntToCrowd: 'reactive-dialog',
  useApothecary: 'inducement',
  useApothecaries: 'inducement',
  useIgor: 'inducement',
  useIgors: 'inducement',
  useMortuaryAssistant: 'inducement',
  useMortuaryAssistants: 'inducement',
  bribes: 'inducement',
  buyInducements: 'inducement',
  buyCards: 'inducement',
  buyCardsAndInducements: 'inducement',
  buyPrayersAndInducements: 'inducement',
  pettyCash: 'inducement',
  kickOffResult: 'kickoff',
  receiveChoice: 'kickoff',
  coinChoice: 'kickoff',
});

const ACTION_RAILS: Readonly<Record<string, RailId>> = Object.freeze({
  move: 'move', standUp: 'move', secureTheBall: 'move',
  block: 'block', multipleBlock: 'block', breatheFire: 'block', chainsaw: 'block',
  stab: 'block', projectileVomit: 'block', chomp: 'block', viciousVines: 'block',
  blitz: 'blitz', blitzMove: 'blitz', blitzSelect: 'blitz', standUpBlitz: 'blitz',
  putridRegurgitationBlitz: 'blitz', kickEmBlitz: 'blitz',
  foul: 'foul', foulMove: 'foul',
  handOver: 'pass-family', handOverMove: 'pass-family', pass: 'pass-family', passMove: 'pass-family',
  hailMaryPass: 'pass-family', dumpOff: 'pass-family', throwBomb: 'pass-family', hailMaryBomb: 'pass-family',
  throwTeamMate: 'pass-family', throwTeamMateMove: 'pass-family', kickTeamMate: 'pass-family',
  kickTeamMateMove: 'pass-family', swoop: 'pass-family', punt: 'pass-family', puntMove: 'pass-family',
});

const COMMAND_RAILS: Readonly<Record<string, RailId>> = Object.freeze({
  clientMove: 'move', clientUseFumblerooskie: 'move',
  clientBlock: 'block', clientBlockChoice: 'block', clientPushback: 'block', clientFollowupChoice: 'block',
  clientSetBlockTargetSelection: 'block', clientUnsetBlockTargetSelection: 'block',
  clientSynchronousMultiBlock: 'block', clientBlockOrReRollChoiceForTarget: 'block',
  clientUseConsummateReRollForBlock: 'block', clientUseProReRollForBlock: 'block',
  clientUseSingleBlockDieReRoll: 'block', clientUseMultiBlockDiceReRoll: 'block', clientUseBrawler: 'block',
  clientBlitzMove: 'blitz', blitzTargetSelected: 'blitz', targetSelected: 'blitz',
  clientFoul: 'foul', clientArgueTheCall: 'foul',
  clientHandOver: 'pass-family', clientPass: 'pass-family', clientThrowTeamMate: 'pass-family',
  clientKickTeamMate: 'pass-family', clientSwoop: 'pass-family', clientThrowKeg: 'pass-family',
  clientUseSkill: 'special-action', clientPileDriver: 'special-action', clientUseChainsaw: 'special-action',
  clientBloodlustAction: 'special-action', clientUseHatred: 'special-action', clientGaze: 'special-action',
  clientFieldCoordinate: 'square-picker', clientSelectWeather: 'square-picker',
  clientPickUpChoice: 'square-picker', clientPositionSelection: 'square-picker',
  clientPuntToCrowd: 'reactive-dialog',
  clientTouchback: 'square-picker',
  clientUseReRoll: 'reroll', clientUseReRollForTarget: 'reroll',
  clientInterceptorChoice: 'reaction',
  clientUseApothecary: 'inducement', clientApothecaryChoice: 'inducement',
  clientUseApothecaries: 'inducement', clientUseIgors: 'inducement', clientUseInducement: 'inducement',
  clientBuyInducements: 'inducement', clientPettyCash: 'inducement', clientBuyCard: 'inducement',
  clientSelectCardToBuy: 'inducement', clientJourneymen: 'inducement',
  clientCoinChoice: 'kickoff', clientReceiveChoice: 'kickoff', clientKickoff: 'kickoff',
  clientKickOffResultChoice: 'kickoff', clientStartGame: 'kickoff',
  clientSetupPlayer: 'setup',
  clientConcedeGame: 'end-game',
  clientPlayerChoice: 'reactive-dialog', clientConfirm: 'reactive-dialog',
  clientPrayerSelection: 'reactive-dialog', clientKeywordSelection: 'reactive-dialog',
  clientUseTeamMatesWisdom: 'reactive-dialog', clientWizardSpell: 'reactive-dialog',
});

const IGNORED_COMMANDS = new Set([
  'clientJoin', 'clientJoinReplay', 'clientTalk', 'clientPing', 'clientCloseSession',
  'clientPasswordChallenge', 'clientRequestVersion', 'clientUserSettings', 'clientDebugClientState',
  'clientReplay', 'clientReplayStatus', 'clientTransferReplayControl', 'clientIllegalProcedure',
  'clientSetMarker', 'clientUpdatePlayerMarkings', 'clientLoadPlayerMarkings',
  'clientTeamSetupLoad', 'clientTeamSetupSave', 'clientTeamSetupDelete',
  'clientAddSketch', 'clientRemoveSketches', 'clientSketchAddCoordinate', 'clientSketchSetColor',
  'clientSketchSetLabel', 'clientClearSketches', 'clientSetPreventSketching',
]);

export function railForDialog(dialogId: string): RailId {
  if (!dialogDescriptor(dialogId)) return 'unknown';
  return DIALOG_RAILS[dialogId] ?? 'reactive-dialog';
}

export function railForAction(action: string): RailId {
  return ACTION_RAILS[action] ?? (playerActionFallbackState(action) === 'UNKNOWN' ? 'unknown' : 'special-action');
}

export function railForCommand(
  command: Readonly<Record<string, unknown>>,
  game?: Readonly<unknown>,
): RailId | null {
  const id = String(command.netCommandId ?? '');
  if (!id || IGNORED_COMMANDS.has(id)) return null;
  if (id === 'clientActingPlayer') {
    const action = String(command.playerAction ?? '');
    if (action) return railForAction(action);
    const actingAction = String((game as { actingPlayer?: { playerAction?: unknown } } | undefined)
      ?.actingPlayer?.playerAction ?? '');
    return actingAction && railForAction(actingAction) === 'move' ? 'move' : null;
  }
  if (id === 'clientEndTurn') {
    const turnMode = String(command.turnMode ?? (game as { turnMode?: unknown } | undefined)?.turnMode ?? '');
    return ['setup', 'swarming', 'swarmingError', 'highKick', 'quickSnap', 'solidDefence', 'perfectDefence', 'dwarfenWisdom']
      .includes(turnMode) ? 'setup' : 'turn-control';
  }
  return COMMAND_RAILS[id] ?? (id.startsWith('client') ? 'unknown' : null);
}

export function actionStateShadowInScope(game: Readonly<unknown>, action: string): boolean {
  const model = game as { turnMode?: unknown; fieldModel?: { pushbackSquareArray?: unknown } };
  const turnMode = String(model.turnMode ?? '');
  const pushbacks = model.fieldModel?.pushbackSquareArray;
  // The fallback matches legacy only in basic action frames.
  return (turnMode === 'regular' || turnMode === 'blitz')
    && (pushbacks == null || (Array.isArray(pushbacks) && pushbacks.length === 0))
    && action !== 'multipleBlock';
}

function frameWithEvent(frame: Readonly<ShadowFrameInput>, event: Readonly<ShadowEvent>): ShadowRailFrame {
  return { ...frame, event };
}

function emitDivergence(
  diagnostic: RailDiagnosticSink,
  rail: RailId,
  key: string,
  expected: string,
  actual: string,
): void {
  diagnostic({
    rail,
    code: 'shadow-divergence',
    key,
    expected,
    actual,
    message: `${SHADOW_DIAGNOSTIC_PREFIX} rail=${rail} key=${key} expected=${expected} actual=${actual}`,
  });
}

function emitRefusalDivergence(
  diagnostic: RailDiagnosticSink,
  rail: RailId,
  key: string,
  classification: 'false-refusal' | 'false-permit',
): void {
  const expected = classification === 'false-refusal' ? 'shadow-refusal' : 'shadow-send';
  const actual = classification === 'false-refusal' ? 'legacy-emitted' : 'legacy-dropped';
  diagnostic({
    rail,
    code: classification,
    key,
    expected,
    actual,
    message: `${SHADOW_DIAGNOSTIC_PREFIX} rail=${rail} key=${key} classification=${classification} expected=${expected} actual=${actual}`,
  });
}

function emitMoveStateDiagnostic(state: Readonly<unknown>, diagnostic: RailDiagnosticSink): void {
  const value = (state as { diagnostic?: Readonly<MoveRailDiagnostic> | null }).diagnostic;
  if (value?.rail === 'move' && value.code === 'unknown-state') diagnostic(value);
}

function observeEvent(
  frame: Readonly<ShadowFrameInput>,
  event: Readonly<ShadowEvent>,
  diagnostic: RailDiagnosticSink,
): void {
  const handler = shadowHandler(event.rail);
  const state = handler.reduce(handler.initial, frameWithEvent(frame, event));
  handler.present(state);
  if (event.rail === 'move') emitMoveStateDiagnostic(state, diagnostic);
}

export function observeShadowModel(
  observation: Readonly<ShadowModelObservation>,
  diagnostic: RailDiagnosticSink,
): void {
  const dialogId = String(observation.frame.dialog?.dialogId ?? '');
  if (dialogId && observation.legacyDialogResolution) {
    const rail = railForDialog(dialogId);
    const expected: DialogResolution = dialogDescriptor(dialogId)?.handling === 'unhandled'
      ? 'unknown-panel'
      : dialogDescriptor(dialogId) ? 'known-surface' : 'unknown-panel';
    observeEvent(observation.frame, { kind: 'dialog', rail, key: dialogId, resolution: expected }, diagnostic);
    if (expected !== observation.legacyDialogResolution) {
      emitDivergence(diagnostic, rail, dialogId, expected, observation.legacyDialogResolution);
    }
  }

  const acting = observation.frame.game as { actingPlayer?: { playerId?: unknown; playerAction?: unknown } };
  const playerId = String(acting.actingPlayer?.playerId ?? '');
  const action = String(acting.actingPlayer?.playerAction ?? '');
  if (!playerId || !action || observation.legacyActionState == null
    || !actionStateShadowInScope(observation.frame.game, action)) return;
  const mappedRail = railForAction(action);
  const moveSquares = (observation.frame.game as { fieldModel?: { moveSquareArray?: unknown[] } })
    .fieldModel?.moveSquareArray;
  // A server-published move offer plus an unregistered action is an unknown moving state, not a
  // reason to reopen selection. Route it through the Move owner so it locks and diagnoses.
  const rail = mappedRail === 'unknown' && Array.isArray(moveSquares) && moveSquares.length > 0
    ? 'move'
    : mappedRail;
  const expected = (observation.frame.game as { waitingForOpponent?: boolean }).waitingForOpponent
    ? 'WAIT'
    : playerActionFallbackState(action);
  const key = `${playerId}:${action}`;
  observeEvent(observation.frame, { kind: 'action-state', rail, key, state: expected }, diagnostic);
  if (expected !== observation.legacyActionState) {
    emitDivergence(diagnostic, rail, key, expected, observation.legacyActionState);
  }
}

export function observeShadowOutgoing(
  frame: Readonly<ShadowFrameInput>,
  command: Readonly<Record<string, unknown>>,
  context: Readonly<DecisionContext>,
  legacyOutcome: LegacyOutgoingOutcome,
  diagnostic: RailDiagnosticSink,
  counts?: RefusalDivergenceCounts,
): RefusalClassification | null {
  const rail = railForCommand(command, frame.game);
  if (!rail) return null;
  const key = String(command.netCommandId ?? '');
  const ownerTeamId = String(frame.dialog?.choosingTeamId ?? frame.dialog?.teamId ?? '') || null;
  const shadowFrame = frameWithEvent(frame, { kind: 'outgoing', rail, key, command, ownerTeamId });
  const handler = shadowHandler(rail);
  const { state, decision } = runShadowHandler(handler, shadowFrame, context);
  if (rail === 'move') emitMoveStateDiagnostic(state, diagnostic);
  // owned = builds the wire; observed = classified but never projected. Undefined keeps generic
  // observe-only handlers in scope so their capability probe cannot pass vacuously.
  if (handler.ownedCommandIds !== undefined
      && !handler.ownedCommandIds.has(key)
      && !handler.observedCommandIds?.has(key)) return null;
  // Meero stage-2 ruling 3: the old approved-command comparison was tautological because the generic
  // handler copied this observed command into its decision and spread it back out. Refusal presence is
  // therefore the load-bearing outgoing signal; compare it with the independently recorded legacy gate.
  const classification: RefusalClassification = decision
    ? legacyOutcome === 'emitted' ? 'agree-send' : 'false-permit'
    : legacyOutcome === 'emitted' ? 'false-refusal' : 'agree-refuse';
  if (counts) counts[classification]++;
  if (classification === 'false-refusal' || classification === 'false-permit') {
    emitRefusalDivergence(diagnostic, rail, key, classification);
  }

  // Keep value drift as a separate signal. It is meaningful only when both paths elect to send;
  // owning handlers can build independently, while generic observe-only handlers still copy input.
  if (decision && legacyOutcome === 'emitted') {
    const expected = handler.command(decision);
    const expectedValue = stableValue(expected);
    const actualValue = stableValue(command);
    if (expectedValue !== actualValue) emitDivergence(diagnostic, rail, key, expectedValue, actualValue);
  }
  return classification;
}

/**
 * Cutover projection for commands explicitly owned by their rail handler. The central store transport
 * gates call this only after legacy authorization succeeds. Refusing an owned command is fail-closed;
 * a command the handler never builds must pass through untouched or the projection breaks the legacy path.
 */
export function projectOwnedOutgoingCommand(
  frame: Readonly<ShadowFrameInput>,
  command: Readonly<Record<string, unknown>>,
  context: Readonly<DecisionContext>,
  diagnostic: RailDiagnosticSink,
): Record<string, unknown> | null {
  const rail = railForCommand(command, frame.game);
  if (!rail) return command as Record<string, unknown>;
  const key = String(command.netCommandId ?? '');
  const handler = findShadowHandler(rail);
  if (!handler) {
    // Fail-closed applies when an owning handler refuses. A missing handler is a config gap;
    // dropping a live command here would break the legacy path, so unregistered rails fail open.
    diagnostic({
      rail,
      code: 'missing-handler',
      netCommandId: key,
      message: `[rail-shadow] missing handler; passing through rail=${rail} netCommandId=${key}`,
    });
    return command as Record<string, unknown>;
  }
  if (!handler.ownedCommandIds?.has(key)) return command as Record<string, unknown>;
  const shadowFrame = frameWithEvent(frame, {
    kind: 'outgoing', rail, key, command,
    ownerTeamId: String(frame.dialog?.choosingTeamId ?? frame.dialog?.teamId ?? '') || null,
  });
  const { decision } = runShadowHandler(handler, shadowFrame, context);
  return decision ? handler.command(decision) : null;
}

function stableValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`).join(',')}}`;
}
